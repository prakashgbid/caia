# 🤖 Claude Code Super Agent

## Universal Multi-LLM Decision Making Agent

A flexible, context-aware AI agent that combines **ChatGPT**, **Gemini**, and **Claude** to provide intelligent decision making through internal debate and consensus building. Works with **any project type** and **any technology stack**.

## ✨ Key Features

### 🧠 Multi-LLM Intelligence
- **3 AI Models**: ChatGPT, Google Gemini, and Anthropic Claude working together
- **Internal Debate**: Models challenge each other's reasoning before reaching consensus
- **Democratic Voting**: Configurable consensus thresholds and collaboration modes
- **Cost Tracking**: Real-time API usage and cost monitoring

### 🔍 Universal Context Detection
Works intelligently with **any project** by automatically detecting:
- **Project files**: `.claude-context.json`, `package.json`, `README.md`
- **Technology stack**: Node.js, Python, Rust, Go, Java, PHP, .NET, Ruby, etc.
- **Framework detection**: React, Vue, Angular, Next.js, Express, Django, Rails, etc.
- **Project type**: Web app, API, CLI tool, mobile app, ML project, game, etc.
- **Git repository**: Repository info and project structure

### ⚙️ Flexible Configuration
- **4 Collaboration Modes**: Democratic consensus, expertise weighted, hierarchical, debate synthesis
- **Adjustable Parameters**: Voting thresholds, debate rounds, timeout settings
- **Custom Context**: Set project-specific context manually or via files
- **Session Memory**: Remembers context and preferences during conversations

## 🚀 Quick Start

### 1. Universal Installation

```bash
# Install globally (works from anywhere)
./install-super-agent.sh

# Or use in current project only
./claude-super-agent-setup.sh
```

### 2. Configure API Keys

Edit `~/.claude-super-agent.json`:

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

Or use environment variables:
```bash
export OPENAI_API_KEY="sk-your-key"
export GOOGLE_API_KEY="your-key"
export ANTHROPIC_API_KEY="sk-ant-your-key"
```

### 3. Launch from Any Project

```bash
super-agent  # Global command (after installation)
# or
./launch-super-agent.sh  # Local usage
```

## 💬 Command Reference

### Core Decision Making

```bash
# Quick single-best answer
ask "What's the best database for real-time gaming?"

# Full consensus decision with debate
decide "Should we use microservices or monolithic architecture?"

# Show detailed debate process
debate "What testing strategy should we implement?"
```

### Context Management

```bash
# Show current context
context

# Set custom context for session
context set "E-commerce platform, 1M+ users, AWS infrastructure"

# Load from file
context file my-project-context.json

# Auto-detect from current directory
context auto

# Clear custom context
context clear
```

### Configuration

```bash
# Show current settings
config

# Change collaboration mode
config mode expertise_weighted

# Adjust consensus threshold (0.0-1.0)
config threshold 0.8

# Set max debate rounds (1-10)
config rounds 5

# Reset to defaults
config reset
```

### System Commands

```bash
health    # Check all LLM providers
metrics   # Show performance metrics
version   # Show agent info
help      # Show all commands
exit      # Exit agent
```

## 🎯 Context Detection Examples

The agent automatically understands your project:

### Web Application (React/Next.js)
```
Context: Project: my-web-app | Description: Modern web application | 
Tech: React, Next.js, TypeScript | Project Type: Web App | Repository: user/my-app
```

### Python ML Project
```
Context: Project: ml-classifier | Tech: Python | Project Type: Machine Learning | 
Repository: team/ml-project
```

### Mobile App (React Native)
```
Context: Project: mobile-chat | Description: Real-time messaging app | 
Tech: React Native, TypeScript | Project Type: Mobile App
```

### Rust CLI Tool
```
Context: Project: file-processor | Description: High-performance file processing | 
Tech: Rust | Project Type: CLI Tool
```

## 📋 Custom Context Files

Create `.claude-context.json` in your project root:

```json
{
  "name": "TikTok Clone",
  "description": "Viral video sharing platform",
  "domain": "social-media",
  "techStack": ["React Native", "Node.js", "PostgreSQL", "Redis", "FFmpeg"],
  "phase": "MVP development",
  "priorities": ["real-time features", "video processing", "viral mechanics"],
  "constraints": ["mobile-first", "low latency", "high availability"],
  "business": {
    "model": "B2C social platform",
    "target_users": "Gen Z creators",
    "scale": "10M+ users expected"
  },
  "special_considerations": [
    "Content moderation required",
    "Global CDN for video delivery",
    "Real-time notifications",
    "Algorithm-driven feed"
  ]
}
```

## 🎭 Collaboration Modes

### 1. Democratic Consensus (Default)
- All models have equal voting weight
- Decision requires majority agreement
- Best for general questions

```bash
config mode democratic_consensus
```

### 2. Expertise Weighted
- Models weighted by domain expertise
- Technical questions favor technical models
- Best for specialized domains

```bash
config mode expertise_weighted
```

### 3. Hierarchical
- Structured decision-making process
- Lead model makes final decision
- Best for complex strategic choices

