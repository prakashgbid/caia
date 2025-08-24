---
layout: default
title: Installation Guide
description: Complete installation and setup guide for the Hierarchical Agent System
---

# Installation Guide

Complete guide for installing and configuring the Hierarchical Agent System for development, testing, and production environments.

## System Requirements

### Minimum Requirements

- **Node.js**: 18.0.0 or higher
- **npm**: 8.0.0 or higher
- **Operating System**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 18.04+)
- **Memory**: 4GB RAM (8GB recommended)
- **Storage**: 1GB free space

### Recommended Requirements

- **Node.js**: 20.0.0 or higher
- **npm**: 10.0.0 or higher
- **Memory**: 8GB RAM or more
- **CPU**: Multi-core processor for parallel processing
- **Network**: Stable internet connection for JIRA/GitHub API calls

### External Dependencies

- **JIRA Cloud/Server**: For JIRA integration features
- **GitHub Account**: For enhanced project analysis (optional)
- **Git**: For repository operations (optional)

## Installation Options

### Option 1: Global CLI Installation

Install globally for command-line usage:

```bash
# Install globally
npm install -g {{ site.npm_package }}

# Verify installation
caia-hierarchical --version
```

### Option 2: Local Project Installation

Install locally for programmatic usage:

```bash
# Navigate to your project directory
cd your-project

# Install as dependency
npm install {{ site.npm_package }}

# Or install as dev dependency
npm install --save-dev {{ site.npm_package }}
```

### Option 3: Development Installation

For contributing or customizing the system:

```bash
# Clone the repository
git clone {{ site.github_repo }}.git
cd hierarchical-agent-system

# Install dependencies
npm install

# Build the project
npm run build

# Link globally for CLI usage
npm link

# Run tests to verify setup
npm test
```

## Configuration Setup

### Interactive Configuration

Use the interactive setup wizard:

```bash
caia-hierarchical init
```

This will guide you through:
1. JIRA connection setup
2. GitHub token configuration
3. Intelligence hub initialization
4. Feature flag configuration
5. Connection testing

### Manual Configuration

Create configuration files manually for more control.

#### Environment Variables

Create a `.env` file:

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

#### Project Configuration File

Create `hierarchical-config.json` for project-specific settings:

```json
{
  "projectName": "My Enterprise Project",
  "taskDecomposer": {
    "enableHierarchicalDecomposition": true,
    "maxDepth": 7,
    "qualityGateThreshold": 0.90,
    "maxReworkCycles": 5,
    "enableGitHubIntegration": true
  },
  "jiraConnect": {
    "hostUrl": "https://company.atlassian.net",
    "enableAdvancedRoadmaps": true,
    "defaultProject": "PROJ",
    "customFields": {
      "storyPoints": "customfield_10001",
      "epicName": "customfield_10002"
    },
    "issueTypes": {
      "initiative": "Initiative",
      "epic": "Epic",
      "story": "Story",
      "task": "Task"
    }
  },
  "intelligence": {
    "enableAnalytics": true,
    "confidenceThreshold": 0.85,
    "enableHistoricalAnalysis": true,
    "riskAssessmentLevel": "comprehensive"
  },
  "orchestration": {
    "maxConcurrency": 15,
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

## Authentication Setup

### JIRA Authentication

#### Generate API Token

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Enter a label (e.g., "Hierarchical Agent System")
4. Copy the generated token
5. Add to your `.env` file as `JIRA_API_TOKEN`

#### Test JIRA Connection

```bash
# Test JIRA connectivity
caia-hierarchical config --validate

# Or test programmatically
caia-hierarchical test --jira
```

### GitHub Authentication

#### Generate Personal Access Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Select scopes:
   - `repo` (for private repositories)
   - `public_repo` (for public repositories)
   - `read:org` (for organization analysis)
4. Copy the generated token
5. Add to your `.env` file as `GITHUB_TOKEN`

#### Test GitHub Connection

```bash
# Test GitHub connectivity
caia-hierarchical test --github
```

## Environment-Specific Setup

### Development Environment

```bash
# Install with dev dependencies
npm install {{ site.npm_package }} --save-dev

# Create development config
cp .env.example .env.development

# Set development-friendly defaults
echo "LOG_LEVEL=debug" >> .env.development
echo "ENABLE_ANALYTICS=false" >> .env.development
echo "QUALITY_GATE_THRESHOLD=0.75" >> .env.development
```

### Testing Environment

```bash
# Create test configuration
cp .env.example .env.test

# Use test JIRA instance
echo "JIRA_HOST_URL=https://test-company.atlassian.net" >> .env.test
echo "JIRA_USERNAME=test-user@company.com" >> .env.test
echo "JIRA_API_TOKEN=test-api-token" >> .env.test

# Disable external integrations
echo "ENABLE_ANALYTICS=false" >> .env.test
echo "GITHUB_TOKEN=" >> .env.test
```

### Production Environment

```bash
# Install production dependencies only
npm install {{ site.npm_package }} --production

