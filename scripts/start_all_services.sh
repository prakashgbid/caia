#!/bin/bash

# CAIA Services Startup Script
# Starts CKS, CLS, and Enhancement systems

echo "🚀 Starting CAIA Services..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Base directory
CAIA_BASE="/Users/MAC/Documents/projects/caia"
KNOWLEDGE_BASE="$CAIA_BASE/knowledge-system"

# Function to check if service is running
check_service() {
    local port=$1
    local name=$2
    if curl -s http://localhost:$port/health >/dev/null 2>&1; then
        echo -e "${GREEN}✓ $name already running on port $port${NC}"
        return 0
    else
        return 1
    fi
}

# Function to start service
start_service() {
    local name=$1
    local port=$2
    local cmd=$3

    echo -e "${YELLOW}Starting $name...${NC}"

    # Check if already running
    if check_service $port "$name"; then
        return 0
    fi

    # Start the service
    eval "$cmd" &
    local pid=$!

    # Wait for service to start (max 10 seconds)
    for i in {1..20}; do
        sleep 0.5
        if check_service $port "$name"; then
            echo -e "${GREEN}✓ $name started successfully (PID: $pid)${NC}"
            return 0
        fi
    done

    echo -e "${RED}✗ Failed to start $name${NC}"
    return 1
}

# Kill existing processes if needed
echo "Checking for existing processes..."
pkill -f "api_server.py" 2>/dev/null
pkill -f "learning_api.py" 2>/dev/null
pkill -f "enhancement_api.py" 2>/dev/null
sleep 1

# Start CKS (Knowledge System) on port 5555
start_service "CKS (Knowledge System)" 5555 \
    "cd $KNOWLEDGE_BASE && python3 api/api_server.py"

# Start CLS (Learning System) on port 5003
start_service "CLS (Learning System)" 5003 \
    "cd $KNOWLEDGE_BASE && python3 learning_api.py"

# Start Enhancement System on port 5002
start_service "Enhancement System" 5002 \
    "cd $KNOWLEDGE_BASE/cc-enhancement && python3 api/enhancement_api.py"

echo ""
echo "📊 Service Status Summary:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Final status check
if check_service 5555 "CKS"; then
    CKS_STATUS="${GREEN}✓ Running${NC}"
else
    CKS_STATUS="${RED}✗ Not running${NC}"
fi

if check_service 5003 "CLS"; then
    CLS_STATUS="${GREEN}✓ Running${NC}"
else
    CLS_STATUS="${RED}✗ Not running${NC}"
fi

if check_service 5002 "Enhancement"; then
    ENH_STATUS="${GREEN}✓ Running${NC}"
else
    ENH_STATUS="${RED}✗ Not running${NC}"
fi

echo -e "  CKS (5555): $CKS_STATUS"
echo -e "  CLS (5003): $CLS_STATUS"
echo -e "  Enhancement (5002): $ENH_STATUS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check all services are running
if check_service 5555 "CKS" && check_service 5003 "CLS" && check_service 5002 "Enhancement"; then
    echo -e "${GREEN}✅ All CAIA services are running!${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠ Some services failed to start. Check logs for details.${NC}"
    echo "  Logs: /Users/MAC/.claude/logs/"
    exit 1
fi