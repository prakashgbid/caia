#!/bin/bash
# Quick status check for all projects
# Shows active projects, recent commits, and critical TODOs

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "🚀 PROJECTS QUICK STATUS"
echo "========================"
echo ""

# Check if context daemon is running
echo "📡 Context Daemon Status:"
if pgrep -f "capture_context.py --daemon" > /dev/null; then
    echo "   ✅ Running"
else
    echo "   ❌ Not running (run start_context_daemon.sh to start)"
fi
echo ""

# Get latest context summary
echo "📊 Project Summary:"
python3 "$SCRIPT_DIR/query_context.py" --command summary | grep -E "^(Total|Active|Recent|Open)" | sed 's/^/   /'
echo ""

# Show recent decisions (last 24 hours)
echo "📝 Recent Decisions (24h):"
python3 "$SCRIPT_DIR/query_context.py" --command decisions --days 1 --format text | head -5 | sed 's/^/   /'
echo ""

# Show active projects with changes
echo "🔥 Active Projects:"
python3 "$SCRIPT_DIR/capture_context.py" --hours 1 2>/dev/null | grep "📦 Scanning" | sed 's/.*Scanning /   - /'
echo ""

echo "💡 Commands:"
echo "   Full summary:  python3 $SCRIPT_DIR/query_context.py --command summary"
echo "   Start daemon:  $SCRIPT_DIR/start_context_daemon.sh"
echo "   Log decision:  python3 $SCRIPT_DIR/log_decision.py --help"
echo ""
echo "========================"