#!/bin/bash
# entity_extraction.sh - Setup entity extraction pipeline

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
PIPELINES_DIR="$KNOWLEDGE_DIR/pipelines"
EXTRACTOR_DIR="$PIPELINES_DIR/extractors"

echo "Setting up entity extraction pipeline..."

# Create directories
mkdir -p "$EXTRACTORS_DIR"

# Create main extraction pipeline
cat > "$EXTRACTORS_DIR/entity_extractor.py" << 'EOF'
#!/usr/bin/env python3
"""Entity extraction pipeline."""

import os
import sqlite3
import json
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging
import hashlib

# Import parsers and models
sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')
from parsers.parser_factory import ParserFactory
from models.entities import (
    Entity, FunctionEntity, ClassEntity, ModuleEntity,
    EntityType, Language, Location,
    create_function_entity, create_class_entity, create_module_entity
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EntityExtractor:
    """Main entity extraction pipeline."""
    
    def __init__(self, db_path: str, parsers_dir: str = None):
        self.db_path = db_path
        self.parser_factory = ParserFactory()
        self.processed_files = set()
        
    def extract_from_file(self, file_path: str) -> List[Entity]:
        """Extract entities from a single file."""
        try:
            logger.info(f"Extracting entities from: {file_path}")
            
            # Get appropriate parser
            parser = self.parser_factory.get_parser(file_path)
            if not parser:
                logger.warning(f"No parser available for: {file_path}")
                return []
            
            # Parse file and get raw entities
            raw_entities = parser.parse_file(file_path)
            if not raw_entities:
                logger.debug(f"No entities found in: {file_path}")
                return []
            
            # Convert to Entity objects
            entities = self._convert_to_entities(raw_entities, file_path)
            
            # Store in database
            self._store_entities(entities)
            
            logger.info(f"Extracted {len(entities)} entities from {file_path}")
            return entities
            
        except Exception as e:
            logger.error(f"Error extracting from {file_path}: {e}")
            return []
    
    def extract_from_directory(self, directory_path: str, recursive: bool = True) -> List[Entity]:
        """Extract entities from all files in a directory."""
        all_entities = []
        
        path = Path(directory_path)
        if not path.exists():
            logger.error(f"Directory does not exist: {directory_path}")
            return []
        
        # Get all supported files
        supported_extensions = self.parser_factory.supported_extensions()
        
        # Find files
        if recursive:
            files = []
            for ext in supported_extensions:
                files.extend(path.rglob(f"*{ext}"))
        else:
            files = [f for f in path.iterdir() if f.suffix in supported_extensions]
        
        # Filter out common ignore patterns
        filtered_files = self._filter_files(files)
        
        logger.info(f"Processing {len(filtered_files)} files in {directory_path}")
        
        # Process each file
        for file_path in filtered_files:
            if str(file_path) not in self.processed_files:
                entities = self.extract_from_file(str(file_path))
                all_entities.extend(entities)
                self.processed_files.add(str(file_path))
        
        return all_entities
    
    def _filter_files(self, files: List[Path]) -> List[Path]:
        """Filter out files that should be ignored."""
        ignore_patterns = {
            '__pycache__', 'node_modules', '.git', 'dist', 'build',
            '.venv', 'venv', '.env', 'coverage', '.pytest_cache',
            'target', 'obj', 'bin'
        }
        
        filtered = []
        for file_path in files:
            # Skip if any part of the path contains ignore patterns
            if any(pattern in str(file_path) for pattern in ignore_patterns):
                continue
            
            # Skip hidden files
            if any(part.startswith('.') for part in file_path.parts):
                continue
            
            # Skip if file is too large (> 1MB)
            try:
                if file_path.stat().st_size > 1024 * 1024:
                    logger.warning(f"Skipping large file: {file_path}")
                    continue
            except OSError:
                continue
            
            filtered.append(file_path)
        
        return filtered
    
    def _convert_to_entities(self, raw_entities: List[Dict[str, Any]], file_path: str) -> List[Entity]:
        """Convert raw parser output to Entity objects."""
        entities = []
        
        for raw in raw_entities:
            try:
                entity = self._create_entity_from_raw(raw, file_path)
                if entity:
                    entities.append(entity)
            except Exception as e:
                logger.error(f"Error converting entity {raw.get('name', 'unknown')}: {e}")
        
        return entities
    
    def _create_entity_from_raw(self, raw: Dict[str, Any], file_path: str) -> Optional[Entity]:
        """Create Entity object from raw parser data."""
        # Determine language from file extension
        language = self._get_language_from_file(file_path)
        
        # Create location
        location = Location(
            file_path=file_path,
            start_line=raw.get('start_line', 1),
            end_line=raw.get('end_line', 1)
        )
        
        # Create appropriate entity type
        entity_type = raw.get('type', 'unknown')
        
        if entity_type in ['function', 'async_function']:
            return create_function_entity(
                name=raw.get('name', 'unknown'),
                location=location,
                language=language,
                signature=raw.get('signature', ''),
                is_async=(entity_type == 'async_function')
            )
        
        elif entity_type == 'class':
            return create_class_entity(
                name=raw.get('name', 'unknown'),
                location=location,
                language=language,
                base_classes=raw.get('dependencies', [])
            )
        
        else:
            # Generic entity
            return Entity(
                type=EntityType.FUNCTION if 'function' in entity_type else EntityType.CLASS,
                name=raw.get('name', 'unknown'),
                language=language,
                location=location,
                signature=raw.get('signature', ''),
                documentation={'docstring': raw.get('docstring', '')}
            )
    
    def _get_language_from_file(self, file_path: str) -> Language:
        """Determine language from file extension."""
        extension = Path(file_path).suffix.lower()
        
        language_map = {
            '.py': Language.PYTHON,
            '.js': Language.JAVASCRIPT,
            '.ts': Language.TYPESCRIPT,
            '.jsx': Language.JSX,
            '.tsx': Language.TSX,
            '.java': Language.JAVA,
            '.cpp': Language.CPP,
            '.cc': Language.CPP,
            '.c': Language.C,
            '.go': Language.GO,
            '.rs': Language.RUST,
        }
        
        return language_map.get(extension, Language.UNKNOWN)
    
    def _store_entities(self, entities: List[Entity]):
        """Store entities in the database."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                for entity in entities:
                    # Check if entity already exists
                    cursor.execute(
                        "SELECT id FROM entities WHERE file_path = ? AND name = ? AND start_line = ?",
                        (entity.location.file_path, entity.name, entity.location.start_line)
                    )
                    
                    existing = cursor.fetchone()
                    
                    if existing:
                        # Update existing entity
                        cursor.execute("""
                            UPDATE entities SET
                                type = ?, signature = ?, docstring = ?, 
                                complexity = ?, end_line = ?, updated_at = ?
                            WHERE id = ?
                        """, (
                            entity.type.value,
                            entity.signature or '',
                            entity.documentation.docstring or '',
                            entity.complexity.cyclomatic,
                            entity.location.end_line,
                            datetime.now(),
                            existing[0]
                        ))
                    else:
                        # Insert new entity
                        cursor.execute("""
                            INSERT INTO entities (
                                type, name, file_path, start_line, end_line,
                                signature, docstring, complexity, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            entity.type.value,
                            entity.name,
                            entity.location.file_path,
                            entity.location.start_line,
                            entity.location.end_line,
                            entity.signature or '',
                            entity.documentation.docstring or '',
                            entity.complexity.cyclomatic,
                            datetime.now(),
                            datetime.now()
                        ))
                
                conn.commit()
                logger.debug(f"Stored {len(entities)} entities in database")
                
        except Exception as e:
            logger.error(f"Error storing entities: {e}")
    
    def get_extraction_stats(self) -> Dict[str, Any]:
        """Get extraction statistics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Total entities
                cursor.execute("SELECT COUNT(*) FROM entities")
                total_entities = cursor.fetchone()[0]
                
                # Entities by type
                cursor.execute("SELECT type, COUNT(*) FROM entities GROUP BY type")
                by_type = dict(cursor.fetchall())
                
                # Files processed
                cursor.execute("SELECT COUNT(DISTINCT file_path) FROM entities")
                files_processed = cursor.fetchone()[0]
                
                # Recent activity
                cursor.execute("""
                    SELECT COUNT(*) FROM entities 
                    WHERE updated_at > datetime('now', '-1 hour')
                """)
                recent_updates = cursor.fetchone()[0]
                
                return {
                    'total_entities': total_entities,
                    'entities_by_type': by_type,
                    'files_processed': files_processed,
                    'recent_updates': recent_updates,
                    'processed_files_count': len(self.processed_files)
                }
                
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {}

def main():
    """CLI interface for entity extraction."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Entity extraction pipeline")
    parser.add_argument("path", help="File or directory to extract from")
    parser.add_argument(
        "--db-path",
        default="/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db",
        help="Database path"
    )
    parser.add_argument("--recursive", action="store_true", help="Recursive directory processing")
    parser.add_argument("--stats", action="store_true", help="Show extraction statistics")
    
    args = parser.parse_args()
    
    # Create extractor
    extractor = EntityExtractor(args.db_path)
    
    # Extract entities
    if Path(args.path).is_file():
        entities = extractor.extract_from_file(args.path)
        print(f"Extracted {len(entities)} entities from file")
    elif Path(args.path).is_dir():
        entities = extractor.extract_from_directory(args.path, args.recursive)
        print(f"Extracted {len(entities)} entities from directory")
    else:
        print(f"Path does not exist: {args.path}")
        return
    
    # Show stats if requested
    if args.stats:
        stats = extractor.get_extraction_stats()
        print("\nExtraction Statistics:")
        print(json.dumps(stats, indent=2))

