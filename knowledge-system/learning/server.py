#!/usr/bin/env python3
"""
Learning System Server - Always-On Learning Service
Continuously learns from all CAIA interactions and improves system intelligence
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import json
import os
from datetime import datetime
import threading
import time
from collections import defaultdict
import hashlib

app = Flask(__name__)
CORS(app)

# Configuration
PORT = 5003
DB_PATH = '/Users/MAC/Documents/projects/caia/knowledge-system/data/learning.db'
LEARNING_LOG = '/Users/MAC/.claude/logs/learning_events.log'

# Learning statistics
stats = {
    'patterns_learned': 0,
    'interactions_processed': 0,
    'improvements_suggested': 0,
    'decisions_tracked': 0,
    'errors_learned_from': 0,
    'success_patterns': 0,
    'start_time': datetime.now().isoformat()
}

# Pattern memory
pattern_memory = defaultdict(lambda: {'count': 0, 'success_rate': 0, 'last_seen': None})
error_patterns = defaultdict(list)
success_patterns = defaultdict(list)

def init_database():
    """Initialize learning database"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Create tables if not exists
    c.execute('''CREATE TABLE IF NOT EXISTS learning_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        event_type TEXT,
        context TEXT,
        data TEXT,
        outcome TEXT,
        learned_pattern TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_hash TEXT UNIQUE,
        pattern_type TEXT,
        pattern_data TEXT,
        occurrences INTEGER DEFAULT 1,
        success_rate REAL,
        last_seen TEXT,
        suggestions TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS improvements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        suggestion TEXT,
        context TEXT,
        priority TEXT,
        implemented BOOLEAN DEFAULT 0
    )''')

    conn.commit()
    conn.close()

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Learning System',
        'port': PORT,
        'uptime': str(datetime.now() - datetime.fromisoformat(stats['start_time'])),
        'stats': stats
    })

@app.route('/learn', methods=['POST'])
def learn():
    """Learn from an interaction or event"""
    try:
        data = request.json
        event_type = data.get('type', 'general')
        context = data.get('context', {})
        outcome = data.get('outcome', 'unknown')

        # Generate pattern hash
        pattern_hash = hashlib.md5(
            f"{event_type}:{json.dumps(context, sort_keys=True)}".encode()
        ).hexdigest()

        # Update pattern memory
        pattern_memory[pattern_hash]['count'] += 1
        pattern_memory[pattern_hash]['last_seen'] = datetime.now().isoformat()

        # Track success/error patterns
        if outcome == 'success':
            success_patterns[event_type].append(context)
            stats['success_patterns'] += 1
        elif outcome == 'error':
            error_patterns[event_type].append(context)
            stats['errors_learned_from'] += 1

        # Store in database
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''INSERT INTO learning_events
                     (timestamp, event_type, context, data, outcome, learned_pattern)
                     VALUES (?, ?, ?, ?, ?, ?)''',
                  (datetime.now().isoformat(), event_type,
                   json.dumps(context), json.dumps(data),
                   outcome, pattern_hash))
        conn.commit()
        conn.close()

        stats['interactions_processed'] += 1
        stats['patterns_learned'] = len(pattern_memory)

        # Generate improvement suggestion if pattern repeats
        suggestion = None
        if pattern_memory[pattern_hash]['count'] > 3:
            suggestion = generate_improvement_suggestion(event_type, context, pattern_hash)
            if suggestion:
                stats['improvements_suggested'] += 1

        return jsonify({
            'status': 'learned',
            'pattern_id': pattern_hash,
            'occurrences': pattern_memory[pattern_hash]['count'],
            'suggestion': suggestion
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/suggest', methods=['POST'])
def suggest():
    """Suggest improvements based on learned patterns"""
    try:
        data = request.json
        context = data.get('context', {})
        task_type = data.get('task_type', 'general')

        # Find similar successful patterns
        suggestions = []
        for pattern_type in success_patterns:
            if pattern_type == task_type or pattern_type == 'general':
                for pattern in success_patterns[pattern_type][-10:]:  # Last 10 successes
                    if has_similar_context(context, pattern):
                        suggestions.append({
                            'type': 'success_pattern',
                            'pattern': pattern,
                            'confidence': calculate_similarity(context, pattern)
                        })

        # Avoid error patterns
        warnings = []
        for pattern_type in error_patterns:
            if pattern_type == task_type or pattern_type == 'general':
                for pattern in error_patterns[pattern_type][-10:]:  # Last 10 errors
                    if has_similar_context(context, pattern):
                        warnings.append({
                            'type': 'error_pattern',
                            'pattern': pattern,
                            'risk': calculate_similarity(context, pattern)
                        })

        return jsonify({
            'suggestions': sorted(suggestions, key=lambda x: x['confidence'], reverse=True)[:5],
            'warnings': sorted(warnings, key=lambda x: x['risk'], reverse=True)[:3]
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/track_decision', methods=['POST'])
def track_decision():
    """Track a decision made by the system"""
    try:
        data = request.json
        decision = data.get('decision')
        context = data.get('context')
        rationale = data.get('rationale')

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''INSERT INTO learning_events
                     (timestamp, event_type, context, data, outcome, learned_pattern)
                     VALUES (?, ?, ?, ?, ?, ?)''',
                  (datetime.now().isoformat(), 'decision',
                   json.dumps(context), json.dumps({
                       'decision': decision,
                       'rationale': rationale
                   }), 'tracked', None))
        conn.commit()
        conn.close()

        stats['decisions_tracked'] += 1

        return jsonify({'status': 'tracked', 'total_decisions': stats['decisions_tracked']})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/stats', methods=['GET'])
