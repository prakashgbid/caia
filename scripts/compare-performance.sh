#!/bin/bash

# CAIA Performance Comparison Script
# Compares current performance metrics with baseline
# Author: CAIA DevOps Team
# Version: 1.0.0

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BASELINE_FILE="$PROJECT_ROOT/performance-baseline.json"
CURRENT_FILE="$PROJECT_ROOT/performance-results.json"
COMPARISON_FILE="$PROJECT_ROOT/performance-comparison.json"

# Thresholds (percentage)
REGRESSION_THRESHOLD=10  # 10% regression is concerning
IMPROVEMENT_THRESHOLD=5   # 5% improvement is notable

# Logging functions
log() {
    echo -e "${BLUE}[PERF]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if performance files exist
check_files() {
    if [[ ! -f "$CURRENT_FILE" ]]; then
        log_error "Current performance results not found: $CURRENT_FILE"
        exit 1
    fi
    
    if [[ ! -f "$BASELINE_FILE" ]]; then
        log_warning "Baseline performance file not found: $BASELINE_FILE"
        log "Creating baseline from current results..."
        cp "$CURRENT_FILE" "$BASELINE_FILE"
        log_success "Baseline created"
        exit 0
    fi
}

# Compare execution times
compare_execution_times() {
    local baseline_time=$(cat "$BASELINE_FILE" | jq -r '.executionTime // 0')
    local current_time=$(cat "$CURRENT_FILE" | jq -r '.executionTime // 0')
    
    if [[ "$baseline_time" == "0" || "$current_time" == "0" ]]; then
        return
    fi
    
    local change_percent=$(echo "scale=2; (($current_time - $baseline_time) / $baseline_time) * 100" | bc -l)
    
    echo "\"executionTime\": {"
    echo "  \"baseline\": $baseline_time,"
    echo "  \"current\": $current_time,"
    echo "  \"changePercent\": $change_percent,"
    echo "  \"status\": \"$(get_status "$change_percent")\""
    echo "},"
    
    log_metric_change "Execution Time" "$baseline_time" "$current_time" "$change_percent" "ms"
}

# Compare memory usage
compare_memory_usage() {
    local baseline_memory=$(cat "$BASELINE_FILE" | jq -r '.memoryUsage // 0')
    local current_memory=$(cat "$CURRENT_FILE" | jq -r '.memoryUsage // 0')
    
    if [[ "$baseline_memory" == "0" || "$current_memory" == "0" ]]; then
        return
    fi
    
    local change_percent=$(echo "scale=2; (($current_memory - $baseline_memory) / $baseline_memory) * 100" | bc -l)
    
    echo "\"memoryUsage\": {"
    echo "  \"baseline\": $baseline_memory,"
    echo "  \"current\": $current_memory,"
    echo "  \"changePercent\": $change_percent,"
    echo "  \"status\": \"$(get_status "$change_percent")\""
    echo "},"
    
    log_metric_change "Memory Usage" "$baseline_memory" "$current_memory" "$change_percent" "bytes"
}

# Compare throughput
compare_throughput() {
    local baseline_throughput=$(cat "$BASELINE_FILE" | jq -r '.throughput // 0')
    local current_throughput=$(cat "$CURRENT_FILE" | jq -r '.throughput // 0')
    
    if [[ "$baseline_throughput" == "0" || "$current_throughput" == "0" ]]; then
        return
    fi
    
    # For throughput, higher is better, so invert the change percentage logic
    local change_percent=$(echo "scale=2; (($current_throughput - $baseline_throughput) / $baseline_throughput) * 100" | bc -l)
    
    echo "\"throughput\": {"
    echo "  \"baseline\": $baseline_throughput,"
    echo "  \"current\": $current_throughput,"
    echo "  \"changePercent\": $change_percent,"
    echo "  \"status\": \"$(get_throughput_status "$change_percent")\""
    echo "},"
    
    log_metric_change "Throughput" "$baseline_throughput" "$current_throughput" "$change_percent" "ops/sec"
}

# Compare CPU usage
compare_cpu_usage() {
    local baseline_cpu=$(cat "$BASELINE_FILE" | jq -r '.cpuUsage // 0')
    local current_cpu=$(cat "$CURRENT_FILE" | jq -r '.cpuUsage // 0')
    
    if [[ "$baseline_cpu" == "0" || "$current_cpu" == "0" ]]; then
        return
    fi
    
    local change_percent=$(echo "scale=2; (($current_cpu - $baseline_cpu) / $baseline_cpu) * 100" | bc -l)
    
    echo "\"cpuUsage\": {"
    echo "  \"baseline\": $baseline_cpu,"
    echo "  \"current\": $current_cpu,"
    echo "  \"changePercent\": $change_percent,"
    echo "  \"status\": \"$(get_status "$change_percent")\""
    echo "}"
    
    log_metric_change "CPU Usage" "$baseline_cpu" "$current_cpu" "$change_percent" "%"
}

# Get status based on change percentage
get_status() {
    local change_percent="$1"
    
    if (( $(echo "$change_percent > $REGRESSION_THRESHOLD" | bc -l) )); then
        echo "regression"
    elif (( $(echo "$change_percent < -$IMPROVEMENT_THRESHOLD" | bc -l) )); then
        echo "improvement"
    else
        echo "stable"
    fi
}

# Get throughput status (higher is better)
get_throughput_status() {
    local change_percent="$1"
    
    if (( $(echo "$change_percent > $IMPROVEMENT_THRESHOLD" | bc -l) )); then
        echo "improvement"
    elif (( $(echo "$change_percent < -$REGRESSION_THRESHOLD" | bc -l) )); then
        echo "regression"
    else
        echo "stable"
    fi
}

# Log metric change
log_metric_change() {
    local metric_name="$1"
    local baseline="$2"
    local current="$3"
    local change_percent="$4"
    local unit="$5"
    
    local abs_change=$(echo "$change_percent" | sed 's/-//')
    
    if (( $(echo "$change_percent > $REGRESSION_THRESHOLD" | bc -l) )); then
        log_error "$metric_name regression: $baseline$unit → $current$unit (+$change_percent%)"
    elif (( $(echo "$change_percent < -$IMPROVEMENT_THRESHOLD" | bc -l) )); then
        log_success "$metric_name improvement: $baseline$unit → $current$unit ($change_percent%)"
    else
        log "$metric_name stable: $baseline$unit → $current$unit ($change_percent%)"
    fi
}

# Generate comparison report
generate_comparison() {
    log "Comparing performance metrics..."
    
    cat > "$COMPARISON_FILE" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "baseline": {
    "file": "$BASELINE_FILE",
    "timestamp": "$(cat "$BASELINE_FILE" | jq -r '.timestamp // "unknown"')"
  },
  "current": {
    "file": "$CURRENT_FILE",
    "timestamp": "$(cat "$CURRENT_FILE" | jq -r '.timestamp // "unknown"')"
  },
  "thresholds": {
    "regressionThreshold": $REGRESSION_THRESHOLD,
    "improvementThreshold": $IMPROVEMENT_THRESHOLD
  },
  "metrics": {
$(compare_execution_times)
$(compare_memory_usage)
$(compare_throughput)
$(compare_cpu_usage)
  }
}
EOF
    
    log_success "Performance comparison generated: $COMPARISON_FILE"
}