# Create production config with strict settings
echo "LOG_LEVEL=warn" > .env.production
echo "ENABLE_FILE_LOGGING=true" >> .env.production
echo "QUALITY_GATE_THRESHOLD=0.90" >> .env.production
echo "MAX_CONCURRENCY=20" >> .env.production
echo "ENABLE_ANALYTICS=true" >> .env.production

# Set up log rotation
mkdir -p /var/log/hierarchical-agent
sudo chown $USER:$USER /var/log/hierarchical-agent
echo "LOG_DIR=/var/log/hierarchical-agent" >> .env.production
```

## Docker Installation

### Using Pre-built Image

```bash
# Pull the official image
docker pull caiadev/hierarchical-agent-system:latest

# Run with environment file
docker run -d \
  --name hierarchical-agent \
  --env-file .env \
  -p 3000:3000 \
  caiadev/hierarchical-agent-system:latest
```

### Build Custom Image

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build application
RUN npm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S hierarchical -u 1001

# Switch to non-root user
USER hierarchical

EXPOSE 3000

CMD ["npm", "start"]
```

```bash
# Build and run
docker build -t my-hierarchical-agent .
docker run -d --name my-agent --env-file .env -p 3000:3000 my-hierarchical-agent
```

## Kubernetes Deployment

### Create ConfigMap

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: hierarchical-agent-config
data:
  LOG_LEVEL: "info"
  ENABLE_ANALYTICS: "true"
  MAX_CONCURRENCY: "15"
  QUALITY_GATE_THRESHOLD: "0.85"
```

### Create Secret

```yaml
# k8s/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: hierarchical-agent-secrets
type: Opaque
stringData:
  JIRA_HOST_URL: "https://company.atlassian.net"
  JIRA_USERNAME: "service@company.com"
  JIRA_API_TOKEN: "your-jira-token"
  GITHUB_TOKEN: "your-github-token"
```

### Create Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hierarchical-agent
spec:
  replicas: 3
  selector:
    matchLabels:
      app: hierarchical-agent
  template:
    metadata:
      labels:
        app: hierarchical-agent
    spec:
      containers:
      - name: hierarchical-agent
        image: caiadev/hierarchical-agent-system:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: hierarchical-agent-config
        - secretRef:
            name: hierarchical-agent-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

## Verification and Testing

### System Health Check

```bash
# Check overall system status
caia-hierarchical status

# Validate configuration
caia-hierarchical config --validate

# Run integration tests
caia-hierarchical test --integration

# Check component connectivity
caia-hierarchical test --jira --github
```

### Performance Test

```bash
# Run performance benchmarks
caia-hierarchical test --performance

# Test with sample project
caia-hierarchical process "Build a simple web application" \
  --project "TEST" \
  --verbose
```

### Log Analysis

```bash
# View recent logs
tail -f ./logs/hierarchical-agent.log

# Check for errors
grep ERROR ./logs/hierarchical-agent.log

# Monitor performance metrics
grep "performance:metrics" ./logs/hierarchical-agent.log
```

## Troubleshooting

### Common Installation Issues

**Node.js Version Mismatch**
```bash
# Check Node.js version
node --version

# Update Node.js (using nvm)
nvm install 20
nvm use 20

# Or update npm
npm install -g npm@latest
```

**Permission Issues (Global Install)**
```bash
# Fix npm permissions (Linux/macOS)
sudo chown -R $USER /usr/local/lib/node_modules

# Or use npx instead
npx {{ site.npm_package }} --version
```

**Missing Dependencies**
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Configuration Issues

**JIRA Authentication Failed**
```bash
# Verify credentials
curl -u $JIRA_USERNAME:$JIRA_API_TOKEN \
  $JIRA_HOST_URL/rest/api/3/myself

# Check API token permissions
# Ensure token has proper scopes in Atlassian account
```

**GitHub Rate Limiting**
```bash
# Check rate limit status
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit

# Wait for reset or upgrade to GitHub Pro
```

**Intelligence Hub Errors**
```bash
# Check directory permissions
ls -la ./intelligence-data

# Create directory if missing
mkdir -p ./intelligence-data
chmod 755 ./intelligence-data
```

## Performance Optimization

### System Tuning

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Enable multi-core processing
export UV_THREADPOOL_SIZE=16

# Optimize for production
export NODE_ENV=production
```

### Configuration Optimization

```json
{
  "orchestration": {
    "maxConcurrency": 20,
    "enableQualityGates": true,
    "retryAttempts": 3,
    "timeoutMs": 300000
  },
  "taskDecomposer": {
    "maxReworkCycles": 3,
    "qualityGateThreshold": 0.85
  },
  "logging": {
    "level": "warn",
    "enableFileLogging": true
  }
}
```

## Next Steps

After successful installation:

1. **[Complete the Getting Started guide](../getting-started)** for your first project
2. **[Configure JIRA integration](jira-integration)** for advanced features
3. **[Explore examples](../examples/basic-usage)** for real-world usage patterns
4. **[Review API documentation](../api/)** for programmatic integration
5. **[Join the community](../support)** for support and best practices

---

**Need help?** Check our [support resources](../support) or join our [Discord community]({{ site.discord_invite }}).