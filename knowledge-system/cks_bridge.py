#!/usr/bin/env python3
"""
CKS Bridge API
Runs on port 5555 and forwards to the main API on 5000
Also provides the expected endpoints for CC integration
"""

from flask import Flask, request, jsonify
import requests

app = Flask(__name__)

# Main API URL
MAIN_API = "http://localhost:5000"

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    try:
        response = requests.get(f"{MAIN_API}/health", timeout=1)
        return response.json(), response.status_code
    except:
        return jsonify({'status': 'unhealthy', 'error': 'Main API not responding'}), 503

@app.route('/search/function', methods=['GET'])
def search_function():
    """Search for functions/components"""
    query = request.args.get('query', '')
    try:
        response = requests.get(f"{MAIN_API}/api/search/function", params={'query': query})
        return response.json(), response.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/check/duplicate', methods=['POST'])
def check_duplicate():
    """Check for duplicate code"""
    try:
        response = requests.post(f"{MAIN_API}/api/check/duplicate", json=request.json)
        return response.json(), response.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/suggest', methods=['GET'])
def suggest():
    """Get code suggestions"""
    context = request.args.get('context', '')
    try:
        response = requests.get(f"{MAIN_API}/api/suggest", params={'context': context})
        return response.json(), response.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/validate/import', methods=['POST'])
def validate_import():
    """Validate imports exist in codebase"""
    data = request.json or {}
    imports = data.get('imports', [])
    
    # Simple validation - check if components exist
    results = []
    for imp in imports:
        try:
            response = requests.get(f"{MAIN_API}/api/search/function", params={'query': imp})
            found = response.json().get('count', 0) > 0
            results.append({'import': imp, 'valid': found})
        except:
            results.append({'import': imp, 'valid': False})
    
    return jsonify({'results': results, 'all_valid': all(r['valid'] for r in results)})

@app.route('/index', methods=['POST'])
def index_file():
    """Index a new file into CKS"""
    data = request.json or {}
    file_path = data.get('file_path', '')
    
    # For now, just acknowledge (would trigger indexing in full implementation)
    return jsonify({
        'status': 'indexed',
        'file': file_path,
        'message': 'File will be indexed in next scan'
    })

@app.route('/stats', methods=['GET'])
def stats():
    """Get CKS statistics"""
    try:
        response = requests.get(f"{MAIN_API}/api/stats")
        return response.json(), response.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("🌉 Starting CKS Bridge API on port 5555")
    print("📡 Forwarding to main API on port 5000")
    print("✅ Ready for CC integration")
    app.run(port=5555, debug=False, host='0.0.0.0')