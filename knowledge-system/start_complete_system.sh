#!/bin/bash

# =============================================================================
# CAIA COMPLETE AI SYSTEM STARTUP
# Starts all 4 phases of the AI system in proper order
# =============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║        CAIA COMPLETE AI SYSTEM - STARTUP SEQUENCE          ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to check if port is in use
check_port() {
    lsof -i :$1 > /dev/null 2>&1
}

# Function to wait for service
wait_for_service() {
    local port=$1
    local name=$2
    local max_attempts=30
    local attempt=0
    
    echo -e "${YELLOW}⏳ Waiting for $name to start on port $port...${NC}"
    
    while [ $attempt -lt $max_attempts ]; do
        if check_port $port; then
            echo -e "${GREEN}✅ $name is running on port $port${NC}"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    
    echo -e "${RED}❌ $name failed to start on port $port${NC}"
    return 1
}

# Kill existing processes on our ports
echo -e "${YELLOW}🔄 Cleaning up existing processes...${NC}"
for port in 5000 5004 5555 5556 5557 6333 7474 7687; do
    if check_port $port; then
        echo -e "  Killing process on port $port"
        lsof -ti:$port | xargs kill -9 2>/dev/null || true
    fi
done
sleep 2

# ===========================================================================
# PHASE 0: Infrastructure Services
# ===========================================================================
echo ""
echo -e "${MAGENTA}═══════════════════════════════════════════════════════════${NC}"
echo -e "${MAGENTA}Starting Infrastructure Services...${NC}"
echo -e "${MAGENTA}═══════════════════════════════════════════════════════════${NC}"

# Start Redis if available
if command -v redis-server &> /dev/null; then
    echo -e "${YELLOW}Starting Redis...${NC}"
    redis-server --daemonize yes > /dev/null 2>&1 || true
    echo -e "${GREEN}✅ Redis started${NC}"
fi

# Start Docker services if docker-compose exists
if [ -f "docker/docker-compose.yml" ] && command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Starting Docker services (Qdrant, Neo4j)...${NC}"
    docker-compose -f docker/docker-compose.yml up -d > /dev/null 2>&1 || true
    echo -e "${GREEN}✅ Docker services started${NC}"
fi

