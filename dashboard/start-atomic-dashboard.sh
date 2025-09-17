#!/bin/bash

# CAIA Atomic Dashboard Launcher
# Comprehensive system monitoring at atomic level

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     🚀 Starting CAIA Atomic Dashboard                      ║"
echo "╚════════════════════════════════════════════════════════════╝"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check dependencies
echo -e "\n${YELLOW}Checking dependencies...${NC}"

# Check if npm packages are installed
cd /Users/MAC/Documents/projects/caia/dashboard

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install express axios sqlite3 --save
fi

# Kill any existing atomic dashboard server
echo -e "\n${YELLOW}Stopping any existing dashboard servers...${NC}"
pkill -f "atomic-server.js" 2>/dev/null

# Start all required services if not running
echo -e "\n${YELLOW}Checking required services...${NC}"

# Check CKS
if ! curl -s http://localhost:5555/health >/dev/null 2>&1; then
    echo -e "${YELLOW}Starting CKS...${NC}"
    cd /Users/MAC/Documents/projects/caia/knowledge-system
    python3 cks_bridge.py &
    sleep 2
fi

# Check Enhancement System
if ! curl -s http://localhost:5002/health >/dev/null 2>&1; then
    echo -e "${YELLOW}Starting Enhancement System...${NC}"
    cd /Users/MAC/Documents/projects/caia/knowledge-system/cc-enhancement
    ./start-daemon.sh &
    sleep 2
fi

# Check Learning System
if ! curl -s http://localhost:5003/health >/dev/null 2>&1; then
    echo -e "${YELLOW}Starting Learning System...${NC}"
    cd /Users/MAC/Documents/projects/caia/knowledge-system
    python3 enhanced_learning_api.py &
    sleep 2
fi

# Start the atomic dashboard server
echo -e "\n${GREEN}Starting Atomic Dashboard Server...${NC}"
cd /Users/MAC/Documents/projects/caia/dashboard
node atomic-server.js &

DASHBOARD_PID=$!

# Wait for server to start
sleep 3

# Check if server is running
if kill -0 $DASHBOARD_PID 2>/dev/null; then
    echo -e "\n${GREEN}✅ Dashboard server started successfully!${NC}"

    # Try to open in browser
    if command -v open &> /dev/null; then
        echo -e "${GREEN}Opening dashboard in browser...${NC}"
        open "http://localhost:3457/"
    else
        echo -e "${GREEN}Open your browser to: http://localhost:3457/${NC}"
    fi

    echo -e "\n${YELLOW}Dashboard Controls:${NC}"
    echo "  • View Dashboard: http://localhost:3457/"
    echo "  • API Endpoint:   http://localhost:3457/api/dashboard-data"
    echo "  • Stop Dashboard: pkill -f atomic-server.js"
    echo ""
    echo -e "${GREEN}Dashboard is running in the background.${NC}"
    echo -e "${YELLOW}To view logs: tail -f /tmp/atomic-dashboard.log${NC}"

    # Keep logs
    node atomic-server.js >> /tmp/atomic-dashboard.log 2>&1
else
    echo -e "\n${RED}❌ Failed to start dashboard server${NC}"
    exit 1
fi