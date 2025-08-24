# Installation Guide

Complete setup instructions for the CAIA Hierarchical Agent System across all platforms.

---

## 📊 System Requirements

### Minimum Requirements
- **Node.js**: 18.0.0 or higher
- **npm**: 8.0.0 or higher (or pnpm 7.0.0+, yarn 1.22.0+)
- **Memory**: 2GB RAM minimum, 4GB recommended
- **Storage**: 500MB free disk space
- **Network**: Internet connection for package installation and API access

### Supported Platforms
- ✅ **macOS**: 10.15 (Catalina) or later
- ✅ **Windows**: Windows 10 or Windows Server 2019+
- ✅ **Linux**: Ubuntu 18.04+, CentOS 8+, Debian 10+, Alpine 3.14+
- ✅ **Docker**: All platforms supporting Docker 20.0+

### Supported Node.js Versions
- ✅ **Node.js 18.x** (LTS - Recommended)
- ✅ **Node.js 20.x** (Current)
- ✅ **Node.js 21.x** (Latest)
- ⚠️ **Node.js 16.x** (Minimum supported, but deprecated)

---

## 🚀 Quick Installation

### Option 1: Global Installation (Recommended)
```bash
# Install globally for CLI access
npm install -g @caia/hierarchical-agent-system

# Verify installation
caia-hierarchical --version
# Expected output: 1.0.0

# Test basic functionality
caia-hierarchical status
```

### Option 2: Local Project Installation
```bash
# Navigate to your project directory
cd your-project

# Install as a dependency
npm install @caia/hierarchical-agent-system

# Or install as dev dependency
npm install --save-dev @caia/hierarchical-agent-system
```

### Option 3: Using pnpm (Recommended for performance)
```bash
# Global installation
pnpm add -g @caia/hierarchical-agent-system

# Local installation
pnpm add @caia/hierarchical-agent-system
```

### Option 4: Using Yarn
```bash
# Global installation
yarn global add @caia/hierarchical-agent-system

# Local installation  
yarn add @caia/hierarchical-agent-system
```

---

## 🌐 Platform-Specific Instructions

### 🍎 macOS Installation

#### Prerequisites
```bash
# Install Xcode Command Line Tools (if not already installed)
xcode-select --install

# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js via Homebrew
brew install node

# Verify installation
node --version  # Should be 18.0.0+
npm --version   # Should be 8.0.0+
```

#### Install the Package
```bash
# Install globally
npm install -g @caia/hierarchical-agent-system

# Create configuration directory
mkdir -p ~/.config/caia-hierarchical

# Initialize project
caia-hierarchical init
```

#### macOS-Specific Configuration
```bash
# Add to ~/.zshrc or ~/.bash_profile
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
echo 'export CAIA_CONFIG_DIR="$HOME/.config/caia-hierarchical"' >> ~/.zshrc

# Reload shell configuration
source ~/.zshrc
```

### 🧠 Windows Installation

#### Prerequisites
```powershell
# Install Node.js using winget (Windows 10+)
winget install OpenJS.NodeJS

# Or download from https://nodejs.org/en/download/
# Choose "Windows Installer (.msi)" for your architecture

# Verify installation in Command Prompt
node --version
npm --version
```

#### Install the Package
```powershell
# Open PowerShell as Administrator
# Install globally
npm install -g @caia/hierarchical-agent-system

# Create configuration directory
mkdir "$env:APPDATA\caia-hierarchical"

# Initialize project
caia-hierarchical init
```

#### Windows-Specific Configuration
```powershell
# Add environment variables (PowerShell)
[Environment]::SetEnvironmentVariable("CAIA_CONFIG_DIR", "$env:APPDATA\caia-hierarchical", "User")

# Or use Command Prompt
setx CAIA_CONFIG_DIR "%APPDATA%\caia-hierarchical"
```

