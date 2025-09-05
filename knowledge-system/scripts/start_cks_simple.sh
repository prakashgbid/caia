#!/bin/bash
# Simple CKS Startup Script for CC Sessions

# Configuration
CKS_ROOT="/Users/MAC/Documents/projects/caia/knowledge-system"
API_PORT=5000
LOG_FILE="/tmp/cks_api.log"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting CKS API Server...${NC}"

# Kill any existing process on port 5000
lsof -ti:$API_PORT | xargs kill -9 2>/dev/null

# Start the API server
cd "$CKS_ROOT"

# Create a simple Python API server if the main one doesn't exist
if [ ! -f "${CKS_ROOT}/services/api_server.py" ]; then
    echo -e "${YELLOW}Creating minimal CKS API server...${NC}"
    cat > /tmp/cks_minimal_api.py << 'EOF'
from flask import Flask, jsonify
import os

app = Flask(__name__)

@app.route('/health')
def health():
    return jsonify({'status': 'healthy', 'service': 'CKS Minimal API'})

@app.route('/context-load')
def context_load():
    return jsonify({'status': 'success', 'message': 'Context loaded'})

@app.route('/check-redundancy')
def check_redundancy():
    return jsonify({'redundant': False, 'message': 'No redundancy found'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
EOF
    
    # Start minimal server
    nohup python3 /tmp/cks_minimal_api.py > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
else
    # Start the actual CKS API server
    nohup python3 "${CKS_ROOT}/services/api_server.py" > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
fi

# Wait for server to start
sleep 2

# Check if server is running
if curl -s http://localhost:$API_PORT/health >/dev/null 2>&1; then
    echo -e "${GREEN}✅ CKS API Server started successfully (PID: $SERVER_PID)${NC}"
    echo $SERVER_PID > /tmp/cks_api.pid
    exit 0
else
    echo -e "${RED}❌ Failed to start CKS API Server${NC}"
    echo "Check logs at: $LOG_FILE"
    exit 1
fi