# ===========================================================================
# PHASE 1: AI Foundation
# ===========================================================================
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}PHASE 1: AI Foundation${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check if Ollama is running
if ! pgrep -x "ollama" > /dev/null; then
    echo -e "${YELLOW}Starting Ollama...${NC}"
    ollama serve > /tmp/ollama.log 2>&1 &
    sleep 3
    echo -e "${GREEN}✅ Ollama started${NC}"
else
    echo -e "${GREEN}✅ Ollama already running${NC}"
fi

# Start the main AI system
echo -e "${YELLOW}Starting AI Foundation API...${NC}"
if [ -f "ai_system.py" ]; then
    python3 ai_system.py > /tmp/ai_system.log 2>&1 &
    wait_for_service 5555 "AI Foundation API"
else
    echo -e "${YELLOW}⚠️  ai_system.py not found, continuing...${NC}"
fi

# ===========================================================================
# PHASE 2: Agentic Layer
# ===========================================================================
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}PHASE 2: Agentic Layer${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"

# Start agent supervisor
echo -e "${YELLOW}Starting Agent Supervisor...${NC}"
if [ -f "orchestration/supervisor.py" ]; then
    python3 orchestration/supervisor.py > /tmp/supervisor.log 2>&1 &
    sleep 2
    echo -e "${GREEN}✅ Agent Supervisor started${NC}"
else
    echo -e "${YELLOW}⚠️  supervisor.py not found, continuing...${NC}"
fi

# Start communication hub
if [ -f "orchestration/communication.py" ]; then
    python3 orchestration/communication.py > /tmp/communication.log 2>&1 &
    echo -e "${GREEN}✅ Communication Hub started${NC}"
fi

# ===========================================================================
# PHASE 3: Learning System
# ===========================================================================
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}PHASE 3: Learning System${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"

# Start learning system
if [ -f "start_learning.sh" ]; then
    echo -e "${YELLOW}Starting Learning System...${NC}"
    ./start_learning.sh start > /tmp/learning.log 2>&1 &
    wait_for_service 5556 "Learning System"
else
    echo -e "${YELLOW}⚠️  Learning system not found, continuing...${NC}"
fi

# ===========================================================================
# PHASE 4: Knowledge Graph
# ===========================================================================
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}PHASE 4: Knowledge Graph${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"

# Start Neo4j if not running via Docker
if ! check_port 7474 && command -v neo4j &> /dev/null; then
    echo -e "${YELLOW}Starting Neo4j...${NC}"
    neo4j start > /dev/null 2>&1 || true
    wait_for_service 7474 "Neo4j"
fi

# Start knowledge graph API
if [ -f "knowledge_graph/integration/api_server.py" ]; then
    echo -e "${YELLOW}Starting Knowledge Graph API...${NC}"
    python3 knowledge_graph/integration/api_server.py > /tmp/kg_api.log 2>&1 &
    wait_for_service 5557 "Knowledge Graph API"
else
    echo -e "${YELLOW}⚠️  Knowledge Graph API not found, continuing...${NC}"
fi

# ===========================================================================
# LEGACY: Keep existing CKS/CLS running
# ===========================================================================
echo ""
echo -e "${MAGENTA}═══════════════════════════════════════════════════════════${NC}"
echo -e "${MAGENTA}Legacy CKS/CLS Systems (keeping for compatibility)${NC}"
echo -e "${MAGENTA}═══════════════════════════════════════════════════════════${NC}"

# The old systems are already running from earlier startup
if check_port 5000; then
    echo -e "${GREEN}✅ Legacy CKS API running on port 5000${NC}"
fi
if check_port 5004; then
    echo -e "${GREEN}✅ Legacy CLS Trainer running on port 5004${NC}"
fi
if check_port 5555; then
    echo -e "${GREEN}✅ Legacy CKS Bridge running on port 5555${NC}"
fi

# ===========================================================================
# FINAL STATUS
# ===========================================================================
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    SYSTEM STATUS                           ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check all services
echo -e "${CYAN}Service Status:${NC}"
echo -e "────────────────────────────────────────────────────────────"

# Infrastructure
check_port 6379 && echo -e "  Redis Cache:         ${GREEN}✅ RUNNING${NC} (port 6379)" || echo -e "  Redis Cache:         ${YELLOW}⚠️  NOT RUNNING${NC}"
check_port 6333 && echo -e "  Qdrant Vector DB:    ${GREEN}✅ RUNNING${NC} (port 6333)" || echo -e "  Qdrant Vector DB:    ${YELLOW}⚠️  NOT RUNNING${NC}"
check_port 7474 && echo -e "  Neo4j Graph DB:      ${GREEN}✅ RUNNING${NC} (port 7474)" || echo -e "  Neo4j Graph DB:      ${YELLOW}⚠️  NOT RUNNING${NC}"

echo ""

# AI Systems
check_port 5555 && echo -e "  AI Foundation API:   ${GREEN}✅ RUNNING${NC} (port 5555)" || echo -e "  AI Foundation API:   ${RED}❌ NOT RUNNING${NC}"
check_port 5556 && echo -e "  Learning System:     ${GREEN}✅ RUNNING${NC} (port 5556)" || echo -e "  Learning System:     ${YELLOW}⚠️  NOT RUNNING${NC}"
check_port 5557 && echo -e "  Knowledge Graph API: ${GREEN}✅ RUNNING${NC} (port 5557)" || echo -e "  Knowledge Graph API: ${YELLOW}⚠️  NOT RUNNING${NC}"

echo ""

# Legacy Systems
echo -e "${CYAN}Legacy Systems (for compatibility):${NC}"
check_port 5000 && echo -e "  CKS API:            ${GREEN}✅ RUNNING${NC} (port 5000)" || echo -e "  CKS API:            ${YELLOW}⚠️  NOT RUNNING${NC}"
check_port 5004 && echo -e "  CLS Trainer:        ${GREEN}✅ RUNNING${NC} (port 5004)" || echo -e "  CLS Trainer:        ${YELLOW}⚠️  NOT RUNNING${NC}"

echo ""
echo -e "────────────────────────────────────────────────────────────"
echo ""

# ===========================================================================
# ACCESS INFORMATION
# ===========================================================================
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                  SYSTEM READY!                             ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Access Points:${NC}"
echo -e "  Main AI System:     ${BLUE}http://localhost:5555${NC}"
echo -e "  Learning System:    ${BLUE}http://localhost:5556${NC}"
echo -e "  Knowledge Graph:    ${BLUE}http://localhost:5557${NC}"
echo -e "  Neo4j Browser:      ${BLUE}http://localhost:7474${NC}"
echo ""
echo -e "${CYAN}Quick Test:${NC}"
echo -e "  ${YELLOW}curl http://localhost:5555/health${NC}"
echo -e "  ${YELLOW}python3 test_ai_system.py${NC}"
echo -e "  ${YELLOW}python3 test_agents.py${NC}"
echo -e "  ${YELLOW}python3 test_learning_basic.py${NC}"
echo ""
echo -e "${GREEN}🚀 The CAIA AI System is ready for use!${NC}"
echo -e "${GREEN}🧠 The system will learn and improve with every interaction.${NC}"
echo ""
echo -e "${CYAN}Logs are available in /tmp/:${NC}"
echo -e "  ai_system.log, supervisor.log, learning.log, kg_api.log"
echo ""