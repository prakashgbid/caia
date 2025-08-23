#!/bin/bash
# setup_file_watcher.sh - Setup file system watcher for incremental updates

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
WATCHER_DIR="$KNOWLEDGE_DIR/watcher"
SERVICES_DIR="$KNOWLEDGE_DIR/services"

echo "Setting up file system watcher..."

# Create watcher directory
mkdir -p "$WATCHER_DIR"
mkdir -p "$SERVICES_DIR"

# Create Python file watcher using watchdog
cat > "$WATCHER_DIR/file_watcher.py" << 'EOF'
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
EOF

# Create systemd service file for background running
cat > "$SERVICES_DIR/knowledge-watcher.service" << 'EOF'
[Unit]
Description=Knowledge System File Watcher
After=network.target

[Service]
Type=simple
User=MAC
WorkingDirectory=/Users/MAC/Documents/projects/caia/knowledge-system
ExecStart=/usr/bin/python3 /Users/MAC/Documents/projects/caia/knowledge-system/watcher/file_watcher.py
Restart=always
RestartSec=5
Environment=PYTHONPATH=/Users/MAC/Documents/projects/caia/knowledge-system

[Install]
WantedBy=multi-user.target
EOF

# Create launch daemon for macOS
cat > "$SERVICES_DIR/com.caia.knowledge-watcher.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.caia.knowledge-watcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/MAC/Documents/projects/caia/knowledge-system/watcher/file_watcher.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/MAC/Documents/projects/caia/knowledge-system</string>
    <key>StandardOutPath</key>
    <string>/Users/MAC/Documents/projects/caia/knowledge-system/logs/watcher.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/MAC/Documents/projects/caia/knowledge-system/logs/watcher.error.log</string>
</dict>
</plist>
EOF

# Create control scripts
cat > "$WATCHER_DIR/start_watcher.sh" << 'EOF'
#!/bin/bash
# Start the file watcher

WATCHER_DIR="/Users/MAC/Documents/projects/caia/knowledge-system/watcher"
LOGS_DIR="/Users/MAC/Documents/projects/caia/knowledge-system/logs"

mkdir -p "$LOGS_DIR"

echo "Starting knowledge system file watcher..."

# Check if already running
if pgrep -f "file_watcher.py" > /dev/null; then
    echo "File watcher is already running"
    exit 0
fi

# Start in background
nohup python3 "$WATCHER_DIR/file_watcher.py" \
    --watch-dirs "/Users/MAC/Documents/projects/caia" \
    > "$LOGS_DIR/watcher.log" 2>&1 &

echo "File watcher started (PID: $!)"  
echo "Logs: $LOGS_DIR/watcher.log"
EOF

cat > "$WATCHER_DIR/stop_watcher.sh" << 'EOF'
#!/bin/bash
# Stop the file watcher

echo "Stopping knowledge system file watcher..."

if pgrep -f "file_watcher.py" > /dev/null; then
    pkill -f "file_watcher.py"
    echo "File watcher stopped"
else
    echo "File watcher is not running"
fi
EOF

cat > "$WATCHER_DIR/status_watcher.sh" << 'EOF'
#!/bin/bash
# Check file watcher status

echo "Knowledge System File Watcher Status:"
echo "====================================="

if pgrep -f "file_watcher.py" > /dev/null; then
    PID=$(pgrep -f "file_watcher.py")
    echo "Status: RUNNING (PID: $PID)"
    echo "Memory usage: $(ps -p $PID -o rss= | awk '{print $1/1024 " MB"}')"
    echo "Started: $(ps -p $PID -o lstart=)"
else
    echo "Status: STOPPED"
fi

echo ""
echo "Recent log entries:"
echo "=================="
tail -n 10 "/Users/MAC/Documents/projects/caia/knowledge-system/logs/watcher.log" 2>/dev/null || echo "No logs found"
EOF

# Make scripts executable
chmod +x "$WATCHER_DIR/file_watcher.py"
chmod +x "$WATCHER_DIR/start_watcher.sh"
chmod +x "$WATCHER_DIR/stop_watcher.sh"
chmod +x "$WATCHER_DIR/status_watcher.sh"

# Create logs directory
mkdir -p "$KNOWLEDGE_DIR/logs"

# Add watchdog to requirements
cat >> "$KNOWLEDGE_DIR/requirements.txt" << 'EOF'
# File watcher requirements
watchdog>=2.1.0
EOF

# Install watchdog if pip is available
if command -v pip3 &> /dev/null; then
    echo "Installing watchdog..."
    pip3 install watchdog
else
    echo "Warning: pip3 not found. Please install watchdog manually: pip3 install watchdog"
fi

echo "✓ File watcher setup complete"
echo "  - Watcher script: $WATCHER_DIR/file_watcher.py"
echo "  - Start: $WATCHER_DIR/start_watcher.sh"
echo "  - Stop: $WATCHER_DIR/stop_watcher.sh"
echo "  - Status: $WATCHER_DIR/status_watcher.sh"
echo "  - Logs: $KNOWLEDGE_DIR/logs/"

exit 0