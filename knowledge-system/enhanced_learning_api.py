#!/usr/bin/env python3
"""
Enhanced Learning API with Full Data Capture
Captures and learns from ALL CC interactions in real-time
"""

from flask import Flask, request, jsonify
import sqlite3
import json
import os
from datetime import datetime
from pathlib import Path
import logging

app = Flask(__name__)

# Setup paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOGS_DIR / 'learning_api.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Database connections
def get_db(db_name):
    """Get database connection"""
    db_path = DATA_DIR / f"{db_name}.db"
    return sqlite3.connect(db_path)

@app.route('/api/capture', methods=['POST'])
def capture_interaction():
    """Capture user interaction for learning"""
    try:
        data = request.json
        logger.info(f"Capturing interaction: {data.get('session_id')}")
        
        # Store in chat history
        with get_db('chat_history') as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO interactions 
                (session_id, user_prompt, assistant_response, tools_used, timestamp)
                VALUES (?, ?, ?, ?, ?)
            """, (
                data.get('session_id'),
                data.get('prompt', ''),
                data.get('response', ''),
                json.dumps(data.get('tools', [])),
                data.get('timestamp', datetime.now().isoformat())
            ))
            conn.commit()
            
        # Extract patterns
        extract_patterns(data)
        
        return jsonify({'status': 'captured', 'session_id': data.get('session_id')})
    except Exception as e:
        logger.error(f"Error capturing interaction: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/capture/tool', methods=['POST'])
def capture_tool_usage():
    """Capture tool usage patterns"""
    try:
        data = request.json
        logger.info(f"Capturing tool usage: {data.get('tool')}")
        
        # Store in patterns database
        with get_db('patterns') as conn:
            cursor = conn.cursor()
            
            # Check if tool pattern exists
            cursor.execute("""
                SELECT id, frequency FROM behavior_patterns 
                WHERE pattern_type = 'tool_usage' AND pattern_data LIKE ?
            """, (f'%{data.get("tool")}%',))
            
            existing = cursor.fetchone()
            if existing:
                # Update frequency
                cursor.execute("""
                    UPDATE behavior_patterns 
                    SET frequency = frequency + 1, last_seen = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (existing[0],))
            else:
                # Insert new pattern
                cursor.execute("""
                    INSERT INTO behavior_patterns 
                    (pattern_type, pattern_data, frequency, confidence)
                    VALUES ('tool_usage', ?, 1, 0.8)
                """, (json.dumps({'tool': data.get('tool'), 'parameters': data.get('parameters')}),))
            
            conn.commit()
            
        return jsonify({'status': 'captured'})
    except Exception as e:
        logger.error(f"Error capturing tool usage: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/capture/decision', methods=['POST'])
def capture_decision():
    """Capture decision making patterns"""
    try:
        data = request.json
        logger.info(f"Capturing decision: {data.get('decision_type')}")
        
        with get_db('decisions') as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO decisions 
                (decision_type, choice, alternatives, reasoning, timestamp)
                VALUES (?, ?, ?, ?, ?)
            """, (
                data.get('decision_type'),
                data.get('choice'),
                json.dumps(data.get('alternatives', [])),
                data.get('reasoning', ''),
                data.get('timestamp', datetime.now().isoformat())
            ))
            conn.commit()
            
        return jsonify({'status': 'captured'})
    except Exception as e:
        logger.error(f"Error capturing decision: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/capture/code', methods=['POST'])
def capture_code_pattern():
    """Capture code generation patterns"""
    try:
        data = request.json
        logger.info(f"Capturing code pattern: {data.get('file_path')}")
        
        with get_db('patterns') as conn:
            cursor = conn.cursor()
            
            # Store code pattern
            cursor.execute("""
                INSERT INTO code_patterns 
                (pattern_name, pattern_code, language, category, last_used)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (
                data.get('pattern_name', 'generated'),
                data.get('code', ''),
                data.get('language', 'unknown'),
                data.get('category', 'generation')
            ))
            conn.commit()
            
        return jsonify({'status': 'captured'})
    except Exception as e:
        logger.error(f"Error capturing code pattern: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get comprehensive learning statistics"""
    try:
        stats = {}
        
        # Chat history stats
        with get_db('chat_history') as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM interactions")
            stats['total_interactions'] = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(DISTINCT session_id) FROM interactions")
            stats['total_sessions'] = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM user_preferences")
            stats['preferences_captured'] = cursor.fetchone()[0]
        
        # Pattern stats
        with get_db('patterns') as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM behavior_patterns")
            stats['behavior_patterns'] = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM code_patterns")
            stats['code_patterns'] = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM user_behavior")
            stats['user_behaviors'] = cursor.fetchone()[0]
        
        # Decision stats
        with get_db('decisions') as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM decisions")
            stats['decisions_tracked'] = cursor.fetchone()[0]
        
        return jsonify(stats)
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/patterns', methods=['GET'])
def get_patterns():
    """Get learned patterns"""
    try:
        patterns = {}
        
        with get_db('patterns') as conn:
            cursor = conn.cursor()
            
            # Get top behavior patterns
            cursor.execute("""
                SELECT pattern_type, pattern_data, frequency, confidence
                FROM behavior_patterns
                ORDER BY frequency DESC
                LIMIT 10
            """)
            patterns['top_behaviors'] = [
                {
                    'type': row[0],
                    'data': json.loads(row[1]) if row[1].startswith('{') else row[1],
                    'frequency': row[2],
                    'confidence': row[3]
                }
                for row in cursor.fetchall()
            ]
            
            # Get tool usage patterns
            cursor.execute("""
                SELECT pattern_data, frequency
                FROM behavior_patterns
                WHERE pattern_type = 'tool_usage'
                ORDER BY frequency DESC
                LIMIT 10
            """)
            patterns['tool_usage'] = [
                {
                    'tool': json.loads(row[0]).get('tool') if row[0].startswith('{') else row[0],
                    'frequency': row[1]
                }
                for row in cursor.fetchall()
            ]
        
        return jsonify(patterns)
    except Exception as e:
        logger.error(f"Error getting patterns: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/learn', methods=['POST'])
def trigger_learning():
    """Trigger active learning from captured data"""
    try:
        # Analyze recent interactions
        with get_db('chat_history') as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT user_prompt, assistant_response, tools_used
                FROM interactions
                ORDER BY timestamp DESC
                LIMIT 100
            """)
            recent = cursor.fetchall()
            
        # Extract patterns
        patterns_found = []
        for prompt, response, tools in recent:
            # Pattern extraction logic here
            if 'parallel' in prompt.lower():
                patterns_found.append('parallel_preference')
            if 'fast' in prompt.lower() or 'quick' in prompt.lower():
                patterns_found.append('speed_focus')
            if 'test' not in prompt.lower():
                patterns_found.append('skip_tests')
                
        # Update patterns
        with get_db('patterns') as conn:
            cursor = conn.cursor()
            for pattern in set(patterns_found):
                cursor.execute("""
                    INSERT OR IGNORE INTO behavior_patterns
                    (pattern_type, pattern_data, frequency, confidence)
                    VALUES ('learned', ?, 1, 0.7)
                """, (pattern,))
            conn.commit()
            
        return jsonify({
            'status': 'learning_complete',
            'patterns_found': len(set(patterns_found))
        })
    except Exception as e:
        logger.error(f"Error in learning: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Enhanced Learning API',
        'timestamp': datetime.now().isoformat()
    })

def extract_patterns(data):
    """Extract patterns from interaction data"""
    try:
        prompt = data.get('prompt', '').lower()
        tools = data.get('tools', [])
        
        # Extract behavioral indicators
        indicators = []
        
        # Speed preferences
        if any(word in prompt for word in ['fast', 'quick', 'speed', 'parallel']):
            indicators.append('speed_focused')
            
        # Tool preferences
        if 'cco' in prompt or 'orchestrator' in prompt:
            indicators.append('orchestrator_preference')
            
        # Testing preferences
        if 'skip test' in prompt or 'no test' in prompt:
            indicators.append('minimal_testing')
            
        # Store indicators as patterns
        if indicators:
            with get_db('patterns') as conn:
                cursor = conn.cursor()
                for indicator in indicators:
                    cursor.execute("""
                        UPDATE behavior_patterns
                        SET frequency = frequency + 1
                        WHERE pattern_data = ?
                    """, (indicator,))
                conn.commit()
                
    except Exception as e:
        logger.error(f"Error extracting patterns: {e}")

if __name__ == '__main__':
    logger.info("Starting Enhanced Learning API on port 5003")
    app.run(port=5003, debug=False, host='0.0.0.0')