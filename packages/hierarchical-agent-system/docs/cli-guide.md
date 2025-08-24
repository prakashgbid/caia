---
layout: default
title: CLI Guide
description: Complete command-line interface guide for the Hierarchical Agent System CLI
---

# CLI Guide

The `caia-hierarchical` CLI provides powerful command-line tools for project decomposition, JIRA integration, and system management. This guide covers all commands, options, and advanced usage patterns.

## Installation

First, install the CLI globally:

```bash
npm install -g @caia/hierarchical-agent-system
```

Verify installation:

```bash
caia-hierarchical --version
# Output: 1.0.0
```

## Global Options

These options are available for all commands:

```bash
caia-hierarchical [command] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-v, --verbose` | Enable verbose output | `false` |
| `-c, --config <file>` | Specify configuration file | `hierarchical-config.json` |
| `--work-dir <dir>` | Set working directory | Current directory |
| `-h, --help` | Show help information | - |
| `--version` | Show version number | - |

## Commands

### `init` - Initialize Project

Initialize a new hierarchical agent system project with interactive configuration.

```bash
caia-hierarchical init [options]
```

**Options:**
- `-f, --force` - Overwrite existing configuration

**Interactive Configuration:**

```bash
caia-hierarchical init

# Interactive prompts:
? Project name: My Enterprise Project
? Enable JIRA integration? Yes
? JIRA host URL: https://mycompany.atlassian.net
? Enable GitHub integration? Yes

✓ Configuration saved to hierarchical-config.json
✓ Environment template saved to .env.example
```

**Generated Files:**
- `hierarchical-config.json` - Project configuration
- `.env.example` - Environment variables template

**Example Configuration:**
```json
{
  "projectName": "My Enterprise Project",
  "taskDecomposer": {
    "enableHierarchicalDecomposition": true,
    "maxDepth": 7,
    "qualityGateThreshold": 0.85
  },
  "jiraConnect": {
    "hostUrl": "https://mycompany.atlassian.net",
    "enableAdvancedRoadmaps": true
  },
  "intelligence": {
    "enableAnalytics": true,
    "confidenceThreshold": 0.85
  }
}
```

### `process` - Process Ideas

Transform ideas into structured hierarchical task breakdowns with optional JIRA integration.

```bash
caia-hierarchical process <idea> [options]
```

**Arguments:**
- `<idea>` - Project description or idea to process (required)

**Options:**
- `-c, --context <context>` - Additional project context
- `-p, --project <key>` - JIRA project key for issue creation
- `-j, --create-jira` - Create issues in JIRA
- `-o, --output <file>` - Save results to JSON file

#### Basic Usage

```bash
# Simple idea processing
caia-hierarchical process "Build a mobile app for food delivery"
```

#### With Context

```bash
caia-hierarchical process "E-commerce recommendation engine" \
  --context "Machine learning, real-time processing, 1M+ users, microservices architecture" \
  --project "ECOM"
```

#### Full JIRA Integration

```bash
caia-hierarchical process "Customer support chatbot with AI" \
  --context "Natural language processing, integration with existing CRM, 24/7 availability" \
  --project "CHAT" \
  --create-jira \
  --output chatbot-project.json
```

**Expected Output:**
```
🚀 CAIA Hierarchical Agent System
   7-level task decomposition with quality gates

Processing Results:
==================================================

📋 Hierarchical Breakdown:
  • 1 Initiatives
  • 3 Epics  
  • 12 Stories
  • 35 Tasks
  • 78 Subtasks
  • Confidence Score: 92%

🧠 Intelligence Analysis:
  • Overall Confidence: 89%
  • Risk Items: 3
  • Risk Level: Medium
  • Success Probability: 87%

🎯 JIRA Integration:
  • Created Issues: 129
  • Errors: 0

💡 Recommendations:
  1. [HIGH] Consider implementing user authentication early
  2. [MEDIUM] Plan for API rate limiting
  3. [LOW] Design for offline functionality

✓ Results saved to chatbot-project.json
```

### `status` - System Status

Check the health and status of all system components.

```bash
caia-hierarchical status
```

