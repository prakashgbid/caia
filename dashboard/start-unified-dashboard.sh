#!/bin/bash

# UNIFIED ATOMIC DASHBOARD LAUNCHER
# Single dashboard to rule them all

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     🚀 Starting UNIFIED Atomic Dashboard                   ║"
echo "╚════════════════════════════════════════════════════════════╝"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Change to dashboard directory
cd /Users/MAC/Documents/projects/caia/dashboard

# Kill ALL other dashboards and free up ports
echo -e "\n${YELLOW}Stopping all other dashboards to free up ports...${NC}"

# Kill specific dashboard processes
pkill -f "atomic-server.js" 2>/dev/null
pkill -f "server.js" 2>/dev/null
pkill -f "monitoring_dashboard.py" 2>/dev/null
pkill -f "knowledge_explorer" 2>/dev/null
pkill -f "web-server.js" 2>/dev/null
pkill -f "monitor_dashboard.py" 2>/dev/null
pkill -f "admin_dashboard.py" 2>/dev/null

# Kill processes on common dashboard ports
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:3456 | xargs kill -9 2>/dev/null
lsof -ti:3457 | xargs kill -9 2>/dev/null
lsof -ti:5000 | xargs kill -9 2>/dev/null

echo -e "${GREEN}✅ All other dashboards stopped${NC}"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "\n${YELLOW}Installing dependencies...${NC}"
    npm install express axios sqlite3 --save
fi

# Start required backend services
echo -e "\n${YELLOW}Checking required backend services...${NC}"

# Check CKS
if ! curl -s http://localhost:5555/health >/dev/null 2>&1; then
    echo -e "${YELLOW}Starting CKS (Knowledge System)...${NC}"
    cd /Users/MAC/Documents/projects/caia/knowledge-system
    nohup python3 cks_bridge.py > /tmp/cks.log 2>&1 &
    sleep 2
    if curl -s http://localhost:5555/health >/dev/null 2>&1; then
        echo -e "${GREEN}✅ CKS started on port 5555${NC}"
    fi
    cd -
fi

# Check Enhancement System
if ! curl -s http://localhost:5002/health >/dev/null 2>&1; then
    echo -e "${YELLOW}Starting Enhancement System...${NC}"
    cd /Users/MAC/Documents/projects/caia/knowledge-system/cc-enhancement
    if [ -f "start-daemon.sh" ]; then
        nohup ./start-daemon.sh > /tmp/enhancement.log 2>&1 &
        sleep 2
        if curl -s http://localhost:5002/health >/dev/null 2>&1; then
            echo -e "${GREEN}✅ Enhancement System started on port 5002${NC}"
        fi
    fi
    cd -
fi

# Check Learning System
if ! curl -s http://localhost:5003/health >/dev/null 2>&1; then
    echo -e "${YELLOW}Starting Learning System...${NC}"
    cd /Users/MAC/Documents/projects/caia/knowledge-system
    if [ -f "enhanced_learning_api.py" ]; then
        nohup python3 enhanced_learning_api.py > /tmp/learning.log 2>&1 &
        sleep 2
        if curl -s http://localhost:5003/health >/dev/null 2>&1; then
            echo -e "${GREEN}✅ Learning System started on port 5003${NC}"
        fi
    fi
    cd -
fi

# Start the unified dashboard server
echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Starting UNIFIED Dashboard Server...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

cd /Users/MAC/Documents/projects/caia/dashboard
node unified-atomic-server.js &

DASHBOARD_PID=$!

# Wait for server to start
sleep 3

# Check if server is running
if kill -0 $DASHBOARD_PID 2>/dev/null; then
    echo -e "\n${GREEN}✅ UNIFIED Dashboard server started successfully!${NC}"

    # Summary
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}🎉 ALL DASHBOARDS UNIFIED INTO ONE!${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}Main Dashboard:${NC} http://localhost:3000/"
    echo -e "  ${GREEN}API Endpoint:${NC}   http://localhost:3000/api/dashboard"
    echo ""
    echo -e "  ${YELLOW}Legacy Routes (still work):${NC}"
    echo -e "  • http://localhost:3000/atomic"
    echo -e "  • http://localhost:3000/feature-browser"
    echo ""
    echo -e "  ${BLUE}Consolidated Features:${NC}"
    echo -e "  ✅ CAIA Feature Browser"
    echo -e "  ✅ Knowledge Explorer UI"
    echo -e "  ✅ Hierarchical Agent System UI"
    echo -e "  ✅ Test Orchestrator Dashboard"
    echo -e "  ✅ Learning Monitor"
    echo -e "  ✅ CC Ultimate Monitor"
    echo -e "  ✅ All Admin Scripts"
    echo ""
    echo -e "  ${YELLOW}Controls:${NC}"
    echo -e "  • Stop: pkill -f unified-atomic-server.js"
    echo -e "  • Logs: tail -f /tmp/unified-dashboard.log"
    echo ""

    # Try to open in browser
    if command -v open &> /dev/null; then
        echo -e "${GREEN}Opening dashboard in browser...${NC}"
        open "http://localhost:3000/"
    fi

    # Log output
    echo -e "\n${YELLOW}Dashboard running in background. Logging to /tmp/unified-dashboard.log${NC}"

else
    echo -e "\n${RED}❌ Failed to start unified dashboard server${NC}"
    echo -e "${YELLOW}Check logs: cat /tmp/unified-dashboard.log${NC}"
    exit 1
fi

echo -e "\n${GREEN}✨ Unified Dashboard is ready!${NC}"