#!/bin/bash

# Start Intelligent AI Companion System
# This script launches all components needed for the intelligent companion

echo "🚀 STARTING INTELLIGENT AI COMPANION SYSTEM"
echo "==========================================="
echo ""

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Base directory
BASE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
DATA_DIR="$BASE_DIR/data"
LOGS_DIR="$BASE_DIR/logs"

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p "$DATA_DIR"
mkdir -p "$LOGS_DIR"
mkdir -p "$DATA_DIR/chromadb"
mkdir -p "$DATA_DIR/models"

# ============================================================================
# 1. CHECK DEPENDENCIES
# ============================================================================

echo ""
echo "🔍 Checking dependencies..."

# Check Python
if command -v python3 &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Python3 installed ($(python3 --version))"
else
    echo -e "  ${RED}✗${NC} Python3 not found"
    exit 1
fi

# Check Ollama
if [ -f ~/bin/ollama ]; then
    echo -e "  ${GREEN}✓${NC} Ollama installed at ~/bin/ollama"
else
    echo -e "  ${YELLOW}⚠${NC} Ollama not found at ~/bin/ollama"
fi

# Check Redis
if command -v redis-cli &> /dev/null; then
    if redis-cli ping 2>/dev/null | grep -q PONG; then
        echo -e "  ${GREEN}✓${NC} Redis is running"
    else
        echo -e "  ${YELLOW}⚠${NC} Redis installed but not running"
        echo "    Starting Redis..."
        redis-server --daemonize yes
    fi
else
    echo -e "  ${YELLOW}⚠${NC} Redis not installed (optional for working memory)"
fi

# ============================================================================
# 2. INSTALL PYTHON PACKAGES
# ============================================================================

echo ""
echo "📦 Checking Python packages..."

# Required packages
PACKAGES=(
    "chromadb"
    "sentence-transformers"
    "langchain"
    "langchain-community"
    "redis"
    "sqlite3"
    "numpy"
    "torch"
    "transformers"
    "ollama"
)

for package in "${PACKAGES[@]}"; do
    if python3 -c "import $package" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $package"
    else
        echo -e "  ${YELLOW}⚠${NC} Installing $package..."
        pip3 install $package --quiet
    fi
done

# ============================================================================
# 3. START OLLAMA SERVER
# ============================================================================

echo ""
echo "🤖 Starting Ollama server..."

if [ -f ~/bin/ollama ]; then
    # Check if already running
    if curl -s http://localhost:11434/api/version >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Ollama server already running"
    else
        echo "  Starting Ollama server..."
        ~/bin/ollama serve > "$LOGS_DIR/ollama.log" 2>&1 &
        OLLAMA_PID=$!
        
        # Wait for server to start
        for i in {1..10}; do
            if curl -s http://localhost:11434/api/version >/dev/null 2>&1; then
                echo -e "  ${GREEN}✓${NC} Ollama server started (PID: $OLLAMA_PID)"
                break
            fi
            sleep 1
        done
    fi
    
    # List available models
    echo "  Available models:"
    ~/bin/ollama list 2>/dev/null | grep -v "^NAME" | while read line; do
        echo "    - $line"
    done
else
    echo -e "  ${YELLOW}⚠${NC} Ollama not available"
fi

# ============================================================================
# 4. START COMPANION SERVICES
# ============================================================================

echo ""
echo "🧠 Starting Intelligent Companion services..."

# Start memory consolidation daemon
cat > "$BASE_DIR/memory_daemon.py" << 'EOF'
#!/usr/bin/env python3
import time
import sys
import os
sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')
from intelligent_companion import IntelligentCompanion

companion = IntelligentCompanion()
print("Memory consolidation daemon started")

while True:
    try:
        # Consolidate memories every hour
        time.sleep(3600)
        companion.consolidate_learning()
        print(f"Memories consolidated at {time.strftime('%Y-%m-%d %H:%M:%S')}")
    except KeyboardInterrupt:
        break
    except Exception as e:
        print(f"Error: {e}")
EOF

python3 "$BASE_DIR/memory_daemon.py" > "$LOGS_DIR/memory_daemon.log" 2>&1 &
MEMORY_PID=$!
echo -e "  ${GREEN}✓${NC} Memory consolidation daemon (PID: $MEMORY_PID)"

# Start learning service
cat > "$BASE_DIR/learning_service.py" << 'EOF'
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
EOF

python3 "$BASE_DIR/learning_service.py" > "$LOGS_DIR/learning_service.log" 2>&1 &
LEARNING_PID=$!
echo -e "  ${GREEN}✓${NC} Learning service API (PID: $LEARNING_PID, Port: 5010)"