def get_stats():
    """Get learning statistics"""
    return jsonify({
        'stats': stats,
        'active_patterns': len(pattern_memory),
        'error_pattern_types': len(error_patterns),
        'success_pattern_types': len(success_patterns),
        'top_patterns': get_top_patterns()
    })

def generate_improvement_suggestion(event_type, context, pattern_hash):
    """Generate improvement suggestions based on patterns"""
    if pattern_memory[pattern_hash]['count'] > 5:
        if event_type == 'error':
            return f"This error pattern has occurred {pattern_memory[pattern_hash]['count']} times. Consider implementing automatic error recovery."
        elif event_type == 'slow_operation':
            return f"This operation is frequently slow. Consider caching or optimization."
        elif event_type == 'duplicate_work':
            return f"This task is often repeated. Consider creating a reusable component."
    return None

def has_similar_context(context1, context2):
    """Check if two contexts are similar"""
    if not context1 or not context2:
        return False

    # Simple similarity check based on key overlap
    keys1 = set(context1.keys() if isinstance(context1, dict) else [])
    keys2 = set(context2.keys() if isinstance(context2, dict) else [])

    if not keys1 or not keys2:
        return False

    overlap = len(keys1.intersection(keys2))
    total = len(keys1.union(keys2))

    return (overlap / total) > 0.5 if total > 0 else False

def calculate_similarity(context1, context2):
    """Calculate similarity score between contexts"""
    if not context1 or not context2:
        return 0.0

    keys1 = set(context1.keys() if isinstance(context1, dict) else [])
    keys2 = set(context2.keys() if isinstance(context2, dict) else [])

    if not keys1 or not keys2:
        return 0.0

    overlap = len(keys1.intersection(keys2))
    total = len(keys1.union(keys2))

    return overlap / total if total > 0 else 0.0

def get_top_patterns():
    """Get most frequent patterns"""
    sorted_patterns = sorted(pattern_memory.items(),
                           key=lambda x: x[1]['count'],
                           reverse=True)
    return [
        {
            'hash': pattern_id,
            'count': data['count'],
            'last_seen': data['last_seen']
        }
        for pattern_id, data in sorted_patterns[:10]
    ]

def background_learning_loop():
    """Background thread for continuous learning"""
    while True:
        try:
            # Analyze patterns every 60 seconds
            time.sleep(60)

            # Consolidate patterns
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()

            for pattern_hash, data in pattern_memory.items():
                c.execute('''INSERT OR REPLACE INTO patterns
                           (pattern_hash, pattern_type, occurrences, last_seen)
                           VALUES (?, ?, ?, ?)''',
                         (pattern_hash, 'auto_detected',
                          data['count'], data['last_seen']))

            conn.commit()
            conn.close()

            # Log learning event
            with open(LEARNING_LOG, 'a') as f:
                f.write(f"{datetime.now().isoformat()} - Consolidated {len(pattern_memory)} patterns\n")

        except Exception as e:
            print(f"Background learning error: {e}")

if __name__ == '__main__':
    # Initialize database
    init_database()

    # Start background learning thread
    learning_thread = threading.Thread(target=background_learning_loop, daemon=True)
    learning_thread.start()

    print(f"🧠 Learning System starting on port {PORT}...")
    print(f"📊 Database: {DB_PATH}")
    print(f"📝 Logs: {LEARNING_LOG}")
    print("✅ Ready to learn from all interactions!")

    # Run server
    app.run(host='0.0.0.0', port=PORT, debug=False)