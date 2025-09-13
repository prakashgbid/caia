# CAIA AI-First Agentic System

A production-ready AI infrastructure with local LLM support, advanced RAG capabilities, and intelligent agent frameworks.

## 🚀 Phase 1 Foundation Complete

This is a true AI-native system built from the ground up with:

- **Local LLM Infrastructure** - Ollama integration with intelligent fallback
- **Multi-Vector Database Support** - ChromaDB, Qdrant, FAISS
- **Advanced RAG Pipeline** - Hybrid search, reranking, confidence scoring  
- **Agent Framework** - LangGraph-based agents with memory and tools
- **Production-Ready API** - FastAPI with health monitoring and async support

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     CAIA AI System                         │
├─────────────────────────────────────────────────────────────┤
│  FastAPI Web Layer (Port 5555)                             │
│  ├── /health     ├── /chat      ├── /documents             │
│  ├── /agents     ├── /system    └── /docs                  │
├─────────────────────────────────────────────────────────────┤
│  AI Core Components                                         │
│  ├── LLM Manager (Ollama + Cloud APIs)                     │
│  ├── Embedding Service (Sentence Transformers)             │
│  ├── Vector Store Manager (Multi-backend)                  │
│  └── RAG Pipeline (Advanced Retrieval + Generation)        │
├─────────────────────────────────────────────────────────────┤
│  Agent Framework (LangGraph)                               │
│  ├── Base Agent (State management)                         │
│  ├── Knowledge Agent (RAG specialist)                      │
│  ├── Reasoning Agent (Logic & analysis)                    │
│  └── Coding Agent (Code generation & analysis)             │
├─────────────────────────────────────────────────────────────┤
│  Learning & Memory                                          │
│  ├── Continual Learning                                     │
│  ├── Feedback Processing                                    │
│  └── Memory Management                                      │
├─────────────────────────────────────────────────────────────┤
│  Knowledge Graph                                            │
│  ├── Entity Extraction                                      │
│  ├── Relation Detection                                     │
│  └── Semantic Reasoning                                     │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure (Docker)                                   │
│  ├── Qdrant (Vector DB)      ├── Redis (Caching)          │
│  ├── Neo4j (Graph DB)        ├── Prometheus (Monitoring)   │
│  └── ChromaDB (Local Vector) └── Grafana (Visualization)   │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
knowledge-system/
├── 🧠 ai_core/                    # Core AI infrastructure
│   ├── llm_manager.py            # Multi-LLM management with failover
│   ├── embedding_service.py      # Advanced embedding with caching
│   ├── vector_store.py           # Multi-backend vector storage
│   └── rag_pipeline.py           # Production RAG with reranking
│
├── 🤖 agents/                     # LangGraph-based agent framework
│   ├── base_agent.py             # Foundation agent with state management
│   ├── knowledge_agent.py        # RAG-specialized knowledge agent
│   ├── reasoning_agent.py        # Logic and reasoning agent
│   └── coding_agent.py           # Code generation and analysis
│
├── 📚 learning/                   # AI learning and adaptation
│   ├── continual_learner.py      # Continual learning implementation
│   ├── feedback_processor.py     # User feedback integration
│   └── memory_manager.py         # Advanced memory management
│
├── 🕸️ knowledge_graph/           # Semantic knowledge representation
│   ├── graph_manager.py          # Knowledge graph management
│   ├── semantic_reasoner.py      # Graph-based reasoning
│   └── entity_extractor.py       # NER and entity management
│
├── 🐳 docker/                     # Container infrastructure
│   ├── docker-compose.yml        # Multi-service orchestration
│   └── data/                     # Persistent storage volumes
│
├── ⚙️ config/                     # Configuration management
│   └── ai_config.yaml            # Comprehensive system config
│
├── 🚀 ai_system.py               # Main system orchestrator
├── 🔧 setup_ai_system.sh         # Automated setup script
└── 📋 ai_requirements.txt        # AI-specific dependencies
```

## 🚀 Quick Start

### 1. Setup (Automated)
```bash
# Run the automated setup
./setup_ai_system.sh

# This will:
# - Create virtual environment
# - Install all dependencies  
# - Pull Ollama models
# - Start Docker services
# - Create configuration files
```

### 2. Start the System
```bash
# Start all services
./start_ai_system.sh

# Or manually:
source venv/bin/activate
python3 ai_system.py --port 5555
```

### 3. Test the System
```bash
# Run test suite
python3 test_ai_system.py

