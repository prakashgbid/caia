---
layout: default
title: Installation Guide
description: Complete installation and setup instructions for the Hierarchical Agent System
---

# Installation Guide

This comprehensive guide covers all installation methods and deployment options for the Hierarchical Agent System, from simple local development to enterprise-grade production deployments.

## Quick Installation

For most users, the quickest way to get started:

```bash
# Install globally for CLI usage
npm install -g @caia/hierarchical-agent-system

# Verify installation
caia-hierarchical --version
```

## Installation Methods

### Method 1: Global CLI Installation (Recommended)

Perfect for individual developers and small teams:

```bash
# Install globally
npm install -g @caia/hierarchical-agent-system

# Initialize in any directory
cd your-project
caia-hierarchical init

# Start using immediately
caia-hierarchical process "Your project idea"
```

**Advantages:**
- ✅ Available system-wide
- ✅ Simple CLI commands
- ✅ Automatic updates with `npm update -g`
- ✅ Perfect for getting started

### Method 2: Local Project Installation

For integrating into existing Node.js projects:

```bash
# Install as project dependency
npm install @caia/hierarchical-agent-system

# Or with specific version
npm install @caia/hierarchical-agent-system@^1.0.0
```

**Use in your code:**
```typescript
import { HierarchicalAgentSystem } from '@caia/hierarchical-agent-system';

const system = new HierarchicalAgentSystem({
  // Your configuration
});
```

**Advantages:**
- ✅ Project-specific dependency management
- ✅ Version pinning for consistency
- ✅ Integrates with existing build systems
- ✅ Team collaboration friendly

### Method 3: Docker Installation

For containerized environments and consistent deployments:

```bash
# Pull the official image
docker pull caia/hierarchical-agent-system:latest

# Run with basic configuration
docker run -it \
  -v $(pwd):/workspace \
  -e JIRA_HOST_URL=https://your-domain.atlassian.net \
  -e JIRA_USERNAME=your-email@company.com \
  -e JIRA_API_TOKEN=your-token \
  caia/hierarchical-agent-system:latest \
  process "Build a customer portal"
```

**Docker Compose setup:**
```yaml
version: '3.8'
services:
  hierarchical-agent:
    image: caia/hierarchical-agent-system:latest
    volumes:
      - ./projects:/workspace
      - ./intelligence-data:/app/intelligence-data
    environment:
      - JIRA_HOST_URL=${JIRA_HOST_URL}
      - JIRA_USERNAME=${JIRA_USERNAME}
      - JIRA_API_TOKEN=${JIRA_API_TOKEN}
      - GITHUB_TOKEN=${GITHUB_TOKEN}
    ports:
      - "3000:3000"  # If using web interface
```

**Advantages:**
- ✅ Consistent environment across teams
- ✅ Easy scaling and orchestration
- ✅ Simplified dependency management
- ✅ Production-ready deployment

### Method 4: Enterprise Installation

For large organizations with specific requirements:

```bash
# Install from private npm registry
npm install @your-org/hierarchical-agent-system \
  --registry https://npm.yourcompany.com

# Or install from source with customizations
git clone https://github.com/caia-team/hierarchical-agent-system.git
cd hierarchical-agent-system
npm install
npm run build
npm link
```

## System Requirements

### Minimum Requirements
- **Node.js**: 18.0.0 or higher
- **npm**: 8.0.0 or higher
- **Memory**: 512MB available RAM
- **Storage**: 100MB free disk space

### Recommended Requirements
- **Node.js**: 20.0.0 or higher (LTS)
- **npm**: 10.0.0 or higher
- **Memory**: 2GB available RAM (for large projects)
- **Storage**: 1GB free disk space (with intelligence data)

### Platform Support
- ✅ **Linux** (Ubuntu 18.04+, RHEL 7+, CentOS 7+)
- ✅ **macOS** (10.15+, Apple Silicon supported)
- ✅ **Windows** (Windows 10+, Windows Server 2019+)
- ✅ **Docker** (Linux containers)

## Environment Setup

### 1. Node.js Installation

#### Linux (Ubuntu/Debian):
```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

#### macOS:
```bash
# Using Homebrew (recommended)
brew install node@20

# Or download from nodejs.org
# https://nodejs.org/en/download/
```

#### Windows:
```powershell
# Using Chocolatey
choco install nodejs

# Or using Scoop
scoop install nodejs

# Or download installer from nodejs.org
```

### 2. Permissions Setup

#### Linux/macOS Global Installation:
```bash
# Option 1: Use npx (recommended)
npx @caia/hierarchical-agent-system process "Your idea"

