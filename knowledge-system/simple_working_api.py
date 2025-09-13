#!/usr/bin/env python3
"""
Simple Working API for CKS/CLS
REALISTIC implementation that actually works with basic features
No complex ML, just practical functionality
"""

from flask import Flask, request, jsonify
import sqlite3
import json
import subprocess
from pathlib import Path
from datetime import datetime
import hashlib

app = Flask(__name__)

# Database paths
BASE_DIR = Path(__file__).parent
KNOWLEDGE_DB = BASE_DIR / 'data' / 'knowledge.db'
PATTERNS_DB = BASE_DIR / 'data' / 'patterns.db'
CHAT_DB = BASE_DIR / 'data' / 'chat_history.db'

# =============================================================================
# CKS ENDPOINTS - Simple but WORKING
# =============================================================================

@app.route('/api/search/function', methods=['GET'])
def search_function():
    """Simple function search using SQL LIKE"""
    query = request.args.get('query', '')
    
    if not query:
        return jsonify({'error': 'No query provided'}), 400
    
    try:
        conn = sqlite3.connect(KNOWLEDGE_DB)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT path, type, language 
            FROM components 
            WHERE path LIKE ? OR type LIKE ?
            LIMIT 20
        """, (f'%{query}%', f'%{query}%'))
        
        results = [
            {'file': row[0], 'type': row[1], 'language': row[2]}
            for row in cursor.fetchall()
        ]
        conn.close()
        
        return jsonify({
            'query': query,
            'count': len(results),
            'results': results
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/check/duplicate', methods=['POST'])
def check_duplicate():
    """Enhanced duplicate check with similarity detection"""
    data = request.json or {}
    code = data.get('code', '')
    filename = data.get('filename', '')
    
    if not code:
        return jsonify({'is_duplicate': False, 'message': 'No code provided'})
    
    # Extract key patterns from code
    patterns = extract_code_patterns(code)
    
    try:
        conn = sqlite3.connect(KNOWLEDGE_DB)
        cursor = conn.cursor()
        
        # 1. Check for exact filename matches
        cursor.execute("""
            SELECT path, type, content_preview 
            FROM components 
            WHERE path LIKE ?
            LIMIT 10
        """, (f'%{filename}%',))
        
        similar_files = cursor.fetchall()
        
        # 2. Check for pattern matches
        similarity_scores = []
        for file_path, file_type, preview in similar_files:
            if preview:
                file_patterns = extract_code_patterns(preview)
                similarity = calculate_similarity(patterns, file_patterns)
                if similarity > 0.3:  # 30% similarity threshold
                    similarity_scores.append({
                        'file': file_path,
                        'type': file_type,
                        'similarity': round(similarity * 100, 1)
                    })
        
        # 3. Check for import/function name matches
        if 'imports' in patterns or 'functions' in patterns:
            for item in patterns.get('imports', []) + patterns.get('functions', []):
                cursor.execute("""
                    SELECT path, type 
                    FROM components 
                    WHERE content_preview LIKE ?
                    LIMIT 5
                """, (f'%{item}%',))
                
                for row in cursor.fetchall():
                    if not any(s['file'] == row[0] for s in similarity_scores):
                        similarity_scores.append({
                            'file': row[0],
                            'type': row[1],
                            'similarity': 25.0  # Base similarity for name match
                        })
        
        conn.close()
        
        # Sort by similarity
        similarity_scores.sort(key=lambda x: x['similarity'], reverse=True)
        
        if similarity_scores:
            high_similarity = [s for s in similarity_scores if s['similarity'] > 70]
            
            return jsonify({
                'is_duplicate': len(high_similarity) > 0,
                'similar_files': similarity_scores[:5],
                'message': f'Found {len(similarity_scores)} similar files',
                'recommendation': 'High similarity detected - review existing code' if high_similarity else 'Some similarity found - consider reusing'
            })
        
        return jsonify({
            'is_duplicate': False,
            'message': 'No similar code found',
            'patterns_found': len(patterns)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def extract_code_patterns(code):
    """Extract patterns from code for similarity detection"""
    patterns = {
        'imports': [],
        'functions': [],
        'classes': [],
        'keywords': []
    }
    
    lines = code.split('\n')
    for line in lines:
        line = line.strip()
        
        # Extract imports
        if line.startswith('import ') or line.startswith('from '):
            patterns['imports'].append(line.split()[1].split('.')[0])
        elif 'require(' in line or 'import(' in line:
            patterns['imports'].append(line)
            
        # Extract function definitions
        if 'def ' in line or 'function ' in line or 'const ' in line:
            if 'def ' in line:
                func_name = line.split('def ')[1].split('(')[0] if 'def ' in line else ''
            elif 'function ' in line:
                func_name = line.split('function ')[1].split('(')[0] if 'function ' in line else ''
            else:
                func_name = ''
            if func_name:
                patterns['functions'].append(func_name)
                
        # Extract class definitions
        if line.startswith('class '):
            class_name = line.split('class ')[1].split('(')[0].split(':')[0]
            patterns['classes'].append(class_name)
            
    # Extract common keywords
    keywords = ['async', 'await', 'test', 'api', 'database', 'auth', 'payment']
    for keyword in keywords:
        if keyword in code.lower():
            patterns['keywords'].append(keyword)
            
    return patterns

def calculate_similarity(patterns1, patterns2):
    """Calculate similarity score between two pattern sets"""
    if not patterns1 or not patterns2:
        return 0.0
        
    score = 0.0
    weights = {
        'imports': 0.3,
        'functions': 0.3,
        'classes': 0.2,
        'keywords': 0.2
    }
    
    for key, weight in weights.items():
        set1 = set(patterns1.get(key, []))
        set2 = set(patterns2.get(key, []))
        
        if set1 and set2:
            intersection = len(set1 & set2)
            union = len(set1 | set2)
            if union > 0:
                score += (intersection / union) * weight
                
    return score

@app.route('/api/suggest', methods=['GET'])
def suggest_code():
    """Simple suggestion based on patterns"""
    context = request.args.get('context', '')
    
    try:
        conn = sqlite3.connect(PATTERNS_DB)
        cursor = conn.cursor()
        
        # Get most used patterns
        cursor.execute("""
            SELECT pattern_data, frequency
            FROM behavior_patterns
            WHERE pattern_type = 'code_pattern'
            ORDER BY frequency DESC
            LIMIT 5
        """)
        
        patterns = cursor.fetchall()
        conn.close()
        
        suggestions = []
        if 'async' in context.lower():
            suggestions.append('Consider using async/await pattern')
        if 'test' in context.lower():
            suggestions.append('Use existing test framework')
        if 'api' in context.lower():
            suggestions.append('Check existing API endpoints')
        
        return jsonify({
            'context': context,
            'suggestions': suggestions,
            'common_patterns': [p[0] for p in patterns]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# =============================================================================
# CLS ENDPOINTS - Simple but WORKING
# =============================================================================

@app.route('/api/capture', methods=['POST'])
def capture_interaction():
    """Capture interaction - ACTUALLY WORKS"""
    data = request.json or {}
    
    try:
        conn = sqlite3.connect(CHAT_DB)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO interactions 
            (session_id, user_prompt, assistant_response, tools_used, timestamp)
            VALUES (?, ?, ?, ?, ?)
        """, (
            data.get('session_id', 'unknown'),
            data.get('prompt', ''),
            data.get('response', ''),
            json.dumps(data.get('tools', [])),
            datetime.now().isoformat()
        ))
        
        conn.commit()
        interaction_id = cursor.lastrowid
        conn.close()
        
        # Update patterns (simple counting)
        update_patterns(data.get('prompt', ''))
        
        return jsonify({
            'status': 'captured',
            'id': interaction_id
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/patterns', methods=['GET'])
def get_patterns():
    """Get learned patterns - SIMPLE VERSION"""
    try:
        conn = sqlite3.connect(PATTERNS_DB)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT pattern_type, pattern_data, frequency
            FROM behavior_patterns
            ORDER BY frequency DESC
            LIMIT 20
        """)
        
        patterns = [
            {'type': row[0], 'data': row[1], 'frequency': row[2]}
            for row in cursor.fetchall()
        ]
        
        conn.close()
        
        return jsonify({
            'count': len(patterns),
            'patterns': patterns
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get system statistics - WORKING"""
    try:
        stats = {}
        
        # CKS stats
        conn = sqlite3.connect(KNOWLEDGE_DB)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM components")
        stats['total_components'] = cursor.fetchone()[0]
        conn.close()
        
        # CLS stats
        conn = sqlite3.connect(CHAT_DB)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM interactions")
        stats['total_interactions'] = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(DISTINCT session_id) FROM interactions")
        stats['total_sessions'] = cursor.fetchone()[0]
        conn.close()
        
        # Pattern stats
        conn = sqlite3.connect(PATTERNS_DB)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM behavior_patterns")
        stats['total_patterns'] = cursor.fetchone()[0]
        conn.close()
        
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def update_patterns(text):
    """Simple pattern extraction and counting"""
    if not text:
        return
    
    # Extract simple patterns
    keywords = ['async', 'function', 'class', 'test', 'api', 'component']
    
    conn = sqlite3.connect(PATTERNS_DB)
    cursor = conn.cursor()
    
    for keyword in keywords:
        if keyword in text.lower():
            cursor.execute("""
                INSERT OR REPLACE INTO behavior_patterns 
                (pattern_type, pattern_data, frequency, last_seen)
                VALUES ('keyword', ?, 
                    COALESCE((SELECT frequency FROM behavior_patterns 
                              WHERE pattern_type='keyword' AND pattern_data=?), 0) + 1,
                    CURRENT_TIMESTAMP)
            """, (keyword, keyword))
    
    conn.commit()
    conn.close()

# =============================================================================
# HEALTH & MAIN
# =============================================================================

@app.route('/health', methods=['GET'])
def health():
    """Health check"""
    return jsonify({
        'service': 'Simple Working CKS/CLS API',
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    print("🚀 Starting Simple Working API on port 5000")
    print("📊 This is a REALISTIC implementation that ACTUALLY WORKS")
    print("✅ No complex ML, just practical functionality")
    app.run(port=5000, debug=False, host='0.0.0.0')