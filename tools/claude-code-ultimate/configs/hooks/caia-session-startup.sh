#!/bin/bash
# CAIA Context-Aware Session Startup Hook for Claude Code Ultimate
# Automatically runs when a new Claude session starts

ADMIN_ROOT="/Users/MAC/Documents/projects/admin"
SCRIPTS_DIR="$ADMIN_ROOT/scripts"
CCU_ROOT="/Users/MAC/Documents/projects/claude-code-ultimate"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧠 CAIA Context-Aware Session Starting...${NC}"
echo "=============================================="

# 1. Check Admin System Health
echo -e "${YELLOW}📊 Admin System Health Check:${NC}"

# Check if context daemon is running
if pgrep -f "capture_context.py --daemon" > /dev/null; then
    echo -e "   ✅ Context Daemon: ${GREEN}Running${NC}"
else
    echo -e "   ❌ Context Daemon: ${RED}Not Running${NC}"
    echo -e "      💡 Starting daemon..."
    "$SCRIPTS_DIR/start_context_daemon.sh" > /dev/null 2>&1
    if pgrep -f "capture_context.py --daemon" > /dev/null; then
        echo -e "      ✅ Context Daemon: ${GREEN}Started${NC}"
    else
        echo -e "      ❌ Failed to start context daemon"
    fi
fi

# Check admin directories
for dir in context decisions logs caia-tracking; do
    if [ -d "$ADMIN_ROOT/$dir" ]; then
        echo -e "   ✅ $dir directory: ${GREEN}Ready${NC}"
    else
        echo -e "   ❌ $dir directory: ${RED}Missing${NC}"
        mkdir -p "$ADMIN_ROOT/$dir"
        echo -e "      ✅ Created $dir directory"
    fi
done

# 2. Load Latest Context
echo ""
echo -e "${YELLOW}📋 Loading Latest Project Context:${NC}"

# Get latest context summary
if [ -f "$SCRIPTS_DIR/query_context.py" ]; then
    CONTEXT_SUMMARY=$(python3 "$SCRIPTS_DIR/query_context.py" --command summary 2>/dev/null | head -10)
    if [ $? -eq 0 ] && [ -n "$CONTEXT_SUMMARY" ]; then
        echo "$CONTEXT_SUMMARY" | sed 's/^/   /'
    else
        echo -e "   ⚠️  No context available yet - will capture on first scan"
    fi
else
    echo -e "   ❌ Context query script not found"
fi

# 3. CAIA Project Status
echo ""
echo -e "${YELLOW}🎯 CAIA Project Status:${NC}"

if [ -f "$SCRIPTS_DIR/caia_status.sh" ]; then
    CAIA_STATUS=$(bash "$SCRIPTS_DIR/caia_status.sh" 2>/dev/null)
    if [ $? -eq 0 ]; then
        # Extract key metrics only for session startup
        echo "$CAIA_STATUS" | grep -E "(Files:|Components:|Ready to Publish:|Active TODOs:)" | sed 's/^/   /'
    else
        echo -e "   ⚠️  CAIA status check failed"
    fi
else
    echo -e "   ❌ CAIA status script not found"
fi

# 4. Recent Decisions
echo ""
echo -e "${YELLOW}💭 Recent Decisions (Last 24h):${NC}"

if [ -f "$SCRIPTS_DIR/query_context.py" ]; then
    RECENT_DECISIONS=$(python3 "$SCRIPTS_DIR/query_context.py" --command decisions --days 1 --format text 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "$RECENT_DECISIONS" ]; then
        echo "$RECENT_DECISIONS" | head -5 | sed 's/^/   /'
    else
        echo -e "   📝 No recent decisions logged"
    fi
fi

# 5. Context-Aware Commands
echo ""
echo -e "${YELLOW}🚀 Available Context Commands:${NC}"
echo -e "   • ${GREEN}admin/scripts/quick_status.sh${NC}     - Quick project overview"
echo -e "   • ${GREEN}admin/scripts/caia_status.sh${NC}      - CAIA-specific status"
echo -e "   • ${GREEN}admin/scripts/caia_tracker.py${NC}     - Component tracking"
echo -e "   • ${GREEN}python3 admin/scripts/log_decision.py${NC} - Log decisions"

# 6. Auto-apply CC Orchestrator settings if available
if [ -f "/Users/MAC/Documents/projects/caia/utils/parallel/cc-orchestrator/src/index.js" ]; then
    echo ""
    echo -e "${YELLOW}⚡ CC Orchestrator:${NC}"
    echo -e "   ✅ ${GREEN}Available for complex tasks${NC}"
    echo -e "   💡 Auto-invokes for 3+ operations"
    
    # Set environment variables for this session
    export CCO_AUTO_INVOKE=true
    export CCO_AUTO_CALCULATE=true
    export CCO_PATH="/Users/MAC/Documents/projects/caia/utils/parallel/cc-orchestrator/src/index.js"
fi

# 7. Session Decision Tracking Setup
echo ""
echo -e "${YELLOW}📝 Decision Tracking:${NC}"
echo -e "   ✅ ${GREEN}Auto-logging enabled${NC}"
echo -e "   💡 Decisions will be automatically captured"

# Create session ID for tracking
SESSION_ID="session_$(date +%Y%m%d_%H%M%S)"
export CLAUDE_SESSION_ID="$SESSION_ID"

# Log session start
if [ -f "$SCRIPTS_DIR/log_decision.py" ]; then
    python3 "$SCRIPTS_DIR/log_decision.py" \
        --type progress \
        --title "Claude Session Started" \
        --description "New context-aware session started with ID: $SESSION_ID. Admin system loaded and ready." \
        --project "admin" \
        --status "started" \
        --completion 0 > /dev/null 2>&1
fi

echo ""
echo -e "${BLUE}✨ Context-Aware Session Ready!${NC}"
echo -e "Session ID: ${GREEN}$SESSION_ID${NC}"
echo "=============================================="
echo ""

# Return success
exit 0