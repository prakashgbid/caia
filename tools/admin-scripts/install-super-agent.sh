#!/bin/bash

# Universal Claude Code Super Agent Installer
# Works in any directory, any project type

echo "🤖 Claude Code Super Agent - Universal Installer"
echo "================================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }

# Check if running in projects directory or create universal installation
INSTALL_DIR="$HOME/.claude-super-agent"
AGENT_FILE="claude-code-super-agent.ts"
CONFIG_FILE=".claude-super-agent.json"

print_info "Installing Claude Code Super Agent universally..."

# Create installation directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Download or copy the super agent file
if [ -f "../projects/$AGENT_FILE" ]; then
    cp "../projects/$AGENT_FILE" .
    print_success "Super Agent copied from projects directory"
else
    print_info "Downloading Super Agent..."
    # In a real scenario, this would download from a repository
    print_warning "Please copy claude-code-super-agent.ts to $INSTALL_DIR"
fi

# Create global configuration if it doesn't exist
if [ ! -f "$HOME/$CONFIG_FILE" ]; then
    print_info "Creating global configuration..."
    
    cat > "$HOME/$CONFIG_FILE" << 'EOF'
{
  "openai": {
    "apiKey": "your-openai-api-key-here",
    "model": "gpt-4"
  },
  "google": {
    "apiKey": "your-google-api-key-here",
    "model": "gemini-1.5-pro"
  },
  "anthropic": {
    "apiKey": "your-anthropic-api-key-here",
    "model": "claude-3-5-sonnet-20241022"
  },
  "collaborationMode": "democratic_consensus",
  "votingThreshold": 0.7,
  "maxDebateRounds": 3
}
EOF

    print_success "Global configuration created at $HOME/$CONFIG_FILE"
    print_warning "Please update the API keys in $HOME/$CONFIG_FILE"
fi

# Create global launcher script
print_info "Creating global launcher..."

cat > "$HOME/.local/bin/super-agent" << EOF
#!/bin/bash

# Claude Code Super Agent Global Launcher
cd "$INSTALL_DIR"

# Check for dependencies
if ! command -v ts-node &> /dev/null; then
    echo "❌ ts-node is required but not installed."
    echo "   Install it with: npm install -g ts-node"
    exit 1
fi

# Check Node.js version
NODE_VERSION=\$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "\$NODE_VERSION" -lt "16" ]; then
    echo "❌ Node.js 16+ is required. Current version: \$(node --version)"
    exit 1
fi

# Launch the agent
echo "🤖 Claude Code Super Agent - Universal Multi-LLM Decision Maker"
echo "📍 Working Directory: \$(pwd)"
echo "🔧 Context: Auto-detecting from current project..."
echo ""

ts-node claude-code-super-agent.ts
EOF

# Make launcher executable
mkdir -p "$HOME/.local/bin"
chmod +x "$HOME/.local/bin/super-agent"

# Create package.json for dependencies
print_info "Setting up dependencies..."

cat > package.json << 'EOF'
{
  "name": "claude-super-agent",
  "version": "1.0.0",
  "description": "Universal Multi-LLM Decision Making Agent",
  "scripts": {
    "install-deps": "npm install",
    "agent": "ts-node claude-code-super-agent.ts",
    "test": "echo 'Testing super agent...' && npm run agent -- --help"
  },
  "dependencies": {
    "openai": "^4.28.0",
    "@google/generative-ai": "^0.2.1",
    "@anthropic-ai/sdk": "^0.17.1"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0"
  },
  "bin": {
    "super-agent": "claude-code-super-agent.ts"
  },
  "keywords": ["ai", "llm", "decision-making", "claude-code"],
  "author": "Claude Code Super Agent",
  "license": "MIT"
}
EOF

# Install dependencies
if command -v npm &> /dev/null; then
    print_info "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
else
    print_warning "npm not found. Please install Node.js and npm, then run 'npm install' in $INSTALL_DIR"
fi

# Add to PATH if not already there
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    print_info "Adding to PATH..."
    
    # Add to shell profile
    SHELL_PROFILE=""
    if [ -f "$HOME/.zshrc" ]; then
        SHELL_PROFILE="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        SHELL_PROFILE="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
        SHELL_PROFILE="$HOME/.bash_profile"
    fi
    
    if [ -n "$SHELL_PROFILE" ]; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_PROFILE"
        print_success "Added to PATH in $SHELL_PROFILE"
        print_info "Please restart your terminal or run: source $SHELL_PROFILE"
    else
        print_warning "Please manually add $HOME/.local/bin to your PATH"
    fi
fi

# Create context example for current directory
if [ "$PWD" != "$INSTALL_DIR" ] && [ ! -f ".claude-context.json" ]; then
    print_info "Creating context example in current directory..."
    
    cat > .claude-context.json.example << 'EOF'
{
  "name": "My Project Name",
  "description": "Brief description of what this project does",
  "domain": "web-development",
  "techStack": ["TypeScript", "React", "Node.js"],
  "phase": "development",
  "priorities": ["performance", "user experience", "security"],
  "constraints": ["mobile-first", "SEO optimized"],
  "special_considerations": [
    "Real-time features required",
    "Offline support needed"
  ]
}
EOF

    print_success "Context example created: .claude-context.json.example"
    print_info "Copy to .claude-context.json and customize for automatic context detection"
fi

# Final instructions
echo ""
print_success "Installation Complete! 🎉"
echo "======================="
print_info "Quick Start:"
echo "1. 🔑 Update API keys in: $HOME/$CONFIG_FILE"
echo "2. 🚀 Run from anywhere: super-agent"
echo "3. 💬 Try commands: ask, decide, debate, context, config"
echo ""
print_info "Universal Context Detection:"
echo "• 📋 .claude-context.json files"
echo "• 📦 package.json & README.md"
echo "• 🔍 Technology stack detection"
echo "• 📁 Project structure analysis"
echo "• 🌍 Git repository info"
echo ""
print_info "Supports All Tech Stacks:"
echo "• Node.js, Python, Rust, Go, Java"
echo "• React, Vue, Angular, Svelte"
echo "• Mobile, Desktop, CLI, ML projects"
echo ""
print_warning "Remember to keep your API keys secure!"

if ! command -v super-agent &> /dev/null; then
    echo ""
    print_warning "Command not found in PATH yet. To use immediately:"
    echo "   $HOME/.local/bin/super-agent"
    echo ""
    echo "Or restart your terminal for the 'super-agent' command to work globally."
fi