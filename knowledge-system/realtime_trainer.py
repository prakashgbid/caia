#!/usr/bin/env python3
"""
Real-Time CKS/CLS Trainer
Receives interactions from CC hooks and trains the system incrementally
"""

from flask import Flask, request, jsonify
import sqlite3
import json
from datetime import datetime
from pathlib import Path
import hashlib
import re
import threading
import time

app = Flask(__name__)

# Database paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / 'data'
KNOWLEDGE_DB = DATA_DIR / 'knowledge.db'
PATTERNS_DB = DATA_DIR / 'patterns.db'
CHAT_DB = DATA_DIR / 'chat_history.db'
BUFFER_FILE = Path('/tmp/cc_training_buffer.json')

# Pattern extraction keywords
KEYWORDS = ['async', 'function', 'class', 'test', 'api', 'component', 'hook', 
            'parallel', 'automation', 'learning', 'cks', 'cls']

# Tool patterns
TOOL_PATTERNS = {
    'Read': r'\bread\s+file|reading\s+|check\s+file',
    'Write': r'\bwrite\s+file|writing\s+|create\s+file',
    'Edit': r'\bedit\s+|modify\s+|update\s+file',
    'Bash': r'\brun\s+command|execute\s+|bash\s+',
    'Task': r'\btask\s+agent|launch\s+agent',
    'Grep': r'\bsearch\s+|grep\s+|find\s+pattern',
}

class RealtimeTrainer:
    def __init__(self):
        self.ensure_databases()
        self.interaction_count = 0
        self.pattern_count = 0
        
    def ensure_databases(self):
        """Ensure all database tables exist"""
        # Chat history
        conn = sqlite3.connect(CHAT_DB)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS interactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                user_prompt TEXT,
                assistant_response TEXT,
                tools_used TEXT,
                timestamp TEXT
            )
        ''')
        conn.commit()
        conn.close()
        
        # Patterns
        conn = sqlite3.connect(PATTERNS_DB)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS behavior_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_type TEXT,
                pattern_data TEXT,
                frequency INTEGER DEFAULT 1,
                confidence REAL DEFAULT 0.5,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_behavior (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT,
                pattern TEXT,
                value TEXT,
                confidence REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
        conn.close()
        
    def train_on_interaction(self, data):
        """Process a single interaction for training"""
        session_id = data.get('session_id', 'unknown')
        user_prompt = data.get('user_prompt', '')
        assistant_response = data.get('assistant_response', '')
        tools_used = data.get('tools_used', [])
        timestamp = data.get('timestamp', datetime.now().isoformat())
        
        # Save interaction
        self.save_interaction(session_id, user_prompt, assistant_response, tools_used, timestamp)
        
        # Extract patterns
        patterns = self.extract_patterns(user_prompt, assistant_response)
        self.update_patterns(patterns)
        
        # Update behavioral profile
        self.update_behavior(user_prompt, assistant_response)
        
        return {
            'status': 'trained',
            'interaction_id': self.interaction_count,
            'patterns_found': len(patterns)
        }
        
    def save_interaction(self, session_id, user_prompt, assistant_response, tools_used, timestamp):
        """Save interaction to database"""
        conn = sqlite3.connect(CHAT_DB)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO interactions 
            (session_id, user_prompt, assistant_response, tools_used, timestamp)
            VALUES (?, ?, ?, ?, ?)
        ''', (
            session_id,
            user_prompt,
            assistant_response,
            json.dumps(tools_used) if isinstance(tools_used, list) else tools_used,
            timestamp
        ))
        
        self.interaction_count = cursor.lastrowid
        conn.commit()
        conn.close()
        
    def extract_patterns(self, prompt, response):
        """Extract patterns from interaction"""
        patterns = []
        text = (prompt + ' ' + response).lower()
        
        # Keyword patterns
        for keyword in KEYWORDS:
            if keyword in text:
                patterns.append(('keyword', keyword))
                
        # Tool usage patterns
        for tool, pattern in TOOL_PATTERNS.items():
            if re.search(pattern, text, re.IGNORECASE):
                patterns.append(('tool_usage', tool))
                
        # Intent patterns
        if 'fix' in prompt or 'debug' in prompt:
            patterns.append(('intent', 'debugging'))
        if 'create' in prompt or 'build' in prompt:
            patterns.append(('intent', 'creation'))
        if 'test' in prompt:
            patterns.append(('intent', 'testing'))
        if 'automat' in prompt:
            patterns.append(('intent', 'automation'))
            
        return patterns
        
    def update_patterns(self, patterns):
        """Update pattern database"""
        if not patterns:
            return
            
        conn = sqlite3.connect(PATTERNS_DB)
        cursor = conn.cursor()
        
        for pattern_type, pattern_data in patterns:
            # Check if pattern exists
            cursor.execute('''
                SELECT frequency FROM behavior_patterns 
                WHERE pattern_type = ? AND pattern_data = ?
            ''', (pattern_type, pattern_data))
            
            existing = cursor.fetchone()
            
            if existing:
                # Update frequency
                cursor.execute('''
                    UPDATE behavior_patterns 
                    SET frequency = frequency + 1, last_seen = CURRENT_TIMESTAMP
                    WHERE pattern_type = ? AND pattern_data = ?
                ''', (pattern_type, pattern_data))
            else:
                # Insert new pattern
                cursor.execute('''
                    INSERT INTO behavior_patterns 
                    (pattern_type, pattern_data, frequency)
                    VALUES (?, ?, 1)
                ''', (pattern_type, pattern_data))
                
            self.pattern_count += 1
            
        conn.commit()
        conn.close()
        
    def update_behavior(self, prompt, response):
        """Update user behavioral profile"""
        conn = sqlite3.connect(PATTERNS_DB)
        cursor = conn.cursor()
        
        # Detect behavioral traits
        traits = []
        
        if 'parallel' in prompt.lower():
            traits.append(('preference', 'parallel_execution', 'high'))
        if 'automat' in prompt.lower():
            traits.append(('preference', 'automation', 'high'))
        if 'no manual' in prompt.lower() or 'zero intervention' in prompt.lower():
            traits.append(('requirement', 'no_manual_intervention', 'absolute'))
        if '?' in prompt:
            traits.append(('interaction', 'questioning', 'frequent'))
            
        for category, pattern, value in traits:
            cursor.execute('''
                INSERT INTO user_behavior 
                (category, pattern, value, confidence)
                VALUES (?, ?, ?, 0.8)
            ''', (category, pattern, value))
            
        conn.commit()
        conn.close()
        
    def process_buffer(self):
        """Process buffered interactions if any"""
        if not BUFFER_FILE.exists():
            return 0
            
        processed = 0
        try:
            with open(BUFFER_FILE, 'r') as f:
                lines = f.readlines()
                
            for line in lines:
                try:
                    data = json.loads(line.strip())
                    self.train_on_interaction(data)
                    processed += 1
                except:
                    continue
                    
            # Clear buffer after processing
            BUFFER_FILE.unlink()
        except:
            pass
            
        return processed

