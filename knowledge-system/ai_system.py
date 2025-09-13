#!/usr/bin/env python3
"""
CAIA AI System - Main AI Infrastructure Orchestrator
Production-ready AI-first agentic system with local LLM support
"""

import asyncio
import logging
import signal
import sys
from pathlib import Path
from typing import Dict, Any, Optional, List
import yaml
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import structlog

# Import AI core components
from ai_core.llm_manager import LLMManager
from ai_core.embedding_service import EmbeddingService
from ai_core.vector_store import VectorStoreManager
from ai_core.rag_pipeline import RAGPipeline

# Import agents
from agents.base_agent import BaseAgent, AgentResult
from agents.knowledge_agent import KnowledgeAgent
# from agents.reasoning_agent import ReasoningAgent
# from agents.coding_agent import CodingAgent

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

# Pydantic models for API
class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

class ChatResponse(BaseModel):
    response: str
    conversation_id: str
    sources: List[Dict[str, Any]] = []
    confidence: float = 0.0
    metadata: Dict[str, Any] = {}

class DocumentRequest(BaseModel):
    content: str
    metadata: Optional[Dict[str, Any]] = None
    chunk: bool = True

class DocumentResponse(BaseModel):
    document_id: str
    status: str
    chunks_created: int = 0

class HealthResponse(BaseModel):
    status: str
    components: Dict[str, Any]
    timestamp: str


