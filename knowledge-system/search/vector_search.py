#!/usr/bin/env python3
"""Vector-based semantic search for code entities."""

import os
import sqlite3
import numpy as np
from typing import List, Dict, Any, Tuple, Optional
import json
import logging
from datetime import datetime
import requests

sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')
from embeddings.codet5_embedder import EmbeddingService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class VectorSearch:
    """Vector-based semantic search engine."""
    
    def __init__(self, db_path: str, qdrant_url: str = "http://localhost:6333"):
        self.db_path = db_path
        self.qdrant_url = qdrant_url
        self.embedding_service = EmbeddingService()
        
    def search_similar_code(self, query: str, limit: int = 10, threshold: float = 0.7) -> List[Dict[str, Any]]:
        """Search for code similar to the query."""
        try:
            # Generate query embedding
            query_embedding = self.embedding_service.embed_code(query)
            
            # Search in Qdrant if available
            if self._is_qdrant_available():
                return self._search_qdrant(query_embedding, limit, threshold)
            else:
                # Fallback to SQLite-based search
                return self._search_sqlite(query_embedding, limit, threshold)
                
        except Exception as e:
            logger.error(f"Error in vector search: {e}")
            return []
    
    def _search_qdrant(self, query_embedding: np.ndarray, limit: int, threshold: float) -> List[Dict[str, Any]]:
        """Search using Qdrant vector database."""
        try:
            search_request = {
                "vector": query_embedding.tolist(),
                "limit": limit,
                "score_threshold": threshold,
                "with_payload": True
            }
            
            response = requests.post(
                f"{self.qdrant_url}/collections/code_embeddings/points/search",
                json=search_request,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                results = response.json()["result"]
                return [
                    {
                        'entity_id': result['id'],
                        'similarity_score': result['score'],
                        'entity_name': result['payload'].get('entity_name'),
                        'entity_type': result['payload'].get('entity_type'),
                        'file_path': result['payload'].get('file_path'),
                        'signature': result['payload'].get('signature', ''),
                        'docstring': result['payload'].get('docstring', '')
                    }
                    for result in results
                ]
            else:
                logger.error(f"Qdrant search failed: {response.status_code}")
                return []
                
        except Exception as e:
            logger.error(f"Error searching Qdrant: {e}")
            return []
    
    def _search_sqlite(self, query_embedding: np.ndarray, limit: int, threshold: float) -> List[Dict[str, Any]]:
        """Fallback search using SQLite with cosine similarity."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # Get all embeddings
                cursor.execute("""
                    SELECT ee.entity_id, ee.embedding_vector, ee.embedding_text,
                           e.name, e.type, e.file_path, e.signature, e.docstring
                    FROM entity_embeddings ee
                    JOIN entities e ON ee.entity_id = e.id
                """)
                
                results = []
                
                for row in cursor.fetchall():
                    # Deserialize embedding
                    stored_embedding = np.frombuffer(row['embedding_vector'], dtype=np.float32)
                    
                    # Calculate cosine similarity
                    similarity = self._cosine_similarity(query_embedding, stored_embedding)
                    
                    if similarity >= threshold:
                        results.append({
                            'entity_id': row['entity_id'],
                            'similarity_score': float(similarity),
                            'entity_name': row['name'],
                            'entity_type': row['type'],
                            'file_path': row['file_path'],
                            'signature': row['signature'] or '',
                            'docstring': row['docstring'] or '',
                            'embedding_text': row['embedding_text']
                        })
                
                # Sort by similarity and limit
                results.sort(key=lambda x: x['similarity_score'], reverse=True)
                return results[:limit]
                
        except Exception as e:
            logger.error(f"Error in SQLite search: {e}")
            return []
    
    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors."""
        try:
            # Ensure same length
            min_len = min(len(a), len(b))
            a = a[:min_len]
            b = b[:min_len]
            
            # Calculate cosine similarity
            dot_product = np.dot(a, b)
            norm_a = np.linalg.norm(a)
            norm_b = np.linalg.norm(b)
            
            if norm_a == 0 or norm_b == 0:
                return 0.0
            
            return dot_product / (norm_a * norm_b)
            
        except Exception as e:
            logger.error(f"Error calculating similarity: {e}")
            return 0.0
    
    def search_by_entity_id(self, entity_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Find entities similar to a specific entity."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Get the entity's embedding
                cursor.execute(
                    "SELECT embedding_vector FROM entity_embeddings WHERE entity_id = ?",
                    (entity_id,)
                )
                result = cursor.fetchone()
                
                if not result:
                    logger.warning(f"No embedding found for entity: {entity_id}")
                    return []
                
                entity_embedding = np.frombuffer(result[0], dtype=np.float32)
                return self._search_sqlite(entity_embedding, limit + 1, 0.1)  # +1 to exclude self
                
        except Exception as e:
            logger.error(f"Error searching by entity ID: {e}")
            return []
    
    def _is_qdrant_available(self) -> bool:
        """Check if Qdrant is available."""
        try:
            response = requests.get(f"{self.qdrant_url}/health", timeout=2)
            return response.status_code == 200
        except:
            return False
    
    def get_search_stats(self) -> Dict[str, Any]:
        """Get search system statistics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Count embeddings
                cursor.execute("SELECT COUNT(*) FROM entity_embeddings")
                total_embeddings = cursor.fetchone()[0]
                
                # Count entities
                cursor.execute("SELECT COUNT(*) FROM entities")
                total_entities = cursor.fetchone()[0]
                
                return {
                    'total_entities': total_entities,
                    'total_embeddings': total_embeddings,
                    'embedding_coverage': total_embeddings / max(total_entities, 1),
                    'qdrant_available': self._is_qdrant_available(),
                    'search_backend': 'qdrant' if self._is_qdrant_available() else 'sqlite'
                }
                
        except Exception as e:
            logger.error(f"Error getting search stats: {e}")
            return {}

def main():
    """CLI interface for vector search."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Vector-based code search")
    parser.add_argument("query", nargs="?", help="Search query")
    parser.add_argument(
        "--db-path",
        default="/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db",
        help="Database path"
    )
    parser.add_argument("--limit", type=int, default=10, help="Result limit")
    parser.add_argument("--threshold", type=float, default=0.7, help="Similarity threshold")
    parser.add_argument("--entity-id", help="Find similar to entity ID")
    parser.add_argument("--stats", action="store_true", help="Show search statistics")
    
    args = parser.parse_args()
    
    search = VectorSearch(args.db_path)
    
    if args.stats:
        stats = search.get_search_stats()
        print(json.dumps(stats, indent=2))
    elif args.entity_id:
        results = search.search_by_entity_id(args.entity_id, args.limit)
        print(f"Similar entities to {args.entity_id}:")
        for i, result in enumerate(results, 1):
            print(f"{i}. {result['entity_name']} ({result['entity_type']}) - {result['similarity_score']:.3f}")
            print(f"   {result['file_path']}")
    elif args.query:
        results = search.search_similar_code(args.query, args.limit, args.threshold)
        print(f"Search results for: {args.query}")
        for i, result in enumerate(results, 1):
            print(f"{i}. {result['entity_name']} ({result['entity_type']}) - {result['similarity_score']:.3f}")
            print(f"   {result['file_path']}")
            if result.get('signature'):
                print(f"   {result['signature']}")
    else:
        print("Please provide a query or use --stats")

if __name__ == "__main__":
    main()