#### Windows Subsystem for Linux (WSL)
```bash
# Install Node.js in WSL
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install the package
npm install -g @caia/hierarchical-agent-system

# Initialize
caia-hierarchical init
```

### 🐧 Linux Installation

#### Ubuntu/Debian
```bash
# Update package index
sudo apt update

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build essentials (required for some native modules)
sudo apt-get install -y build-essential

# Install the package
npm install -g @caia/hierarchical-agent-system

# Initialize
caia-hierarchical init
```

#### CentOS/RHEL/Rocky Linux
```bash
# Install Node.js 18.x
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs npm

# Install development tools
sudo dnf groupinstall "Development Tools"

# Install the package
npm install -g @caia/hierarchical-agent-system

# Initialize
caia-hierarchical init
```

#### Alpine Linux
```bash
# Install Node.js and npm
sudo apk add --no-cache nodejs npm python3 make g++

# Install the package
npm install -g @caia/hierarchical-agent-system

# Initialize
caia-hierarchical init
```

#### Arch Linux
```bash
# Install Node.js
sudo pacman -S nodejs npm base-devel

# Install the package
npm install -g @caia/hierarchical-agent-system

# Initialize
caia-hierarchical init
```

---

## 🐳 Docker Installation

### Option 1: Pre-built Docker Image (Coming Soon)
```bash
# Pull the official image
docker pull caia/hierarchical-agent-system:latest

# Run with environment configuration
docker run -it \
  -e JIRA_HOST_URL="https://your-domain.atlassian.net" \
  -e JIRA_USERNAME="your-email@company.com" \
  -e JIRA_API_TOKEN="your-api-token" \
  -v $(pwd):/workspace \
  caia/hierarchical-agent-system:latest
```

### Option 2: Build from Source
```bash
# Clone the repository
git clone https://github.com/caia-team/hierarchical-agent-system.git
cd hierarchical-agent-system

# Build the Docker image
docker build -t hierarchical-agent-system .

# Run the container
docker run -it \
  -v $(pwd):/workspace \
  hierarchical-agent-system
```

### Option 3: Docker Compose
Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  hierarchical-agent:
    image: caia/hierarchical-agent-system:latest
    environment:
      - JIRA_HOST_URL=${JIRA_HOST_URL}
      - JIRA_USERNAME=${JIRA_USERNAME}
      - JIRA_API_TOKEN=${JIRA_API_TOKEN}
      - GITHUB_TOKEN=${GITHUB_TOKEN}
    volumes:
      - ./data:/app/data
      - ./config:/app/config
    ports:
      - "3000:3000"  # If using web interface
```

```bash
# Run with docker-compose
docker-compose up -d
```

---

## ⚙️ Initial Configuration

### 1. Environment Setup
Create a `.env` file in your project directory:

```bash
# JIRA Integration (Required for JIRA features)
JIRA_HOST_URL=https://your-domain.atlassian.net
JIRA_USERNAME=your-email@company.com
JIRA_API_TOKEN=your-jira-api-token

# GitHub Integration (Optional - enhances analysis)
GITHUB_TOKEN=github_pat_your_token_here

# Intelligence Hub Configuration
INTELLIGENCE_ROOT=./intelligence-data
INTELLIGENCE_DEBUG=false

# Logging Configuration
LOG_LEVEL=info
LOG_DIR=./logs
ENABLE_FILE_LOGGING=true

# Performance Tuning
MAX_CONCURRENCY=10
QUALITY_GATE_THRESHOLD=0.85
MAX_REWORK_CYCLES=3

# Feature Flags
ENABLE_ANALYTICS=true
ENABLE_ADVANCED_ROADMAPS=true
ENABLE_AUTO_DOCUMENTATION=true
```

### 2. Interactive Setup
```bash
# Run interactive configuration
caia-hierarchical init

# This will prompt you for:
# - JIRA connection details
# - GitHub token (optional)
# - Project preferences
# - Quality gate thresholds
# - Logging preferences
```

### 3. Verify Configuration
```bash
# Test system health
caia-hierarchical status

