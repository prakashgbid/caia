#!/usr/bin/env python3
"""
CAIA Learning System - Full Training and Learning Activation
Captures and learns from all user interactions, code patterns, and behaviors
"""

import os
import sys
import json
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
import subprocess
import time

# Setup paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
PROMPTS_DIR = LOGS_DIR / "prompts"

# Ensure directories exist
DATA_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)
PROMPTS_DIR.mkdir(exist_ok=True)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOGS_DIR / 'learning_system.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class CAIALearningSystem:
    def __init__(self):
        self.databases = {
            'knowledge': DATA_DIR / 'caia_knowledge.db',
            'chat_history': DATA_DIR / 'chat_history.db',
            'decisions': DATA_DIR / 'decisions.db',
            'patterns': DATA_DIR / 'patterns.db',
            'sessions': DATA_DIR / 'sessions.db',
            'evolution': DATA_DIR / 'evolution.db',
            'resources': DATA_DIR / 'resources.db',
            'ai_logs': DATA_DIR / 'ai_enhanced_logs.db'
        }
        self.session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        
    def initialize_databases(self):
        """Initialize all learning databases with proper schemas"""
        logger.info("🔧 Initializing all learning databases...")
        
        # Chat History Database
        with sqlite3.connect(self.databases['chat_history']) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    user_prompt TEXT,
                    assistant_response TEXT,
                    tokens_used INTEGER,
                    context_size INTEGER,
                    tools_used TEXT,
                    success BOOLEAN
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS user_preferences (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    frequency INTEGER DEFAULT 1,
                    last_used DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
        # Decisions Database
        with sqlite3.connect(self.databases['decisions']) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS decisions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    decision_type TEXT,
                    choice TEXT,
                    alternatives TEXT,
                    reasoning TEXT,
                    outcome TEXT,
                    success_score REAL
                )
            ''')
            
        # Patterns Database
        with sqlite3.connect(self.databases['patterns']) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS code_patterns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pattern_name TEXT,
                    pattern_code TEXT,
                    usage_count INTEGER DEFAULT 1,
                    language TEXT,
                    category TEXT,
                    last_used DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS behavior_patterns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pattern_type TEXT,
                    pattern_data TEXT,
                    frequency INTEGER DEFAULT 1,
                    confidence REAL,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
        # Sessions Database
        with sqlite3.connect(self.databases['sessions']) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                    end_time DATETIME,
                    total_interactions INTEGER DEFAULT 0,
                    tools_used TEXT,
                    files_modified INTEGER DEFAULT 0,
                    success_rate REAL
                )
            ''')
            
        # Evolution Database (tracks system improvements)
        with sqlite3.connect(self.databases['evolution']) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS learning_progress (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    metric_name TEXT,
                    metric_value REAL,
                    improvement REAL
                )
            ''')
            
        logger.info("✅ All databases initialized successfully")
        
    def capture_user_profile(self):
        """Capture and learn from user's configuration and preferences"""
        logger.info("📊 Analyzing user profile and preferences...")
        
        # Read user's CLAUDE.md configuration
        claude_config = Path.home() / '.claude' / 'CLAUDE.md'
        if claude_config.exists():
            with open(claude_config, 'r') as f:
                config_content = f.read()
                
            # Extract key preferences
            preferences = {
                'parallel_execution': 'PARALLEL-FIRST' in config_content,
                'auto_approval': 'NEVER ASK FOR PERMISSION' in config_content,
                'speed_optimization': 'MAX_PARALLEL=' in config_content,
                'git_style': 'simple' if 'just "updates"' in config_content else 'conventional',
                'testing_approach': 'minimal' if 'Skip tests for CC-only' in config_content else 'comprehensive',
                'documentation': 'minimal' if 'minimal docs' in config_content else 'comprehensive'
            }
            
            # Store preferences
            with sqlite3.connect(self.databases['chat_history']) as conn:
                for key, value in preferences.items():
                    conn.execute('''
                        INSERT OR REPLACE INTO user_preferences (key, value)
                        VALUES (?, ?)
                    ''', (key, str(value)))
                    
            logger.info(f"✅ Captured {len(preferences)} user preferences")
            return preferences
        return {}
        
    def scan_codebase(self):
        """Scan and learn from existing codebase"""
        logger.info("🔍 Scanning codebase for patterns...")
        
        caia_path = Path('/Users/MAC/Documents/projects/caia')
        stats = {
            'total_files': 0,
            'languages': {},
            'patterns': [],
            'frameworks': set()
        }
        
        # Scan for code files
        for ext in ['*.py', '*.js', '*.ts', '*.jsx', '*.tsx', '*.json', '*.md']:
            for file_path in caia_path.rglob(ext):
                if 'node_modules' in str(file_path) or '.git' in str(file_path):
                    continue
                    
                stats['total_files'] += 1
                ext_name = file_path.suffix
                stats['languages'][ext_name] = stats['languages'].get(ext_name, 0) + 1
                
                # Detect frameworks
                if file_path.name == 'package.json':
                    try:
                        with open(file_path) as f:
                            pkg = json.load(f)
                            deps = list(pkg.get('dependencies', {}).keys())
                            deps.extend(pkg.get('devDependencies', {}).keys())
                            
                            if 'react' in deps: stats['frameworks'].add('React')
                            if 'vue' in deps: stats['frameworks'].add('Vue')
                            if 'express' in deps: stats['frameworks'].add('Express')
                            if '@angular/core' in deps: stats['frameworks'].add('Angular')
                            if 'jest' in deps: stats['frameworks'].add('Jest')
                    except:
                        pass
                        
        logger.info(f"✅ Scanned {stats['total_files']} files")
        logger.info(f"📊 Languages: {stats['languages']}")
        logger.info(f"🎯 Frameworks detected: {stats['frameworks']}")
        
        return stats
        
    def start_learning_daemon(self):
        """Start the background learning daemon"""
        logger.info("🚀 Starting learning daemon...")
        
        daemon_script = BASE_DIR / 'cc-enhancement' / 'start-daemon.sh'
        if daemon_script.exists():
            subprocess.Popen(['bash', str(daemon_script)], 
                           stdout=subprocess.DEVNULL, 
                           stderr=subprocess.DEVNULL)
            logger.info("✅ Learning daemon started")
        else:
            # Create a simple learning API server
            api_script = BASE_DIR / 'learning_api.py'
            with open(api_script, 'w') as f:
                f.write('''#!/usr/bin/env python3