# Analyze overall performance
analyze_performance() {
    log "Analyzing overall performance..."
    
    local regressions=$(cat "$COMPARISON_FILE" | jq -r '.metrics | to_entries[] | select(.value.status == "regression") | .key' | wc -l)
    local improvements=$(cat "$COMPARISON_FILE" | jq -r '.metrics | to_entries[] | select(.value.status == "improvement") | .key' | wc -l)
    local stable=$(cat "$COMPARISON_FILE" | jq -r '.metrics | to_entries[] | select(.value.status == "stable") | .key' | wc -l)
    
    echo ""
    echo "========================================"
    echo "📊 Performance Analysis Summary"
    echo "========================================"
    echo "🔴 Regressions: $regressions"
    echo "🟢 Improvements: $improvements"
    echo "⚪ Stable: $stable"
    echo "========================================"
    
    # Generate summary for CI/CD
    local summary=""
    
    if [[ $regressions -gt 0 ]]; then
        summary="⚠️ **Performance regressions detected** ($regressions metrics)\n\n"
        summary+="**Regressed metrics:**\n"
        
        local regressed_metrics=$(cat "$COMPARISON_FILE" | jq -r '.metrics | to_entries[] | select(.value.status == "regression") | "- \(.key): \(.value.changePercent)%"')
        summary+="$regressed_metrics\n\n"
    fi
    
    if [[ $improvements -gt 0 ]]; then
        summary+="✅ **Performance improvements** ($improvements metrics)\n\n"
        summary+="**Improved metrics:**\n"
        
        local improved_metrics=$(cat "$COMPARISON_FILE" | jq -r '.metrics | to_entries[] | select(.value.status == "improvement") | "- \(.key): \(.value.changePercent)%"')
        summary+="$improved_metrics\n\n"
    fi
    
    if [[ $regressions -eq 0 && $improvements -eq 0 ]]; then
        summary+="📊 **Performance stable** - No significant changes detected\n\n"
    fi
    
    summary+="**Comparison Details:**\n"
    summary+="- Baseline: $(cat "$BASELINE_FILE" | jq -r '.timestamp // "unknown"')\n"
    summary+="- Current: $(cat "$CURRENT_FILE" | jq -r '.timestamp // "unknown"')\n"
    summary+="- Regression threshold: ${REGRESSION_THRESHOLD}%\n"
    summary+="- Improvement threshold: ${IMPROVEMENT_THRESHOLD}%"
    
    # Save summary for GitHub Actions
    cat > "performance-summary.md" << EOF
## Performance Comparison Results

$summary

<details>
<summary>Detailed Metrics</summary>

\`\`\`json
$(cat "$COMPARISON_FILE" | jq '.metrics')
\`\`\`

</details>
EOF
    
    # Update comparison file with summary
    local temp_file=$(mktemp)
    cat "$COMPARISON_FILE" | jq --arg summary "$summary" '. + {summary: $summary}' > "$temp_file"
    mv "$temp_file" "$COMPARISON_FILE"
    
    echo -e "$summary"
    
    # Return appropriate exit code
    if [[ $regressions -gt 0 ]]; then
        log_error "Performance regressions detected"
        return 1
    else
        log_success "Performance analysis completed"
        return 0
    fi
}

# Update baseline if needed
update_baseline() {
    local update_baseline=false
    
    # Check if we should update baseline
    if [[ "${UPDATE_BASELINE:-false}" == "true" ]]; then
        update_baseline=true
    elif [[ "${CI:-false}" == "true" && "${GITHUB_REF:-}" == "refs/heads/main" ]]; then
        # Auto-update baseline on main branch in CI
        update_baseline=true
    fi
    
    if [[ "$update_baseline" == "true" ]]; then
        log "Updating performance baseline..."
        cp "$CURRENT_FILE" "$BASELINE_FILE"
        log_success "Baseline updated"
    fi
}

# Main execution
main() {
    cd "$PROJECT_ROOT"
    
    check_files
    generate_comparison
    analyze_performance
    local exit_code=$?
    
    update_baseline
    
    return $exit_code
}

# Execute main function
main "$@"