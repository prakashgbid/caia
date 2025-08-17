#!/usr/bin/env python3
"""
Independent ChatGPT MCP Server

A standalone server that provides ChatGPT access through multiple managed sessions.
Implements human-like behavior and anti-detection measures.
Can be called by any client, including autonomous agents.
"""

import asyncio
import json
import random
import time
import hashlib
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from pathlib import Path
from enum import Enum
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from playwright.async_api import async_playwright, Browser, Page, BrowserContext
import uvicorn


# Request/Response Models
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    session_type: str = "general"
    human_mode: bool = True


class ChatResponse(BaseModel):
    response: str
    session_id: str
    thinking_time: float
    timestamp: datetime


class SessionStatus(BaseModel):
    session_id: str
    status: str
    messages_count: int
    created_at: datetime
    last_used: datetime
    purpose: str


# Human behavior simulator
class HumanSimulator:
    """Simulates human-like interaction patterns"""
    
    @staticmethod
    def calculate_typing_delay(text: str) -> float:
        """Calculate realistic typing delay"""
        wpm = random.uniform(40, 80)
        words = len(text.split())
        base_time = (words / wpm) * 60
        
        # Add thinking time for questions
        if "?" in text:
            base_time += random.uniform(1, 3)
        
        # Add variation
        return base_time * random.uniform(0.8, 1.2)
    
    @staticmethod
    def calculate_reading_time(text: str) -> float:
        """Calculate time to read response"""
        words = len(text.split())
        reading_speed = random.uniform(200, 300)
        return (words / reading_speed) * 60 + random.uniform(0.5, 2)
    
    @staticmethod
    def should_take_break(session_start: datetime) -> bool:
        """Determine if break is needed"""
        duration = datetime.now() - session_start
        if duration > timedelta(minutes=random.uniform(25, 45)):
            return random.random() > 0.3
        return False
    
    @staticmethod
    def get_activity_pattern() -> str:
        """Get activity pattern based on time"""
        hour = datetime.now().hour
        if 6 <= hour < 9:
            return "morning"
        elif 9 <= hour < 12:
            return "focused"
        elif 12 <= hour < 13:
            return "lunch"
        elif 13 <= hour < 17:
            return "productive"
        elif 17 <= hour < 20:
            return "evening"
        elif 20 <= hour < 23:
            return "relaxed"
        else:
            return "minimal"


# Session Manager
class ChatGPTSession:
    """Manages a single ChatGPT browser session"""
    
    def __init__(self, session_id: str, context: BrowserContext, purpose: str = "general"):
        self.id = session_id
        self.context = context
        self.page: Optional[Page] = None
        self.purpose = purpose
        self.created_at = datetime.now()
        self.last_used = datetime.now()
        self.message_count = 0
        self.is_busy = False
        self.conversation_history = []
    
    async def initialize(self) -> bool:
        """Initialize the session"""
        try:
            self.page = await self.context.new_page()
            await self.page.goto("https://chat.openai.com", wait_until="networkidle")
            
            # Start new chat
            new_chat = self.page.locator('a[href="/"]').first
            if await new_chat.is_visible():
                await new_chat.click()
                await asyncio.sleep(1)
            
            logging.info(f"Session {self.id} initialized")
            return True
        except Exception as e:
            logging.error(f"Session {self.id} init failed: {e}")
            return False
    
    async def send_message(self, message: str, human_mode: bool = True) -> Dict[str, Any]:
        """Send message with optional human simulation"""
        if not self.page:
            await self.initialize()
        
        self.is_busy = True
        self.last_used = datetime.now()
        start_time = time.time()
        
        try:
            # Human-like typing delay
            typing_delay = 0
            if human_mode:
                typing_delay = HumanSimulator.calculate_typing_delay(message)
                await asyncio.sleep(typing_delay)
            
            # Type and send message
            input_field = self.page.locator('textarea[placeholder*="Message"]').first
            await input_field.fill(message)
            
            if human_mode:
                await asyncio.sleep(random.uniform(0.5, 1.5))
            
            await input_field.press("Enter")
            self.message_count += 1
            
            # Wait for response
            await self._wait_for_response()
            response_text = await self._get_last_response()
            
            # Human-like reading time
            reading_time = 0
            if human_mode:
                reading_time = HumanSimulator.calculate_reading_time(response_text)
                await asyncio.sleep(reading_time)
            
            # Track conversation
            self.conversation_history.append({
                'message': message,
                'response': response_text,
                'timestamp': datetime.now()
            })
            
            total_time = time.time() - start_time
            
            return {
                'response': response_text,
                'session_id': self.id,
                'thinking_time': total_time,
                'typing_delay': typing_delay,
                'reading_time': reading_time
            }
            
        finally:
            self.is_busy = False
    
    async def _wait_for_response(self):
        """Wait for ChatGPT to complete response"""
        try:
            # Wait for stop button to appear and disappear
            stop_button = 'button:has-text("Stop generating")'
            await self.page.wait_for_selector(stop_button, timeout=60000, state="attached")
            await self.page.wait_for_selector(stop_button, timeout=60000, state="detached")
        except:
            await asyncio.sleep(2)
    
    async def _get_last_response(self) -> str:
        """Get the last assistant response"""
        responses = await self.page.locator('[data-message-author-role="assistant"]').all()
        if responses:
            return await responses[-1].text_content() or ""
        return ""
    
    def needs_rest(self) -> bool:
        """Check if session needs a break"""
        session_duration = datetime.now() - self.created_at
        return (
            session_duration > timedelta(minutes=random.uniform(30, 45)) or
            self.message_count > random.randint(15, 25)
        )
    
    def get_status(self) -> SessionStatus:
        """Get session status"""
        return SessionStatus(
            session_id=self.id,
            status="busy" if self.is_busy else "available",
            messages_count=self.message_count,
            created_at=self.created_at,
            last_used=self.last_used,
            purpose=self.purpose
        )