**Output Example:**
```
System Status:
===============
Overall: HEALTHY

┌─────────────────┬─────────────┬─────────────────┐
│ Component       │ Status      │ Details         │
├─────────────────┼─────────────┼─────────────────┤
│ taskDecomposer  │ ✓ healthy   │ OK              │
│ jiraConnect     │ ✓ healthy   │ OK              │ 
│ intelligenceHub │ ✓ healthy   │ OK              │
│ orchestrator    │ ✓ healthy   │ OK              │
│ integrations    │ ✓ healthy   │ OK              │
└─────────────────┴─────────────┴─────────────────┘

Last check: 2024-01-15T10:30:45Z
System uptime: 2 hours, 15 minutes
```

**Status Indicators:**
- ✓ **healthy** - Component operating normally
- ⚠ **degraded** - Component has issues but still functional
- ✗ **unhealthy** - Component not functioning

### `test` - Run Tests

Execute system tests to verify functionality and integrations.

```bash
caia-hierarchical test [options]
```

**Options:**
- `-s, --suite <name>` - Run specific test suite
- `-i, --integration` - Run integration tests
- `--timeout <ms>` - Set test timeout (default: 30000ms)

#### Run All Tests

```bash
caia-hierarchical test
```

#### Integration Tests Only

```bash
caia-hierarchical test --integration
```

#### Specific Test Suite

```bash
caia-hierarchical test --suite decomposition
caia-hierarchical test --suite jira-integration
caia-hierarchical test --suite intelligence
```

**Test Output:**
```
Test Results:
========================================
Total Tests: 47
Passed: 45
Failed: 2
Success Rate: 96%
Duration: 12,345ms

Failed Tests:
• jira-integration/bulk-creation: Timeout
• intelligence/risk-assessment: API error

Overall: PASSED (with warnings)
```

### `config` - Configuration Management

Manage system configuration and validate settings.

```bash
caia-hierarchical config [options]
```

**Options:**
- `--show` - Display current configuration
- `--validate` - Validate configuration and connections
- `--edit` - Open configuration in default editor
- `--reset` - Reset to default configuration

#### Show Configuration

```bash
caia-hierarchical config --show
```

```json
{
  "projectName": "My Project",
  "taskDecomposer": {
    "enableHierarchicalDecomposition": true,
    "maxDepth": 7,
    "qualityGateThreshold": 0.85
  },
  "jiraConnect": {
    "hostUrl": "https://company.atlassian.net",
    "enableAdvancedRoadmaps": true
  }
}
```

#### Validate Configuration

```bash
caia-hierarchical config --validate

✓ Configuration file found
✓ Required fields present
✓ JIRA connection successful
✓ GitHub token valid
✓ Intelligence hub initialized

Configuration is valid
```

## Advanced Usage

### Environment Variables

Configure sensitive information through environment variables:

```bash
export JIRA_HOST_URL="https://company.atlassian.net"
export JIRA_USERNAME="user@company.com" 
export JIRA_API_TOKEN="your-api-token"
export GITHUB_TOKEN="github_pat_your_token"

# Run with environment variables
caia-hierarchical process "Your idea" --create-jira
```

### Configuration File

Create custom configuration files for different environments:

```bash
# Development environment
caia-hierarchical --config dev-config.json process "Test idea"

# Production environment  
caia-hierarchical --config prod-config.json process "Production idea"
```

**dev-config.json:**
```json
{
  "projectName": "Development Environment",
  "taskDecomposer": {
    "qualityGateThreshold": 0.75,
    "maxReworkCycles": 2
  },
  "intelligence": {
    "enableAnalytics": false
  },
  "logging": {
    "level": "debug"
  }
}
```

### Batch Processing

Process multiple ideas using shell scripting:

```bash
#!/bin/bash
# process-batch.sh

ideas=(
  "Build a customer dashboard"
  "Create API gateway"
  "Implement user authentication"  
  "Set up monitoring system"
)

for idea in "${ideas[@]}"; do
  echo "Processing: $idea"
  caia-hierarchical process "$idea" \
    --project "BATCH" \
    --create-jira \
    --output "results-$(date +%s).json"
  echo "---"
done
```

### Pipeline Integration

Integrate with CI/CD pipelines:

