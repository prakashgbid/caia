#!/bin/bash
# api_endpoints.sh - Setup REST API endpoints

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
API_DIR="$KNOWLEDGE_DIR/api"

echo "Setting up API endpoints..."

mkdir -p "$API_DIR"

cat > "$API_DIR/api_server.py" << 'EOF'
#!/usr/bin/env python3
"""REST API server for knowledge system."""

from flask import Flask, request, jsonify
import sys
import json

sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')

app = Flask(__name__)

@app.route('/search', methods=['POST'])
def search():
    """Search endpoint."""
    try:
        from search.vector_search import VectorSearch
        data = request.get_json()
        query = data.get('query', '')
        
        search_engine = VectorSearch('/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db')
        results = search_engine.search_similar_code(query)
        
        return jsonify({'results': results, 'count': len(results)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/stats', methods=['GET'])
def stats():
    """Statistics endpoint."""
    try:
        from search.vector_search import VectorSearch
        search = VectorSearch('/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db')
        stats = search.get_search_stats()
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/extract', methods=['POST'])
def extract():
    """Extract entities endpoint."""
    try:
        from pipelines.extractors.entity_extractor import EntityExtractor
        data = request.get_json()
        path = data.get('path', '')
        
        extractor = EntityExtractor('/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db')
        if Path(path).is_file():
            entities = extractor.extract_from_file(path)
        else:
            entities = extractor.extract_from_directory(path)
        
        return jsonify({'extracted_count': len(entities)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
EOF

chmod +x "$API_DIR/api_server.py"

echo " API endpoints setup complete"
echo "  - API server: $API_DIR/api_server.py"
echo "  - Start with: python3 $API_DIR/api_server.py"
exit 0