#!/bin/bash
# Start the context capture daemon
# Runs context capture every hour in the background

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOG_DIR="$SCRIPT_DIR/../logs"
PIDFILE="$LOG_DIR/context_daemon.pid"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Check if daemon is already running
if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if ps -p $PID > /dev/null 2>&1; then
        echo "❌ Context daemon is already running (PID: $PID)"
        echo "To stop it, run: $SCRIPT_DIR/stop_context_daemon.sh"
        exit 1
    else
        echo "🔧 Removing stale PID file"
        rm "$PIDFILE"
    fi
fi

# Start the daemon
echo "🚀 Starting context capture daemon..."
nohup python3 "$SCRIPT_DIR/capture_context.py" --daemon > "$LOG_DIR/context_daemon.log" 2>&1 &
PID=$!

# Save PID
echo $PID > "$PIDFILE"

echo "✅ Context daemon started (PID: $PID)"
echo "📝 Logs: $LOG_DIR/context_daemon.log"
echo "🛑 To stop: $SCRIPT_DIR/stop_context_daemon.sh"