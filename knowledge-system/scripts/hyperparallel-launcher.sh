#!/bin/bash

# CAIA Knowledge System Hyper-Parallel Launcher
# Executes all tasks with maximum parallelization

set -e

BASE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
SCRIPTS_DIR="$BASE_DIR/scripts"
LOG_DIR="$BASE_DIR/logs"
STATUS_DB="$BASE_DIR/data/task_status.db"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 CAIA Knowledge System Hyper-Parallel Implementation${NC}"
echo -e "${BLUE}=================================================${NC}"
echo "Starting at: $(date)"
echo ""

# Create necessary directories
mkdir -p "$LOG_DIR" "$BASE_DIR/data" "$BASE_DIR/cache"

# Initialize status database
sqlite3 "$STATUS_DB" <<EOF
CREATE TABLE IF NOT EXISTS task_status (
    task_id TEXT PRIMARY KEY,
    name TEXT,
    status TEXT DEFAULT 'pending',
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    log_file TEXT
);
EOF

# Function to check dependencies
check_deps() {
    local task_id=$1
    local deps=$(jq -r ".tasks.\"$task_id\".deps[]" "$BASE_DIR/configs/dependency-graph.json" 2>/dev/null)
    
    for dep in $deps; do
        local status=$(sqlite3 "$STATUS_DB" "SELECT status FROM task_status WHERE task_id='$dep';")
        if [ "$status" != "completed" ]; then
            return 1
        fi
    done
    return 0
}

# Function to launch task
launch_task() {
    local task_id=$1
    local task_name=$(jq -r ".tasks.\"$task_id\".name" "$BASE_DIR/configs/dependency-graph.json")
    local log_file="$LOG_DIR/${task_id}_${task_name}.log"
    
    echo -e "${GREEN}▶ Launching${NC} $task_id: $task_name"
    
    # Update status to running
    sqlite3 "$STATUS_DB" "INSERT OR REPLACE INTO task_status (task_id, name, status, start_time, log_file) VALUES ('$task_id', '$task_name', 'running', datetime('now'), '$log_file');"
    
    # Launch task in background
    (
        "$SCRIPTS_DIR/tasks/${task_name}.sh" > "$log_file" 2>&1
        if [ $? -eq 0 ]; then
            sqlite3 "$STATUS_DB" "UPDATE task_status SET status='completed', end_time=datetime('now') WHERE task_id='$task_id';"
            echo -e "${GREEN}✓ Completed${NC} $task_id: $task_name"
        else
            sqlite3 "$STATUS_DB" "UPDATE task_status SET status='failed', end_time=datetime('now') WHERE task_id='$task_id';"
            echo -e "${RED}✗ Failed${NC} $task_id: $task_name"
        fi
    ) &
}

# Get all tasks
ALL_TASKS=$(jq -r '.tasks | keys[]' "$BASE_DIR/configs/dependency-graph.json")

# Initialize all tasks as pending
for task_id in $ALL_TASKS; do
    task_name=$(jq -r ".tasks.\"$task_id\".name" "$BASE_DIR/configs/dependency-graph.json")
    sqlite3 "$STATUS_DB" "INSERT OR IGNORE INTO task_status (task_id, name, status) VALUES ('$task_id', '$task_name', 'pending');"
done

echo -e "${YELLOW}📊 Total tasks to execute: $(echo $ALL_TASKS | wc -w)${NC}"
echo ""

# Launch all tasks with no dependencies immediately
echo -e "${BLUE}Phase 1: Launching zero-dependency tasks...${NC}"
for task_id in $ALL_TASKS; do
    if check_deps "$task_id"; then
        launch_task "$task_id"
    fi
done

echo ""
echo -e "${BLUE}Phase 2: Progressive dependency resolution...${NC}"

# Monitor and launch tasks as dependencies complete
while true; do
    sleep 2
    
    # Check for pending tasks with satisfied dependencies
    pending_tasks=$(sqlite3 "$STATUS_DB" "SELECT task_id FROM task_status WHERE status='pending';")
    
    if [ -z "$pending_tasks" ]; then
        # Check if any tasks are still running
        running_tasks=$(sqlite3 "$STATUS_DB" "SELECT task_id FROM task_status WHERE status='running';")
        if [ -z "$running_tasks" ]; then
            break
        fi
    else
        for task_id in $pending_tasks; do
            if check_deps "$task_id"; then
                launch_task "$task_id"
            fi
        done
    fi
    
    # Show status
    completed=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status WHERE status='completed';")
    running=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status WHERE status='running';")
    pending=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status WHERE status='pending';")
    failed=$(sqlite3 "$STATUS_DB" "SELECT COUNT(*) FROM task_status WHERE status='failed';")
    
    echo -ne "\r📊 Status: ${GREEN}✓ $completed${NC} | ${YELLOW}⚡ $running${NC} | ${BLUE}⏳ $pending${NC} | ${RED}✗ $failed${NC}    "
done

echo ""
echo ""
echo -e "${GREEN}✨ Hyper-parallel execution complete!${NC}"
echo "Ended at: $(date)"
echo ""

# Final report
echo -e "${BLUE}📋 Final Report:${NC}"
sqlite3 -column -header "$STATUS_DB" "SELECT task_id, name, status, 
    strftime('%H:%M:%S', start_time) as started, 
    strftime('%H:%M:%S', end_time) as ended 
    FROM task_status ORDER BY task_id;"

echo ""
echo -e "${GREEN}🎯 Knowledge System Ready!${NC}"
echo "Logs available at: $LOG_DIR"