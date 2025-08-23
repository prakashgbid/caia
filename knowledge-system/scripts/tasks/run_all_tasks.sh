#!/bin/bash
# run_all_tasks.sh - Execute all 36 knowledge system tasks

set -e

TASKS_DIR="/Users/MAC/Documents/projects/caia/knowledge-system/scripts/tasks"
KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"

echo "Running all 36 knowledge system setup tasks..."
echo "=============================================="

# Create logs directory
mkdir -p "$KNOWLEDGE_DIR/logs"

# Define task categories and execution order based on dependency graph
INFRASTRUCTURE_TASKS=(
    "setup_qdrant"
    "setup_sqlite"
    "setup_ast_parser"
    "setup_file_watcher" 
    "setup_codet5"
    "define_entity_models"
)

PIPELINE_TASKS=(
    "entity_extraction"
    "embedding_pipeline"
    "relationship_mapper"
    "incremental_updater"
    "batch_processor"
    "cache_layer"
)

SEARCH_TASKS=(
    "vector_search"
    "sql_fts"
    "graph_search"
    "redundancy_detector"
    "query_fusion"
    "result_ranker"
)

INTEGRATION_TASKS=(
    "cc_hooks"
    "cli_interface"
    "api_endpoints"
    "git_hooks"
    "pre_impl_checker"
    "enforcement_policies"
)

INTELLIGENCE_TASKS=(
    "cross_language"
    "arch_conformance"
    "knowledge_gaps"
    "perf_monitoring"
    "health_checks"
    "auto_recovery"
)

MIGRATION_TASKS=(
    "perf_optimization"
    "gcp_configs"
    "migration_scripts"
    "backup_restore"
    "horizontal_scaling"
    "documentation"
)

# Function to run a task category
run_task_category() {
    local category_name="$1"
    shift
    local tasks=("$@")
    
    echo ""
    echo "=== $category_name TASKS ==="
    
    for task in "${tasks[@]}"; do
        echo "Running $task..."
        if [ -f "$TASKS_DIR/$task.sh" ]; then
            if bash "$TASKS_DIR/$task.sh" > "$KNOWLEDGE_DIR/logs/$task.log" 2>&1; then
                echo "✓ $task completed successfully"
            else
                echo "✗ $task failed (check $KNOWLEDGE_DIR/logs/$task.log)"
                echo "Continuing with remaining tasks..."
            fi
        else
            echo "✗ $task.sh not found"
        fi
    done
}

# Execute tasks in dependency order
run_task_category "INFRASTRUCTURE" "${INFRASTRUCTURE_TASKS[@]}"
run_task_category "PIPELINE" "${PIPELINE_TASKS[@]}"
run_task_category "SEARCH" "${SEARCH_TASKS[@]}"
run_task_category "INTEGRATION" "${INTEGRATION_TASKS[@]}"
run_task_category "INTELLIGENCE" "${INTELLIGENCE_TASKS[@]}"
run_task_category "MIGRATION" "${MIGRATION_TASKS[@]}"

# Summary
echo ""
echo "=============================================="
echo "Task Execution Summary:"
echo "=============================================="

total_tasks=36
successful_tasks=0
failed_tasks=0

for script in "$TASKS_DIR"/*.sh; do
    if [[ $(basename "$script") == "run_all_tasks.sh" ]]; then
        continue
    fi
    
    task_name=$(basename "$script" .sh)
    log_file="$KNOWLEDGE_DIR/logs/$task_name.log"
    
    if [[ -f "$log_file" ]]; then
        if grep -q "setup complete" "$log_file" 2>/dev/null; then
            ((successful_tasks++))
        else
            ((failed_tasks++))
        fi
    else
        ((failed_tasks++))
    fi
done

echo "Total tasks: $total_tasks"
echo "Successful: $successful_tasks"
echo "Failed: $failed_tasks"
echo "Success rate: $(( (successful_tasks * 100) / total_tasks ))%"

echo ""
echo "Individual task logs available in: $KNOWLEDGE_DIR/logs/"
echo ""

if [[ $failed_tasks -gt 0 ]]; then
    echo "⚠️  Some tasks failed. Check logs for details:"
    echo "   find $KNOWLEDGE_DIR/logs/ -name '*.log' -exec grep -L 'setup complete' {} \;"
    exit 1
else
    echo "🎉 All tasks completed successfully!"
    echo ""
    echo "Knowledge system is ready!"
    echo "Next steps:"
    echo "1. Run initial extraction: bash $KNOWLEDGE_DIR/pipelines/extractors/batch_extract.sh"
    echo "2. Start file watcher: bash $KNOWLEDGE_DIR/watcher/start_watcher.sh"
    echo "3. Test search: python3 $KNOWLEDGE_DIR/search/vector_search.py 'function that handles files'"
    exit 0
fi