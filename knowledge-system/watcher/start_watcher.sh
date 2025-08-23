#!/bin/bash
# Start the file watcher

WATCHER_DIR="/Users/MAC/Documents/projects/caia/knowledge-system/watcher"
LOGS_DIR="/Users/MAC/Documents/projects/caia/knowledge-system/logs"

mkdir -p "$LOGS_DIR"

echo "Starting knowledge system file watcher..."

# Check if already running
if pgrep -f "file_watcher.py" > /dev/null; then
    echo "File watcher is already running"
    exit 0
fi

# Start in background
nohup python3 "$WATCHER_DIR/file_watcher.py" \
    --watch-dirs "/Users/MAC/Documents/projects/caia" \
    > "$LOGS_DIR/watcher.log" 2>&1 &

echo "File watcher started (PID: $!)"  
echo "Logs: $LOGS_DIR/watcher.log"
