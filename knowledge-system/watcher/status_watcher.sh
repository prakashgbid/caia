#!/bin/bash
# Check file watcher status

echo "Knowledge System File Watcher Status:"
echo "====================================="

if pgrep -f "file_watcher.py" > /dev/null; then
    PID=$(pgrep -f "file_watcher.py")
    echo "Status: RUNNING (PID: $PID)"
    echo "Memory usage: $(ps -p $PID -o rss= | awk '{print $1/1024 " MB"}')"
    echo "Started: $(ps -p $PID -o lstart=)"
else
    echo "Status: STOPPED"
fi

echo ""
echo "Recent log entries:"
echo "=================="
tail -n 10 "/Users/MAC/Documents/projects/caia/knowledge-system/logs/watcher.log" 2>/dev/null || echo "No logs found"
