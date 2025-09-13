#!/usr/bin/env python3
"""
File Indexer for CKS
Watches for new/modified files and indexes them automatically
"""

import sqlite3
import os
import time
import hashlib
import json
from pathlib import Path
from datetime import datetime

class FileIndexer:
    def __init__(self, watch_dir='/Users/MAC/Documents/projects'):
        self.watch_dir = Path(watch_dir)
        self.db_path = Path(__file__).parent / 'data' / 'knowledge.db'
        self.indexed_files = self.load_indexed()
        self.ensure_database()
        
    def ensure_database(self):
        """Ensure database table exists"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS components (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE,
                type TEXT,
                language TEXT,
                metadata TEXT,
                content_preview TEXT,
                timestamp TEXT
            )
        ''')
        conn.commit()
        conn.close()
        
    def load_indexed(self):
        """Load already indexed files"""
        if not self.db_path.exists():
            return {}
            
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('SELECT path, metadata FROM components')
            indexed = {}
            for path, metadata in cursor.fetchall():
                if metadata:
                    try:
                        meta = json.loads(metadata)
                        indexed[path] = meta.get('hash', '')
                    except:
                        indexed[path] = ''
                else:
                    indexed[path] = ''
        except:
            indexed = {}
            
        conn.close()
        return indexed
        
    def get_file_hash(self, file_path):
        """Get hash of file content"""
        try:
            with open(file_path, 'rb') as f:
                return hashlib.md5(f.read(1000)).hexdigest()[:8]
        except:
            return None
            
    def get_language(self, file_path):
        """Determine file language"""
        ext = file_path.suffix.lower()
        lang_map = {
            '.py': 'Python',
            '.js': 'JavaScript',
            '.ts': 'TypeScript',
            '.jsx': 'JSX',
            '.tsx': 'TSX',
            '.sh': 'Bash',
            '.bash': 'Bash',
            '.json': 'JSON',
            '.md': 'Markdown',
            '.yaml': 'YAML',
            '.yml': 'YAML',
            '.go': 'Go',
            '.rs': 'Rust',
            '.java': 'Java',
            '.cpp': 'C++',
            '.c': 'C',
            '.h': 'C/C++',
            '.html': 'HTML',
            '.css': 'CSS',
            '.sql': 'SQL'
        }
        return lang_map.get(ext, 'Unknown')
        
    def index_file(self, file_path):
        """Index a single file"""
        file_path = Path(file_path)
        
        # Skip certain files/dirs
        skip_patterns = [
            'node_modules', '.git', '__pycache__', '.cache',
            'dist', 'build', '.next', 'coverage', '.pytest_cache'
        ]
        
        if any(p in str(file_path) for p in skip_patterns):
            return False
            
        # Only index code files
        code_extensions = {
            '.py', '.js', '.ts', '.jsx', '.tsx', '.sh', '.bash',
            '.go', '.rs', '.java', '.cpp', '.c', '.h', '.sql',
            '.json', '.yaml', '.yml', '.md'
        }
        
        if file_path.suffix.lower() not in code_extensions:
            return False
            
        # Get file info
        file_hash = self.get_file_hash(file_path)
        if not file_hash:
            return False
            
        # Check if already indexed with same hash
        rel_path = str(file_path.relative_to(self.watch_dir))
        if rel_path in self.indexed_files and self.indexed_files[rel_path] == file_hash:
            return False  # Already indexed, no change
            
        # Read preview
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                preview = f.read(500)
        except:
            preview = ''
            
        # Prepare metadata
        metadata = {
            'size': file_path.stat().st_size,
            'hash': file_hash,
            'full_path': str(file_path)
        }
        
        # Index to database
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO components 
            (path, type, language, metadata, content_preview, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            rel_path,
            'file',
            self.get_language(file_path),
            json.dumps(metadata),
            preview,
            datetime.now().isoformat()
        ))
        
        conn.commit()
        conn.close()
        
        self.indexed_files[rel_path] = file_hash
        return True
        
    def scan_directory(self, directory=None):
        """Scan directory for files to index"""
        if directory is None:
            directory = self.watch_dir
            
        indexed = 0
        scanned = 0
        
        for file_path in Path(directory).rglob('*'):
            if file_path.is_file():
                scanned += 1
                if self.index_file(file_path):
                    indexed += 1
                    
                if indexed > 0 and indexed % 100 == 0:
                    print(f"  Indexed {indexed} new/changed files...")
                    
        return scanned, indexed
        
    def watch_loop(self, interval=60):
        """Continuously watch and index files"""
        print(f"🔍 Starting file indexer")
        print(f"📁 Watching: {self.watch_dir}")
        print(f"⏱️  Scan interval: {interval}s")
        print("=" * 50)
        
        while True:
            try:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Scanning...")
                scanned, indexed = self.scan_directory()
                
                if indexed > 0:
                    print(f"  ✅ Indexed {indexed} new/changed files (scanned {scanned})")
                    
            except KeyboardInterrupt:
                print("\n👋 Stopping file indexer")
                break
            except Exception as e:
                print(f"❌ Error: {e}")
                
            time.sleep(interval)

def main():
    import sys
    
    if len(sys.argv) > 1:
        # Index specific directory
        indexer = FileIndexer()
        print(f"Indexing {sys.argv[1]}...")
        scanned, indexed = indexer.scan_directory(sys.argv[1])
        print(f"✅ Indexed {indexed} files (scanned {scanned})")
    else:
        # Watch mode
        indexer = FileIndexer()
        indexer.watch_loop()

if __name__ == '__main__':
    main()