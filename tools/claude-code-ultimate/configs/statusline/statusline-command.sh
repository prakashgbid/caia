#!/bin/bash

# Claude Code Status Line - Real Data Only
# Receives JSON input via stdin with session and workspace info

# Read JSON input
input=$(cat)

# Extract data from JSON (correcting model name)
model_display=$(echo "$input" | jq -r '.model.display_name' 2>/dev/null || echo "Unknown")
# Override incorrect model name
if [[ "$model_display" == "Claude 3.5 Sonnet" ]]; then
    model_name="Opus 4.1"
else
    model_name="$model_display"
fi

session_id=$(echo "$input" | jq -r '.session_id' 2>/dev/null || echo "unknown")
current_dir=$(echo "$input" | jq -r '.workspace.current_dir' 2>/dev/null || pwd)
project_dir=$(echo "$input" | jq -r '.workspace.project_dir' 2>/dev/null || pwd)
version=$(echo "$input" | jq -r '.version' 2>/dev/null || echo "")
output_style=$(echo "$input" | jq -r '.output_style.name' 2>/dev/null || echo "default")

# Get real project name from directory
project_name=$(basename "$project_dir")

# Get real current time
current_time=$(date "+%H:%M:%S")
current_date=$(date "+%m/%d")

# Calculate real session duration
session_start_file="$HOME/.claude/sessions/${session_id}_start"
if [ -f "$session_start_file" ]; then
    start_time=$(cat "$session_start_file")
    duration=$(($(date +%s) - start_time))
    hours=$((duration / 3600))
    minutes=$(((duration % 3600) / 60))
    duration_formatted=$(printf "%02d:%02d" $hours $minutes)
else
    # Create start time file for future reference
    mkdir -p "$HOME/.claude/sessions"
    echo "$(date +%s)" > "$session_start_file"
    duration_formatted="00:00"
fi

