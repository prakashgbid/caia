#!/bin/bash

# Claude Code Ultimate - Parallel Launcher using tmux
# Launches 82 Claude Code instances in tmux panes/windows

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKS_DIR="$PROJECT_ROOT/parallel_tasks"
LOGS_DIR="$PROJECT_ROOT/parallel_logs"
RESULTS_DIR="$PROJECT_ROOT/parallel_results"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     CLAUDE CODE ULTIMATE - PARALLEL TMUX ORCHESTRATOR       ║${NC}"
echo -e "${BLUE}║              82 Concurrent Configurations                    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo -e "${RED}❌ tmux is not installed. Please install tmux first.${NC}"
    echo "   macOS: brew install tmux"
    echo "   Linux: sudo apt-get install tmux"
    exit 1
fi

# Create directories
mkdir -p "$TASKS_DIR" "$LOGS_DIR" "$RESULTS_DIR"

# Function to extract configuration items from ENHANCEMENT_MATRIX.md
extract_config_items() {
    local matrix_file="$PROJECT_ROOT/ENHANCEMENT_MATRIX.md"
    local item_count=0
    
    # Parse the matrix file and create task files
    while IFS= read -r line; do
        if [[ $line == *"⬜ TODO"* ]] && [[ $line == "|"* ]]; then
            item_count=$((item_count + 1))
            
            # Extract fields from the line
            IFS='|' read -ra FIELDS <<< "$line"
            
            CONFIG_ID=$(echo "${FIELDS[1]}" | xargs)
            CONFIG_NAME=$(echo "${FIELDS[2]}" | xargs)
            PRIORITY=$(echo "${FIELDS[4]}" | xargs)
            TEST_CMD=$(echo "${FIELDS[6]:-}" | xargs)
            
            # Determine priority level
            if [[ $PRIORITY == *"🔴"* ]]; then
                PRIORITY_LEVEL="CRITICAL"
            elif [[ $PRIORITY == *"🟡"* ]]; then
                PRIORITY_LEVEL="HIGH"
            else
                PRIORITY_LEVEL="MEDIUM"
            fi
            
            # Create task ID
            TASK_ID=$(echo "$CONFIG_ID" | tr '.' '_')
            
            # Save task info
            echo "$item_count|$TASK_ID|$CONFIG_NAME|$PRIORITY_LEVEL|$TEST_CMD" >> "$TASKS_DIR/tasks.list"
        fi
    done < "$matrix_file"
    
    echo -e "${GREEN}✅ Extracted $item_count configuration items${NC}"
}

# Function to create task prompt for each configuration
create_task_prompt() {
    local task_num=$1
    local task_id=$2
    local config_name=$3
    local priority=$4
    local test_cmd=$5
    
    local prompt_file="$TASKS_DIR/prompt_${task_id}.txt"
    
    cat > "$prompt_file" << EOF
Execute configuration task $task_id: $config_name

This is task $task_num of 82 parallel tasks.
Priority: $priority

Your objective:
1. Implement the "$config_name" configuration
2. Create necessary configuration files in the appropriate directory
3. Test using: $test_cmd
4. Save results to parallel_results/result_${task_id}.json

Work autonomously and complete this specific configuration item.
Focus only on this task. Do not interact with other configurations.

Result format:
{
    "task_id": "$task_id",
    "status": "completed|failed|blocked",
    "files_created": [],
    "test_result": "pass|fail",
    "notes": "",
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}

Start immediately.
EOF
    
    echo "$prompt_file"
}

# Function to launch Claude instance in tmux
launch_claude_instance() {
    local session_name=$1
    local window_num=$2
    local task_id=$3
    local prompt_file=$4
    local log_file=$5
    
    # Create window/pane and run Claude
    if [ $window_num -eq 1 ]; then
        # First window - create new session
        tmux new-session -d -s "$session_name" -n "$task_id" \
            "cd '$PROJECT_ROOT' && claude --no-interactive < '$prompt_file' > '$log_file' 2>&1; echo 'Task completed. Press Enter to close.'; read"
    elif [ $window_num -le 10 ]; then
        # Create new windows for first 10 tasks
        tmux new-window -t "$session_name:$window_num" -n "$task_id" \
            "cd '$PROJECT_ROOT' && claude --no-interactive < '$prompt_file' > '$log_file' 2>&1; echo 'Task completed. Press Enter to close.'; read"
    else
        # Split panes for remaining tasks (up to 4 panes per window)
        local base_window=$(( (window_num - 1) / 4 + 1 ))
        local pane_pos=$(( (window_num - 1) % 4 ))
        
        if [ $pane_pos -eq 0 ]; then
            tmux new-window -t "$session_name:$base_window" -n "batch-$base_window" \
                "cd '$PROJECT_ROOT' && claude --no-interactive < '$prompt_file' > '$log_file' 2>&1; echo 'Task completed. Press Enter to close.'; read"
        else
            tmux split-window -t "$session_name:$base_window" \
                "cd '$PROJECT_ROOT' && claude --no-interactive < '$prompt_file' > '$log_file' 2>&1; echo 'Task completed. Press Enter to close.'; read"
            tmux select-layout -t "$session_name:$base_window" tiled
        fi
    fi
}

