#!/usr/bin/env python3
from flask import Flask, request, jsonify
import sys
import os
sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')
from intelligent_companion import IntelligentCompanion

app = Flask(__name__)
companion = IntelligentCompanion()

@app.route('/learn', methods=['POST'])
def learn():
    data = request.json
    user_input = data.get('input', '')
    response = data.get('response', '')
    feedback = data.get('feedback', None)
    
    companion.learn_from_response(user_input, response, feedback)
    return jsonify({'status': 'learned'})

@app.route('/suggest', methods=['POST'])
def suggest():
    data = request.json
    user_input = data.get('input', '')
    
    result = companion.process_input(user_input)
    return jsonify(result)

@app.route('/insights', methods=['GET'])
def insights():
    return jsonify(companion.get_insights())

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5010, debug=False)
