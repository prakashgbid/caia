#!/bin/bash

# CAIA Reusability Framework Startup Script
# Initializes and starts all reusability services

set -e

PROJECT_ROOT="/Users/MAC/Documents/projects/caia"
REUSABILITY_DIR="$PROJECT_ROOT/reusability"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting CAIA Reusability Framework${NC}"
echo "================================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is required but not installed${NC}"
    exit 1
fi

# Check if local CKS is running
echo -e "\n${YELLOW}🔍 Checking services...${NC}"
if curl -s http://localhost:5555/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Local CKS is running${NC}"
else
    echo -e "${YELLOW}⚠️  Local CKS not running - some features may be limited${NC}"
fi

# Initialize reusability framework if needed
if [ ! -f "$PROJECT_ROOT/reusability.config.json" ]; then
    echo -e "\n${YELLOW}🆕 First time setup detected${NC}"
    echo "Initializing reusability framework..."
    cd "$REUSABILITY_DIR"
    node caia-reuse-cli.js init
fi

# Start bridge service in background
echo -e "\n${YELLOW}🌉 Starting bridge service...${NC}"
cd "$REUSABILITY_DIR"
nohup node bridge-service.js start > bridge.log 2>&1 &
BRIDGE_PID=$!
echo "Bridge service started (PID: $BRIDGE_PID)"

# Create convenience aliases
echo -e "\n${YELLOW}🔧 Setting up aliases...${NC}"
cat > "$PROJECT_ROOT/reusability-aliases.sh" << 'EOF'
# CAIA Reusability Aliases
alias caia-reuse='node /Users/MAC/Documents/projects/caia/reusability/caia-reuse-cli.js'
alias reuse='caia-reuse'
alias share='caia-reuse share'
alias import='caia-reuse import'
alias reuse-sync='caia-reuse sync'
alias reuse-list='caia-reuse list'
alias reuse-test='caia-reuse test'
alias reuse-stats='caia-reuse stats'
EOF

echo "To use aliases, run: source $PROJECT_ROOT/reusability-aliases.sh"

# Quick test
echo -e "\n${YELLOW}🧪 Running quick test...${NC}"
cd "$REUSABILITY_DIR"
node -e "const {EnvironmentDetector} = require('./shared-components'); console.log('Environment:', EnvironmentDetector.isLocal ? 'Local' : 'Cloud');"

# Display status
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Reusability Framework Active${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Available commands:"
echo "  caia-reuse init     - Initialize framework"
echo "  caia-reuse share    - Share component"
echo "  caia-reuse import   - Import component"
echo "  caia-reuse sync     - Sync components"
echo "  caia-reuse list     - List components"
echo "  caia-reuse test     - Test component"
echo "  caia-reuse analyze  - Analyze codebase"
echo "  caia-reuse stats    - Show statistics"
echo ""
echo "Bridge Service Log: $REUSABILITY_DIR/bridge.log"
echo ""
echo -e "${GREEN}Happy coding with reusable components! 🎉${NC}"