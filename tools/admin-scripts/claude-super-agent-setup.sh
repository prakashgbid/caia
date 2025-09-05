#!/bin/bash

# Claude Code Super Agent Setup Script
# This script deploys the super agent across all three projects

echo "🚀 Claude Code Super Agent Setup"
echo "================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if we're in the right directory
if [ ! -d "smart-agents-training-system" ] || [ ! -d "application-development-platform" ] || [ ! -d "roulette-community" ]; then
    print_error "Please run this script from the projects root directory containing all three projects"
    exit 1
fi

print_info "Setting up Super Agent dependencies..."

# Update SATS project with required packages
echo ""
print_info "📦 Installing SATS dependencies..."
cd smart-agents-training-system

# Create package.json if it doesn't exist or update it
cat > package.json << 'EOF'
{
  "name": "smart-agents-training-system",
  "version": "1.0.0",
  "description": "Multi-LLM collaboration system with bias-free decision making",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "test": "jest",
    "lint": "eslint src --ext .ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "openai": "^4.28.0",
    "@google/generative-ai": "^0.2.1",
    "@anthropic-ai/sdk": "^0.17.1",
    "events": "^3.3.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/jest": "^29.5.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0",
    "jest": "^29.7.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/parser": "^6.19.0",
    "@typescript-eslint/eslint-plugin": "^6.19.0"
  },
  "keywords": ["ai", "llm", "multi-model", "consensus", "decision-making"],
  "author": "Your Name",
  "license": "MIT"
}
EOF

npm install
print_status "SATS dependencies installed"

cd ..

# Create the super agent executable
echo ""
print_info "🔧 Creating Super Agent executable..."

# Make the super agent executable
chmod +x claude-code-super-agent.ts

# Create a package.json for the super agent
cat > super-agent-package.json << 'EOF'
{
  "name": "claude-code-super-agent",
  "version": "1.0.0",
  "description": "Multi-LLM decision making agent for Claude Code",
  "main": "claude-code-super-agent.ts",
  "scripts": {
    "agent": "ts-node claude-code-super-agent.ts",
    "build": "tsc claude-code-super-agent.ts --outDir dist",
    "install-global": "npm link"
  },
  "bin": {
    "super-agent": "./claude-code-super-agent.ts"
  },
  "dependencies": {
    "openai": "^4.28.0",
    "@google/generative-ai": "^0.2.1",
    "@anthropic-ai/sdk": "^0.17.1",
    "readline": "^1.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0"
  },
  "keywords": ["claude-code", "ai", "llm", "multi-model", "decision-making"],
  "author": "Your Name",
  "license": "MIT"
}
EOF

# Create configuration template
echo ""
print_info "📋 Creating configuration template..."

cat > .claude-super-agent.json << 'EOF'
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

print_status "Configuration template created"

# Create symlinks in each project
echo ""
print_info "🔗 Creating project symlinks..."

for project in "smart-agents-training-system" "application-development-platform" "roulette-community"; do
    cd "$project"
    
    # Create symlink to super agent
    if [ ! -L "super-agent" ]; then
        ln -s "../claude-code-super-agent.ts" super-agent
        print_status "Symlink created in $project"
    fi
    
    # Create project-specific launch script
    cat > launch-super-agent.sh << EOF
#!/bin/bash
# Launch Super Agent for $project
echo "🤖 Starting Claude Code Super Agent for $project"
echo "📍 Project Context: $(basename \$(pwd))"
echo ""
cd ..
ts-node claude-code-super-agent.ts
EOF
    
    chmod +x launch-super-agent.sh
    cd ..
done

# Create global launch script
echo ""
print_info "🌍 Creating global launcher..."

cat > launch-super-agent.sh << 'EOF'
#!/bin/bash

# Global Super Agent Launcher
echo "🤖 Claude Code Super Agent"
echo "=========================="

# Check for dependencies
if ! command -v ts-node &> /dev/null; then
    echo "❌ ts-node is required but not installed."
    echo "   Install it with: npm install -g ts-node"
    exit 1
fi

# Check for configuration
if [ ! -f ".claude-super-agent.json" ]; then
    echo "⚠️  Configuration file not found."
    echo "   A template has been created at .claude-super-agent.json"
    echo "   Please update it with your API keys."
    exit 1
fi

