#!/usr/bin/env python3
"""Relationship mapping pipeline for code entities."""

import os
import ast
import sqlite3
import json
from typing import List, Dict, Any, Set, Optional, Tuple
from pathlib import Path
from datetime import datetime
import logging
import re

# Add to path
import sys
sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')

from models.entities import RelationshipType

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class RelationshipMapper:
    """Maps relationships between code entities."""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        
    def map_all_relationships(self) -> int:
        """Map relationships for all entities."""
        try:
            # Get all entities
            entities = self._get_all_entities()
            if not entities:
                logger.info("No entities found")
                return 0
            
            logger.info(f"Mapping relationships for {len(entities)} entities")
            
            # Group entities by file for efficient processing
            entities_by_file = self._group_entities_by_file(entities)
            
            total_relationships = 0
            
            # Process each file
            for file_path, file_entities in entities_by_file.items():
                file_rels = self._map_file_relationships(file_path, file_entities)
                total_relationships += len(file_rels)
            
            # Map cross-file relationships
            cross_file_rels = self._map_cross_file_relationships(entities)
            total_relationships += len(cross_file_rels)
            
            logger.info(f"Mapped {total_relationships} relationships")
            return total_relationships
            
        except Exception as e:
            logger.error(f"Error mapping relationships: {e}")
            return 0
    
    def _get_all_entities(self) -> List[Dict[str, Any]]:
        """Get all entities from database."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute("""
                    SELECT id, type, name, file_path, start_line, end_line,
                           signature, docstring
                    FROM entities
                    ORDER BY file_path, start_line
                """)
                
                return [dict(row) for row in cursor.fetchall()]
                
        except Exception as e:
            logger.error(f"Error getting entities: {e}")
            return []
    
    def _group_entities_by_file(self, entities: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """Group entities by file path."""
        grouped = {}
        for entity in entities:
            file_path = entity['file_path']
            if file_path not in grouped:
                grouped[file_path] = []
            grouped[file_path].append(entity)
        return grouped
    
    def _map_file_relationships(self, file_path: str, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Map relationships within a single file."""
        relationships = []
        
        try:
            # Read and parse the file
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Different strategies based on file type
            if file_path.endswith('.py'):
                relationships.extend(self._map_python_relationships(content, entities))
            elif file_path.endswith(('.js', '.ts', '.jsx', '.tsx')):
                relationships.extend(self._map_js_relationships(content, entities))
            
            # Store relationships
            self._store_relationships(relationships)
            
        except Exception as e:
            logger.error(f"Error mapping relationships in {file_path}: {e}")
        
        return relationships
    
    def _map_python_relationships(self, content: str, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Map Python-specific relationships."""
        relationships = []
        
        try:
            # Parse AST
            tree = ast.parse(content)
            
            # Create entity lookup
            entity_lookup = {
                (e['name'], e['start_line']): e for e in entities
            }
            
            # Find function calls
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    caller_entity = self._find_containing_entity(node.lineno, entities)
                    if caller_entity:
                        called_name = self._get_call_name(node)
                        if called_name:
                            called_entity = self._find_entity_by_name(called_name, entities)
                            if called_entity:
                                relationships.append({
                                    'from_entity_id': caller_entity['id'],
                                    'to_entity_id': called_entity['id'],
                                    'relationship_type': RelationshipType.CALLS.value,
                                    'line_number': node.lineno
                                })
                
                # Find class inheritance
                elif isinstance(node, ast.ClassDef):
                    class_entity = self._find_entity_by_name(node.name, entities)
                    if class_entity:
                        for base in node.bases:
                            base_name = self._get_name_from_node(base)
                            if base_name:
                                base_entity = self._find_entity_by_name(base_name, entities)
                                if base_entity:
                                    relationships.append({
                                        'from_entity_id': class_entity['id'],
                                        'to_entity_id': base_entity['id'],
                                        'relationship_type': RelationshipType.INHERITS.value,
                                        'line_number': node.lineno
                                    })
                
                # Find imports (handled separately for cross-file)
                
        except Exception as e:
            logger.error(f"Error parsing Python AST: {e}")
        
        return relationships
    
    def _map_js_relationships(self, content: str, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Map JavaScript/TypeScript relationships using regex patterns."""
        relationships = []
        
        try:
            lines = content.split('\n')
            
            # Pattern matching for function calls
            call_pattern = r'(\w+)\s*\('
            
            for line_num, line in enumerate(lines, 1):
                # Find function calls
                calls = re.findall(call_pattern, line)
                caller_entity = self._find_containing_entity(line_num, entities)
                
                if caller_entity:
                    for call in calls:
                        called_entity = self._find_entity_by_name(call, entities)
                        if called_entity and called_entity['id'] != caller_entity['id']:
                            relationships.append({
                                'from_entity_id': caller_entity['id'],
                                'to_entity_id': called_entity['id'],
                                'relationship_type': RelationshipType.CALLS.value,
                                'line_number': line_num
                            })\n            
        except Exception as e:
            logger.error(f"Error parsing JS relationships: {e}")
        
        return relationships
    
    def _map_cross_file_relationships(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Map relationships across files (imports, etc.)."""
        relationships = []
        
        # Group by file for import analysis
        by_file = self._group_entities_by_file(entities)
        
        for file_path, file_entities in by_file.items():
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                if file_path.endswith('.py'):
                    relationships.extend(self._map_python_imports(content, file_entities, entities))
                elif file_path.endswith(('.js', '.ts', '.jsx', '.tsx')):
                    relationships.extend(self._map_js_imports(content, file_entities, entities))
                    
            except Exception as e:
                logger.error(f"Error mapping imports in {file_path}: {e}")
        
        # Store cross-file relationships
        self._store_relationships(relationships)
        
        return relationships
    
    def _map_python_imports(self, content: str, file_entities: List[Dict[str, Any]], all_entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Map Python import relationships."""
        relationships = []
        
        try:
            tree = ast.parse(content)
            
            for node in ast.walk(tree):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    for alias in node.names:
                        imported_name = alias.name
                        
                        # Find imported entity
                        imported_entity = self._find_entity_by_name(imported_name, all_entities)
                        
                        if imported_entity:
                            # All entities in this file "import" the external entity
                            for entity in file_entities:
                                relationships.append({
                                    'from_entity_id': entity['id'],
                                    'to_entity_id': imported_entity['id'],
                                    'relationship_type': RelationshipType.IMPORTS.value,
                                    'line_number': node.lineno
                                })
        
        except Exception as e:
            logger.error(f"Error mapping Python imports: {e}")
        
        return relationships
    
    def _map_js_imports(self, content: str, file_entities: List[Dict[str, Any]], all_entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Map JavaScript/TypeScript import relationships."""
        relationships = []
        
        # Pattern for ES6 imports
        import_patterns = [
            r'import\s+(\w+)\s+from',
            r'import\s+{\s*([^}]+)\s*}\s+from',
            r'const\s+(\w+)\s*=\s*require'
        ]
        
        lines = content.split('\n')
        
        for line_num, line in enumerate(lines, 1):
            for pattern in import_patterns:
                matches = re.findall(pattern, line)
                for match in matches:
                    if isinstance(match, str):
                        imported_names = [match.strip()]
                    else:
                        imported_names = [name.strip() for name in match.split(',')]
                    
                    for imported_name in imported_names:
                        imported_entity = self._find_entity_by_name(imported_name, all_entities)
                        if imported_entity:
                            for entity in file_entities:
                                relationships.append({
                                    'from_entity_id': entity['id'],
                                    'to_entity_id': imported_entity['id'],
                                    'relationship_type': RelationshipType.IMPORTS.value,
                                    'line_number': line_num
                                })
        
        return relationships
    
    def _find_containing_entity(self, line_number: int, entities: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Find entity that contains the given line number."""
        for entity in entities:
            if entity['start_line'] <= line_number <= entity['end_line']:
                return entity
        return None
    
    def _find_entity_by_name(self, name: str, entities: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Find entity by name."""
        for entity in entities:
            if entity['name'] == name:
                return entity
        return None
    
    def _get_call_name(self, node: ast.Call) -> Optional[str]:
        """Extract function name from call node."""
        if isinstance(node.func, ast.Name):
            return node.func.id
        elif isinstance(node.func, ast.Attribute):
            return node.func.attr
        return None
    
    def _get_name_from_node(self, node: ast.AST) -> Optional[str]:
        """Get name from AST node."""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            return node.attr
        return None
    
    def _store_relationships(self, relationships: List[Dict[str, Any]]):
        """Store relationships in database."""
        if not relationships:
            return
        
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                for rel in relationships:
                    # Check if relationship already exists
                    cursor.execute("""
                        SELECT id FROM relationships 
                        WHERE from_entity_id = ? AND to_entity_id = ? AND relationship_type = ?
                    """, (
                        rel['from_entity_id'],
                        rel['to_entity_id'],
                        rel['relationship_type']
                    ))
                    
                    if not cursor.fetchone():
                        cursor.execute("""
                            INSERT INTO relationships 
                            (from_entity_id, to_entity_id, relationship_type, weight, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        """, (
                            rel['from_entity_id'],
                            rel['to_entity_id'],
                            rel['relationship_type'],
                            rel.get('weight', 1.0),
                            datetime.now()
                        ))
                
                conn.commit()
                logger.debug(f"Stored {len(relationships)} relationships")
                
        except Exception as e:
            logger.error(f"Error storing relationships: {e}")
    
    def get_relationship_stats(self) -> Dict[str, Any]:
        """Get relationship mapping statistics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Total relationships
                cursor.execute("SELECT COUNT(*) FROM relationships")
                total_relationships = cursor.fetchone()[0]
                
                # Relationships by type
                cursor.execute("SELECT relationship_type, COUNT(*) FROM relationships GROUP BY relationship_type")
                by_type = dict(cursor.fetchall())
                
                # Most connected entities
                cursor.execute("""
                    SELECT e.name, e.type, COUNT(*) as connection_count
                    FROM entities e
                    JOIN relationships r ON (e.id = r.from_entity_id OR e.id = r.to_entity_id)
                    GROUP BY e.id
                    ORDER BY connection_count DESC
                    LIMIT 10
                """)
                most_connected = [
                    {'name': row[0], 'type': row[1], 'connections': row[2]}
                    for row in cursor.fetchall()
                ]
                
                return {
                    'total_relationships': total_relationships,
                    'relationships_by_type': by_type,
                    'most_connected_entities': most_connected
                }
                
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {}

def main():
    """CLI interface for relationship mapper."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Relationship mapping pipeline")
    parser.add_argument(
        "--db-path",
        default="/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db",
        help="Database path"
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Show relationship statistics"
    )
    
    args = parser.parse_args()
    
    # Create mapper
    mapper = RelationshipMapper(args.db_path)
    
    if args.stats:
        stats = mapper.get_relationship_stats()
        print(json.dumps(stats, indent=2))
    else:
        # Map relationships
        count = mapper.map_all_relationships()
        print(f"Mapped {count} relationships")
        
        # Show final stats
        stats = mapper.get_relationship_stats()
        print(f"Total relationships: {stats.get('total_relationships', 0)}")

if __name__ == "__main__":
    main()
