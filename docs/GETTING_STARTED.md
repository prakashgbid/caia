# Getting Started with CAIA

> **Chief AI Agent: The Orchestrator of Orchestrators**

CAIA is a comprehensive AI agent framework that enables the creation, orchestration, and management of specialized AI agents. This guide will help you get started with CAIA and begin building your own AI-powered solutions.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Your First Agent](#your-first-agent)
- [Working with ParaForge](#working-with-paraforge)
- [Examples](#examples)
- [Next Steps](#next-steps)

## Quick Start

### Prerequisites

- Node.js 18+ and npm 9+
- Git
- A JIRA instance (for ParaForge)
- API keys for AI providers (OpenAI, Anthropic, etc.)

### 5-Minute Setup

```bash
# Clone CAIA
git clone https://github.com/caia-ai/caia.git
cd caia

# Install dependencies
npm install

# Bootstrap all packages
npm run bootstrap

# Build all packages
npm run build:all

# Run tests to verify installation
npm run test:all
```

### Verify Installation

```bash
# Check CAIA core
node -e "console.log(require('./packages/core/dist').version)"

# Test ParaForge CLI
./packages/agents/paraforge/bin/paraforge.js --version
```

## Installation

### Option 1: Full Development Setup

```bash
# Clone the repository
git clone https://github.com/caia-ai/caia.git
cd caia

# Install dependencies for all packages
npm install

# Bootstrap packages with Lerna
npm run bootstrap

# Build all packages
npm run build:all

# Set up development environment
cp .env.example .env
# Edit .env with your configuration
```

### Option 2: Individual Package Installation

```bash
# Install specific agents
npm install @caia/agent-paraforge
npm install @caia/agent-product-owner
npm install @caia/agent-solution-architect

# Install core framework
npm install @caia/core

# Install utilities
npm install @caia/utils-cc-orchestrator
```

### Option 3: Using Individual Packages

CAIA packages can be used independently:

```bash
# Use ParaForge standalone
npx @caia/agent-paraforge process --idea "Build a todo app"

# Use CC Orchestrator for parallel processing
npx @caia/utils-cc-orchestrator --workers 10 task1 task2 task3
```

## Core Concepts

### 1. Agents

Agents are specialized AI entities that perform specific tasks:

- **Product Owner Agent**: Analyzes requirements and creates user stories
- **Solution Architect Agent**: Designs system architecture
- **Frontend Engineer Agent**: Generates frontend code and components
- **Backend Engineer Agent**: Creates APIs and backend services
- **ParaForge Agent**: Transforms ideas into JIRA project structures

### 2. Orchestration

CAIA orchestrates multiple agents to work together on complex tasks:

```javascript
const { AgentOrchestrator } = require('@caia/core');

const orchestrator = new AgentOrchestrator({
  agents: ['product-owner', 'solution-architect', 'frontend-engineer'],
  coordination: 'parallel'
});

const result = await orchestrator.execute({
  task: 'Build a modern web application',
  requirements: 'User authentication, dashboard, mobile responsive'
});
```

### 3. Engines

Engines provide specialized capabilities:

- **Workflow Engine**: Manages complex multi-step processes
- **Learning Engine**: Improves agent performance over time
- **Planning Engine**: Creates optimal execution strategies
- **Code Generation Engine**: Produces high-quality code
- **Reasoning Engine**: Provides advanced problem-solving

### 4. Utilities

- **CC Orchestrator**: Parallel execution of multiple Claude Code instances
- **Memory Systems**: Persistent storage for agent knowledge
- **Monitoring Tools**: Track agent performance and system health

## Your First Agent

Let's create a simple agent that generates project documentation:

### 1. Create Agent Structure

```bash
# Using CAIA CLI
npm run create:agent documentation-generator

# Or manually
mkdir -p packages/agents/documentation-generator/src
cd packages/agents/documentation-generator
```

### 2. Implement the Agent

```typescript
// packages/agents/documentation-generator/src/index.ts
import { BaseAgent } from '@caia/core';

export class DocumentationGeneratorAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super({
      name: 'Documentation Generator',
      version: '1.0.0',
      capabilities: ['markdown-generation', 'api-documentation', 'tutorials'],
      ...config
    });
  }

  async generateProjectDocs(project: ProjectInfo): Promise<Documentation> {
    // Analyze project structure
    const analysis = await this.analyzeProject(project);
    
    // Generate README
    const readme = await this.generateReadme(analysis);
    
    // Generate API docs
    const apiDocs = await this.generateApiDocs(analysis.apis);
    
    // Generate tutorials
    const tutorials = await this.generateTutorials(analysis.features);
    
    return {
      readme,
      apiDocs,
      tutorials,
      metadata: {
        generatedAt: new Date(),
        version: project.version,
        coverage: this.calculateCoverage(analysis)
      }
    };
  }

  private async analyzeProject(project: ProjectInfo): Promise<ProjectAnalysis> {
    // Use AI to analyze project structure
    const prompt = `Analyze this project and identify key components:\n${JSON.stringify(project, null, 2)}`;
    
    const response = await this.callAI(prompt, {
      model: 'claude-3-sonnet',
      maxTokens: 4000
    });
    
    return this.parseAnalysis(response);
  }

  private async generateReadme(analysis: ProjectAnalysis): Promise<string> {
    const template = `
# ${analysis.name}

${analysis.description}

## Features

${analysis.features.map(f => `- ${f}`).join('\n')}

## Quick Start

\`\`\`bash
${analysis.quickStart}
\`\`\`

## Architecture

${analysis.architecture}

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
    `;
    
    return template.trim();
  }
}
```

### 3. Configure the Agent

```json
// packages/agents/documentation-generator/package.json
{
  "name": "@caia/agent-documentation-generator",
  "version": "1.0.0",
  "description": "AI agent for generating project documentation",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "@caia/core": "^1.0.0",
    "@anthropic-ai/sdk": "^0.20.0",
    "markdown-it": "^13.0.0"
  }
}
```

### 4. Use the Agent

```javascript
const { DocumentationGeneratorAgent } = require('@caia/agent-documentation-generator');

const agent = new DocumentationGeneratorAgent({
  aiProvider: {
    type: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY
  }
});

const project = {
  name: 'My Awesome App',
  description: 'A revolutionary web application',
  features: ['User authentication', 'Real-time updates', 'Mobile responsive'],
  codebase: './src'
};

const docs = await agent.generateProjectDocs(project);
console.log('Generated documentation:', docs);
```

## Working with ParaForge

ParaForge is CAIA's flagship agent for transforming ideas into JIRA project structures.

### Configuration

```bash
# Configure ParaForge
cd packages/agents/paraforge
./bin/paraforge.js config
```

Enter your JIRA credentials and AI API keys when prompted.

### Basic Usage

```bash
# Process an idea
./bin/paraforge.js process --idea "Build a modern e-commerce platform"

# Process from file
./bin/paraforge.js process --file requirements.txt

# Interactive mode
./bin/paraforge.js interactive
```

### Programmatic Usage

```javascript
const { ParaForgeCore } = require('@caia/agent-paraforge');

const paraforge = new ParaForgeCore({
  jira: {
    host: 'yourcompany.atlassian.net',
    email: 'your@email.com',
    apiToken: 'your-api-token'
  },
  ai: {
    anthropic: 'your-anthropic-key'
  }
});

// Initialize
await paraforge.initialize();

// Process an idea
const result = await paraforge.processIdea({
  title: 'E-commerce Platform',
  description: 'Build a modern e-commerce platform with user accounts, product catalog, and payment processing',
  goals: ['Launch MVP in 3 months', 'Support 10,000 users'],
  constraints: {
    budget: '$100,000',
    team: '5 developers',
    timeline: '3 months'
  }
});

console.log('Created JIRA structure:', result);
```

### End-to-End Workflow

```bash
# Run the complete workflow example
node examples/paraforge-workflow.js single ecommerce

# Run multiple workflows in parallel
node examples/paraforge-workflow.js parallel

# List available example projects
node examples/paraforge-workflow.js list
```

## Examples

### Example 1: Simple Todo App

```javascript
// examples/todo-app/build-with-caia.js
const { AgentOrchestrator } = require('@caia/core');

const orchestrator = new AgentOrchestrator({
  agents: {
    'product-owner': '@caia/agent-product-owner',
    'frontend-engineer': '@caia/agent-frontend-engineer',
    'backend-engineer': '@caia/agent-backend-engineer'
  }
});

const app = await orchestrator.buildApplication({
  idea: 'A simple todo application with user authentication',
  tech: {
    frontend: 'React',
    backend: 'Node.js',
    database: 'PostgreSQL'
  },
  features: [
    'User registration and login',
    'Create, read, update, delete todos',
    'Mark todos as complete',
    'Filter todos by status',
    'Responsive design'
  ]
});

console.log('Generated application:', app);
```

### Example 2: Multi-Agent Coordination

```javascript
// examples/multi-agent-workflow.js
const { AgentOrchestrator, WorkflowEngine } = require('@caia/core');

const workflow = new WorkflowEngine({
  steps: [
    {
      name: 'analyze-requirements',
      agent: 'product-owner',
      input: 'requirements.md'
    },
    {
      name: 'design-architecture',
      agent: 'solution-architect',
      dependsOn: ['analyze-requirements']
    },
    {
      name: 'implement-frontend',
      agent: 'frontend-engineer',
      dependsOn: ['design-architecture'],
      parallel: true
    },
    {
      name: 'implement-backend',
      agent: 'backend-engineer',
      dependsOn: ['design-architecture'],
      parallel: true
    }
  ]
});

const result = await workflow.execute();
console.log('Workflow completed:', result);
```

### Example 3: Custom Agent Integration

```javascript
// examples/custom-agent-integration.js
const { CAIA } = require('@caia/core');
const { CustomAgent } = require('./my-custom-agent');

const caia = new CAIA();

// Register custom agent
caia.registerAgent('my-agent', new CustomAgent({
  capabilities: ['custom-task'],
  configuration: { /* agent config */ }
}));

// Use in orchestration
const result = await caia.orchestrate({
  agents: ['product-owner', 'my-agent'],
  task: 'Build something amazing',
  coordination: 'sequential'
});
```

## Next Steps

### 1. Explore Advanced Features

- **Learning Systems**: Make your agents smarter over time
- **Custom Engines**: Build specialized processing capabilities
- **Integration Patterns**: Connect with existing tools and workflows

### 2. Build Production Applications

- **Scaling**: Use CC Orchestrator for high-throughput processing
- **Monitoring**: Implement comprehensive observability
- **Security**: Follow best practices for AI agent security

### 3. Contribute to CAIA

- **Agent Development**: Create new specialized agents
- **Core Improvements**: Enhance the framework itself
- **Documentation**: Help improve guides and examples

### Resources

- **Documentation**: [CAIA Docs](docs/)
- **API Reference**: [API.md](API.md)
- **Agent Development**: [AGENT_DEVELOPMENT.md](AGENT_DEVELOPMENT.md)
- **Examples**: [examples/](../examples/)
- **Community**: [GitHub Discussions](https://github.com/caia-ai/caia/discussions)

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/caia-ai/caia/issues)
- **Discussions**: [GitHub Discussions](https://github.com/caia-ai/caia/discussions)
- **Documentation**: [Full Documentation](docs/)

---

**Ready to build the future with AI agents?** Start with the examples above and join our community of builders creating the next generation of AI-powered applications.

## Configuration Examples

### Environment Variables

```bash
# .env file
# JIRA Configuration
JIRA_HOST=yourcompany.atlassian.net
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=your-jira-token
JIRA_PROJECT_KEY=DEMO

# AI Provider Keys
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
GEMINI_API_KEY=your-gemini-key

# CAIA Configuration
CAIA_LOG_LEVEL=info
CAIA_ENABLE_METRICS=true
CAIA_PARALLEL_WORKERS=10
```

### Configuration Files

```yaml
# caia.config.yaml
version: "1.0"

agents:
  default_timeout: 30000
  max_retries: 3
  
  providers:
    anthropic:
      model: "claude-3-sonnet-20240229"
      max_tokens: 4000
    openai:
      model: "gpt-4"
      max_tokens: 4000

orchestration:
  parallel_limit: 10
  coordination_strategy: "intelligent"
  
monitoring:
  enable_metrics: true
  log_level: "info"
  trace_requests: true

integrations:
  jira:
    batch_size: 50
    rate_limit: 100
  
  github:
    auto_create_repos: false
    default_branch: "main"
```

### Quick Configuration Script

```bash
#!/bin/bash
# scripts/quick-setup.sh

echo "Setting up CAIA..."

# Create .env file
cp .env.example .env

# Install dependencies
npm install

# Bootstrap packages
npm run bootstrap

# Build all packages
npm run build:all

# Run quick test
npm run test:core

echo "CAIA setup complete!"
echo "Edit .env file with your credentials"
echo "Run 'npm run dev' to start development"
```

This completes your getting started journey with CAIA. You now have everything needed to begin building sophisticated AI agent systems!