# Function to launch all instances
launch_all_instances() {
    local session_name="claude-ultimate-$(date +%s)"
    local batch_size=${1:-5}
    local delay=${2:-1}
    
    echo -e "${YELLOW}📦 Launching 82 Claude instances in tmux session: $session_name${NC}"
    echo -e "${YELLOW}   Batch size: $batch_size, Delay: ${delay}s${NC}"
    
    # Read tasks and launch
    local count=0
    while IFS='|' read -r task_num task_id config_name priority test_cmd; do
        count=$((count + 1))
        
        # Create prompt file
        prompt_file=$(create_task_prompt "$task_num" "$task_id" "$config_name" "$priority" "$test_cmd")
        log_file="$LOGS_DIR/log_${task_id}.txt"
        
        # Launch instance
        echo -e "  ${GREEN}[$count/82]${NC} Launching: $task_id - ${config_name:0:40}..."
        launch_claude_instance "$session_name" "$count" "$task_id" "$prompt_file" "$log_file"
        
        # Batch control
        if [ $((count % batch_size)) -eq 0 ]; then
            echo -e "${YELLOW}   Pausing $delay seconds before next batch...${NC}"
            sleep "$delay"
        fi
        
    done < "$TASKS_DIR/tasks.list"
    
    echo -e "${GREEN}✅ All 82 instances launched!${NC}"
    echo -e "${BLUE}📺 To view progress: tmux attach-session -t $session_name${NC}"
    echo -e "${BLUE}📊 To monitor: watch -n 5 'ls -la $RESULTS_DIR | wc -l'${NC}"
}

# Function to monitor progress
monitor_progress() {
    echo -e "${BLUE}📊 Monitoring Progress...${NC}"
    
    while true; do
        local completed=$(ls -1 "$RESULTS_DIR"/result_*.json 2>/dev/null | wc -l)
        local percentage=$((completed * 100 / 82))
        
        # Progress bar
        local bar_length=50
        local filled=$((bar_length * completed / 82))
        local bar=$(printf "█%.0s" $(seq 1 $filled))
        local empty=$(printf "░%.0s" $(seq 1 $((bar_length - filled))))
        
        printf "\r[${bar}${empty}] ${percentage}%% (${completed}/82) "
        
        if [ "$completed" -ge 82 ]; then
            echo -e "\n${GREEN}✅ ALL TASKS COMPLETED!${NC}"
            break
        fi
        
        sleep 5
    done
}

# Main execution
main() {
    # Clear previous run
    echo -e "${YELLOW}🧹 Cleaning previous run data...${NC}"
    rm -f "$TASKS_DIR"/*.txt "$TASKS_DIR"/*.list
    
    # Extract configuration items
    echo -e "${BLUE}📋 Extracting configuration items...${NC}"
    extract_config_items
    
    # Check task count
    TASK_COUNT=$(wc -l < "$TASKS_DIR/tasks.list")
    echo -e "${GREEN}📊 Ready to launch $TASK_COUNT tasks${NC}"
    
    # Confirm launch
    echo -e "\n${YELLOW}⚠️  WARNING: This will launch $TASK_COUNT Claude Code instances in tmux!${NC}"
    echo -e "   Each instance will work on a specific configuration autonomously."
    echo -e "   Ensure you have:"
    echo -e "   - Sufficient API credits"
    echo -e "   - At least 16GB RAM"
    echo -e "   - Claude Code properly configured"
    
    read -p "$(echo -e ${GREEN}Ready to launch? [yes/no]: ${NC})" confirm
    if [[ "$confirm" != "yes" ]]; then
        echo -e "${RED}Aborted.${NC}"
        exit 0
    fi
    
    # Launch all instances
    launch_all_instances 5 2  # batch_size=5, delay=2s
    
    # Option to monitor
    echo ""
    read -p "$(echo -e ${GREEN}Monitor progress? [yes/no]: ${NC})" monitor
    if [[ "$monitor" == "yes" ]]; then
        monitor_progress
    fi
    
    echo -e "\n${GREEN}✨ Setup complete! Check tmux sessions for progress.${NC}"
}

# Run main
main "$@"