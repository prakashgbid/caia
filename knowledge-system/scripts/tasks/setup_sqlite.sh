#!/bin/bash
# setup_sqlite.sh - Setup SQLite database for metadata and FTS

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
DB_PATH="$KNOWLEDGE_DIR/data/knowledge.db"
SCHEMA_DIR="$KNOWLEDGE_DIR/schema"

echo "Setting up SQLite database..."

# Create data directory
mkdir -p "$(dirname "$DB_PATH")"
mkdir -p "$SCHEMA_DIR"

# Create database schema
cat > "$SCHEMA_DIR/schema.sql" << 'EOF'
-- Knowledge System Database Schema

-- Entities table for code components
CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- 'function', 'class', 'file', 'module'
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    signature TEXT,
    docstring TEXT,
    complexity INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Relationships between entities
CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entity_id INTEGER NOT NULL,
    to_entity_id INTEGER NOT NULL,
    relationship_type TEXT NOT NULL, -- 'calls', 'imports', 'inherits', 'uses'
    weight REAL DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_entity_id) REFERENCES entities(id),
    FOREIGN KEY (to_entity_id) REFERENCES entities(id)
);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
    name,
    signature,
    docstring,
    content='entities',
    content_rowid='id'
);

-- File tracking for incremental updates
CREATE TABLE IF NOT EXISTS file_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,
    last_modified DATETIME NOT NULL,
    file_hash TEXT NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Performance metrics
CREATE TABLE IF NOT EXISTS performance_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_file_path ON entities(file_path);
CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_file_tracking_path ON file_tracking(file_path);
CREATE INDEX IF NOT EXISTS idx_file_tracking_modified ON file_tracking(last_modified);

-- Triggers to keep FTS table synchronized
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, signature, docstring)
  VALUES (new.id, new.name, new.signature, new.docstring);
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  UPDATE entities_fts SET name=new.name, signature=new.signature, docstring=new.docstring
  WHERE rowid=new.id;
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  DELETE FROM entities_fts WHERE rowid=old.id;
END;
EOF

# Initialize database with schema
echo "Creating database at: $DB_PATH"
sqlite3 "$DB_PATH" < "$SCHEMA_DIR/schema.sql"

# Verify database creation
if sqlite3 "$DB_PATH" ".tables" | grep -q "entities"; then
    echo "✓ SQLite database created successfully"
    echo "  - Database path: $DB_PATH"
    echo "  - Schema file: $SCHEMA_DIR/schema.sql"
    
    # Show table count
    TABLE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")
    echo "  - Tables created: $TABLE_COUNT"
else
    echo "✗ Failed to create database tables"
    exit 1
fi

# Create database utilities script
cat > "$KNOWLEDGE_DIR/scripts/db_utils.sh" << 'EOF'
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
EOF

chmod +x "$KNOWLEDGE_DIR/scripts/db_utils.sh"

echo "✓ SQLite setup complete with utilities"
exit 0