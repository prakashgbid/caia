#!/bin/bash

echo "🚀 ChatGPT MCP Server Setup"
echo "==========================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed"
    echo "Install with: brew install node"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Install Playwright browsers
echo ""
echo "🌐 Installing browser for automation..."
npx playwright install chromium

# Build TypeScript
echo ""
echo "🔨 Building TypeScript..."
npm run build

# Create session directory
echo ""
echo "📁 Creating session directory..."
mkdir -p ~/.chatgpt-mcp/session

# Check for Claude Code config
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo ""
if [ -f "$CLAUDE_CONFIG" ]; then
    echo "📝 Claude Code config found"
    echo ""
    echo "Add this to your Claude Code config:"
    echo ""
    cat << EOF
{
  "mcpServers": {
    "chatgpt": {
      "command": "node",
      "args": ["$(pwd)/dist/index.js"],
      "env": {}
    }
  }
}
EOF
else
    echo "⚠️ Claude Code config not found"
    echo "Creating config with ChatGPT server..."
    
    mkdir -p "$HOME/Library/Application Support/Claude"
    cat > "$CLAUDE_CONFIG" << EOF
{
  "mcpServers": {
    "chatgpt": {
      "command": "node",
      "args": ["$(pwd)/dist/index.js"],
      "env": {}
    }
  }
}
EOF
    echo "✅ Config created at: $CLAUDE_CONFIG"
fi

echo ""
echo "================================"
echo "✅ Setup Complete!"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Restart Claude Code"
echo "2. In Claude Code, say: 'Use chatgpt to initialize'"
echo "3. Log in to ChatGPT when browser opens (first time only)"
echo "4. Start using ChatGPT from Claude Code!"
echo ""
echo "Example commands:"
echo "  'Use chatgpt to explain quantum computing'"
echo "  'Use chatgpt code_interpreter to run Python code'"
echo "  'Use chatgpt to generate an image of a sunset'"
echo ""