```yaml
# .github/workflows/project-planning.yml
name: Automated Project Planning

on:
  issues:
    types: [opened, labeled]

jobs:
  process-idea:
    if: contains(github.event.issue.labels.*.name, 'project-idea')
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
    
    - name: Install Hierarchical Agent System
      run: npm install -g @caia/hierarchical-agent-system
    
    - name: Process Project Idea
      run: |
        caia-hierarchical process "${{ github.event.issue.title }}" \
          --context "${{ github.event.issue.body }}" \
          --project "AUTO" \
          --create-jira \
          --output project-results.json
      env:
        JIRA_HOST_URL: ${{ secrets.JIRA_HOST_URL }}
        JIRA_USERNAME: ${{ secrets.JIRA_USERNAME }}
        JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
    
    - name: Comment on Issue
      uses: actions/github-script@v6
      with:
        script: |
          const fs = require('fs');
          const results = JSON.parse(fs.readFileSync('project-results.json', 'utf8'));
          
          const comment = `
          ## 🤖 Automated Project Analysis Complete
          
          **Hierarchical Breakdown:**
          - Initiatives: ${results.decomposition.initiatives.length}
          - Epics: ${results.decomposition.epics.length}  
          - Stories: ${results.decomposition.stories.length}
          - Confidence Score: ${Math.round(results.decomposition.confidenceScore * 100)}%
          
          **Success Probability:** ${Math.round(results.analysis.success_predictions.overall_success_probability * 100)}%
          
          **JIRA Issues Created:** ${results.jiraResults?.created_issues?.length || 0}
          `;
          
          github.rest.issues.createComment({
            issue_number: context.issue.number,
            owner: context.repo.owner,
            repo: context.repo.repo,
            body: comment
          });
```

## Error Handling

### Common Error Messages

#### Configuration Errors

```bash
# Missing configuration
✗ Configuration file not found. Run 'caia-hierarchical init' first.

# Invalid JIRA credentials
✗ JIRA connection failed: Authentication failed

# Missing required fields
✗ Configuration validation failed: Missing required field 'jiraConnect.hostUrl'
```

#### Processing Errors

```bash
# Low confidence score
⚠ Quality gate warning: Confidence score 78% below threshold 85%
Recommendation: Provide more detailed context or requirements

# API rate limiting
✗ Processing failed: GitHub API rate limit exceeded
Recommendation: Use GitHub App token or wait for rate limit reset

# JIRA creation failed
⚠ JIRA integration: 3 issues failed to create
Check JIRA permissions and project configuration
```

### Debugging

Enable verbose output for troubleshooting:

```bash
# Verbose output
caia-hierarchical --verbose process "Debug this idea"

# Debug-level logging
LOG_LEVEL=debug caia-hierarchical process "Your idea"
```

**Verbose Output Example:**
```
[DEBUG] Loading configuration from hierarchical-config.json
[DEBUG] Initializing TaskDecomposer with maxDepth=7
[DEBUG] Connecting to JIRA at https://company.atlassian.net
[INFO] Starting decomposition for: "Build a mobile app"
[DEBUG] Processing level 1: Initiatives
[DEBUG] Generated 1 initiatives with confidence 0.92
[DEBUG] Processing level 2: Epics
[DEBUG] Generated 3 epics with confidence 0.88
[INFO] Decomposition completed successfully
```

## Output Formats

### JSON Output

Save structured results for programmatic processing:

```bash
caia-hierarchical process "Your idea" --output results.json
```

**results.json structure:**
```json
{
  "metadata": {
    "processedAt": "2024-01-15T10:30:45Z",
    "idea": "Build a mobile app for food delivery",
    "processingTimeMs": 45230,
    "version": "1.0.0"
  },
  "decomposition": {
    "initiatives": [...],
    "epics": [...],
    "stories": [...],
    "tasks": [...],
    "confidenceScore": 0.92
  },
  "analysis": {
    "risk_assessment": {...},
    "success_predictions": {...},
    "recommendations": [...]
  },
  "jiraResults": {
    "created_issues": [...],
    "summary": {...}
  }
}
```

### CSV Export

Export hierarchical data to CSV for spreadsheet analysis:

```bash
# Using jq to convert JSON to CSV
caia-hierarchical process "Your idea" --output results.json
jq -r '.decomposition.stories[] | [.id, .title, .estimatedStoryPoints] | @csv' results.json > stories.csv
```

## Best Practices

### Project Organization

```bash
# Organize by project
mkdir my-projects
cd my-projects

# Initialize project-specific configuration
caia-hierarchical init
cp .env.example .env
# Edit .env with project-specific credentials

# Process related ideas
caia-hierarchical process "Core platform features" --project "CORE" --output core-results.json
caia-hierarchical process "Mobile application" --project "MOBILE" --output mobile-results.json
caia-hierarchical process "Admin dashboard" --project "ADMIN" --output admin-results.json
```

### Team Collaboration

