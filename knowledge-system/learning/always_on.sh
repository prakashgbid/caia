#!/bin/bash

# Always-On Learning System Manager
# Ensures the Learning System is always running and learning

LOG_FILE="/Users/MAC/.claude/logs/learning.log"
PID_FILE="/tmp/learning_system.pid"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/server.py"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Function to check if process is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        fi
    fi

    # Also check if it's running on port 5003
    if lsof -i:5003 > /dev/null 2>&1; then
        return 0
    fi

    return 1
}

# Function to start the Learning System
start_learning() {
    echo -e "${YELLOW}Starting Learning System...${NC}"

    # Kill any existing process on port 5003
    lsof -ti:5003 | xargs kill -9 2>/dev/null

    # Start the server
    cd "$SCRIPT_DIR"
    nohup python3 "$PYTHON_SCRIPT" >> "$LOG_FILE" 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"

    sleep 2

    # Verify it started
    if curl -s http://localhost:5003/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Learning System started successfully (PID: $PID)${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to start Learning System${NC}"
        return 1
    fi
}

# Function to monitor and restart if needed
monitor_loop() {
    echo -e "${GREEN}🧠 Always-On Learning System Monitor Started${NC}"
    echo "Monitoring Learning System on port 5003..."
    echo "Log file: $LOG_FILE"
    echo "---"

    while true; do
        if ! is_running; then
            echo -e "${YELLOW}$(date): Learning System not running, restarting...${NC}"
            start_learning
        fi

        # Check health endpoint
        HEALTH=$(curl -s http://localhost:5003/health 2>/dev/null)
        if [ $? -eq 0 ]; then
            STATS=$(echo "$HEALTH" | python3 -c "
import sys, json
data = json.load(sys.stdin)
stats = data.get('stats', {})
print(f\"Patterns: {stats.get('patterns_learned', 0)}, Processed: {stats.get('interactions_processed', 0)}, Decisions: {stats.get('decisions_tracked', 0)}\")
" 2>/dev/null)

            if [ ! -z "$STATS" ]; then
                echo -e "$(date): ${GREEN}✓ Healthy${NC} - $STATS"
            fi
        fi

        # Sleep for 30 seconds before next check
        sleep 30
    done
}

# Function to stop the service
stop_learning() {
    echo -e "${YELLOW}Stopping Learning System...${NC}"

    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        kill $PID 2>/dev/null
        rm "$PID_FILE"
    fi

    # Also kill by port
    lsof -ti:5003 | xargs kill -9 2>/dev/null

    echo -e "${GREEN}✅ Learning System stopped${NC}"
}

# Function to show status
show_status() {
    if is_running; then
        HEALTH=$(curl -s http://localhost:5003/health 2>/dev/null)
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Learning System is running${NC}"
            echo "$HEALTH" | python3 -m json.tool
        else
            echo -e "${YELLOW}⚠️  Learning System is running but not responding${NC}"
        fi
    else
        echo -e "${RED}❌ Learning System is not running${NC}"
    fi
}

# Main script logic
case "${1:-monitor}" in
    start)
        if is_running; then
            echo -e "${YELLOW}Learning System is already running${NC}"
        else
            start_learning
        fi
        ;;
    stop)
        stop_learning
        ;;
    restart)
        stop_learning
        sleep 2
        start_learning
        ;;
    status)
        show_status
        ;;
    monitor)
        # Default: run in monitor mode
        monitor_loop
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|monitor}"
        echo "  start   - Start the Learning System"
        echo "  stop    - Stop the Learning System"
        echo "  restart - Restart the Learning System"
        echo "  status  - Show current status"
        echo "  monitor - Run in always-on monitor mode (default)"
        exit 1
        ;;
esac