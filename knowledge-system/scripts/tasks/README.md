# Knowledge System Task Scripts

This directory contains 36 shell scripts that implement all tasks from the knowledge system dependency graph. Each script sets up a specific component and validates successful completion.

## Task Categories

### Infrastructure (6 tasks)
- **setup_qdrant.sh** - Setup Qdrant vector database with Docker
- **setup_sqlite.sh** - Setup SQLite database with schema and FTS
- **setup_ast_parser.sh** - Setup AST parsers for Python/JavaScript
- **setup_file_watcher.sh** - Setup file system watcher with watchdog
- **setup_codet5.sh** - Setup CodeT5 embedding model
- **define_entity_models.sh** - Define Pydantic entity models and schemas

### Pipelines (6 tasks)
- **entity_extraction.sh** - Setup entity extraction pipeline
- **embedding_pipeline.sh** - Setup embedding generation pipeline
- **relationship_mapper.sh** - Setup relationship mapping pipeline
- **incremental_updater.sh** - Setup incremental update system
- **batch_processor.sh** - Setup batch processing component
- **cache_layer.sh** - Setup caching layer component

### Search (6 tasks)  
- **vector_search.sh** - Setup vector-based semantic search
- **sql_fts.sh** - Setup SQL full-text search component
- **graph_search.sh** - Setup graph search component
- **redundancy_detector.sh** - Setup duplicate detection component
- **query_fusion.sh** - Setup query fusion component
- **result_ranker.sh** - Setup result ranking component

### Integration (6 tasks)
- **cc_hooks.sh** - Setup Claude Code integration hooks
- **cli_interface.sh** - Setup command-line interface with Click
- **api_endpoints.sh** - Setup REST API endpoints with Flask
- **git_hooks.sh** - Setup Git integration hooks
- **pre_impl_checker.sh** - Setup pre-implementation checker
- **enforcement_policies.sh** - Setup policy enforcement component

### Intelligence (6 tasks)
- **cross_language.sh** - Setup cross-language analysis component
- **arch_conformance.sh** - Setup architecture conformance checker
- **knowledge_gaps.sh** - Setup knowledge gap detector
- **perf_monitoring.sh** - Setup performance monitoring component
- **health_checks.sh** - Setup system health checks
- **auto_recovery.sh** - Setup automatic recovery component

### Migration (6 tasks)
- **perf_optimization.sh** - Setup performance optimization component
- **gcp_configs.sh** - Setup Google Cloud Platform configurations
- **migration_scripts.sh** - Setup data migration scripts
- **backup_restore.sh** - Setup backup and restore component
- **horizontal_scaling.sh** - Setup horizontal scaling component
- **documentation.sh** - Setup documentation generation component

## Usage

### Run Individual Tasks
```bash
# Run a specific task
./setup_qdrant.sh
./entity_extraction.sh
```

### Run All Tasks
```bash
# Execute all 36 tasks in dependency order
./run_all_tasks.sh
```

### Validate Scripts
```bash
# Check all scripts are present and valid
./validate_tasks.sh
```

## Task Dependencies

The tasks are executed in dependency order:

1. **Infrastructure** - Core systems (databases, parsers, models)
2. **Pipelines** - Data processing pipelines
3. **Search** - Search and retrieval systems
4. **Integration** - External system integrations
5. **Intelligence** - Advanced analysis features
6. **Migration** - Scaling and operational features

## Output Structure

Each task creates:
- Component directories under `/knowledge-system/`
- Python modules with classes and functions
- Configuration files and schemas
- Utility scripts and services
- Documentation and examples

## Logs and Monitoring

Task execution logs are stored in:
- `/knowledge-system/logs/[task_name].log`

Use the validation script to check completion status:
```bash
find /Users/MAC/Documents/projects/caia/knowledge-system/logs/ -name '*.log' -exec grep -l 'setup complete' {} \;
```

## Next Steps After Setup

1. **Initialize Database**: Run SQLite and Qdrant setup
2. **Extract Entities**: Process existing codebase
3. **Generate Embeddings**: Create vector representations
4. **Start Services**: Enable file watching and API server
5. **Test Search**: Validate semantic search functionality

## Dependencies

Required packages (installed by individual scripts):
- Python: `pydantic`, `transformers`, `torch`, `watchdog`, `flask`, `click`
- External: Docker (for Qdrant), Node.js (for JS parsing)

## Troubleshooting

- Check individual task logs in `/logs/` directory
- Ensure all dependencies are installed
- Verify file permissions (all scripts should be executable)
- Run validation script to identify issues