# Main MCP Server
class ChatGPTMCPServer:
    """Independent MCP server managing multiple ChatGPT sessions"""
    
    def __init__(self, max_sessions: int = 3):
        self.max_sessions = max_sessions
        self.sessions: Dict[str, ChatGPTSession] = {}
        self.browser: Optional[Browser] = None
        self.playwright = None
        self.storage_path = Path.home() / ".chatgpt-mcp"
        self.storage_path.mkdir(exist_ok=True)
        self.activity_log = []
        
        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(self.storage_path / "server.log"),
                logging.StreamHandler()
            ]
        )
    
    async def initialize(self):
        """Initialize the MCP server"""
        logging.info("🚀 Initializing ChatGPT MCP Server...")
        
        # Start Playwright
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=False,  # Set to True after initial login
            args=['--disable-blink-features=AutomationControlled']
        )
        
        # Load saved session if exists
        await self._load_saved_state()
        
        logging.info(f"✅ MCP Server ready with max {self.max_sessions} sessions")
    
    async def shutdown(self):
        """Gracefully shutdown the server"""
        logging.info("Shutting down MCP Server...")
        
        # Save state
        await self._save_state()
        
        # Close all sessions
        for session in self.sessions.values():
            if session.page:
                await session.page.close()
            await session.context.close()
        
        # Close browser
        if self.browser:
            await self.browser.close()
        
        if self.playwright:
            await self.playwright.stop()
        
        logging.info("✅ MCP Server shutdown complete")
    
    async def get_or_create_session(self, session_type: str = "general") -> ChatGPTSession:
        """Get available session or create new one"""
        # Find available session of same type
        for session in self.sessions.values():
            if not session.is_busy and session.purpose == session_type and not session.needs_rest():
                logging.info(f"Reusing session {session.id}")
                return session
        
        # Remove sessions that need rest
        sessions_to_remove = [
            sid for sid, session in self.sessions.items()
            if session.needs_rest()
        ]
        for sid in sessions_to_remove:
            logging.info(f"Retiring session {sid} (needs rest)")
            await self.sessions[sid].context.close()
            del self.sessions[sid]
        
        # Create new session if under limit
        if len(self.sessions) < self.max_sessions:
            session_id = f"session_{len(self.sessions) + 1}_{int(time.time())}"
            
            # Create context with saved cookies
            context = await self.browser.new_context(
                storage_state=await self._get_storage_state()
            )
            
            session = ChatGPTSession(session_id, context, session_type)
            success = await session.initialize()
            
            if success:
                self.sessions[session_id] = session
                logging.info(f"Created new session: {session_id}")
                
                # Save cookies after successful init
                await self._save_storage_state(context)
                
                return session
            else:
                await context.close()
                raise HTTPException(status_code=500, detail="Failed to create session")
        
        # Wait for available session
        for _ in range(30):  # Wait up to 30 seconds
            for session in self.sessions.values():
                if not session.is_busy:
                    return session
            await asyncio.sleep(1)
        
        raise HTTPException(status_code=503, detail="No sessions available")
    
    async def chat(self, request: ChatRequest) -> ChatResponse:
        """Process chat request"""
        # Log activity
        self.activity_log.append({
            'timestamp': datetime.now(),
            'message': request.message[:50],
            'session_type': request.session_type
        })
        
        # Get or create session
        if request.session_id and request.session_id in self.sessions:
            session = self.sessions[request.session_id]
        else:
            session = await self.get_or_create_session(request.session_type)
        
        # Send message
        result = await session.send_message(request.message, request.human_mode)
        
        return ChatResponse(
            response=result['response'],
            session_id=session.id,
            thinking_time=result['thinking_time'],
            timestamp=datetime.now()
        )
    
    async def get_status(self) -> Dict[str, Any]:
        """Get server status"""
        return {
            'active_sessions': len(self.sessions),
            'max_sessions': self.max_sessions,
            'sessions': [session.get_status().dict() for session in self.sessions.values()],
            'activity_pattern': HumanSimulator.get_activity_pattern(),
            'total_messages': sum(s.message_count for s in self.sessions.values()),
            'uptime': str(datetime.now() - self.activity_log[0]['timestamp']) if self.activity_log else "0:00:00"
        }
    
    async def _get_storage_state(self) -> Optional[str]:
        """Get saved browser storage state"""
        storage_file = self.storage_path / "browser_state.json"
        if storage_file.exists():
            return str(storage_file)
        return None
    
    async def _save_storage_state(self, context: BrowserContext):
        """Save browser storage state"""
        storage_file = self.storage_path / "browser_state.json"
        await context.storage_state(path=str(storage_file))
        logging.info("Saved browser state")
    
    async def _save_state(self):
        """Save server state"""
        state = {
            'sessions': [
                {
                    'id': s.id,
                    'purpose': s.purpose,
                    'message_count': s.message_count,
                    'created_at': s.created_at.isoformat()
                }
                for s in self.sessions.values()
            ],
            'activity_log': [
                {
                    'timestamp': a['timestamp'].isoformat(),
                    'message': a['message'],
                    'session_type': a['session_type']
                }
                for a in self.activity_log[-100:]  # Keep last 100
            ]
        }
        
        state_file = self.storage_path / "server_state.json"
        with open(state_file, 'w') as f:
            json.dump(state, f, indent=2)
    
    async def _load_saved_state(self):
        """Load saved server state"""
        state_file = self.storage_path / "server_state.json"
        if state_file.exists():
            with open(state_file, 'r') as f:
                state = json.load(f)
                
                # Restore activity log
                for entry in state.get('activity_log', []):
                    self.activity_log.append({
                        'timestamp': datetime.fromisoformat(entry['timestamp']),
                        'message': entry['message'],
                        'session_type': entry['session_type']
                    })
                
                logging.info(f"Loaded {len(self.activity_log)} activity log entries")


# FastAPI app with lifespan management
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app.state.mcp_server = ChatGPTMCPServer(max_sessions=3)
    await app.state.mcp_server.initialize()
    yield
    # Shutdown
    await app.state.mcp_server.shutdown()


app = FastAPI(title="ChatGPT MCP Server", version="1.0.0", lifespan=lifespan)


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Send a message to ChatGPT"""
    return await app.state.mcp_server.chat(request)


@app.get("/status")
async def get_status():
    """Get server status"""
    return await app.state.mcp_server.get_status()


@app.get("/sessions")
async def get_sessions():
    """Get all sessions"""
    return {
        'sessions': [
            session.get_status().dict() 
            for session in app.state.mcp_server.sessions.values()
        ]
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket for real-time communication"""
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            
            if data['type'] == 'chat':
                request = ChatRequest(**data['payload'])
                response = await app.state.mcp_server.chat(request)
                await websocket.send_json({
                    'type': 'response',
                    'payload': response.dict()
                })
            
            elif data['type'] == 'status':
                status = await app.state.mcp_server.get_status()
                await websocket.send_json({
                    'type': 'status',
                    'payload': status
                })
                
    except WebSocketDisconnect:
        logging.info("WebSocket disconnected")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now()}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)