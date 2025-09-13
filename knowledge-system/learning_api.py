#!/usr/bin/env python3
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