# ============================================================================
# 5. CREATE INTEGRATION HOOKS
# ============================================================================

echo ""
echo "🔗 Setting up CC integration hooks..."

# Create CC hook for automatic learning
cat > ~/.claude/hooks/intelligent-companion-hook.sh << 'EOF'
#!/bin/bash

# Hook to capture CC inputs and responses for learning

if [ "$1" = "user-prompt-submit" ]; then
    # Capture user input
    USER_INPUT="$2"
    
    # Send to learning service
    curl -s -X POST http://localhost:5010/suggest \
        -H "Content-Type: application/json" \
        -d "{\"input\": \"$USER_INPUT\"}" > /tmp/companion_suggestion.json
    
    # Show suggestion if available
    if [ -s /tmp/companion_suggestion.json ]; then
        suggestion=$(jq -r '.suggestion // empty' /tmp/companion_suggestion.json)
        if [ ! -z "$suggestion" ]; then
            echo "💡 Companion suggestion: $suggestion"
        fi
    fi
fi

if [ "$1" = "llm-response-received" ]; then
    # Capture CC response
    CC_RESPONSE="$2"
    USER_INPUT=$(cat /tmp/last_user_input.txt 2>/dev/null)
    
    # Send to learning service
    curl -s -X POST http://localhost:5010/learn \
        -H "Content-Type: application/json" \
        -d "{\"input\": \"$USER_INPUT\", \"response\": \"$CC_RESPONSE\"}" > /dev/null
fi
EOF

chmod +x ~/.claude/hooks/intelligent-companion-hook.sh
echo -e "  ${GREEN}✓${NC} CC integration hook installed"

# ============================================================================
# 6. CREATE CONTROL SCRIPT
# ============================================================================

cat > "$BASE_DIR/companion_control.sh" << 'EOF'
#!/bin/bash

case "$1" in
    status)
        echo "🤖 Intelligent Companion Status:"
        curl -s http://localhost:5010/health | jq .
        curl -s http://localhost:5010/insights | jq .
        ;;
    
    stop)
        echo "Stopping companion services..."
        pkill -f memory_daemon.py
        pkill -f learning_service.py
        echo "Services stopped"
        ;;
    
    restart)
        $0 stop
        sleep 2
        /Users/MAC/Documents/projects/caia/knowledge-system/start_intelligent_companion.sh
        ;;
    
    logs)
        tail -f /Users/MAC/Documents/projects/caia/knowledge-system/logs/*.log
        ;;
    
    *)
        echo "Usage: $0 {status|stop|restart|logs}"
        exit 1
        ;;
esac
EOF

chmod +x "$BASE_DIR/companion_control.sh"

# ============================================================================
# 7. SAVE PROCESS IDS
# ============================================================================

cat > "$BASE_DIR/.companion.pid" << EOF
OLLAMA_PID=$OLLAMA_PID
MEMORY_PID=$MEMORY_PID
LEARNING_PID=$LEARNING_PID
EOF

# ============================================================================
# 8. TEST SERVICES
# ============================================================================

echo ""
echo "🧪 Testing services..."

sleep 3  # Give services time to start

# Test learning service
if curl -s http://localhost:5010/health | grep -q healthy; then
    echo -e "  ${GREEN}✓${NC} Learning service is healthy"
else
    echo -e "  ${RED}✗${NC} Learning service not responding"
fi

# Test Ollama
if curl -s http://localhost:11434/api/version >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Ollama API is accessible"
else
    echo -e "  ${YELLOW}⚠${NC} Ollama API not accessible"
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo "==========================================="
echo "🎉 INTELLIGENT COMPANION SYSTEM READY!"
echo "==========================================="
echo ""
echo "📊 Services Running:"
echo "  • Learning API: http://localhost:5010"
echo "  • Ollama API: http://localhost:11434"
echo "  • Memory Daemon: Background consolidation"
echo ""
echo "🛠️ Control Commands:"
echo "  • Status: $BASE_DIR/companion_control.sh status"
echo "  • Stop: $BASE_DIR/companion_control.sh stop"
echo "  • Restart: $BASE_DIR/companion_control.sh restart"
echo "  • Logs: $BASE_DIR/companion_control.sh logs"
echo ""
echo "📝 Usage:"
echo "  The system will automatically:"
echo "  • Learn from all your inputs"
echo "  • Remember past interactions"
echo "  • Suggest based on patterns"
echo "  • Improve over time"
echo ""
echo "💡 Tips:"
echo "  • Provide feedback to improve learning"
echo "  • Use consistent terminology"
echo "  • The system gets smarter with use"
echo ""
echo "🚀 Your AI companion is ready to learn and assist!"