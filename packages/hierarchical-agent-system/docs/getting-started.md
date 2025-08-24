---
layout: default
title: Getting Started
description: Quick start guide to get up and running with the Hierarchical Agent System in minutes
---

# Getting Started

Welcome to the **Hierarchical Agent System**! This guide will have you up and running in under 5 minutes, transforming ideas into structured project hierarchies with AI-powered intelligence.

## What You'll Build

By the end of this guide, you'll have:
- ✅ A fully configured Hierarchical Agent System
- ✅ Your first AI-generated project hierarchy
- ✅ Optional JIRA integration with created issues
- ✅ Understanding of the 7-level decomposition process

## Prerequisites

Before we begin, ensure you have:
- **Node.js 18+** installed ([Download here](https://nodejs.org/))
- **npm 8+** (comes with Node.js)
- Optional: JIRA account for integration
- Optional: GitHub account for enhanced analysis

## Step 1: Installation

Install the Hierarchical Agent System globally for CLI access:

```bash
npm install -g @caia/hierarchical-agent-system
```

**Verify installation:**

```bash
caia-hierarchical --version
# Should output: 1.0.0
```

## Step 2: Project Initialization

Navigate to your project directory and initialize the system:

```bash
# Create a new project directory (optional)
mkdir my-project
cd my-project

# Initialize the hierarchical agent system
caia-hierarchical init
```

You'll be prompted to configure:
- **Project name** (defaults to current directory name)
- **JIRA integration** (optional but recommended)
- **GitHub integration** (optional for enhanced analysis)

**Example interaction:**
```
? Project name: My Enterprise Project
? Enable JIRA integration? Yes
? JIRA host URL: https://mycompany.atlassian.net
? Enable GitHub integration? Yes
✓ Configuration saved to hierarchical-config.json
✓ Environment template saved to .env.example
```

## Step 3: Environment Configuration

Copy the generated environment template and add your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:

```bash
# GitHub Integration (optional - enhances analysis)
GITHUB_TOKEN=github_pat_your_token_here

# JIRA Integration (optional - enables issue creation)
JIRA_HOST_URL=https://your-domain.atlassian.net
JIRA_USERNAME=your-email@company.com
JIRA_API_TOKEN=your_jira_api_token

# Intelligence Hub Configuration
INTELLIGENCE_ROOT=./intelligence-data
```

<div class="tip">
<strong>💡 Tip:</strong> You can run the system without any integrations for basic decomposition functionality.
</div>

## Step 4: Your First Project

Let's process your first idea into a structured hierarchy:

```bash
caia-hierarchical process "Build a mobile app for food delivery with real-time tracking"
```

**With additional context and JIRA creation:**

```bash
caia-hierarchical process "Build a mobile app for food delivery with real-time tracking" \
  --context "Target market: urban professionals, iOS and Android platforms, integration with payment gateways" \
  --project "FOOD" \
  --create-jira \
  --output my-project-results.json
```

## Expected Output

You'll see a comprehensive breakdown like this:

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
  2. [MEDIUM] Plan for API rate limiting in real-time tracking
  3. [LOW] Design for offline functionality
  4. [HIGH] Implement comprehensive error handling
  5. [MEDIUM] Set up monitoring and analytics

✓ Results saved to my-project-results.json
```

## Understanding the 7-Level Hierarchy

Your idea gets broken down into:

1. **Initiative** - Strategic business objective
2. **Epic** - Major feature areas
3. **Story** - User-facing functionality
4. **Task** - Implementation work items
5. **Subtask** - Specific development activities
6. **Component** - Technical components
7. **Atomic Unit** - Individual code elements

Example for "Food Delivery App":
```
Initiative: Food Delivery Platform (FOOD-1)
├── Epic: User Management System (FOOD-2)
│   ├── Story: User Registration and Login (FOOD-3)
│   │   ├── Task: Design registration flow (FOOD-4)
│   │   ├── Task: Implement authentication API (FOOD-5)
│   │   └── Task: Create login UI components (FOOD-6)
├── Epic: Real-time Order Tracking (FOOD-7)
└── Epic: Payment Processing (FOOD-8)
```

## Checking System Status

Verify everything is working correctly:

```bash
caia-hierarchical status
```

Expected output:
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
```

## Next Steps

Now that you have the basics working:

### 🔗 **Set Up Integrations**
- [JIRA Integration Guide](guides/jira-integration) - Connect to your JIRA instance
- [GitHub Integration](guides/github-integration) - Enhance analysis with repository data

### 📚 **Explore Advanced Features**
- [API Reference](api/) - Use the system programmatically
- [CLI Guide](reference/cli) - Master all CLI commands
- [Configuration Guide](guides/configuration) - Customize for your needs

### 💡 **Try More Examples**
- [Enterprise Project Setup](examples/enterprise-project) - Large scale project planning
- [Microservices Architecture](examples/microservices) - Complex system decomposition
- [Team Collaboration](examples/team-workflow) - Multi-team project coordination

## Common Issues & Solutions

### "System initialization failed"
- **Cause**: Missing or invalid configuration
- **Solution**: Run `caia-hierarchical config --validate` to check your setup

### "JIRA connection failed"
- **Cause**: Invalid JIRA credentials or network issues
- **Solution**: Verify credentials in `.env` and check JIRA permissions

### "Low confidence scores (<85%)"
- **Cause**: Vague or incomplete project descriptions
- **Solution**: Provide more context and specific requirements

### "No GitHub token provided"
- **Cause**: Missing GitHub integration (optional)
- **Solution**: Add `GITHUB_TOKEN` to `.env` or run without GitHub features

## Getting Help

If you encounter issues:

1. **Check our FAQ**: Common questions and solutions
2. **Join our Discord**: Real-time community support
3. **GitHub Issues**: Report bugs or request features
4. **Documentation**: Comprehensive guides and references

<div class="help-links">
  <a href="{{ site.discord_invite }}" class="btn btn-primary">Join Discord</a>
  <a href="{{ site.github_repo }}/issues" class="btn btn-secondary">Report Issue</a>
  <a href="support" class="btn btn-outline">View Support Options</a>
</div>

## What's Next?

You're now ready to:
- **Scale up** with enterprise-grade configurations
- **Integrate** with your existing development workflow
- **Customize** decomposition rules for your domain
- **Collaborate** with your team using shared configurations

Continue your journey:

<div class="next-steps">
  <div class="step">
    <h3><a href="guides/installation">📦 Complete Installation Guide</a></h3>
    <p>Learn about advanced installation options, Docker deployment, and enterprise setup</p>
  </div>
  
  <div class="step">
    <h3><a href="api/">🔧 API Integration</a></h3>
    <p>Integrate the system into your applications using our comprehensive API</p>
  </div>
  
  <div class="step">
    <h3><a href="examples/basic-usage">💼 Real-world Examples</a></h3>
    <p>Explore practical examples from actual enterprise implementations</p>
  </div>
</div>

---

<div class="success-banner">
  <h2>🎉 Congratulations!</h2>
  <p>You've successfully set up the Hierarchical Agent System and processed your first project. You're now part of a revolution in AI-powered project management that's helping teams worldwide achieve 20x faster planning with superior quality.</p>
</div>