#!/bin/bash
# cc_hooks.sh - Setup Claude Code integration hooks

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
HOOKS_DIR="$KNOWLEDGE_DIR/hooks"

echo "Setting up Claude Code hooks..."

mkdir -p "$HOOKS_DIR"

# Create CC hook handler
cat > "$HOOKS_DIR/cc_hooks.py" << 'EOF'
#!/usr/bin/env python3
"""Claude Code integration hooks."""

import os
import sys
import json
from pathlib import Path
from typing import Dict, Any, List

sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')

from updater.incremental_updater import IncrementalUpdater
from search.vector_search import VectorSearch

class CCHooks:
    """Claude Code integration hooks."""
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or "/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db"
        self.updater = IncrementalUpdater(self.db_path)
        self.search = VectorSearch(self.db_path)
    
    def on_file_change(self, file_path: str) -> Dict[str, Any]:
        """Handle file change events from Claude Code."""
        print(f"Processing file change: {file_path}")
        
        if Path(file_path).exists():
            result = self.updater.process_file_changes([file_path])
            return {"status": "processed", "result": result}
        else:
            # File deleted
            self.updater._cleanup_deleted_file(file_path)
            return {"status": "deleted"}
    
    def on_query(self, query: str, limit: int = 10) -> Dict[str, Any]:
        """Handle knowledge queries from Claude Code."""
        print(f"Processing query: {query}")
        
        results = self.search.search_similar_code(query, limit)
        return {
            "status": "success",
            "query": query,
            "results": results,
            "count": len(results)
        }
    
    def get_knowledge_stats(self) -> Dict[str, Any]:
        """Get knowledge base statistics."""
        stats = self.search.get_search_stats()
        return stats

def main():
    """CLI interface."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Claude Code hooks")
    parser.add_argument("--file-change", help="Process file change")
    parser.add_argument("--query", help="Process knowledge query")
    parser.add_argument("--stats", action="store_true", help="Show stats")
    
    args = parser.parse_args()
    
    hooks = CCHooks()
    
    if args.file_change:
        result = hooks.on_file_change(args.file_change)
        print(json.dumps(result, indent=2))
    elif args.query:
        result = hooks.on_query(args.query)
        print(json.dumps(result, indent=2))
    elif args.stats:
        stats = hooks.get_knowledge_stats()
        print(json.dumps(stats, indent=2))
    else:
        print("Claude Code hooks ready")

if __name__ == "__main__":
    main()
EOF

chmod +x "$HOOKS_DIR/cc_hooks.py"

echo " Claude Code hooks setup complete"
echo "  - Hooks: $HOOKS_DIR/cc_hooks.py"
exit 0