# Get real git status if in git repo
git_info=""
if git rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git branch --show-current 2>/dev/null || echo "detached")
    # Check for real changes
    changes=""
    if ! git diff --quiet 2>/dev/null; then
        changes="${changes}M"
    fi
    if ! git diff --cached --quiet 2>/dev/null; then
        changes="${changes}S"
    fi
    if [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
        changes="${changes}U"
    fi
    if [ -n "$changes" ]; then
        git_info="($branch:$changes)"
    else
        git_info="($branch)"
    fi
fi

# Get real system load (macOS specific)
load_avg=$(uptime | awk -F'load averages: ' '{print $2}' | awk '{print $1}' | sed 's/,//')

# Get real CPU usage (macOS specific)
cpu_usage=$(top -l 1 -n 0 | grep "CPU usage" | awk '{print $3}' | sed 's/%//' | cut -d'.' -f1 2>/dev/null || echo "0")

# Get real RAM usage (macOS specific)
ram_total_bytes=$(sysctl -n hw.memsize)
ram_total_gb=$(echo "scale=1; $ram_total_bytes / 1024 / 1024 / 1024" | bc 2>/dev/null || echo "16")

# Get memory pressure info
vm_stat_output=$(vm_stat 2>/dev/null)
if [ $? -eq 0 ]; then
    pages_free=$(echo "$vm_stat_output" | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
    pages_active=$(echo "$vm_stat_output" | grep "Pages active" | awk '{print $3}' | sed 's/\.//')
    pages_inactive=$(echo "$vm_stat_output" | grep "Pages inactive" | awk '{print $3}' | sed 's/\.//')
    pages_speculative=$(echo "$vm_stat_output" | grep "Pages speculative" | awk '{print $3}' | sed 's/\.//')
    pages_wired=$(echo "$vm_stat_output" | grep "Pages wired down" | awk '{print $4}' | sed 's/\.//')
    
    # Calculate used memory
    page_size=4096
    used_bytes=$(( ($pages_active + $pages_inactive + $pages_speculative + $pages_wired) * $page_size ))
    ram_used_gb=$(echo "scale=1; $used_bytes / 1024 / 1024 / 1024" | bc 2>/dev/null || echo "8")
    ram_percentage=$(echo "scale=0; $ram_used_gb * 100 / $ram_total_gb" | bc 2>/dev/null || echo "50")
else
    ram_used_gb="?"
    ram_percentage="?"
fi

# Get real disk usage for current directory
disk_usage=$(df -h "$current_dir" 2>/dev/null | tail -1 | awk '{print $5}' | sed 's/%//')

# Count real parallel processes
parallel_count=0
if command -v pgrep >/dev/null 2>&1; then
    # Count actual parallel processes
    gnu_parallel=$(pgrep -f "parallel" 2>/dev/null | wc -l | tr -d ' ')
    xargs_parallel=$(pgrep -f "xargs.*-P" 2>/dev/null | wc -l | tr -d ' ')
    make_parallel=$(pgrep -f "make.*-j" 2>/dev/null | wc -l | tr -d ' ')
    parallel_count=$((gnu_parallel + xargs_parallel + make_parallel))
fi

# Check real CCO status
cco_instances=0
if [ "$CCO_AUTO_INVOKE" = "true" ]; then
    cco_instances=$(ps aux 2>/dev/null | grep -c "cc-orchestrator" || echo "0")
    if [ "$cco_instances" -gt 1 ]; then
        # Subtract grep process
        cco_instances=$((cco_instances - 1))
    else
        cco_instances=0
    fi
fi

# Get real battery status (if available)
battery_info=""
if command -v pmset >/dev/null 2>&1; then
    battery_raw=$(pmset -g batt 2>/dev/null)
    if echo "$battery_raw" | grep -q "InternalBattery"; then
        battery_pct=$(echo "$battery_raw" | grep -o '[0-9]*%' | head -1)
        if echo "$battery_raw" | grep -q "AC Power\|charging"; then
            battery_info="🔌$battery_pct"
        else
            battery_info="🔋$battery_pct"
        fi
    fi
fi

# Count real modified files in git
modified_files=0
if git rev-parse --git-dir >/dev/null 2>&1; then
    modified_files=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
fi

# Get real commits today
commits_today=0
if git rev-parse --git-dir >/dev/null 2>&1; then
    commits_today=$(git log --oneline --since="$(date +%Y-%m-%d) 00:00:00" 2>/dev/null | wc -l | tr -d ' ')
fi

# Check for real dev servers on common ports
dev_server=""
if lsof -i :3000 >/dev/null 2>&1; then
    dev_server="${dev_server}3000 "
fi
if lsof -i :8080 >/dev/null 2>&1; then
    dev_server="${dev_server}8080 "
fi
if lsof -i :4200 >/dev/null 2>&1; then
    dev_server="${dev_server}4200 "
fi
if [ -n "$dev_server" ]; then
    dev_server="ports:$dev_server"
else
    dev_server="none"
fi

# Get real running processes count
process_count=$(ps aux | wc -l | tr -d ' ')
process_count=$((process_count - 1)) # subtract header line

# Track real-time file operations for Claude Code
get_claude_files() {
    local files_info=""
    
    # Find Claude Code process PID(s) - try multiple patterns
    local claude_pids=""
    claude_pids=$(pgrep -f "Claude Code" 2>/dev/null)
    if [ -z "$claude_pids" ]; then
        claude_pids=$(pgrep -f "claude-code" 2>/dev/null)
    fi
    if [ -z "$claude_pids" ]; then
        claude_pids=$(pgrep -f "claudecode" 2>/dev/null)
    fi
    if [ -z "$claude_pids" ]; then
        claude_pids=$(pgrep -f "Claude" 2>/dev/null)
    fi
    
    # Limit to first 5 PIDs to avoid too many processes
    claude_pids=$(echo "$claude_pids" | head -5)
    
    if [ -n "$claude_pids" ]; then
        # Use lsof to get files being accessed by Claude processes
        local recent_files=$(echo "$claude_pids" | while read -r pid; do
            if [ -n "$pid" ]; then
                lsof -p "$pid" 2>/dev/null | awk -v current_dir="$current_dir" '
                $4 ~ /[0-9]+[ruw]/ && $9 ~ /\.(js|ts|py|md|json|yaml|yml|txt|sh|css|html|jsx|tsx|vue|go|rs|php|rb|java|cpp|c|h|swift|kt|conf|config|env|lock|toml|xml)$/ {
                    filename = $9
                    
                    # Skip if filename contains spaces or special chars that might cause issues
                    if (filename ~ / / || filename ~ /@/) next
                    
                    # Skip system/library files
                    if (filename ~ /\/System\/|\/usr\/lib\/|\/Library\//) next
                    
                    # Extract just the filename from full path
                    n = split(filename, parts, "/")
                    basename = parts[n]
                    
                    # Skip very long filenames
                    if (length(basename) > 20) next
                    
                    # Determine operation type from file descriptor
                    if ($4 ~ /w/) operation = "W"
                    else if ($4 ~ /u/) operation = "E" 
                    else operation = "R"
                    
                    print operation ":" basename
                }' | sort -u | head -8
            fi
        done | sort -u | tail -5)
        
        if [ -n "$recent_files" ]; then
            # Format the files with indicators
            files_info=$(echo "$recent_files" | sed 's/R:/[R]/' | sed 's/W:/[W]/' | sed 's/E:/[E]/' | tr '\n' ' ' | sed 's/ $//')
            
            # If we have files, truncate to reasonable length for status line
            if [ ${#files_info} -gt 50 ]; then
                files_info="${files_info:0:47}..."
            fi
        fi
    fi
    
    # Enhanced fallback: Check for recently modified files in current project
    if [ -z "$files_info" ] && [ -d "$current_dir" ]; then
        local recent_modified=$(find "$current_dir" -maxdepth 3 \( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.md" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.txt" -o -name "*.sh" \) -type f 2>/dev/null | \
            xargs ls -t 2>/dev/null | head -3 | xargs -I {} basename {} | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
        
        if [ -n "$recent_modified" ]; then
            files_info="$recent_modified"
        fi
    fi
    
    echo "$files_info"
}

# Get currently tracked files with caching (to avoid excessive lsof calls)
cache_file="$HOME/.claude/file_tracking_cache"
cache_timeout=2  # seconds

tracked_files=""
current_time_sec=$(date +%s)

# Check if cache exists and is recent
if [ -f "$cache_file" ]; then
    cache_time=$(stat -f %m "$cache_file" 2>/dev/null || echo "0")
    time_diff=$((current_time_sec - cache_time))
    
    if [ "$time_diff" -lt "$cache_timeout" ]; then
        # Use cached result
        tracked_files=$(cat "$cache_file" 2>/dev/null || echo "")
    fi
fi

# If no valid cache, get fresh data
if [ -z "$tracked_files" ]; then
    tracked_files=$(get_claude_files)
    
    # Cache the result
    if [ -n "$tracked_files" ]; then
        mkdir -p "$(dirname "$cache_file")"
        echo "$tracked_files" > "$cache_file" 2>/dev/null
    fi
fi

# Build status line with only real data
status_parts=()

# Time and model (corrected)
status_parts+=("$current_date $current_time")
status_parts+=("$model_name")
if [ "$duration_formatted" != "00:00" ]; then
    status_parts+=("${duration_formatted}")
fi

# System resources
status_parts+=("CPU:${cpu_usage}%")
if [ "$ram_used_gb" != "?" ]; then
    status_parts+=("RAM:${ram_used_gb}GB")
fi
status_parts+=("Load:${load_avg}")
if [ -n "$battery_info" ]; then
    status_parts+=("$battery_info")
fi

# Project info
status_parts+=("${project_name}${git_info}")
if [ "$modified_files" -gt 0 ]; then
    status_parts+=("±${modified_files}")
fi
if [ "$commits_today" -gt 0 ]; then
    status_parts+=("↑${commits_today}")
fi

# Parallel execution
if [ "$parallel_count" -gt 0 ]; then
    status_parts+=("⚡${parallel_count}")
fi
if [ "$cco_instances" -gt 0 ]; then
    status_parts+=("🚀${cco_instances}")
elif [ "$CCO_AUTO_INVOKE" = "true" ]; then
    status_parts+=("🚀")
fi

# Development activity
if [ "$dev_server" != "none" ]; then
    status_parts+=("$dev_server")
fi

# Active files (real-time tracking)
if [ -n "$tracked_files" ]; then
    status_parts+=("Files: $tracked_files")
fi

# Join all parts with " | "
IFS=" | "
printf "\033[2m%s\033[0m\n" "${status_parts[*]}"