#!/bin/bash

echo "🚀 ChatGPT MCP Server Launcher"
echo "=============================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required"
    exit 1
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "📦 Installing dependencies..."
pip install -r requirements.txt

# Install Playwright browsers
echo "🌐 Setting up browser..."
playwright install chromium

# Create storage directory
mkdir -p ~/.chatgpt-mcp

echo ""
echo "✅ Setup complete!"
echo ""
echo "Starting MCP Server..."
echo "======================"
echo ""
echo "Server will run at: http://localhost:8000"
echo ""
echo "API Endpoints:"
echo "  POST /chat         - Send message to ChatGPT"
echo "  GET  /status       - Get server status"
echo "  GET  /sessions     - List all sessions"
echo "  WS   /ws          - WebSocket connection"
echo ""
echo "First time setup:"
echo "  1. A browser window will open"
echo "  2. Log in to your ChatGPT account"
echo "  3. The session will be saved"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the server
python server.py