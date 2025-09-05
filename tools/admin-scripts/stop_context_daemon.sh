#!/bin/bash
# Stop the context capture daemon

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOG_DIR="$SCRIPT_DIR/../logs"
PIDFILE="$LOG_DIR/context_daemon.pid"

if [ ! -f "$PIDFILE" ]; then
    echo "❌ Context daemon is not running (no PID file found)"
    exit 1
fi

PID=$(cat "$PIDFILE")

if ps -p $PID > /dev/null 2>&1; then
    echo "🛑 Stopping context daemon (PID: $PID)..."
    kill $PID
    sleep 2
    
    # Force kill if still running
    if ps -p $PID > /dev/null 2>&1; then
        echo "⚠️  Process didn't stop gracefully, force killing..."
        kill -9 $PID
    fi
    
    rm "$PIDFILE"
    echo "✅ Context daemon stopped"
else
    echo "⚠️  Process not found, removing stale PID file"
    rm "$PIDFILE"
fi