if __name__ == "__main__":
    main()
EOF

# Create batch extraction script
cat > "$EXTRACTORS_DIR/batch_extract.sh" << 'EOF'
#!/bin/bash
# Batch entity extraction for multiple directories

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
EXTRACTOR="$KNOWLEDGE_DIR/pipelines/extractors/entity_extractor.py"
DB_PATH="$KNOWLEDGE_DIR/data/knowledge.db"

echo "Starting batch entity extraction..."

# Default directories to process
DIRECTORIES=(
    "/Users/MAC/Documents/projects/caia"
)

# Process command line arguments
if [ $# -gt 0 ]; then
    DIRECTORIES=("$@")
fi

# Extract from each directory
for dir in "${DIRECTORIES[@]}"; do
    if [ -d "$dir" ]; then
        echo "Processing directory: $dir"
        python3 "$EXTRACTOR" "$dir" --recursive --db-path "$DB_PATH"
    else
        echo "Directory not found: $dir"
    fi
done

# Show final stats
echo "\nFinal extraction statistics:"
python3 "$EXTRACTOR" "$KNOWLEDGE_DIR" --stats --db-path "$DB_PATH"

echo "Batch extraction complete"
EOF

# Create extraction monitor
cat > "$EXTRACTORS_DIR/extraction_monitor.py" << 'EOF'
#!/usr/bin/env python3
"""Monitor and report on entity extraction progress."""

import sqlite3
import json
import time
from datetime import datetime, timedelta
from typing import Dict, Any

class ExtractionMonitor:
    """Monitor entity extraction progress."""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def get_current_stats(self) -> Dict[str, Any]:
        """Get current extraction statistics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Basic counts
                cursor.execute("SELECT COUNT(*) FROM entities")
                total_entities = cursor.fetchone()[0]
                
                cursor.execute("SELECT COUNT(*) FROM relationships")
                total_relationships = cursor.fetchone()[0]
                
                cursor.execute("SELECT COUNT(DISTINCT file_path) FROM entities")
                total_files = cursor.fetchone()[0]
                
                # Entities by type
                cursor.execute("SELECT type, COUNT(*) FROM entities GROUP BY type")
                entities_by_type = dict(cursor.fetchall())
                
                # Recent activity (last hour)
                cursor.execute("""
                    SELECT COUNT(*) FROM entities 
                    WHERE created_at > datetime('now', '-1 hour')
                """)
                recent_entities = cursor.fetchone()[0]
                
                # File processing status
                cursor.execute("""
                    SELECT file_path, COUNT(*) as entity_count, 
                           MAX(updated_at) as last_processed
                    FROM entities 
                    GROUP BY file_path 
                    ORDER BY last_processed DESC 
                    LIMIT 10
                """)
                recent_files = cursor.fetchall()
                
                return {
                    'timestamp': datetime.now().isoformat(),
                    'totals': {
                        'entities': total_entities,
                        'relationships': total_relationships,
                        'files': total_files
                    },
                    'entities_by_type': entities_by_type,
                    'recent_activity': {
                        'new_entities_last_hour': recent_entities
                    },
                    'recent_files': [
                        {
                            'file_path': row[0],
                            'entity_count': row[1],
                            'last_processed': row[2]
                        }
                        for row in recent_files
                    ]
                }
                
        except Exception as e:
            return {'error': str(e)}
    
    def monitor_continuously(self, interval: int = 30):
        """Continuously monitor and report stats."""
        print(f"Starting extraction monitoring (interval: {interval}s)...")
        
        try:
            while True:
                stats = self.get_current_stats()
                
                if 'error' not in stats:
                    print(f"\n[{stats['timestamp']}]")
                    print(f"Entities: {stats['totals']['entities']}")
                    print(f"Files: {stats['totals']['files']}")
                    print(f"Recent: +{stats['recent_activity']['new_entities_last_hour']}")
                    
                    if stats['entities_by_type']:
                        type_summary = ', '.join([
                            f"{k}: {v}" for k, v in stats['entities_by_type'].items()
                        ])
                        print(f"Types: {type_summary}")
                else:
                    print(f"Error: {stats['error']}")
                
                time.sleep(interval)
                
        except KeyboardInterrupt:
            print("\nMonitoring stopped")

def main():
    """CLI for extraction monitoring."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Entity extraction monitor")
    parser.add_argument(
        "--db-path",
        default="/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db",
        help="Database path"
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=30,
        help="Monitoring interval in seconds"
    )
    parser.add_argument(
        "--continuous",
        action="store_true",
        help="Run continuous monitoring"
    )
    
    args = parser.parse_args()
    
    monitor = ExtractionMonitor(args.db_path)
    
    if args.continuous:
        monitor.monitor_continuously(args.interval)
    else:
        stats = monitor.get_current_stats()
        print(json.dumps(stats, indent=2))

if __name__ == "__main__":
    main()
EOF

# Make scripts executable
chmod +x "$EXTRACTORS_DIR/entity_extractor.py"
chmod +x "$EXTRACTORS_DIR/batch_extract.sh"
chmod +x "$EXTRACTORS_DIR/extraction_monitor.py"

echo "✓ Entity extraction pipeline setup complete"
echo "  - Main extractor: $EXTRACTORS_DIR/entity_extractor.py"
echo "  - Batch script: $EXTRACTORS_DIR/batch_extract.sh"
echo "  - Monitor: $EXTRACTORS_DIR/extraction_monitor.py"
echo ""
echo "Usage examples:"
echo "  # Extract from single file:"
echo "  python3 $EXTRACTORS_DIR/entity_extractor.py /path/to/file.py"
echo ""
echo "  # Extract from directory:"
echo "  python3 $EXTRACTORS_DIR/entity_extractor.py /path/to/dir --recursive"
echo ""
echo "  # Batch extraction:"
echo "  $EXTRACTORS_DIR/batch_extract.sh /dir1 /dir2 /dir3"
echo ""
echo "  # Monitor progress:"
echo "  python3 $EXTRACTORS_DIR/extraction_monitor.py --continuous"

exit 0