# Launch the agent
echo "🚀 Starting Multi-LLM Super Agent..."
echo ""
ts-node claude-code-super-agent.ts
EOF

chmod +x launch-super-agent.sh

# Create usage instructions
echo ""
print_info "📚 Creating usage documentation..."

cat > SUPER_AGENT_README.md << 'EOF'
# 🤖 Claude Code Super Agent

A multi-LLM decision-making agent that leverages ChatGPT, Gemini, and Claude to provide consensus-based answers through internal debate and collaboration.

## 🚀 Quick Start

### 1. Configure API Keys

Edit `.claude-super-agent.json` with your API keys:

```json
{
  "openai": {
    "apiKey": "sk-your-openai-key",
    "model": "gpt-4"
  },
  "google": {
    "apiKey": "your-google-key",
    "model": "gemini-1.5-pro"
  },
  "anthropic": {
    "apiKey": "sk-ant-your-key",
    "model": "claude-3-5-sonnet-20241022"
  }
}
```

Or set environment variables:
```bash
export OPENAI_API_KEY="sk-your-openai-key"
export GOOGLE_API_KEY="your-google-key"  
export ANTHROPIC_API_KEY="sk-ant-your-key"
```

### 2. Launch the Agent

From any project directory:
```bash
./launch-super-agent.sh
```

Or globally:
```bash
./launch-super-agent.sh
```

## 💬 Commands

### Core Decision Making

- `ask "question"` - Quick single-best answer (no consensus required)
- `decide "question"` - Full consensus decision with internal debate  
- `debate "question"` - Show detailed debate process and reasoning

### System Commands

- `health` - Check health of all LLM providers
- `metrics` - Show system performance metrics
- `config` - Show current configuration
- `help` - Show available commands
- `exit` - Exit the agent

## 🎯 Examples

```bash
# Quick question
ask "What's the best approach for user authentication?"

# Consensus decision  
decide "Should we use TypeScript or JavaScript for this project?"

# Full debate with reasoning
debate "What database should we choose for a social media app?"
```

## 🧠 How It Works

1. **Multi-LLM Collaboration**: ChatGPT, Gemini, and Claude work together
2. **Internal Debate**: Models challenge each other's reasoning 
3. **Consensus Building**: Democratic voting with configurable thresholds
4. **Context Awareness**: Automatically detects which project you're in

## ⚙️ Configuration

- `collaborationMode`: How models collaborate (`democratic_consensus`, `expertise_weighted`, `hierarchical`, `debate_synthesis`)
- `votingThreshold`: Agreement level required for consensus (0.0 - 1.0)
- `maxDebateRounds`: Maximum rounds of internal debate (1-10)

## 🏗️ Project Integration

The agent automatically provides context based on your current project:

- **SATS**: Multi-LLM collaboration and training systems
- **ADP**: Application development platform and agent orchestration  
- **RC**: Roulette community gaming application

## 🔧 Troubleshooting

### API Key Issues
- Verify keys in `.claude-super-agent.json`
- Check environment variables are set
- Ensure APIs have sufficient credits

### Connection Problems  
- Run `health` command to check provider status
- Check network connectivity
- Verify API endpoints are accessible

### Performance Issues
- Reduce `maxDebateRounds` for faster responses
- Lower `votingThreshold` for quicker consensus
- Use `ask` instead of `decide` for simple queries

## 📊 Advanced Features

### Memory System
The agent remembers previous interactions to provide better context in future decisions.

### Learning Mechanism
Continuous improvement based on decision outcomes and feedback.

### Cost Tracking
Real-time tracking of API costs across all providers.

### Extensibility
Easy to add new LLM providers or modify collaboration strategies.
EOF

print_status "Documentation created"

# Final summary
echo ""
echo "🎉 Setup Complete!"
echo "=================="
print_info "Next steps:"
echo "1. 🔑 Update .claude-super-agent.json with your API keys"
echo "2. 🚀 Run ./launch-super-agent.sh to start the agent"  
echo "3. 💬 Try commands like: ask, decide, debate, health"
echo ""
print_info "The agent is now available in all three projects:"
echo "   • smart-agents-training-system/"
echo "   • application-development-platform/" 
echo "   • roulette-community/"
echo ""
print_warning "Remember to keep your API keys secure and never commit them to git!"
echo ""
print_status "Your Multi-LLM Super Agent is ready! 🤖✨"