#!/bin/bash

case "$1" in
    status)
        echo "🤖 Intelligent Companion Status:"
        curl -s http://localhost:5010/health | jq .
        curl -s http://localhost:5010/insights | jq .
        ;;
    
    stop)
        echo "Stopping companion services..."
        pkill -f memory_daemon.py
        pkill -f learning_service.py
        echo "Services stopped"
        ;;
    
    restart)
        $0 stop
        sleep 2
        /Users/MAC/Documents/projects/caia/knowledge-system/start_intelligent_companion.sh
        ;;
    
    logs)
        tail -f /Users/MAC/Documents/projects/caia/knowledge-system/logs/*.log
        ;;
    
    *)
        echo "Usage: $0 {status|stop|restart|logs}"
        exit 1
        ;;
esac
