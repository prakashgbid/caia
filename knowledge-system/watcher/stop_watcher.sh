#!/bin/bash
# Stop the file watcher

echo "Stopping knowledge system file watcher..."

if pgrep -f "file_watcher.py" > /dev/null; then
    pkill -f "file_watcher.py"
    echo "File watcher stopped"
else
    echo "File watcher is not running"
fi
