#!/bin/bash
# validate_tasks.sh - Validate all 36 task scripts

set -e

TASKS_DIR="/Users/MAC/Documents/projects/caia/knowledge-system/scripts/tasks"
EXPECTED_TASKS=(
    # Infrastructure (6 tasks)
    "setup_qdrant"
    "setup_sqlite" 
    "setup_ast_parser"
    "setup_file_watcher"
    "setup_codet5"
    "define_entity_models"
    
    # Pipelines (6 tasks)
    "entity_extraction"
    "embedding_pipeline"
    "relationship_mapper"
    "incremental_updater"
    "batch_processor"
    "cache_layer"
    
    # Search (6 tasks)
    "vector_search"
    "sql_fts"
    "graph_search"
    "redundancy_detector"
    "query_fusion"
    "result_ranker"
    
    # Integration (6 tasks)
    "cc_hooks"
    "cli_interface"
    "api_endpoints"
    "git_hooks"
    "pre_impl_checker"
    "enforcement_policies"
    
    # Intelligence (6 tasks)
    "cross_language"
    "arch_conformance"
    "knowledge_gaps"
    "perf_monitoring"
    "health_checks"
    "auto_recovery"
    
    # Migration (6 tasks)
    "perf_optimization"
    "gcp_configs"
    "migration_scripts"
    "backup_restore"
    "horizontal_scaling"
    "documentation"
)

echo "Validating knowledge system task scripts..."
echo "=========================================="

missing_count=0
present_count=0
invalid_count=0

for task in "${EXPECTED_TASKS[@]}"; do
    script_path="$TASKS_DIR/$task.sh"
    
    if [[ -f "$script_path" ]]; then
        # Check if executable
        if [[ -x "$script_path" ]]; then
            # Basic syntax check
            if bash -n "$script_path" 2>/dev/null; then
                echo "✓ $task.sh - valid and executable"
                ((present_count++))
            else
                echo "✗ $task.sh - syntax errors"
                ((invalid_count++))
            fi
        else
            echo "⚠ $task.sh - not executable"
            chmod +x "$script_path"
            ((present_count++))
        fi
    else
        echo "✗ $task.sh - missing"
        ((missing_count++))
    fi
done

echo ""
echo "Validation Summary:"
echo "=================="
echo "Expected tasks: ${#EXPECTED_TASKS[@]}"
echo "Present and valid: $present_count"
echo "Missing: $missing_count"  
echo "Invalid syntax: $invalid_count"

# Check for extra scripts
echo ""
echo "Additional scripts found:"
for script in "$TASKS_DIR"/*.sh; do
    script_name=$(basename "$script" .sh)
    if [[ ! " ${EXPECTED_TASKS[@]} " =~ " $script_name " ]] && [[ "$script_name" != "run_all_tasks" ]] && [[ "$script_name" != "validate_tasks" ]]; then
        echo "+ $script_name.sh (extra)"
    fi
done

if [[ $missing_count -eq 0 && $invalid_count -eq 0 ]]; then
    echo ""
    echo "🎉 All 36 task scripts are present and valid!"
    echo "Ready to run: ./run_all_tasks.sh"
    exit 0
else
    echo ""
    echo "❌ Some scripts are missing or invalid"
    exit 1
fi