#!/bin/bash

# Real-time monitoring dashboard for hyper-parallel execution

BASE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
STATUS_DB="$BASE_DIR/data/task_status.db"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

while true; do
    clear
    
    echo -e "${CYAN}${BOLD}🚀 CAIA Knowledge System - Hyper-Parallel Execution Dashboard${NC}"
    echo -e "${CYAN}===============================================================${NC}"
    echo -e "${YELLOW}Time: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo ""
    
    # Get statistics
    total=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status;" 2>/dev/null || echo "0")
    completed=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status WHERE status='completed';" 2>/dev/null || echo "0")
    running=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status WHERE status='running';" 2>/dev/null || echo "0")
    pending=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status WHERE status='pending';" 2>/dev/null || echo "0")
    failed=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status WHERE status='failed';" 2>/dev/null || echo "0")
    
    # Calculate progress
    if [ "$total" -gt 0 ]; then
        progress=$((completed * 100 / total))
    else
        progress=0
    fi
    
    # Progress bar
    echo -e "${BOLD}Overall Progress:${NC}"
    printf "["
    for i in {1..50}; do
        if [ $i -le $((progress / 2)) ]; then
            printf "${GREEN}█${NC}"
        else
            printf "░"
        fi
    done
    printf "] ${progress}%% (${completed}/${total})\n\n"
    
    # Status summary
    echo -e "${BOLD}Task Status:${NC}"
    echo -e "  ${GREEN}✓ Completed:${NC} $completed"
    echo -e "  ${YELLOW}⚡ Running:${NC} $running"
    echo -e "  ${BLUE}⏳ Pending:${NC} $pending"
    echo -e "  ${RED}✗ Failed:${NC} $failed"
    echo ""
    
    # Currently running tasks
    if [ "$running" -gt 0 ]; then
        echo -e "${BOLD}${YELLOW}Currently Running:${NC}"
        sqlite3 -list "$STATUS_DB" "SELECT '  ▶ ' || task_id || ': ' || name FROM task_status WHERE status='running' LIMIT 10;" 2>/dev/null
        echo ""
    fi
    
    # Recently completed
    recent_completed=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status WHERE status='completed' AND datetime(end_time) > datetime('now', '-30 seconds');" 2>/dev/null || echo "0")
    if [ "$recent_completed" -gt 0 ]; then
        echo -e "${BOLD}${GREEN}Recently Completed:${NC}"
        sqlite3 -list "$STATUS_DB" "SELECT '  ✓ ' || task_id || ': ' || name FROM task_status WHERE status='completed' AND datetime(end_time) > datetime('now', '-30 seconds') LIMIT 5;" 2>/dev/null
        echo ""
    fi
    
    # System resources
    echo -e "${BOLD}System Resources:${NC}"
    cpu_usage=$(ps aux | awk '{sum+=$3} END {print int(sum)}')
    mem_usage=$(ps aux | awk '{sum+=$4} END {print int(sum)}')
    echo -e "  CPU Usage: ${cpu_usage}%"
    echo -e "  Memory Usage: ${mem_usage}%"
    echo -e "  Active Processes: $(ps aux | grep -c 'knowledge-system/scripts/tasks')"
    
    # Estimated time
    if [ "$completed" -gt 0 ] && [ "$running" -gt 0 ]; then
        avg_time=$(sqlite3 "$STATUS_DB" "SELECT AVG(strftime('%s', end_time) - strftime('%s', start_time)) FROM task_status WHERE status='completed';" 2>/dev/null || echo "60")
        remaining=$((pending + running))
        eta=$((remaining * ${avg_time%.*} / (running + 1)))
        echo ""
        echo -e "${BOLD}Estimated Time:${NC}"
        echo -e "  Average task time: ${avg_time%.*}s"
        echo -e "  ETA: ~$((eta / 60))m $((eta % 60))s"
    fi
    
    echo ""
    echo -e "${CYAN}Press Ctrl+C to exit monitor${NC}"
    
    sleep 2
done