#!/usr/bin/env python3
"""File system watcher for incremental knowledge updates."""

import os
import time
import hashlib
import sqlite3
from pathlib import Path
from datetime import datetime
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from typing import Set, List
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CodeFileHandler(FileSystemEventHandler):
    """Handler for code file changes."""
    
    def __init__(self, knowledge_db_path: str, supported_extensions: Set[str]):
        self.knowledge_db_path = knowledge_db_path
        self.supported_extensions = supported_extensions
        self.processing_queue = set()
        
    def on_modified(self, event):
        if not event.is_directory:
            self._handle_file_change(event.src_path, 'modified')
    
    def on_created(self, event):
        if not event.is_directory:
            self._handle_file_change(event.src_path, 'created')
    
    def on_deleted(self, event):
        if not event.is_directory:
            self._handle_file_change(event.src_path, 'deleted')
    
    def on_moved(self, event):
        if not event.is_directory:
            self._handle_file_change(event.dest_path, 'moved')
            # Handle old file as deleted
            self._handle_file_change(event.src_path, 'deleted')
    
    def _handle_file_change(self, file_path: str, event_type: str):
        """Handle file change event."""
        if not self._is_supported_file(file_path):
            return
        
        # Avoid duplicate processing
        if file_path in self.processing_queue:
            return
            
        self.processing_queue.add(file_path)
        
        try:
            logger.info(f"Processing {event_type}: {file_path}")
            
            if event_type == 'deleted':
                self._handle_deleted_file(file_path)
            else:
                self._handle_changed_file(file_path)
                
        except Exception as e:
            logger.error(f"Error processing {file_path}: {e}")
        finally:
            self.processing_queue.discard(file_path)
    
    def _is_supported_file(self, file_path: str) -> bool:
        """Check if file should be processed."""
        path = Path(file_path)
        
        # Skip hidden files and directories
        if any(part.startswith('.') for part in path.parts):
            return False
        
        # Skip common ignore patterns
        ignore_patterns = {
            '__pycache__', 'node_modules', '.git', 'dist', 'build',
            '.venv', 'venv', '.env', 'coverage', '.pytest_cache'
        }
        
        if any(pattern in str(path) for pattern in ignore_patterns):
            return False
        
        return path.suffix in self.supported_extensions
    
    def _handle_changed_file(self, file_path: str):
        """Handle created/modified file."""
        try:
            # Calculate file hash
            file_hash = self._calculate_file_hash(file_path)
            last_modified = datetime.fromtimestamp(os.path.getmtime(file_path))
            
            # Check if file actually changed
            with sqlite3.connect(self.knowledge_db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT file_hash FROM file_tracking WHERE file_path = ?",
                    (file_path,)
                )
                result = cursor.fetchone()
                
                if result and result[0] == file_hash:
                    logger.debug(f"File unchanged: {file_path}")
                    return
                
                # Update file tracking
                cursor.execute("""
                    INSERT OR REPLACE INTO file_tracking 
                    (file_path, last_modified, file_hash, processed_at)
                    VALUES (?, ?, ?, ?)
                """, (file_path, last_modified, file_hash, datetime.now()))
                
                conn.commit()
            
            # Trigger reprocessing of the file
            self._trigger_reprocessing(file_path)
            
        except Exception as e:
            logger.error(f"Error handling changed file {file_path}: {e}")
    
    def _handle_deleted_file(self, file_path: str):
        """Handle deleted file."""
        try:
            with sqlite3.connect(self.knowledge_db_path) as conn:
                cursor = conn.cursor()
                
                # Remove entities from this file
                cursor.execute("DELETE FROM entities WHERE file_path = ?", (file_path,))
                
                # Remove file tracking
                cursor.execute("DELETE FROM file_tracking WHERE file_path = ?", (file_path,))
                
                conn.commit()
                
            logger.info(f"Cleaned up deleted file: {file_path}")
            
        except Exception as e:
            logger.error(f"Error handling deleted file {file_path}: {e}")
    
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
    
    def _trigger_reprocessing(self, file_path: str):
        """Trigger reprocessing of the file."""
        # This would typically call the entity extraction pipeline
        logger.info(f"Triggering reprocessing for: {file_path}")
        
        # Create a trigger file for the processing pipeline
        trigger_dir = Path(self.knowledge_db_path).parent / "triggers"
        trigger_dir.mkdir(exist_ok=True)
        
        trigger_file = trigger_dir / f"process_{int(time.time())}.trigger"
        with open(trigger_file, 'w') as f:
            f.write(file_path)

class FileWatcher:
    """Main file watcher class."""
    
    def __init__(self, watch_dirs: List[str], knowledge_db_path: str):
        self.watch_dirs = watch_dirs
        self.knowledge_db_path = knowledge_db_path
        self.supported_extensions = {'.py', '.js', '.ts', '.jsx', '.tsx'}
        self.observer = Observer()
        
    def start(self):
        """Start watching directories."""
        event_handler = CodeFileHandler(
            self.knowledge_db_path,
            self.supported_extensions
        )
        
        for watch_dir in self.watch_dirs:
            if os.path.exists(watch_dir):
                logger.info(f"Watching directory: {watch_dir}")
                self.observer.schedule(
                    event_handler,
                    watch_dir,
                    recursive=True
                )
            else:
                logger.warning(f"Watch directory does not exist: {watch_dir}")
        
        self.observer.start()
        logger.info("File watcher started")
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stop()
    
    def stop(self):
        """Stop the file watcher."""
        self.observer.stop()
        self.observer.join()
        logger.info("File watcher stopped")

def main():
    """CLI interface for the file watcher."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Knowledge system file watcher")
    parser.add_argument(
        "--watch-dirs",
        nargs="+",
        default=["/Users/MAC/Documents/projects/caia"],
        help="Directories to watch"
    )
    parser.add_argument(
        "--db-path",
        default="/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db",
        help="Path to knowledge database"
    )
    
    args = parser.parse_args()
    
    watcher = FileWatcher(args.watch_dirs, args.db_path)
    watcher.start()

if __name__ == "__main__":
    main()
