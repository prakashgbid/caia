#!/bin/bash
# Setup script for CAIA AI-First Agentic System
# Installs and configures all AI infrastructure components

set -e

echo "🤖 CAIA AI System Setup Starting..."
echo "================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running in correct directory
if [[ ! -f "ai_system.py" ]]; then
    print_error "Please run this script from the knowledge-system directory"
    exit 1
fi

# Create necessary directories
print_status "Creating directory structure..."
mkdir -p data/{chroma_db,faiss_index,neo4j/{data,logs},prometheus,grafana,qdrant,redis,minio}
mkdir -p cache/embeddings
mkdir -p logs
mkdir -p docker/data/{qdrant,redis,neo4j,prometheus,grafana,chroma,minio}

print_success "Directory structure created"

# Check Python version
print_status "Checking Python version..."
python_version=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
required_version="3.8"

if (( $(echo "$python_version $required_version" | awk '{print ($1 >= $2)}') )); then
    print_success "Python $python_version is compatible"
else
    print_error "Python $required_version or higher is required, found $python_version"
    exit 1
fi

# Check if virtual environment exists, create if not
if [[ ! -d "venv" ]]; then
    print_status "Creating Python virtual environment..."
    python3 -m venv venv
    print_success "Virtual environment created"
fi

# Activate virtual environment
print_status "Activating virtual environment..."
source venv/bin/activate
print_success "Virtual environment activated"

# Upgrade pip
print_status "Upgrading pip..."
pip install --upgrade pip

# Install AI dependencies
print_status "Installing AI system dependencies..."
pip install -r ai_requirements.txt

# Also install the original requirements if they exist
if [[ -f "requirements.txt" ]]; then
    print_status "Installing existing requirements..."
    pip install -r requirements.txt
fi

print_success "Dependencies installed"

# Check Ollama installation
print_status "Checking Ollama installation..."
if command -v ollama &> /dev/null; then
    print_success "Ollama is installed"
    
    # Try to start Ollama service
    print_status "Starting Ollama service..."
    ollama serve &
    OLLAMA_PID=$!
    sleep 5
    
    # Pull basic models
    print_status "Pulling essential Ollama models (this may take a while)..."
    ollama pull llama3.1:8b || print_warning "Failed to pull llama3.1:8b"
    ollama pull nomic-embed-text:latest || print_warning "Failed to pull nomic-embed-text"
    
    print_success "Ollama models pulled"
    
    # Stop the temporary service
    kill $OLLAMA_PID 2>/dev/null || true
    
else
    print_warning "Ollama is not installed"
    echo ""
    echo "To install Ollama, please visit: https://ollama.ai"
    echo "Or run: curl -fsSL https://ollama.ai/install.sh | sh"
    echo ""
    echo "The system will work with OpenAI/Anthropic APIs as fallback"
fi

# Check Docker installation
print_status "Checking Docker installation..."
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    print_success "Docker and docker-compose are installed"
    
    # Ask if user wants to start Docker services
    read -p "Start Docker services (Qdrant, Redis, etc.)? [y/N]: " start_docker
    if [[ $start_docker =~ ^[Yy]$ ]]; then
        print_status "Starting Docker services..."
        cd docker
        docker-compose up -d
        cd ..
        print_success "Docker services started"
        
        # Wait a bit for services to start
        print_status "Waiting for services to initialize..."
        sleep 10
        
        # Check service health
        print_status "Checking service health..."
        docker-compose -f docker/docker-compose.yml ps
    fi
else
    print_warning "Docker is not installed"
    echo ""
    echo "Some vector databases require Docker. Install from: https://docs.docker.com/get-docker/"
    echo "The system will work with ChromaDB in local mode"
fi

# Set up configuration files
print_status "Setting up configuration files..."

# Create .env file if it doesn't exist
if [[ ! -f ".env" ]]; then
    cat > .env << EOF
# AI System Environment Configuration
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
NEO4J_PASSWORD=caia_knowledge_2024

# Logging
LOG_LEVEL=INFO
DEBUG=false

# API Configuration
API_HOST=0.0.0.0
API_PORT=5555

# Vector Database
VECTOR_DB_TYPE=chroma
CHROMA_PERSIST_DIR=./data/chroma_db

# Redis (if using)
REDIS_HOST=localhost
REDIS_PORT=6379