```bash
# Shared configuration in version control
git add hierarchical-config.json
git commit -m "Add hierarchical agent system configuration"

# Environment-specific overrides (don't commit .env)
echo ".env" >> .gitignore

# Team members can use the same configuration
git clone project-repo
cd project-repo
cp .env.example .env
# Edit .env with personal credentials
```

### Automation Scripts

Create reusable scripts for common workflows:

**scripts/process-epic.sh:**
```bash
#!/bin/bash
set -e

EPIC_IDEA="$1"
PROJECT_KEY="$2"
OUTPUT_DIR="${3:-./results}"

if [ -z "$EPIC_IDEA" ] || [ -z "$PROJECT_KEY" ]; then
  echo "Usage: $0 <epic-idea> <project-key> [output-dir]"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Processing epic: $EPIC_IDEA"
caia-hierarchical process "$EPIC_IDEA" \
  --project "$PROJECT_KEY" \
  --create-jira \
  --output "$OUTPUT_DIR/epic-$(date +%Y%m%d-%H%M%S).json"

echo "Epic processing complete"
```

**Usage:**
```bash
chmod +x scripts/process-epic.sh
./scripts/process-epic.sh "User management system" "USER" ./results
```

## Integration Examples

### Slack Integration

Send results to Slack channel:

```bash
# process-and-notify.sh
#!/bin/bash

IDEA="$1"
SLACK_WEBHOOK="$2"

# Process idea
caia-hierarchical process "$IDEA" --output temp-results.json

# Extract key metrics
EPICS=$(jq '.decomposition.epics | length' temp-results.json)
CONFIDENCE=$(jq '.decomposition.confidenceScore * 100 | round' temp-results.json)

# Send to Slack
curl -X POST -H 'Content-type: application/json' \
  --data "{\"text\":\"🚀 Project processed: $IDEA\\nEpics: $EPICS\\nConfidence: $CONFIDENCE%\"}" \
  "$SLACK_WEBHOOK"

rm temp-results.json
```

### Database Integration

Store results in database:

```bash
# process-to-database.sh
#!/bin/bash

caia-hierarchical process "$1" --output temp-results.json

# Use jq and psql to insert into PostgreSQL
jq -c '.decomposition.stories[]' temp-results.json | while read story; do
  psql -d project_db -c "
    INSERT INTO stories (id, title, description, story_points) 
    VALUES (
      '$(echo $story | jq -r .id)',
      '$(echo $story | jq -r .title)',
      '$(echo $story | jq -r .description)',
      $(echo $story | jq -r .estimatedStoryPoints)
    )
  "
done

rm temp-results.json
```

## Troubleshooting

### Performance Optimization

```bash
# Increase processing concurrency
MAX_CONCURRENCY=20 caia-hierarchical process "Large project"

# Reduce quality threshold for faster processing
caia-hierarchical --config fast-config.json process "Quick idea"
```

**fast-config.json:**
```json
{
  "taskDecomposer": {
    "qualityGateThreshold": 0.75,
    "maxReworkCycles": 1
  },
  "orchestration": {
    "maxConcurrency": 5,
    "enableQualityGates": false
  }
}
```

### Memory Management

```bash
# Monitor memory usage
NODE_OPTIONS="--max-old-space-size=4096" caia-hierarchical process "Large project"

# Process in smaller chunks for very large projects
caia-hierarchical process "Core features only" --output core.json
caia-hierarchical process "Additional features" --output additional.json
```

### Logging and Debugging

```bash
# Enable detailed logging
export LOG_LEVEL=debug
export ENABLE_FILE_LOGGING=true
export LOG_DIR=./logs

caia-hierarchical process "Debug this project"

# Check logs
tail -f logs/hierarchical-agent.log
```

## Help and Support

### Built-in Help

```bash
# General help
caia-hierarchical --help

# Command-specific help
caia-hierarchical process --help
caia-hierarchical init --help
caia-hierarchical test --help
```

### Version Information

```bash
# Show version
caia-hierarchical --version

# Show detailed version info
caia-hierarchical --version --verbose
```

### Community Support

- 📖 [Documentation](/)
- 💬 [Discord Community]({{ site.discord_invite }})
- 🐛 [GitHub Issues]({{ site.github_repo }}/issues)
- 📧 [Email Support](mailto:support@caia.dev)

---

The CLI provides a powerful interface for automating project decomposition and integrating with your existing development workflows. For more advanced programmatic usage, see the [API Reference](api-reference).