# Or test endpoints manually
curl http://localhost:5555/health
curl http://localhost:5555/system/info
```

## 💬 API Endpoints

### Core Endpoints

**Health Check**
```http
GET /health
```

**Chat with AI**
```http
POST /chat
{
  "message": "Explain quantum computing",
  "conversation_id": "conv_001",
  "config": {
    "max_sources": 5,
    "filters": {"domain": "physics"}
  }
}
```

**Add Documents**
```http
POST /documents
{
  "content": "Your document content here...",
  "metadata": {"source": "research_paper", "domain": "AI"},
  "chunk": true
}
```

**Execute Agents**
```http
POST /agents/knowledge/execute
{
  "task": "Research the latest developments in transformer architecture"
}
```

## 🎯 Key Features

### Local-First AI
- **Ollama Integration**: Run powerful models locally (Llama 3.1, CodeLlama, etc.)
- **Smart Fallback**: Automatic failover to cloud APIs when needed
- **Privacy-Focused**: Keep sensitive data on your infrastructure

### Advanced RAG
- **Hybrid Search**: Combines semantic and keyword search
- **Reranking**: Cross-encoder reranking for better relevance
- **Confidence Scoring**: Reliability indicators for responses
- **Multi-Source**: Intelligent source combination and citation

### Production-Ready
- **Health Monitoring**: Comprehensive health checks for all components
- **Async Architecture**: Non-blocking operations throughout
- **Error Recovery**: Graceful failure handling and retries
- **Structured Logging**: JSON logs with correlation IDs

### Scalable Infrastructure
- **Multi-Vector DB**: Choose between ChromaDB, Qdrant, or FAISS
- **Container Support**: Docker Compose for easy deployment
- **Memory Management**: Intelligent caching and memory optimization
- **Load Balancing**: Ready for horizontal scaling

## 🔧 Configuration

Edit `config/ai_config.yaml` to customize:

```yaml
# LLM Configuration
llm:
  default_provider: "ollama"
  providers:
    ollama:
      base_url: "http://localhost:11434"
      models:
        primary: "llama3.1:8b"
        coding: "codellama:13b"

# Vector Database
vector_db:
  default_provider: "chroma"
  providers:
    chroma:
      persist_directory: "./data/chroma_db"

# RAG Settings
rag:
  retrieval:
    top_k: 10
    similarity_threshold: 0.7
    rerank: true
```

## 🧪 Development

### Adding New Agents
```python
from agents.base_agent import BaseAgent

class MyAgent(BaseAgent):
    async def _plan_action(self, state, context):
        # Your planning logic
        pass
    
    async def _execute_action(self, state):
        # Your execution logic  
        pass
```

### Custom Vector Stores
```python
# Implement in ai_core/vector_store.py
async def _add_to_custom_store(self, documents, embeddings, store):
    # Your custom vector store integration
    pass
```

### Extending RAG Pipeline
```python
# Add to ai_core/rag_pipeline.py
async def _custom_retrieval_strategy(self, query, filters, max_sources):
    # Your custom retrieval logic
    pass
```

## 🔍 Monitoring

### Health Dashboard
- Visit `http://localhost:5555/health` for system status
- Docker services: `docker-compose -f docker/docker-compose.yml ps`
- Grafana dashboard: `http://localhost:3000` (admin/caia_admin_2024)

### Logs
- System logs: `logs/ai_system.log`
- Container logs: `docker-compose logs -f`
- Individual component health via API

## 🚀 Next Phases

### Phase 2: Advanced Agents (Coming Soon)
- Multi-agent coordination
- Tool-use capabilities
- Code execution environment
- Memory persistence

### Phase 3: Learning & Adaptation
- Reinforcement learning from human feedback
- Continual learning pipelines
- Automated model fine-tuning
- Performance optimization

### Phase 4: Scale & Production
- Kubernetes deployment
- Multi-tenant architecture
- Advanced security features
- Enterprise integrations

## 🤝 Contributing

This is Phase 1 of a comprehensive AI system. Key areas for expansion:

1. **More Agents**: Reasoning, coding, research, creative agents
2. **Learning Systems**: RLHF, continual learning, memory systems
3. **Knowledge Graph**: Advanced semantic reasoning and entity management
4. **Production Features**: Authentication, rate limiting, monitoring
5. **Integrations**: External APIs, databases, file systems

## 📜 License

This project is part of the CAIA (Computer-Aided Intelligence Amplification) system.

---

**Status**: ✅ Phase 1 Complete - Core AI infrastructure ready for development

**Next**: Phase 2 - Advanced multi-agent coordination and tool use

**Built with**: Python 3.8+, FastAPI, LangChain/LangGraph, Ollama, Docker