```bash
config mode hierarchical
```

### 4. Debate Synthesis
- Adversarial debate then synthesis
- Models argue opposing viewpoints
- Best for exploring trade-offs

```bash
config mode debate_synthesis
```

## 📊 Example Workflows

### Architecture Decision
```bash
🤖 Super Agent > decide "Should we use GraphQL or REST for our mobile API?"

🏛️ Initiating consensus decision process...

🔄 Starting debate round 1
   🤖 openai: GraphQL provides better mobile performance with query optimization...
   🤖 google: REST is simpler and has better caching infrastructure...
   🤖 anthropic: Consider the team's experience and tooling ecosystem...

🔄 Starting debate round 2
   [Models refine positions based on each other's arguments]

🎯 Consensus Decision:
Use GraphQL with Apollo Federation for the mobile API. The query optimization 
and reduced over-fetching significantly benefit mobile performance, while Apollo 
provides mature tooling for team adoption.

🤝 Agreement Level: 85.2%
📊 Confidence: 87.6%
```

### Custom Context Example
```bash
🤖 Super Agent > context set "Gaming startup, real-time multiplayer, Node.js/Redis, 50k CCU target"

✅ Custom context set: Gaming startup, real-time multiplayer, Node.js/Redis, 50k CCU target

🤖 Super Agent > ask "What's the best approach for handling player state?"

🤔 Asking all models...

💡 Best Answer:
For 50k CCU real-time gaming, use Redis with pub/sub for immediate state 
propagation, implement state sharding by game room, and use UDP for 
high-frequency updates with TCP for reliable state sync...

📊 Confidence: 91.3% | 🤖 Provided by: claude
```

## 🛠️ Advanced Usage

### Environment Context Override
```bash
export CLAUDE_AGENT_CONTEXT="Fintech startup, PCI compliance required, microservices"
super-agent
```

### Custom Configuration per Project
```bash
# Project-specific config
cp ~/.claude-super-agent.json ./.claude-super-agent.json
# Edit project-specific settings
```

### Batch Mode (Future Feature)
```bash
# Process multiple questions from file
super-agent --batch questions.txt --output results.json
```

## 🔧 Supported Technologies

### Languages & Runtimes
- **Node.js/JavaScript/TypeScript**: React, Vue, Angular, Express, Fastify
- **Python**: Django, Flask, FastAPI, Jupyter, PyTorch, TensorFlow
- **Rust**: Actix, Warp, Tauri, CLI tools
- **Go**: Gin, Echo, gRPC, microservices
- **Java**: Spring Boot, Maven, Gradle
- **PHP**: Laravel, Symfony, Composer
- **Ruby**: Rails, Sinatra, Bundler
- **C#/.NET**: ASP.NET, Blazor, MAUI
- **Swift/Kotlin**: iOS/Android native development
- **Dart**: Flutter mobile development

### Project Types
- **Web Applications**: SPA, SSR, static sites
- **API/Backend**: REST, GraphQL, microservices
- **Mobile Apps**: Native, React Native, Flutter
- **Desktop Apps**: Electron, Tauri, native
- **CLI Tools**: Command-line utilities
- **ML/AI**: Training, inference, data processing
- **Games**: Unity, Godot, web games
- **Blockchain**: Smart contracts, DApps

## ⚡ Performance Tips

1. **Use `ask` for quick questions** - No consensus overhead
2. **Use `decide` for important choices** - Full multi-LLM analysis
3. **Set appropriate thresholds** - Lower for speed, higher for accuracy
4. **Provide good context** - Better context = better decisions
5. **Monitor costs** - Check `metrics` regularly

## 🔒 Security & Privacy

- **API keys encrypted** in configuration files
- **No data storage** - All processing is ephemeral
- **Local execution** - Your code never leaves your machine
- **Audit logging** available for enterprise use

## 🐛 Troubleshooting

### Common Issues

**"Command not found: super-agent"**
```bash
# Add to PATH manually
export PATH="$HOME/.local/bin:$PATH"
# Or use full path
$HOME/.local/bin/super-agent
```

**API Key Errors**
```bash
# Check configuration
super-agent
config

# Test API health
health
```

**Context Not Detected**
```bash
# Check current context
context

# Set manually
context set "Your project description"
```

**Performance Issues**
```bash
# Reduce debate rounds
config rounds 1

# Lower consensus threshold
config threshold 0.6
```

## 🤝 Contributing

The Super Agent is built on the **SATS** (Smart Agents Training System) architecture. To contribute:

1. **Core SATS**: `smart-agents-training-system/`
2. **Agent Logic**: `claude-code-super-agent.ts`
3. **Context Detection**: Enhance project detection algorithms
4. **LLM Providers**: Add new model providers

## 📄 License

MIT License - Use freely in any project, commercial or personal.

## 🆘 Support

- **GitHub Issues**: Report bugs and feature requests
- **Documentation**: This README and inline help
- **Community**: Share your use cases and workflows

---

**Built with ❤️ for developers who want AI collaboration, not replacement.**

*The Super Agent learns with you, adapts to your projects, and makes intelligent decisions across any technology stack.*