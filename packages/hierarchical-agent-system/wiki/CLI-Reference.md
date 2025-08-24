# CLI Reference

Complete command-line interface documentation for the CAIA Hierarchical Agent System.

---

## 📚 Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Global Commands](#global-commands)
3. [Project Processing](#project-processing)
4. [Configuration Commands](#configuration-commands)
5. [Testing & Validation](#testing--validation)
6. [System Management](#system-management)
7. [Examples & Workflows](#examples--workflows)
8. [Troubleshooting](#troubleshooting)

---

## Installation & Setup

### Install the CLI
```bash
# Install globally
npm install -g @caia/hierarchical-agent-system

# Verify installation
caia-hierarchical --version
# Output: 1.0.0

# Show help
caia-hierarchical --help
```

### First-time Setup
```bash
# Interactive setup wizard
caia-hierarchical init

# Quick setup with defaults
caia-hierarchical init --quick

# Setup with specific configuration
caia-hierarchical init --config ./my-config.json
```

---

## Global Commands

### `caia-hierarchical --help`

Displays comprehensive help information.

```bash
caia-hierarchical --help

# Output:
# CAIA Hierarchical Agent System v1.0.0
# Transform ideas into structured JIRA hierarchies with 7-level task decomposition
#
# Usage:
#   caia-hierarchical <command> [options]
#
# Commands:
#   init            Initialize project configuration
#   process         Process project idea into hierarchical structure
#   status          Check system health and configuration
#   config          Manage configuration settings
#   test            Run system tests and validations
#   analyze         Analyze existing project or hierarchy
#   export          Export results in various formats
#   import          Import project data from external sources
#
# Global Options:
#   --version, -v   Show version number
#   --help, -h      Show help information
#   --config, -c    Specify configuration file path
#   --quiet, -q     Suppress non-essential output
#   --verbose       Enable verbose logging
#   --debug         Enable debug mode
```

### `caia-hierarchical --version`

Displays version information.

```bash
caia-hierarchical --version
# Output: 1.0.0

# Detailed version info
caia-hierarchical --version --verbose
# Output:
# CAIA Hierarchical Agent System
# Version: 1.0.0
# Node.js: v18.17.0
# Platform: darwin x64
# Installation: /usr/local/lib/node_modules/@caia/hierarchical-agent-system
```

---

## Project Processing

### `caia-hierarchical process`

Main command for processing project ideas into hierarchical structures.

#### Basic Usage
```bash
# Simple processing
caia-hierarchical process "Build a todo application with user authentication"

# With context
caia-hierarchical process "E-commerce platform" \
  --context "React frontend, Node.js backend, PostgreSQL database, payment integration"

# Specify project key
caia-hierarchical process "Customer dashboard" --project "DASH"
```

#### Advanced Options
```bash
caia-hierarchical process [idea] [options]

Options:
  --context, -x     Additional project context
  --project, -p     JIRA project key
  --create-jira     Create JIRA issues (requires JIRA configuration)
  --output, -o      Output file path (JSON format)
  --format, -f      Output format: json, yaml, xml, csv
  --template, -t    Use predefined template
  --team-size       Team size (affects estimation)
  --timeline        Project timeline in months
  --budget          Project budget
  --experience      Team experience level: junior, intermediate, senior, expert
  --priority        Default priority: low, medium, high, critical
  --labels          Default labels (comma-separated)
  --dry-run         Process without creating JIRA issues
  --quality-gate    Quality gate threshold (0.0-1.0)
  --max-depth       Maximum decomposition depth
  --parallel        Enable parallel processing
  --cache           Enable result caching
  --force           Override existing output files
```

#### Examples
```bash
# Comprehensive project processing
caia-hierarchical process "Build a microservices-based e-commerce platform" \
  --context "Node.js, React, Docker, Kubernetes, PostgreSQL, Redis" \
  --project "ECOM" \
  --create-jira \
  --output "ecommerce-project.json" \
  --team-size 12 \
  --timeline 6 \
  --experience "senior" \
  --priority "high" \
  --labels "ecommerce,microservices,strategic"

# Quick processing with template
caia-hierarchical process "Mobile banking app" \
  --template "mobile-app" \
  --project "BANK" \
  --create-jira

# Processing with custom quality gates
caia-hierarchical process "AI recommendation engine" \
  --quality-gate 0.90 \
  --max-depth 6 \
  --parallel

# Dry run (no JIRA creation)
caia-hierarchical process "Data pipeline" \
  --project "DATA" \
  --dry-run \
  --output "data-pipeline-preview.json"
```

#### Output Formats
```bash
# JSON output (default)
caia-hierarchical process "API gateway" -o results.json

# YAML output
caia-hierarchical process "API gateway" -f yaml -o results.yaml

# CSV export for spreadsheet analysis
caia-hierarchical process "API gateway" -f csv -o results.csv

# Multiple formats
caia-hierarchical process "API gateway" -f json,yaml,csv -o results
# Creates: results.json, results.yaml, results.csv
```

---

## Configuration Commands

### `caia-hierarchical init`

Initializes project configuration with interactive setup.

```bash
# Interactive setup wizard
caia-hierarchical init

# Quick setup with defaults
caia-hierarchical init --quick

# Setup with custom configuration file
caia-hierarchical init --config ./custom-config.json

# Setup for specific environment
caia-hierarchical init --env production

# Minimal setup (CLI only, no integrations)
caia-hierarchical init --minimal
```

#### Interactive Setup Flow
```bash
caia-hierarchical init

# Prompts:
# ? Welcome to CAIA Hierarchical Agent System setup!
# ? Do you want to configure JIRA integration? (Y/n) y
# ? JIRA Host URL: https://company.atlassian.net
# ? JIRA Username: pm@company.com
# ? JIRA API Token: [hidden]
# ? Test JIRA connection? (Y/n) y
# ✓ JIRA connection successful!
# ? Configure GitHub integration? (y/N) y
# ? GitHub Token: [hidden]
# ? Test GitHub connection? (Y/n) y
# ✓ GitHub connection successful!
# ? Quality gate threshold (0.0-1.0): 0.85
# ? Maximum decomposition depth: 7
# ? Enable analytics? (Y/n) y
# ? Log level (debug/info/warn/error): info
# ✓ Configuration saved to ~/.config/caia-hierarchical/config.json
```

### `caia-hierarchical config`

Manages configuration settings.

```bash
# Show current configuration
caia-hierarchical config show

# Show specific configuration section
caia-hierarchical config show --section jira
caia-hierarchical config show --section intelligence

# Set configuration values
caia-hierarchical config set jira.hostUrl "https://new-domain.atlassian.net"
caia-hierarchical config set quality.threshold 0.90
caia-hierarchical config set logging.level debug

# Validate configuration
caia-hierarchical config validate

# Reset configuration to defaults
caia-hierarchical config reset

# Export configuration
caia-hierarchical config export --output config-backup.json

# Import configuration
caia-hierarchical config import --file config-backup.json
```

#### Configuration File Locations
```bash
# View configuration paths
caia-hierarchical config paths

# Output:
# Global config: ~/.config/caia-hierarchical/config.json
# Project config: ./hierarchical-config.json
# Environment config: ./.env
# Override order: CLI args > Project > Environment > Global
```

---

## Testing & Validation

### `caia-hierarchical test`

Runs comprehensive system tests and validations.

```bash
# Run all tests
caia-hierarchical test

# Run specific test suites
caia-hierarchical test --unit          # Unit tests only
caia-hierarchical test --integration   # Integration tests only
caia-hierarchical test --jira          # JIRA integration tests
caia-hierarchical test --github        # GitHub integration tests
caia-hierarchical test --performance   # Performance benchmarks

# Test with specific configuration
caia-hierarchical test --config ./test-config.json

# Verbose test output
caia-hierarchical test --verbose

# Test specific components
caia-hierarchical test --component task-decomposer
caia-hierarchical test --component intelligence-hub
caia-hierarchical test --component jira-connect
```

#### Test Categories
```bash
# System health check
caia-hierarchical test --health
# Output:
# ✓ Node.js version compatible (18.17.0)
# ✓ Required dependencies available
# ✓ Configuration valid
# ✓ Disk space sufficient (2.1 GB available)
# ✓ Network connectivity

# Integration connectivity tests  
caia-hierarchical test --connectivity
# Output:
# ✓ JIRA API accessible (200ms response)
# ✓ GitHub API accessible (150ms response)
# ✗ OpenAI API timeout (check network/keys)

# Performance benchmarks
caia-hierarchical test --benchmark
# Output:
# Task Decomposition: 1,247ms (target: <2,000ms) ✓
# Intelligence Analysis: 892ms (target: <1,500ms) ✓
# JIRA Issue Creation: 345ms (target: <1,000ms) ✓
# End-to-End Processing: 3,124ms (target: <5,000ms) ✓
```

---

## System Management

### `caia-hierarchical status`

Displays comprehensive system health and status information.

```bash
# Basic status
caia-hierarchical status

# Detailed status with component breakdown
caia-hierarchical status --detailed

# Status in JSON format
caia-hierarchical status --json

# Watch mode (refresh every 5 seconds)
caia-hierarchical status --watch

# Status with performance metrics
caia-hierarchical status --metrics
```

#### Status Output Example
```bash
caia-hierarchical status

# Output:
# CAIA Hierarchical Agent System Status
# =====================================
# 
# Overall Status: HEALTHY ✓
# Version: 1.0.0
# Uptime: 2h 15m 32s
# 
# ┌─────────────────┬─────────────┬─────────────────┬─────────────────┐
# │ Component       │ Status      │ Last Check      │ Details         │
# ├─────────────────┼─────────────┼─────────────────┼─────────────────┤
# │ Task Decomposer │ ✓ Healthy   │ 2s ago         │ Ready           │
# │ JIRA Connect    │ ✓ Healthy   │ 5s ago         │ Connected       │
# │ Intelligence    │ ✓ Healthy   │ 3s ago         │ 847 patterns    │
# │ Orchestrator    │ ✓ Healthy   │ 1s ago         │ 3 jobs queued   │
# │ Integrations    │ ✓ Healthy   │ 4s ago         │ All services up │
# └─────────────────┴─────────────┴─────────────────┴─────────────────┘
# 
# Recent Activity:
# • 14:30:15 - Processed project "Mobile app development"
# • 14:25:22 - Created 23 JIRA issues for project MOBILE
# • 14:20:08 - Intelligence analysis completed (0.89 confidence)
# 
# Resource Usage:
# • Memory: 245 MB / 2 GB (12%)
# • CPU: 5.2% average
# • Disk: 1.2 GB available
# • Network: 25 KB/s average
```

### `caia-hierarchical analyze`

Analyzes existing projects or hierarchical structures.

```bash
# Analyze JIRA project
caia-hierarchical analyze --jira-project "ECOM"

# Analyze exported hierarchy
caia-hierarchical analyze --file "project-hierarchy.json"

# Analyze and compare with original
caia-hierarchical analyze --file "current.json" --compare "original.json"

# Generate analysis report
caia-hierarchical analyze --jira-project "DASH" --report --output "analysis-report.html"
```

### `caia-hierarchical export`

Exports project data and results in various formats.

```bash
# Export JIRA project structure
caia-hierarchical export --jira-project "ECOM" --output "ecom-export.json"

# Export with specific format
caia-hierarchical export --jira-project "ECOM" --format yaml --output "ecom-export.yaml"

# Export analysis results
caia-hierarchical export --analysis-results --project "DASH" --output "dashboard-analysis.json"

# Export system configuration
caia-hierarchical export --config --output "system-config.json"
```

### `caia-hierarchical import`

Imports project data from external sources.

```bash
# Import from JSON file
caia-hierarchical import --file "project-data.json" --project "IMPORTED"

# Import from CSV
caia-hierarchical import --csv "tasks.csv" --project "CSV-IMPORT" --create-jira

# Import from Azure DevOps export
caia-hierarchical import --azure-devops "azure-export.json" --project "AZURE"

# Import GitHub issues
caia-hierarchical import --github-repo "company/project" --project "GH-IMPORT"
```

---

## Examples & Workflows

### Complete Project Workflow

```bash
# 1. Initialize system
caia-hierarchical init --quick

# 2. Process a complex project
caia-hierarchical process "Build a comprehensive CRM system" \
  --context "Multi-tenant SaaS, React, Node.js, PostgreSQL, Elasticsearch" \
  --project "CRM" \
  --team-size 15 \
  --timeline 8 \
  --experience "senior" \
  --priority "high" \
  --create-jira \
  --output "crm-project.json" \
  --format "json,yaml,csv"

# 3. Analyze results
caia-hierarchical analyze --file "crm-project.json" --report

# 4. Check system status
caia-hierarchical status --detailed

# 5. Export for documentation
caia-hierarchical export --analysis-results --project "CRM" --output "crm-documentation.html"
```

### Batch Processing Workflow

```bash
# Process multiple projects from a file
# Create projects.txt with one idea per line:
echo "Build a real-time analytics dashboard" > projects.txt
echo "Create a mobile inventory management app" >> projects.txt
echo "Develop an API gateway for microservices" >> projects.txt

# Process all projects
while IFS= read -r idea; do
  project_key=$(echo "$idea" | sed 's/[^a-zA-Z0-9]//g' | tr '[:lower:]' '[:upper:]' | cut -c1-8)
  caia-hierarchical process "$idea" \
    --project "$project_key" \
    --create-jira \
    --output "${project_key,,}-results.json"
done < projects.txt

# Generate summary report
caia-hierarchical analyze --batch *.json --summary-report "batch-summary.html"
```

### CI/CD Integration

```bash
# Use in CI/CD pipeline
#!/bin/bash
set -e

# Validate configuration
caia-hierarchical config validate

# Run tests
caia-hierarchical test --integration --quiet

# Process project from environment variables
caia-hierarchical process "$PROJECT_IDEA" \
  --context "$PROJECT_CONTEXT" \
  --project "$JIRA_PROJECT_KEY" \
  --create-jira \
  --output "ci-results.json" \
  --quiet

# Upload results to artifact store
if [ -f "ci-results.json" ]; then
  echo "✓ Project processing completed successfully"
  # Upload to S3, Artifactory, etc.
else
  echo "✗ Project processing failed"
  exit 1
fi
```

### Development & Testing

```bash
# Development workflow
# 1. Test with minimal setup
caia-hierarchical init --minimal

# 2. Test decomposition without JIRA
caia-hierarchical process "Test project" --dry-run --output "test-results.json"

# 3. Validate results
caia-hierarchical analyze --file "test-results.json"

# 4. Performance testing
caia-hierarchical test --benchmark --verbose

# 5. Configuration testing
caia-hierarchical config validate
caia-hierarchical test --health
```

---

## Troubleshooting

### Common Issues & Solutions

#### Command Not Found
```bash
# Error: caia-hierarchical: command not found

# Solution 1: Check installation
npm list -g @caia/hierarchical-agent-system

# Solution 2: Reinstall globally
npm uninstall -g @caia/hierarchical-agent-system
npm install -g @caia/hierarchical-agent-system

# Solution 3: Check PATH
echo $PATH
npm config get prefix
```

#### Permission Issues
```bash
# Error: EACCES: permission denied

# Solution: Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH

# Then reinstall
npm install -g @caia/hierarchical-agent-system
```

#### Configuration Issues
```bash
# Error: Configuration validation failed

# Debug configuration
caia-hierarchical config show --verbose
caia-hierarchical config validate --debug

# Reset to defaults
caia-hierarchical config reset
caia-hierarchical init --quick
```

#### JIRA Connection Issues
```bash
# Error: JIRA authentication failed

# Test connection
caia-hierarchical test --jira --debug

# Check credentials
caia-hierarchical config show --section jira

# Reconfigure JIRA
caia-hierarchical config set jira.hostUrl "https://correct-domain.atlassian.net"
caia-hierarchical config set jira.username "correct-email@company.com"
# Note: API token should be set via environment variable for security
```

#### Performance Issues
```bash
# Error: Processing very slow

# Check system resources
caia-hierarchical status --metrics

# Run performance tests
caia-hierarchical test --benchmark

# Adjust configuration for performance
caia-hierarchical config set orchestration.maxConcurrency 20
caia-hierarchical config set quality.threshold 0.75  # Lower threshold for speed
```

### Debug Mode

```bash
# Enable debug logging
caia-hierarchical process "test" --debug

# Enable verbose output
caia-hierarchical status --verbose

# Check log files
tail -f ~/.config/caia-hierarchical/logs/debug.log
```

### Getting Help

```bash
# Command-specific help
caia-hierarchical process --help
caia-hierarchical config --help
caia-hierarchical test --help

# Version and diagnostic info
caia-hierarchical --version --verbose
caia-hierarchical status --detailed

# System diagnostic
caia-hierarchical test --health --verbose
```

---

## Advanced Usage

### Environment Variables

```bash
# Configuration via environment
export JIRA_HOST_URL="https://company.atlassian.net"
export JIRA_USERNAME="pm@company.com"
export JIRA_API_TOKEN="your-api-token"
export GITHUB_TOKEN="your-github-token"
export CAIA_LOG_LEVEL="debug"
export CAIA_MAX_CONCURRENCY="15"
export CAIA_QUALITY_THRESHOLD="0.90"

# Use environment configuration
caia-hierarchical process "test project" --project "TEST"
```

### Configuration Files

```bash
# Project-specific configuration: ./hierarchical-config.json
{
  "taskDecomposer": {
    "maxDepth": 6,
    "qualityGateThreshold": 0.88
  },
  "jiraConnect": {
    "enableAdvancedRoadmaps": true
  },
  "orchestration": {
    "maxConcurrency": 12
  }
}

# Use project configuration
caia-hierarchical process "project idea" --config ./hierarchical-config.json
```

### Shell Integration

```bash
# Add to .bashrc/.zshrc for aliases
alias caia="caia-hierarchical"
alias caia-quick="caia-hierarchical process --dry-run --quiet"
alias caia-status="caia-hierarchical status"

# Completion (bash)
eval "$(caia-hierarchical completion bash)"

# Completion (zsh)
eval "$(caia-hierarchical completion zsh)"
```

---

For more information and advanced usage patterns, see:
- [Examples and Tutorials](Examples-and-Tutorials)
- [Configuration Reference](Configuration-Reference) 
- [Troubleshooting Guide](Troubleshooting)
- [API Reference](API-Reference)