# Test JIRA connection
caia-hierarchical test --jira

# Test GitHub connection (if configured)
caia-hierarchical test --github

# Run integration tests
caia-hierarchical test --integration
```

---

## 🔧 Development Installation

### From Source (Latest Development)
```bash
# Clone the repository
git clone https://github.com/caia-team/hierarchical-agent-system.git
cd hierarchical-agent-system

# Install dependencies
npm install

# Build the project
npm run build

# Link globally for development
npm link

# Run tests
npm test

# Start development mode
npm run dev
```

### Development Dependencies
```bash
# Additional tools for development
npm install -g typescript ts-node nodemon

# Code quality tools
npm install -g eslint prettier

# Testing tools
npm install -g jest @types/jest
```

---

## 📊 Verification & Testing

### Basic Functionality Test
```bash
# Check version
caia-hierarchical --version

# System status
caia-hierarchical status

# Help information
caia-hierarchical --help
```

### Process a Simple Project
```bash
# Test basic decomposition
caia-hierarchical process "Build a simple todo app"

# Expected output:
# Processing project: Build a simple todo app...
# Decomposing idea into hierarchical structure...
# Analysis completed with 0.87 confidence
# Generated 1 epic, 3 stories, 7 tasks
```

### Integration Tests
```bash
# Test JIRA integration (requires configuration)
caia-hierarchical test --jira

# Test GitHub integration
caia-hierarchical test --github

# Full integration test suite
caia-hierarchical test --all
```

---

## ⚠️ Troubleshooting

### Common Installation Issues

#### Node.js Version Issues
```bash
# Check Node.js version
node --version

# If version is < 18.0.0, update Node.js:
# macOS: brew upgrade node
# Windows: Download from nodejs.org
# Linux: Update using package manager
```

#### Permission Issues (macOS/Linux)
```bash
# Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Reinstall globally
npm install -g @caia/hierarchical-agent-system
```

#### Windows PowerShell Execution Policy
```powershell
# If you get execution policy errors
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Then reinstall
npm install -g @caia/hierarchical-agent-system
```

#### Network/Proxy Issues
```bash
# Configure npm for corporate proxy
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy http://proxy.company.com:8080

# Or use .npmrc file
echo "proxy=http://proxy.company.com:8080" >> ~/.npmrc
echo "https-proxy=http://proxy.company.com:8080" >> ~/.npmrc
```

#### Module Installation Failures
```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Try with --no-optional flag
npm install --no-optional
```

### Getting Help

If you encounter issues not covered here:

1. **Check the [Troubleshooting Guide](Troubleshooting)** for more detailed solutions
2. **Search [GitHub Issues](https://github.com/caia-team/hierarchical-agent-system/issues)**
3. **Ask on [GitHub Discussions](https://github.com/caia-team/hierarchical-agent-system/discussions)**
4. **Join our [Discord Community](https://discord.gg/caia-dev)**
5. **Email support**: [support@caia.dev](mailto:support@caia.dev)

---

## 🚀 Next Steps

After successful installation:

1. **[Configure JIRA Integration](JIRA-Integration-Guide)** - Set up JIRA connectivity
2. **[Explore Examples](Examples-and-Tutorials)** - Try real-world scenarios
3. **[Read the API Reference](API-Reference)** - Learn programmatic usage
4. **[Performance Tuning](Performance-Tuning)** - Optimize for your environment

---

## 📋 Installation Checklist

- [ ] Node.js 18.0.0+ installed
- [ ] Package installed globally or locally
- [ ] CLI command `caia-hierarchical` accessible
- [ ] Basic `caia-hierarchical status` command works
- [ ] Environment variables configured (if using JIRA/GitHub)
- [ ] Initial project test successful
- [ ] Documentation and examples reviewed

Congratulations! You're ready to start using the Hierarchical Agent System. 🎉