# Development
DEVELOPMENT_MODE=true
EOF
    print_success "Environment file created (.env)"
    print_warning "Please edit .env file to add your API keys"
fi

# Make scripts executable
chmod +x ai_system.py
chmod +x setup_ai_system.sh

# Create startup script
cat > start_ai_system.sh << 'EOF'
#!/bin/bash
# Startup script for CAIA AI System

set -e

echo "🚀 Starting CAIA AI System..."

# Activate virtual environment
if [[ -d "venv" ]]; then
    source venv/bin/activate
    echo "✓ Virtual environment activated"
fi

# Load environment variables
if [[ -f ".env" ]]; then
    export $(grep -v '^#' .env | xargs)
    echo "✓ Environment variables loaded"
fi

# Start Ollama if available
if command -v ollama &> /dev/null; then
    echo "Starting Ollama service..."
    ollama serve &
    OLLAMA_PID=$!
    echo "✓ Ollama started (PID: $OLLAMA_PID)"
    sleep 3
fi

# Start the AI system
echo "Starting AI System API server..."
python3 ai_system.py --host ${API_HOST:-0.0.0.0} --port ${API_PORT:-5555} --log-level ${LOG_LEVEL:-INFO}
EOF

chmod +x start_ai_system.sh

print_success "Startup script created (start_ai_system.sh)"

# Create test script
cat > test_ai_system.py << 'EOF'
#!/usr/bin/env python3
"""
Test script for CAIA AI System
"""

import asyncio
import aiohttp
import json

async def test_ai_system():
    """Test the AI system endpoints"""
    base_url = "http://localhost:5555"
    
    async with aiohttp.ClientSession() as session:
        # Test health endpoint
        print("Testing health endpoint...")
        try:
            async with session.get(f"{base_url}/health") as response:
                if response.status == 200:
                    data = await response.json()
                    print("✓ Health check passed")
                    print(f"  Status: {data.get('status')}")
                else:
                    print(f"✗ Health check failed: {response.status}")
        except Exception as e:
            print(f"✗ Health check error: {e}")
        
        # Test system info
        print("\nTesting system info...")
        try:
            async with session.get(f"{base_url}/system/info") as response:
                if response.status == 200:
                    data = await response.json()
                    print("✓ System info retrieved")
                    print(f"  Agents: {data.get('stats', {}).get('agents_count', 0)}")
                else:
                    print(f"✗ System info failed: {response.status}")
        except Exception as e:
            print(f"✗ System info error: {e}")
        
        # Test chat endpoint
        print("\nTesting chat endpoint...")
        try:
            chat_data = {
                "message": "Hello, can you help me understand AI systems?",
                "conversation_id": "test_001"
            }
            async with session.post(f"{base_url}/chat", json=chat_data) as response:
                if response.status == 200:
                    data = await response.json()
                    print("✓ Chat endpoint works")
                    print(f"  Response length: {len(data.get('response', ''))}")
                    print(f"  Confidence: {data.get('confidence', 0)}")
                else:
                    print(f"✗ Chat failed: {response.status}")
        except Exception as e:
            print(f"✗ Chat error: {e}")

if __name__ == "__main__":
    print("🧪 CAIA AI System Test")
    print("=====================")
    asyncio.run(test_ai_system())
EOF

chmod +x test_ai_system.py

print_success "Test script created (test_ai_system.py)"

# Final instructions
echo ""
echo "🎉 AI System Setup Complete!"
echo "============================="
echo ""
echo "Next steps:"
echo "1. Edit .env file to add your API keys (optional, for OpenAI/Anthropic fallback)"
echo "2. Start the system: ./start_ai_system.sh"
echo "3. Test the system: python3 test_ai_system.py (in another terminal)"
echo "4. Access the API at: http://localhost:5555"
echo ""
echo "API Documentation:"
echo "- Health: GET /health"
echo "- Chat: POST /chat"
echo "- Add Documents: POST /documents"
echo "- System Info: GET /system/info"
echo ""
echo "Key Features:"
echo "✓ Local LLM support (Ollama)"
echo "✓ Multiple vector databases (Chroma, Qdrant, FAISS)"
echo "✓ Advanced RAG pipeline"
echo "✓ AI agent framework"
echo "✓ Embedding service with multiple models"
echo "✓ Docker container support"
echo "✓ Health monitoring"
echo ""
print_success "Setup completed successfully! 🚀"
EOF

chmod +x setup_ai_system.sh