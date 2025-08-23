#!/bin/bash
# Database utilities

DB_PATH="/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db"

# Show database stats
db_stats() {
    echo "Database Statistics:"
    echo "- Entities: $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM entities;")"
    echo "- Relationships: $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM relationships;")"
    echo "- Files tracked: $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM file_tracking;")"
    echo "- Database size: $(ls -lh "$DB_PATH" | awk '{print $5}')"
}

# Reset database
db_reset() {
    echo "Resetting database..."
    rm -f "$DB_PATH"
    "/Users/MAC/Documents/projects/caia/knowledge-system/scripts/tasks/setup_sqlite.sh"
}

# Export data
db_export() {
    local output_dir="${1:-/tmp/knowledge_export}"
    mkdir -p "$output_dir"
    sqlite3 "$DB_PATH" ".dump" > "$output_dir/knowledge_dump.sql"
    echo "Database exported to: $output_dir/knowledge_dump.sql"
}

case "$1" in
    stats) db_stats ;;
    reset) db_reset ;;
    export) db_export "$2" ;;
    *) echo "Usage: $0 {stats|reset|export [output_dir]}" ;;
esac