# Option 2: Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

#### Windows Global Installation:
```powershell
# Run as Administrator or configure npm
npm config set prefix %APPDATA%\npm
# Add %APPDATA%\npm to your PATH
```

## Configuration

### Basic Configuration

Create `hierarchical-config.json` in your project:

```json
{
  "projectName": "My Project",
  "taskDecomposer": {
    "enableHierarchicalDecomposition": true,
    "maxDepth": 7,
    "qualityGateThreshold": 0.85
  },
  "intelligence": {
    "enableAnalytics": true,
    "confidenceThreshold": 0.85
  }
}
```

### Environment Variables

Create `.env` file:

```bash
# Required for JIRA integration
JIRA_HOST_URL=https://your-domain.atlassian.net
JIRA_USERNAME=your-email@company.com
JIRA_API_TOKEN=your-api-token

# Optional for enhanced analysis
GITHUB_TOKEN=github_pat_your_token_here

# System configuration
INTELLIGENCE_ROOT=./intelligence-data
LOG_LEVEL=info
MAX_CONCURRENCY=10
```

### Advanced Configuration

For enterprise deployments, create `hierarchical-config.enterprise.json`:

```json
{
  "projectName": "Enterprise Deployment",
  "taskDecomposer": {
    "enableHierarchicalDecomposition": true,
    "maxDepth": 7,
    "qualityGateThreshold": 0.90,
    "maxReworkCycles": 5,
    "enableGitHubIntegration": true
  },
  "jiraConnect": {
    "enableAdvancedRoadmaps": true,
    "batchSize": 50,
    "retryAttempts": 5,
    "customFields": {
      "storyPoints": "customfield_10001",
      "epicName": "customfield_10002",
      "businessValue": "customfield_10003"
    }
  },
  "intelligence": {
    "enableAnalytics": true,
    "confidenceThreshold": 0.85,
    "enableHistoricalAnalysis": true,
    "riskAssessmentLevel": "comprehensive"
  },
  "orchestration": {
    "maxConcurrency": 20,
    "enableQualityGates": true,
    "retryAttempts": 5,
    "timeoutMs": 300000
  },
  "logging": {
    "level": "info",
    "enableFileLogging": true,
    "enableMetrics": true,
    "logRetentionDays": 30
  }
}
```

## Integration Setup

### JIRA Integration

1. **Create JIRA API Token:**
   - Go to https://id.atlassian.com/manage-profile/security/api-tokens
   - Click "Create API token"
   - Copy the generated token

2. **Configure permissions:**
   - Ensure your JIRA user has project administration rights
   - Verify Advanced Roadmaps is enabled (for enterprise features)

3. **Test connection:**
   ```bash
   caia-hierarchical status
   # Should show JIRA connection as healthy
   ```

### GitHub Integration

1. **Create Personal Access Token:**
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Generate new token with `repo` and `read:org` scopes
   - Copy the token

2. **Configure in environment:**
   ```bash
   export GITHUB_TOKEN=github_pat_your_token_here
   ```

3. **Verify connection:**
   ```bash
   caia-hierarchical test --integration
   ```

## Deployment Options

### Local Development

```bash
# Install and run locally
npm install -g @caia/hierarchical-agent-system
caia-hierarchical init
```

### Team Shared Setup

```bash
# Shared configuration repository
git clone https://github.com/yourteam/hierarchical-config.git
cd hierarchical-config
npm install @caia/hierarchical-agent-system
npm run setup
```

### Docker Deployment

**Dockerfile example:**
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install global dependencies
RUN npm install -g @caia/hierarchical-agent-system

# Copy configuration
COPY hierarchical-config.json .env ./

# Create intelligence data directory
RUN mkdir -p intelligence-data

# Expose port (if using web interface)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD caia-hierarchical status || exit 1

CMD ["caia-hierarchical", "server"]
```

**Build and run:**
```bash
docker build -t my-hierarchical-system .
docker run -d --name hierarchical-agent \
  -p 3000:3000 \
  -v ./projects:/app/projects \
  my-hierarchical-system