class AISystem:
    """Main AI System orchestrator"""
    
    def __init__(self, config_path: str = "config/ai_config.yaml"):
        self.config_path = Path(config_path)
        self.config = self._load_config()
        
        # Core components
        self.llm_manager: Optional[LLMManager] = None
        self.embedding_service: Optional[EmbeddingService] = None
        self.vector_store: Optional[VectorStoreManager] = None
        self.rag_pipeline: Optional[RAGPipeline] = None
        
        # Agents
        self.agents: Dict[str, BaseAgent] = {}
        self.active_conversations: Dict[str, Any] = {}
        
        # System state
        self.is_running = False
        self.startup_complete = False
        
        # FastAPI app
        self.app = FastAPI(
            title="CAIA AI System",
            description="Advanced AI-first agentic system with local LLM support",
            version="1.0.0"
        )
        
        self._setup_api_routes()
        self._setup_middleware()
        
        logger.info("AI System initialized", config_path=str(self.config_path))
    
    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from YAML file"""
        try:
            with open(self.config_path, 'r') as f:
                config = yaml.safe_load(f)
            
            logger.info("Configuration loaded successfully", 
                       config_file=str(self.config_path))
            return config
            
        except Exception as e:
            logger.error("Failed to load configuration", 
                        error=str(e), config_path=str(self.config_path))
            raise
    
    def _setup_middleware(self):
        """Setup FastAPI middleware"""
        # CORS
        cors_config = self.config.get('api', {}).get('cors', {})
        if cors_config.get('enabled', True):
            self.app.add_middleware(
                CORSMiddleware,
                allow_origins=cors_config.get('origins', ["*"]),
                allow_credentials=True,
                allow_methods=["*"],
                allow_headers=["*"],
            )
    
    def _setup_api_routes(self):
        """Setup FastAPI routes"""
        
        @self.app.get("/health", response_model=HealthResponse)
        async def health_check():
            """System health check"""
            if not self.startup_complete:
                raise HTTPException(status_code=503, detail="System starting up")
            
            health_data = await self.get_system_health()
            return HealthResponse(
                status="healthy" if all(health_data['components'].values()) else "degraded",
                components=health_data['components'],
                timestamp=health_data['timestamp']
            )
        
        @self.app.post("/chat", response_model=ChatResponse)
        async def chat(request: ChatRequest):
            """Chat with the AI system using RAG"""
            if not self.startup_complete:
                raise HTTPException(status_code=503, detail="System not ready")
            
            try:
                conversation_id = request.conversation_id or f"conv_{len(self.active_conversations)}"
                
                # Use RAG pipeline for response
                rag_result = await self.rag_pipeline.query(
                    query=request.message,
                    filters=request.config.get('filters') if request.config else None,
                    max_sources=request.config.get('max_sources', 5) if request.config else 5
                )
                
                # Store conversation state
                self.active_conversations[conversation_id] = {
                    'last_query': request.message,
                    'last_response': rag_result.answer,
                    'sources': [source.__dict__ for source in rag_result.sources]
                }
                
                return ChatResponse(
                    response=rag_result.answer,
                    conversation_id=conversation_id,
                    sources=[source.__dict__ for source in rag_result.sources],
                    confidence=rag_result.confidence,
                    metadata=rag_result.metadata
                )
                
            except Exception as e:
                logger.error("Chat request failed", error=str(e))
                raise HTTPException(status_code=500, detail=str(e))
        
        @self.app.post("/documents", response_model=DocumentResponse)
        async def add_document(request: DocumentRequest):
            """Add document to knowledge base"""
            if not self.startup_complete:
                raise HTTPException(status_code=503, detail="System not ready")
            
            try:
                documents = [{
                    'content': request.content,
                    'metadata': request.metadata or {}
                }]
                
                doc_ids = await self.rag_pipeline.add_documents(
                    documents=documents,
                    chunk_documents=request.chunk
                )
                
                return DocumentResponse(
                    document_id=doc_ids[0] if doc_ids else "unknown",
                    status="success",
                    chunks_created=len(doc_ids)
                )
                
            except Exception as e:
                logger.error("Document addition failed", error=str(e))
                raise HTTPException(status_code=500, detail=str(e))
        
        @self.app.get("/agents")
        async def list_agents():
            """List all available agents"""
            agents_info = {}
            for agent_name, agent in self.agents.items():
                agents_info[agent_name] = agent.get_stats()
            return agents_info
        
        @self.app.post("/agents/{agent_name}/execute")
        async def execute_agent(agent_name: str, task: str):
            """Execute task with specific agent"""
            if agent_name not in self.agents:
                raise HTTPException(status_code=404, detail=f"Agent {agent_name} not found")
            
            try:
                agent = self.agents[agent_name]
                result = await agent.execute(task)
                
                return {
                    "agent_name": agent_name,
                    "task": task,
                    "success": result.success,
                    "result": result.result,
                    "execution_time": result.execution_time,
                    "iterations": result.iterations
                }
                
            except Exception as e:
                logger.error("Agent execution failed", agent=agent_name, error=str(e))
                raise HTTPException(status_code=500, detail=str(e))
        
        @self.app.get("/system/info")
        async def system_info():
            """Get system information"""
            return {
                "config": {
                    "llm_providers": list(self.config.get('llm', {}).get('providers', {}).keys()),
                    "vector_stores": list(self.config.get('vector_db', {}).get('providers', {}).keys()),
                    "embedding_models": list(self.config.get('embeddings', {}).get('models', {}).keys())
                },
                "stats": {
                    "agents_count": len(self.agents),
                    "active_conversations": len(self.active_conversations),
                    "startup_complete": self.startup_complete
                }
            }
    
    async def initialize(self):
        """Initialize all AI system components"""
        logger.info("Starting AI system initialization...")
        
        try:
            # Initialize core components in order
            await self._initialize_llm_manager()
            await self._initialize_embedding_service()
            await self._initialize_vector_store()
            await self._initialize_rag_pipeline()
            await self._initialize_agents()
            
            # Pull Ollama models if configured
            await self._pull_ollama_models()
            
            self.startup_complete = True
            logger.info("AI system initialization completed successfully")
            
        except Exception as e:
            logger.error("AI system initialization failed", error=str(e))
            raise
    
    async def _initialize_llm_manager(self):
        """Initialize LLM Manager"""
        logger.info("Initializing LLM Manager...")
        self.llm_manager = LLMManager(self.config)
        
        # Health check
        health = await self.llm_manager.health_check()
        if not any(health.values()):
            logger.warning("No LLM providers are healthy", health=health)
        else:
            logger.info("LLM Manager initialized", health=health)
    
    async def _initialize_embedding_service(self):
        """Initialize Embedding Service"""
        logger.info("Initializing Embedding Service...")
        self.embedding_service = EmbeddingService(self.config)
        
        # Health check
        health = await self.embedding_service.health_check()
        logger.info("Embedding Service initialized", health=health)
    
    async def _initialize_vector_store(self):
        """Initialize Vector Store"""
        logger.info("Initializing Vector Store...")
        self.vector_store = VectorStoreManager(self.config)
        
        # Health check
        health = await self.vector_store.health_check()
        logger.info("Vector Store initialized", health=health)
    
    async def _initialize_rag_pipeline(self):
        """Initialize RAG Pipeline"""
        logger.info("Initializing RAG Pipeline...")
        self.rag_pipeline = RAGPipeline(
            llm_manager=self.llm_manager,
            embedding_service=self.embedding_service,
            vector_store=self.vector_store,
            config=self.config
        )
        
        # Health check
        health = await self.rag_pipeline.health_check()
        logger.info("RAG Pipeline initialized", health=health)
    
    async def _initialize_agents(self):
        """Initialize AI Agents"""
        logger.info("Initializing AI Agents...")
        
        agents_config = self.config.get('agents', {})
        
        # Initialize Knowledge Agent
        if 'knowledge_agent' in agents_config.get('types', {}):
            try:
                knowledge_config = agents_config['types']['knowledge_agent']
                self.agents['knowledge'] = KnowledgeAgent(
                    name="Knowledge Agent",
                    llm_manager=self.llm_manager,
                    rag_pipeline=self.rag_pipeline,
                    config=knowledge_config
                )
                logger.info("Knowledge Agent initialized")
            except Exception as e:
                logger.error("Failed to initialize Knowledge Agent", error=str(e))
        
        # TODO: Initialize other agents (ReasoningAgent, CodingAgent, etc.)
        
        logger.info("AI Agents initialized", count=len(self.agents))
    
    async def _pull_ollama_models(self):
        """Pull configured Ollama models"""
        ollama_config = self.config.get('llm', {}).get('providers', {}).get('ollama', {})
        
        if ollama_config.get('auto_pull', False):
            logger.info("Pulling Ollama models...")
            models = ollama_config.get('models', {})
            
            for role, model_name in models.items():
                try:
                    success = await self.llm_manager.pull_ollama_model(model_name)
                    if success:
                        logger.info("Pulled Ollama model", role=role, model=model_name)
                    else:
                        logger.warning("Failed to pull Ollama model", role=role, model=model_name)
                except Exception as e:
                    logger.error("Error pulling Ollama model", role=role, model=model_name, error=str(e))
    
    async def get_system_health(self) -> Dict[str, Any]:
        """Get comprehensive system health"""
        health = {
            'components': {},
            'timestamp': structlog.processors.TimeStamper(fmt="iso")(None, None, {})['timestamp']
        }
        
        if self.llm_manager:
            health['components']['llm'] = await self.llm_manager.health_check()
        
        if self.embedding_service:
            health['components']['embeddings'] = await self.embedding_service.health_check()
        
        if self.vector_store:
            health['components']['vector_store'] = await self.vector_store.health_check()
        
        if self.rag_pipeline:
            health['components']['rag_pipeline'] = await self.rag_pipeline.health_check()
        
        # Agent health
        agent_health = {}
        for agent_name, agent in self.agents.items():
            agent_health[agent_name] = await agent.health_check()
        health['components']['agents'] = agent_health
        
        return health
    
    async def shutdown(self):
        """Graceful shutdown"""
        logger.info("Shutting down AI system...")
        
        self.is_running = False
        
        # Reset agents
        for agent in self.agents.values():
            await agent.reset()
        
        # Clear conversations
        self.active_conversations.clear()
        
        logger.info("AI system shutdown complete")
    
    def run(self, host: str = "0.0.0.0", port: int = 5555):
        """Run the AI system"""
        
        async def startup():
            await self.initialize()
            self.is_running = True
        
        async def shutdown():
            await self.shutdown()
        
        # Setup signal handlers
        def signal_handler(signum, frame):
            logger.info("Received shutdown signal", signal=signum)
            asyncio.create_task(shutdown())
        
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        
        # Configure uvicorn
        api_config = self.config.get('api', {})
        
        uvicorn.run(
            self.app,
            host=host,
            port=port,
            workers=api_config.get('workers', 1),
            log_level="info",
            on_startup=[startup],
            on_shutdown=[shutdown]
        )


# Standalone execution
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="CAIA AI System")
    parser.add_argument("--config", default="config/ai_config.yaml", help="Configuration file path")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=5555, help="Port to bind to")
    parser.add_argument("--log-level", default="INFO", help="Logging level")
    
    args = parser.parse_args()
    
    # Configure logging level
    logging.basicConfig(level=getattr(logging, args.log_level.upper()))
    
    # Create and run AI system
    ai_system = AISystem(config_path=args.config)
    
    try:
        ai_system.run(host=args.host, port=args.port)
    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt, shutting down...")
    except Exception as e:
        logger.error("Unexpected error", error=str(e))
        sys.exit(1)