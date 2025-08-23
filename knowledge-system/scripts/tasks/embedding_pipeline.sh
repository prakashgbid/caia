#!/bin/bash
# embedding_pipeline.sh - Setup embedding generation pipeline

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
PIPELINES_DIR="$KNOWLEDGE_DIR/pipelines"
EMBEDDINGS_DIR="$PIPELINES_DIR/embeddings"

echo "Setting up embedding pipeline..."

# Create directories
mkdir -p "$EMBEDDINGS_DIR"

# Create embedding pipeline
cat > "$EMBEDDINGS_DIR/embedding_pipeline.py" << 'EOF'
#!/usr/bin/env python3
"""Embedding generation pipeline for code entities."""

import os
import sqlite3
import numpy as np
from typing import List, Dict, Any, Optional
import json
import logging
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

# Add knowledge system to path
import sys
sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')

from embeddings.codet5_embedder import EmbeddingService
from models.entities import Entity, EntityType

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EmbeddingPipeline:
    """Pipeline for generating and storing embeddings."""
    
    def __init__(self, db_path: str, qdrant_url: str = "http://localhost:6333"):
        self.db_path = db_path
        self.qdrant_url = qdrant_url
        self.embedding_service = None
        
        # Initialize embedding service
        try:
            self.embedding_service = EmbeddingService()
            logger.info("Embedding service initialized")
        except Exception as e:
            logger.error(f"Failed to initialize embedding service: {e}")
            raise
    
    def process_all_entities(self, batch_size: int = 32) -> int:
        """Process all entities that don't have embeddings."""
        try:
            # Get entities without embeddings
            entities = self._get_entities_without_embeddings()
            
            if not entities:
                logger.info("No entities need embedding processing")
                return 0
            
            logger.info(f"Processing embeddings for {len(entities)} entities")
            
            # Process in batches
            processed = 0
            for i in range(0, len(entities), batch_size):
                batch = entities[i:i + batch_size]
                success_count = self._process_entity_batch(batch)
                processed += success_count
                
                logger.info(f"Processed batch {i//batch_size + 1}/{(len(entities)-1)//batch_size + 1}")
            
            return processed
            
        except Exception as e:
            logger.error(f"Error processing entities: {e}")
            return 0
    
    def _get_entities_without_embeddings(self) -> List[Dict[str, Any]]:
        """Get entities that don't have embeddings yet."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute("""
                    SELECT id, type, name, signature, docstring, file_path, 
                           start_line, end_line
                    FROM entities 
                    WHERE id NOT IN (
                        SELECT DISTINCT entity_id FROM entity_embeddings
                    )
                    ORDER BY updated_at DESC
                """)
                
                return [dict(row) for row in cursor.fetchall()]
                
        except Exception as e:
            logger.error(f"Error getting entities: {e}")
            return []
    
    def _process_entity_batch(self, entities: List[Dict[str, Any]]) -> int:
        """Process a batch of entities."""
        success_count = 0
        
        for entity in entities:
            try:
                # Create text representation
                text_repr = self._create_entity_text(entity)
                
                # Generate embedding
                embedding = self.embedding_service.embed_code(text_repr)
                
                # Store embedding in SQLite
                self._store_embedding_sqlite(entity['id'], embedding, text_repr)
                
                # Store in Qdrant if available
                self._store_embedding_qdrant(entity['id'], embedding, entity)
                
                success_count += 1
                
            except Exception as e:
                logger.error(f"Error processing entity {entity.get('name', 'unknown')}: {e}")
        
        return success_count
    
    def _create_entity_text(self, entity: Dict[str, Any]) -> str:
        """Create text representation for embedding."""
        parts = []
        
        # Add type and name
        parts.append(f"{entity.get('type', 'unknown')} {entity.get('name', 'unnamed')}")
        
        # Add signature if available
        if entity.get('signature'):
            parts.append(entity['signature'])
        
        # Add docstring if available
        if entity.get('docstring'):
            parts.append(entity['docstring'])
        
        return " ".join(parts)
    
    def _store_embedding_sqlite(self, entity_id: str, embedding: np.ndarray, text: str):
        """Store embedding in SQLite database."""
        try:
            # Create embeddings table if it doesn't exist
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Create table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS entity_embeddings (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        entity_id TEXT NOT NULL,
                        embedding_vector BLOB NOT NULL,
                        embedding_text TEXT NOT NULL,
                        model_name TEXT DEFAULT 'codet5-base',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (entity_id) REFERENCES entities(id)
                    )
                """)
                
                # Insert embedding
                cursor.execute("""
                    INSERT OR REPLACE INTO entity_embeddings 
                    (entity_id, embedding_vector, embedding_text, created_at)
                    VALUES (?, ?, ?, ?)
                """, (
                    entity_id,
                    embedding.tobytes(),
                    text,
                    datetime.now()
                ))
                
                conn.commit()
                
        except Exception as e:
            logger.error(f"Error storing SQLite embedding: {e}")
    
    def _store_embedding_qdrant(self, entity_id: str, embedding: np.ndarray, entity: Dict[str, Any]):
        """Store embedding in Qdrant vector database."""
        try:
            # Check if Qdrant is available
            if not self._is_qdrant_available():
                logger.debug("Qdrant not available, skipping vector storage")
                return
            
            # Prepare point for Qdrant
            point = {
                "id": entity_id,
                "vector": embedding.tolist(),
                "payload": {
                    "entity_type": entity.get('type'),
                    "entity_name": entity.get('name'),
                    "file_path": entity.get('file_path'),
                    "start_line": entity.get('start_line'),
                    "signature": entity.get('signature', ''),
                    "docstring": entity.get('docstring', '')
                }
            }
            
            # Insert into Qdrant
            response = requests.put(
                f"{self.qdrant_url}/collections/code_embeddings/points",
                json={"points": [point]},
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code not in [200, 201]:
                logger.warning(f"Qdrant storage failed: {response.status_code}")\n            
        except Exception as e:
            logger.debug(f"Qdrant storage error (non-critical): {e}")
    
    def _is_qdrant_available(self) -> bool:
        """Check if Qdrant is available."""
        try:
            response = requests.get(f"{self.qdrant_url}/health", timeout=2)
            return response.status_code == 200
        except:
            return False
    
    def get_pipeline_stats(self) -> Dict[str, Any]:
        """Get pipeline statistics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Total entities
                cursor.execute("SELECT COUNT(*) FROM entities")
                total_entities = cursor.fetchone()[0]
                
                # Entities with embeddings
                cursor.execute("SELECT COUNT(*) FROM entity_embeddings")
                embedded_entities = cursor.fetchone()[0]
                
                # Recent embeddings
                cursor.execute("""
                    SELECT COUNT(*) FROM entity_embeddings 
                    WHERE created_at > datetime('now', '-1 hour')
                """)
                recent_embeddings = cursor.fetchone()[0]
                
                return {
                    'total_entities': total_entities,
                    'embedded_entities': embedded_entities,
                    'embedding_coverage': embedded_entities / max(total_entities, 1),
                    'recent_embeddings': recent_embeddings,
                    'qdrant_available': self._is_qdrant_available()
                }
                
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {}

def main():
    """CLI interface for embedding pipeline."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Embedding generation pipeline")
    parser.add_argument(
        "--db-path",
        default="/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db",
        help="Database path"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Batch size for processing"
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Show pipeline statistics"
    )
    
    args = parser.parse_args()
    
    try:
        # Create pipeline
        pipeline = EmbeddingPipeline(args.db_path)
        
        if args.stats:
            stats = pipeline.get_pipeline_stats()
            print(json.dumps(stats, indent=2))
        else:
            # Process entities
            processed = pipeline.process_all_entities(args.batch_size)
            print(f"Processed embeddings for {processed} entities")
            
            # Show final stats
            stats = pipeline.get_pipeline_stats()
            print(f"Coverage: {stats.get('embedding_coverage', 0):.2%}")
    
    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        exit(1)

if __name__ == "__main__":
    main()
EOF

chmod +x "$EMBEDDINGS_DIR/embedding_pipeline.py"

echo "✓ Embedding pipeline setup complete"
echo "  - Pipeline script: $EMBEDDINGS_DIR/embedding_pipeline.py"
echo ""
echo "Usage:"
echo "  python3 $EMBEDDINGS_DIR/embedding_pipeline.py"
echo "  python3 $EMBEDDINGS_DIR/embedding_pipeline.py --stats"

exit 0