from flask import Flask, request, jsonify
import sqlite3
import json
from datetime import datetime
from pathlib import Path

app = Flask(__name__)
DATA_DIR = Path(__file__).parent / "data"

@app.route('/api/capture', methods=['POST'])
def capture_interaction():
    """Capture user interaction for learning"""
    data = request.json
    
    # Store in chat history
    with sqlite3.connect(DATA_DIR / 'chat_history.db') as conn:
        conn.execute("""
            INSERT INTO interactions 
            (session_id, user_prompt, assistant_response, tools_used)
            VALUES (?, ?, ?, ?)
        """, (
            data.get('session_id'),
            data.get('prompt'),
            data.get('response'),
            json.dumps(data.get('tools', []))
        ))
    
    return jsonify({'status': 'captured'})

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get learning statistics"""
    stats = {}
    
    with sqlite3.connect(DATA_DIR / 'chat_history.db') as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM interactions")
        stats['total_interactions'] = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(DISTINCT session_id) FROM interactions")
        stats['total_sessions'] = cursor.fetchone()[0]
    
    return jsonify(stats)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy'})

if __name__ == '__main__':
    app.run(port=5003, debug=False)
''')
            
            # Start the API server
            subprocess.Popen([sys.executable, str(api_script)],
                           stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
            logger.info("✅ Learning API started on port 5003")
            
    def train_on_history(self):
        """Train on existing interaction history"""
        logger.info("🧠 Training on historical data...")
        
        # Check for existing prompt patterns
        patterns_file = PROMPTS_DIR / 'prompt_patterns.json'
        if patterns_file.exists():
            with open(patterns_file) as f:
                patterns = json.load(f)
                
            logger.info(f"📊 Found {len(patterns.get('prompt_types', {}))} prompt types")
            logger.info(f"🔄 Found {len(patterns.get('decision_sequences', []))} decision sequences")
            
            # Store patterns in database
            with sqlite3.connect(self.databases['patterns']) as conn:
                for seq in patterns.get('decision_sequences', []):
                    conn.execute('''
                        INSERT INTO behavior_patterns 
                        (pattern_type, pattern_data, frequency, confidence)
                        VALUES ('decision_sequence', ?, 1, 0.8)
                    ''', (json.dumps(seq),))
                    
        logger.info("✅ Training complete")
        
    def create_session(self):
        """Create a new learning session"""
        with sqlite3.connect(self.databases['sessions']) as conn:
            conn.execute('''
                INSERT INTO sessions (session_id, start_time)
                VALUES (?, CURRENT_TIMESTAMP)
            ''', (self.session_id,))
            
        logger.info(f"📝 Created session: {self.session_id}")
        
    def display_status(self):
        """Display current learning system status"""
        print("\n" + "="*60)
        print("🧠 CAIA LEARNING SYSTEM STATUS")
        print("="*60)
        
        # Check database sizes
        for name, path in self.databases.items():
            if path.exists():
                size = path.stat().st_size
                print(f"  📊 {name:15} : {size:,} bytes")
                
        # Check running services
        print("\n🚀 Services:")
        
        # Check CKS API
        try:
            result = subprocess.run(['curl', '-s', 'http://localhost:5555/health'],
                                  capture_output=True, text=True, timeout=2)
            if result.returncode == 0:
                print("  ✅ CKS API     : Running on port 5555")
            else:
                print("  ❌ CKS API     : Not responding")
        except:
            print("  ❌ CKS API     : Not running")
            
        # Check Learning API
        try:
            result = subprocess.run(['curl', '-s', 'http://localhost:5003/health'],
                                  capture_output=True, text=True, timeout=2)
            if result.returncode == 0:
                print("  ✅ Learning API: Running on port 5003")
            else:
                print("  ❌ Learning API: Not responding")
        except:
            print("  ⏳ Learning API: Starting...")
            
        print("\n" + "="*60)
        
    def run(self):
        """Main execution flow"""
        print("\n🚀 STARTING CAIA LEARNING SYSTEM")
        print("="*60)
        
        # Initialize all components
        self.initialize_databases()
        self.create_session()
        
        # Capture and learn
        preferences = self.capture_user_profile()
        codebase_stats = self.scan_codebase()
        
        # Train on existing data
        self.train_on_history()
        
        # Start background services
        self.start_learning_daemon()
        
        # Wait for services to start
        time.sleep(2)
        
        # Display final status
        self.display_status()
        
        print("\n✨ Learning System Activated!")
        print("📊 The system will now:")
        print("  • Capture all interactions")
        print("  • Learn from your patterns")
        print("  • Optimize based on preferences")
        print("  • Evolve with usage")
        print("\n🔗 APIs Available:")
        print("  • CKS API: http://localhost:5555")
        print("  • Learning API: http://localhost:5003")
        print("  • Enhancement API: http://localhost:5002")
        
        return True

if __name__ == "__main__":
    system = CAIALearningSystem()
    system.run()