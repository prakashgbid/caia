#!/usr/bin/env python3
"""
ChatGPT MCP Client Library

Simple client for interacting with the ChatGPT MCP Server.
Can be used by autonomous agents or other applications.
"""

import asyncio
import aiohttp
import json
from typing import Optional, Dict, Any
from datetime import datetime


class ChatGPTMCPClient:
    """Client for ChatGPT MCP Server"""
    
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
        self.session: Optional[aiohttp.ClientSession] = None
        self.current_session_id: Optional[str] = None
    
    async def __aenter__(self):
        """Async context manager entry"""
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.close()
    
    async def chat(
        self, 
        message: str, 
        session_type: str = "general",
        human_mode: bool = True,
        use_existing_session: bool = True
    ) -> Dict[str, Any]:
        """
        Send a message to ChatGPT through the MCP server.
        
        Args:
            message: The message to send
            session_type: Type of session (general, research, creative, analytical)
            human_mode: Whether to simulate human behavior
            use_existing_session: Whether to reuse existing session
        
        Returns:
            Response dictionary with ChatGPT's response
        """
        if not self.session:
            self.session = aiohttp.ClientSession()
        
        payload = {
            "message": message,
            "session_type": session_type,
            "human_mode": human_mode
        }
        
        if use_existing_session and self.current_session_id:
            payload["session_id"] = self.current_session_id
        
        async with self.session.post(
            f"{self.base_url}/chat",
            json=payload
        ) as response:
            if response.status == 200:
                result = await response.json()
                self.current_session_id = result.get("session_id")
                return result
            else:
                error = await response.text()
                raise Exception(f"Chat request failed: {error}")
    
    async def get_status(self) -> Dict[str, Any]:
        """Get server status"""
        if not self.session:
            self.session = aiohttp.ClientSession()
        
        async with self.session.get(f"{self.base_url}/status") as response:
            if response.status == 200:
                return await response.json()
            else:
                error = await response.text()
                raise Exception(f"Status request failed: {error}")
    
    async def get_sessions(self) -> Dict[str, Any]:
        """Get all sessions"""
        if not self.session:
            self.session = aiohttp.ClientSession()
        
        async with self.session.get(f"{self.base_url}/sessions") as response:
            if response.status == 200:
                return await response.json()
            else:
                error = await response.text()
                raise Exception(f"Sessions request failed: {error}")
    
    async def health_check(self) -> bool:
        """Check if server is healthy"""
        try:
            if not self.session:
                self.session = aiohttp.ClientSession()
            
            async with self.session.get(f"{self.base_url}/health") as response:
                return response.status == 200
        except:
            return False


class ChatGPTConversation:
    """High-level conversation manager"""
    
    def __init__(self, client: ChatGPTMCPClient, session_type: str = "general"):
        self.client = client
        self.session_type = session_type
        self.history = []
    
    async def ask(self, message: str, human_mode: bool = True) -> str:
        """Ask a question and get response"""
        response = await self.client.chat(
            message=message,
            session_type=self.session_type,
            human_mode=human_mode,
            use_existing_session=True
        )
        
        self.history.append({
            'message': message,
            'response': response['response'],
            'timestamp': response['timestamp']
        })
        
        return response['response']
    
    async def research(self, topic: str, questions: list) -> Dict[str, str]:
        """Conduct research on a topic"""
        results = {}
        
        for question in questions:
            response = await self.ask(question)
            results[question] = response
            
            # Human-like pause between questions
            await asyncio.sleep(5)
        
        return results
    
    async def iterative_refinement(self, initial_prompt: str, iterations: int = 3) -> list:
        """Iteratively refine a response"""
        responses = []
        current_prompt = initial_prompt
        
        for i in range(iterations):
            response = await self.ask(current_prompt)
            responses.append(response)
            
            # Build on previous response
            current_prompt = f"Improve upon this: {response[:500]}..."
            
            await asyncio.sleep(3)
        
        return responses


# Example usage functions
async def simple_chat_example():
    """Simple chat example"""
    async with ChatGPTMCPClient() as client:
        # Check server health
        if not await client.health_check():
            print("❌ Server is not running. Start with: ./start_server.sh")
            return
        
        # Send a message
        response = await client.chat("What is quantum computing?")
        print(f"ChatGPT: {response['response'][:200]}...")
        print(f"Thinking time: {response['thinking_time']:.2f}s")


async def research_example():
    """Research example with multiple questions"""
    async with ChatGPTMCPClient() as client:
        conversation = ChatGPTConversation(client, session_type="research")
        
        # Conduct research
        results = await conversation.research(
            topic="AI Safety",
            questions=[
                "What are the main concerns about AI safety?",
                "What approaches are being developed for AI alignment?",
                "What organizations are working on AI safety?"
            ]
        )
        
        for question, answer in results.items():
            print(f"\nQ: {question}")
            print(f"A: {answer[:200]}...")


async def status_monitor():
    """Monitor server status"""
    async with ChatGPTMCPClient() as client:
        while True:
            try:
                status = await client.get_status()
                print(f"\n📊 Server Status at {datetime.now():%H:%M:%S}")
                print(f"Active sessions: {status['active_sessions']}/{status['max_sessions']}")
                print(f"Total messages: {status['total_messages']}")
                print(f"Activity pattern: {status['activity_pattern']}")
                print(f"Uptime: {status['uptime']}")
                
                await asyncio.sleep(10)
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Error: {e}")
                await asyncio.sleep(5)


if __name__ == "__main__":
    print("ChatGPT MCP Client Examples")
    print("===========================\n")
    
    print("1. Simple chat")
    print("2. Research mode")
    print("3. Status monitor")
    print()
    
    choice = input("Select example (1-3): ")
    
    if choice == "1":
        asyncio.run(simple_chat_example())
    elif choice == "2":
        asyncio.run(research_example())
    elif choice == "3":
        asyncio.run(status_monitor())
    else:
        print("Invalid choice")