#!/bin/bash
# incremental_updater.sh - Setup incremental update system

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
UPDATER_DIR="$KNOWLEDGE_DIR/updater"

echo "Setting up incremental updater..."

mkdir -p "$UPDATER_DIR"

# Create incremental updater
cat > "$UPDATER_DIR/incremental_updater.py" << 'EOF'
#!/usr/bin/env python3
"""Incremental update system for knowledge base."""

import os
import sqlite3
import hashlib
from typing import List, Dict, Any, Set
from pathlib import Path
from datetime import datetime
import logging
import json

sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')
from pipelines.extractors.entity_extractor import EntityExtractor
from pipelines.relationships.relationship_mapper import RelationshipMapper
from pipelines.embeddings.embedding_pipeline import EmbeddingPipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class IncrementalUpdater:
    """Handles incremental updates to the knowledge base."""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.extractor = EntityExtractor(db_path)
        self.mapper = RelationshipMapper(db_path)
        self.embedder = EmbeddingPipeline(db_path)
        
    def process_file_changes(self, changed_files: List[str]) -> Dict[str, Any]:
        """Process incremental changes to files."""
        results = {
            'processed_files': 0,
            'new_entities': 0,
            'updated_entities': 0,
            'new_relationships': 0,
            'new_embeddings': 0
        }
        
        for file_path in changed_files:
            if Path(file_path).exists():
                result = self._process_single_file(file_path)
                for key in results:
                    if key in result:
                        results[key] += result[key]
                results['processed_files'] += 1
            else:
                # File deleted - clean up
                self._cleanup_deleted_file(file_path)
        
        return results
    
    def _process_single_file(self, file_path: str) -> Dict[str, Any]:
        """Process updates for a single file."""
        logger.info(f"Processing file: {file_path}")
        
        # Check if file needs processing
        if not self._file_needs_update(file_path):
            return {}
        
        # Extract entities
        entities = self.extractor.extract_from_file(file_path)
        
        # Map relationships
        relationships = self.mapper._map_file_relationships(file_path, [
            {'id': e.id, 'name': e.name, 'start_line': e.location.start_line,
             'end_line': e.location.end_line, 'file_path': file_path}
            for e in entities
        ])
        
        # Generate embeddings
        embeddings = self.embedder._process_entity_batch([
            {'id': e.id, 'name': e.name, 'signature': e.signature,
             'docstring': e.documentation.docstring}
            for e in entities
        ])
        
        return {
            'new_entities': len(entities),
            'new_relationships': len(relationships),
            'new_embeddings': embeddings
        }
    
    def _file_needs_update(self, file_path: str) -> bool:
        """Check if file needs to be reprocessed."""
        try:
            current_hash = self._calculate_file_hash(file_path)
            last_modified = datetime.fromtimestamp(os.path.getmtime(file_path))
            
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT file_hash, last_modified FROM file_tracking WHERE file_path = ?",
                    (file_path,)
                )
                result = cursor.fetchone()
                
                if not result:
                    return True  # New file
                
                stored_hash, stored_modified = result
                return current_hash != stored_hash
                
        except Exception as e:
            logger.error(f"Error checking file update status: {e}")
            return True  # Process if uncertain
    
    def _calculate_file_hash(self, file_path: str) -> str:
        """Calculate SHA-256 hash of file."""
        hash_sha256 = hashlib.sha256()
        try:
            with open(file_path, 'rb') as f:
                for chunk in iter(lambda: f.read(4096), b""):
                    hash_sha256.update(chunk)
            return hash_sha256.hexdigest()
        except Exception:
            return ""
    
    def _cleanup_deleted_file(self, file_path: str):
        """Clean up entities and relationships for deleted file."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Get entity IDs to clean up relationships
                cursor.execute("SELECT id FROM entities WHERE file_path = ?", (file_path,))
                entity_ids = [row[0] for row in cursor.fetchall()]
                
                # Delete relationships
                for entity_id in entity_ids:
                    cursor.execute(
                        "DELETE FROM relationships WHERE from_entity_id = ? OR to_entity_id = ?",
                        (entity_id, entity_id)
                    )
                
                # Delete embeddings
                for entity_id in entity_ids:
                    cursor.execute("DELETE FROM entity_embeddings WHERE entity_id = ?", (entity_id,))
                
                # Delete entities
                cursor.execute("DELETE FROM entities WHERE file_path = ?", (file_path,))
                
                # Remove from file tracking
                cursor.execute("DELETE FROM file_tracking WHERE file_path = ?", (file_path,))
                
                conn.commit()
                logger.info(f"Cleaned up deleted file: {file_path}")
                
        except Exception as e:
            logger.error(f"Error cleaning up deleted file: {e}")

def main():
    """CLI interface for incremental updater."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Incremental knowledge base updater")
    parser.add_argument("files", nargs="*", help="Files to process")
    parser.add_argument(
        "--db-path",
        default="/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db",
        help="Database path"
    )
    
    args = parser.parse_args()
    
    if not args.files:
        print("No files specified")
        return
    
    updater = IncrementalUpdater(args.db_path)
    results = updater.process_file_changes(args.files)
    
    print(f"Incremental update results:")
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
EOF

chmod +x "$UPDATER_DIR/incremental_updater.py"

echo "✓ Incremental updater setup complete"
echo "  - Updater: $UPDATER_DIR/incremental_updater.py"
exit 0
