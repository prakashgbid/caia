#!/bin/bash
# Quick CAIA System Diagnostic
# Shows current status and provides immediate actionable commands

echo "🚀 CAIA SYSTEM DIAGNOSTIC"
echo "========================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check service health
echo -e "${BLUE}📡 Service Health Check:${NC}"
echo -n "   CKS (port 5555): "
if curl -s http://localhost:5555/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
    CKS_RUNNING=true
else
    echo -e "${RED}❌ Down${NC}"
    CKS_RUNNING=false
fi

echo -n "   Enhancement Systems (port 5002): "
if curl -s http://localhost:5002/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
    ENHANCEMENT_RUNNING=true
else
    echo -e "${RED}❌ Down${NC}"
    ENHANCEMENT_RUNNING=false
fi

echo -n "   Learning System (port 5003): "
if curl -s http://localhost:5003/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
    LEARNING_RUNNING=true
else
    echo -e "${RED}❌ Down${NC}"
    LEARNING_RUNNING=false
fi

echo ""

# Check CC Orchestrator availability
echo -e "${BLUE}⚡ CC Orchestrator:${NC}"
if [ -f "/Users/MAC/Documents/projects/caia/utils/parallel/cc-orchestrator/src/index.ts" ]; then
    echo -e "   ${GREEN}✅ Available${NC}"
    CCO_AVAILABLE=true
else
    echo -e "   ${RED}❌ Not found${NC}"
    CCO_AVAILABLE=false
fi

# Check admin scripts
echo -e "${BLUE}🛠️  Admin Scripts:${NC}"
if [ -f "/Users/MAC/Documents/projects/caia/tools/admin-scripts/quick_status.sh" ]; then
    echo -e "   ${GREEN}✅ Available${NC}"
    ADMIN_AVAILABLE=true
else
    echo -e "   ${RED}❌ Not found${NC}"
    ADMIN_AVAILABLE=false
fi

echo ""
echo -e "${YELLOW}🎯 IMMEDIATE ACTIONS YOU CAN TAKE:${NC}"
echo ""

if [ "$CKS_RUNNING" = false ] || [ "$ENHANCEMENT_RUNNING" = false ] || [ "$LEARNING_RUNNING" = false ]; then
    echo -e "${RED}1. START SERVICES:${NC}"
    echo "   /Users/MAC/Documents/projects/caia/knowledge-system/scripts/start_all_services.sh"
    echo ""
fi

if [ "$CKS_RUNNING" = true ]; then
    echo -e "${GREEN}2. EXPLORE YOUR KNOWLEDGE BASE:${NC}"
    echo '   curl "http://localhost:5555/search/function?query=authentication"'
    echo '   curl "http://localhost:5555/search/function?query=api"'
    echo ""
fi

if [ "$CCO_AVAILABLE" = true ]; then
    echo -e "${GREEN}3. CHECK CC ORCHESTRATOR POWER:${NC}"
    echo '   node -e "const CCO = require('\''./utils/parallel/cc-orchestrator/src/index.ts'\''); console.log('\''CC Orchestrator ready'\'');"'
    echo ""
fi

if [ "$ENHANCEMENT_RUNNING" = true ]; then
    echo -e "${GREEN}4. ACTIVATE ENHANCEMENT SYSTEMS:${NC}"
    echo '   curl -X POST "http://localhost:5002/api/session-manager/start-enhanced-session"'
    echo '   curl "http://localhost:5002/api/status"'
    echo ""
fi

if [ "$ADMIN_AVAILABLE" = true ]; then
    echo -e "${GREEN}5. CHECK PROJECT STATUS:${NC}"
    echo "   /Users/MAC/Documents/projects/caia/tools/admin-scripts/quick_status.sh"
    echo "   /Users/MAC/Documents/projects/caia/tools/admin-scripts/caia_status.sh"
    echo ""
fi

echo -e "${GREEN}6. LOG A DECISION (ALWAYS AVAILABLE):${NC}"
echo '   python3 /Users/MAC/Documents/projects/caia/tools/admin-scripts/log_decision.py \'
echo '     --title "Testing CAIA" --description "Exploring system capabilities"'
echo ""

echo -e "${YELLOW}🏆 POWER USER TIP:${NC}"
echo "Run this diagnostic anytime to see what's available!"
echo "Save it as: chmod +x quick_diagnostic.sh && ./quick_diagnostic.sh"
echo ""

echo "========================="
echo -e "${BLUE}🚀 READY FOR SUPERHUMAN PRODUCTIVITY!${NC}"