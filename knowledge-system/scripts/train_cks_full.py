#!/usr/bin/env python3
"""
Full CKS Training Script - Updates knowledge base with latest project data
"""

import os
import sys
import json
import sqlite3
from datetime import datetime
from pathlib import Path

# Add knowledge system to path
sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')

# Configuration
PROJECT_ROOT = '/Users/MAC/Documents/projects/caia'
KNOWLEDGE_DB = '/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db'

def scan_project():
    """Scan project for all code files"""
    print(f"🔍 Scanning project: {PROJECT_ROOT}")
    
    code_files = []
    extensions = {'.py', '.ts', '.js', '.tsx', '.jsx', '.sh', '.json', '.md'}
    ignore_dirs = {'node_modules', '.git', 'dist', 'build', '__pycache__', '.next'}
    
    for root, dirs, files in os.walk(PROJECT_ROOT):
        # Remove ignored directories from search
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        
        for file in files:
            if any(file.endswith(ext) for ext in extensions):
                file_path = os.path.join(root, file)
                code_files.append(file_path)
    
    print(f"✅ Found {len(code_files)} code files")
    return code_files

def extract_components(files):
    """Extract components from files"""
    components = []
    
    for file_path in files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Get relative path
            rel_path = os.path.relpath(file_path, PROJECT_ROOT)
            
            # Extract basic metadata
            component = {
                'path': rel_path,
                'type': 'file',
                'language': Path(file_path).suffix[1:],
                'size': len(content),
                'lines': content.count('\n'),
                'content_preview': content[:500],
                'timestamp': datetime.now().isoformat()
            }
            
            # Extract functions/classes for Python files
            if file_path.endswith('.py'):
                functions = []
                classes = []
                for line in content.split('\n'):
                    if line.strip().startswith('def '):
                        func_name = line.split('def ')[1].split('(')[0].strip()
                        functions.append(func_name)
                    elif line.strip().startswith('class '):
                        class_name = line.split('class ')[1].split('(')[0].split(':')[0].strip()
                        classes.append(class_name)
                
                component['functions'] = functions
                component['classes'] = classes
            
            # Extract exports for JS/TS files
            elif file_path.endswith(('.js', '.ts', '.jsx', '.tsx')):
                exports = []
                for line in content.split('\n'):
                    if 'export ' in line:
                        exports.append(line.strip()[:100])
                component['exports'] = exports[:10]  # Limit to first 10
            
            components.append(component)
            
        except Exception as e:
            print(f"⚠️ Error processing {file_path}: {e}")
    
    return components

def update_knowledge_base(components):
    """Update the knowledge database"""
    print(f"💾 Updating knowledge base: {KNOWLEDGE_DB}")
    
    conn = sqlite3.connect(KNOWLEDGE_DB)
    cursor = conn.cursor()
    
    # Create tables if they don't exist
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
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS training_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            files_processed INTEGER,
            components_found INTEGER,
            status TEXT
        )
    ''')
    
    # Update components
    updated = 0
    inserted = 0
    
    for component in components:
        metadata = json.dumps({
            'size': component.get('size', 0),
            'lines': component.get('lines', 0),
            'functions': component.get('functions', []),
            'classes': component.get('classes', []),
            'exports': component.get('exports', [])
        })
        
        try:
            cursor.execute('''
                INSERT OR REPLACE INTO components 
                (path, type, language, metadata, content_preview, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                component['path'],
                component['type'],
                component['language'],
                metadata,
                component.get('content_preview', ''),
                component['timestamp']
            ))
            
            if cursor.rowcount > 0:
                if cursor.lastrowid:
                    inserted += 1
                else:
                    updated += 1
                    
        except Exception as e:
            print(f"⚠️ Error inserting {component['path']}: {e}")
            raise
    # Log training history
    cursor.execute('''
        INSERT INTO training_history (timestamp, files_processed, components_found, status)
        VALUES (?, ?, ?, ?)
    ''', (
        datetime.now().isoformat(),
        len(components),
        inserted + updated,
        'completed'
    ))
    
    try:
        conn.commit()
        print(f"✅ Updated {updated} components, inserted {inserted} new components")
        # Show statistics
        cursor.execute('SELECT COUNT(*) FROM components')
        total_components = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(DISTINCT language) FROM components')
        languages = cursor.fetchone()[0]
        print("\n📊 Knowledge Base Statistics:")
        print(f"   Total components: {total_components}")
        print(f"   Languages tracked: {languages}")
        print(f"   Database size: {os.path.getsize(KNOWLEDGE_DB) / 1024 / 1024:.2f} MB")
    finally:
        conn.close()
def main():
    print("🚀 Starting Full CKS Training")
    print("=" * 50)
    
    # Scan project
    files = scan_project()
    
    # Extract components
    print(f"\n🔧 Extracting components from files...")
    components = extract_components(files)
    print(f"✅ Extracted {len(components)} components")
    
    # Update knowledge base
    print()
    update_knowledge_base(components)
    
    print("\n" + "=" * 50)
    print("✨ CKS Training Complete!")
    print(f"⏰ Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == '__main__':
    main()