```

### Kubernetes Deployment

**deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hierarchical-agent-system
spec:
  replicas: 3
  selector:
    matchLabels:
      app: hierarchical-agent-system
  template:
    metadata:
      labels:
        app: hierarchical-agent-system
    spec:
      containers:
      - name: hierarchical-agent
        image: caia/hierarchical-agent-system:latest
        ports:
        - containerPort: 3000
        env:
        - name: JIRA_HOST_URL
          valueFrom:
            secretKeyRef:
              name: hierarchical-secrets
              key: jira-host-url
        - name: JIRA_USERNAME
          valueFrom:
            secretKeyRef:
              name: hierarchical-secrets
              key: jira-username
        - name: JIRA_API_TOKEN
          valueFrom:
            secretKeyRef:
              name: hierarchical-secrets
              key: jira-api-token
        volumeMounts:
        - name: intelligence-data
          mountPath: /app/intelligence-data
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
      volumes:
      - name: intelligence-data
        persistentVolumeClaim:
          claimName: intelligence-data-pvc
```

## Verification & Testing

### Installation Verification

```bash
# Check version
caia-hierarchical --version

# Check system status
caia-hierarchical status

# Run basic functionality test
caia-hierarchical process "Test project" --output test-results.json

# Run integration tests
caia-hierarchical test --integration
```

### Performance Testing

```bash
# Load test with multiple projects
for i in {1..10}; do
  caia-hierarchical process "Test project $i" &
done
wait

# Memory usage test
caia-hierarchical process "Large enterprise system with 100+ microservices"
```

### Configuration Validation

```bash
# Validate configuration
caia-hierarchical config --validate

# Show current configuration
caia-hierarchical config --show
```

## Troubleshooting

### Common Installation Issues

#### "Permission denied" on Linux/macOS
```bash
# Fix npm permissions
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}

# Or use npx instead
npx @caia/hierarchical-agent-system process "Your idea"
```

#### "Node version not supported"
```bash
# Check current version
node --version

# Update Node.js
# Linux/macOS with nvm:
nvm install 20
nvm use 20

# Windows with nvm-windows:
nvm install 20.0.0
nvm use 20.0.0
```

#### "Module not found" errors
```bash
# Clear npm cache
npm cache clean --force

# Reinstall with verbose output
npm install -g @caia/hierarchical-agent-system --verbose

# Check global installation path
npm list -g --depth=0
```

### Docker Issues

#### Container won't start
```bash
# Check logs
docker logs hierarchical-agent

# Run in interactive mode
docker run -it caia/hierarchical-agent-system:latest sh

# Check environment variables
docker exec hierarchical-agent env
```

### Integration Issues

#### JIRA connection fails
```bash
# Test JIRA connectivity
curl -u your-email@company.com:your-api-token \
  https://your-domain.atlassian.net/rest/api/3/myself

# Verify API token permissions
# Check Advanced Roadmaps availability
```

#### GitHub rate limiting
```bash
# Check GitHub API limits
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit

# Use GitHub App instead of personal token for higher limits
```

## Updating

### Update Global Installation
```bash
# Check current version
caia-hierarchical --version

# Update to latest version
npm update -g @caia/hierarchical-agent-system

# Update to specific version
npm install -g @caia/hierarchical-agent-system@1.0.1
```

### Update Local Installation
```bash
# Check for updates
npm outdated @caia/hierarchical-agent-system

# Update to latest
npm update @caia/hierarchical-agent-system

# Update package.json
npm install @caia/hierarchical-agent-system@latest --save
```

### Docker Updates
```bash
# Pull latest image
docker pull caia/hierarchical-agent-system:latest

# Update running containers
docker-compose pull
docker-compose up -d
```

## Backup & Recovery

### Backup Intelligence Data
```bash
# Create backup
tar -czf intelligence-backup-$(date +%Y%m%d).tar.gz intelligence-data/

# Restore backup
tar -xzf intelligence-backup-20241201.tar.gz
```

### Configuration Backup
```bash
# Backup all configuration
cp hierarchical-config.json hierarchical-config.backup.json
cp .env .env.backup
```

## Next Steps

Now that you have the system installed:

1. **[Get Started](getting-started)** - Follow the quick start guide
2. **[Configure JIRA](jira-integration)** - Set up JIRA integration
3. **[Explore Examples](examples/)** - Try real-world examples
4. **[API Reference](api/)** - Integrate programmatically

## Support

If you encounter installation issues:

- 📖 Check our [FAQ](support#faq)
- 💬 Join our [Discord community]({{ site.discord_invite }})
- 🐛 Report issues on [GitHub]({{ site.github_repo }}/issues)
- 📧 Contact [support@caia.dev](mailto:support@caia.dev)

---

<div class="installation-success">
  <h2>🎉 Installation Complete!</h2>
  <p>You're now ready to revolutionize your project management with AI-powered hierarchical decomposition. The system is installed and ready to transform ideas into structured, executable project hierarchies.</p>
  <a href="getting-started" class="btn btn-primary">Get Started Now</a>
</div>