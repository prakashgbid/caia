#!/bin/bash
# CAIA-specific status and operations

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" }" && pwd )"
ADMIN_DIR="/Users/MAC/Documents/projects/admin"
CAIA_DIR="/Users/MAC/Documents/projects/caia"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}           🚀 CAIA PROJECT STATUS CHECK                       ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Show quick status from tracker
echo -e "${YELLOW}📊 Quick Status:${NC}"
python3 "$SCRIPT_DIR/caia_progress_tracker.py" status 2>/dev/null || echo "   Tracker not initialized"
echo ""

# Get CAIA-specific context
echo -e "${YELLOW}📦 CAIA Components:${NC}"
python3 "$SCRIPT_DIR/query_context.py" --command project --project caia --format text 2>/dev/null | sed 's/^/   /' | head -5 || echo "   Context not available"
echo ""

# Get CAIA component tracking
if [ -f "$SCRIPT_DIR/caia_tracker.py" ]; then
    echo -e "${YELLOW}🎯 Published Components:${NC}"
    python3 "$SCRIPT_DIR/caia_tracker.py" 2>/dev/null | grep -E "^(Total|Published|Ready|Components with)" | sed 's/^/   /' || echo "   No components tracked"
    echo ""
fi

# Show recent CAIA decisions
echo -e "${YELLOW}📝 Recent Decisions:${NC}"
python3 "$SCRIPT_DIR/query_context.py" --command decisions --project caia --days 7 --format text 2>/dev/null | head -3 | sed 's/^/   /' || echo "   No recent decisions"
echo ""

# Check git status
echo -e "${YELLOW}🔧 Git Status:${NC}"
cd "$CAIA_DIR" 2>/dev/null && {
    BRANCH=$(git branch --show-current)
    CHANGES=$(git status --porcelain | wc -l | tr -d ' ')
    echo "   Branch: $BRANCH"
    echo "   Uncommitted changes: $CHANGES files"
} || echo "   Git status unavailable"
echo ""

# Show next actions
echo -e "${GREEN}🚀 Next Actions:${NC}"
echo "   1. View full report:  python3 $SCRIPT_DIR/caia_progress_tracker.py report"
echo "   2. Fix TypeScript:    cd $CAIA_DIR && npx lerna run build"
echo "   3. Track progress:    python3 $SCRIPT_DIR/caia_progress_tracker.py log \"message\""
echo "   4. Update roadmap:    cat $CAIA_DIR/ROADMAP.md"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"