trainer = RealtimeTrainer()

@app.route('/train', methods=['POST'])
def train():
    """Receive and train on interaction"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400
            
        result = trainer.train_on_interaction(data)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'interactions_trained': trainer.interaction_count,
        'patterns_learned': trainer.pattern_count,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/process_buffer', methods=['POST'])
def process_buffer():
    """Process any buffered interactions"""
    processed = trainer.process_buffer()
    return jsonify({
        'processed': processed,
        'status': 'completed'
    })

@app.route('/stats', methods=['GET'])
def stats():
    """Get training statistics"""
    stats = {}
    
    # Interaction count
    conn = sqlite3.connect(CHAT_DB)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM interactions")
    stats['total_interactions'] = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(DISTINCT session_id) FROM interactions")
    stats['total_sessions'] = cursor.fetchone()[0]
    conn.close()
    
    # Pattern count
    conn = sqlite3.connect(PATTERNS_DB)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM behavior_patterns")
    stats['total_patterns'] = cursor.fetchone()[0]
    cursor.execute("SELECT pattern_type, COUNT(*) FROM behavior_patterns GROUP BY pattern_type")
    stats['patterns_by_type'] = dict(cursor.fetchall())
    conn.close()
    
    return jsonify(stats)

def background_buffer_processor():
    """Background thread to process buffer periodically"""
    while True:
        time.sleep(30)  # Check every 30 seconds
        try:
            trainer.process_buffer()
        except:
            pass

if __name__ == '__main__':
    print("🚀 Starting Real-Time CKS/CLS Trainer on port 5004")
    print("📊 Ready to receive and train on CC interactions")
    print("✅ Buffer processing enabled for offline captures")
    
    # Start background buffer processor
    buffer_thread = threading.Thread(target=background_buffer_processor, daemon=True)
    buffer_thread.start()
    
    app.run(port=5004, debug=False, host='0.0.0.0')