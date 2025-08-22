# CAIA Package Registry

This document lists all publishable packages in the CAIA ecosystem, their current versions, dependencies, and publication status.

## 📦 Package Overview

| Package | Version | Status | Description | Dependencies |
|---------|---------|--------|-------------|--------------|
| [@caia/core](./packages/core) | 1.0.0 | 🔄 Ready | Core orchestration and agent management | `eventemitter3`, `zod`, `winston`, `uuid` |
| [@caia/util-cc-orchestrator](./packages/utils/cc-orchestrator) | 0.1.0 | 🔄 Ready | Claude Code orchestrator for parallel execution | `p-queue`, `p-limit`, `bottleneck` |
| [@caia/engine-workflow](./packages/engines/workflow) | 0.1.0 | 🔄 Ready | Workflow orchestration engine | - |
| [@caia/engine-reasoning](./packages/engines/reasoning) | 0.1.0 | 🔄 Ready | AI reasoning engine | - |
| [@caia/engine-learning](./packages/engines/learning) | 0.1.0 | 🔄 Ready | Machine learning engine | - |
| [@caia/engine-planning](./packages/engines/planning) | 0.1.0 | 🔄 Ready | Task planning engine | - |
| [@caia/engine-code-generation](./packages/engines/code-generation) | 0.1.0 | 🔄 Ready | Code generation engine | - |
| [@caia/module-memory](./packages/modules/memory) | 0.1.0 | 🔄 Ready | Memory management module | - |
| [@caia/module-autonomy](./packages/modules/autonomy) | 0.1.0 | 🔄 Ready | Autonomous behavior module | - |
| [@caia/agent-frontend-engineer](./packages/agents/frontend-engineer) | 1.0.0 | 🔄 Ready | Frontend engineering agent | `@caia/core`, React, Vue, Angular |
| [@caia/agent-backend-engineer](./packages/agents/backend-engineer) | 1.0.0 | 🔄 Ready | Backend engineering agent | `@caia/core` |
| [@caia/agent-solution-architect](./packages/agents/solution-architect) | 1.0.0 | 🔄 Ready | Solution architecture agent | `@caia/core` |
| [@caia/agent-product-owner](./packages/agents/product-owner) | 1.0.0 | 🔄 Ready | Product owner agent | `@caia/core` |
| [@caia/agent-jira-connect](./packages/agents/jira-connect) | 1.0.0 | 🔄 Ready | JIRA integration agent | `@caia/core`, `axios` |
| [@caia/agent-training-system](./packages/agents/training-system) | 0.1.0 | 🔄 Ready | Agent training system | - |
| [@caia/agent-paraforge](./packages/agents/paraforge) | 0.1.0 | 🔄 Ready | ParaForge integration agent | - |
| [@caia/agent-chatgpt-autonomous](./packages/agents/chatgpt-autonomous) | 0.1.0 | 🔄 Ready | Autonomous ChatGPT agent | - |
| [@caia/integration-jira](./packages/integrations/jira) | 0.1.0 | 🔄 Ready | JIRA integration package | - |
| [@caia/integration-mcp-chatgpt](./packages/integrations/mcp-chatgpt) | 0.1.0 | 🔄 Ready | MCP ChatGPT integration | - |
| [@caia/integration-orchestra](./packages/integrations/orchestra) | 0.1.0 | 🔄 Ready | Orchestra integration | - |
| [@caia/testing-test-utils](./packages/testing/test-utils) | 0.1.0 | 🔄 Ready | Testing utilities | - |

## 🚀 Publishing Status Legend

- ✅ **Published** - Available on NPM
- 🔄 **Ready** - Ready for publishing
- ⚠️ **Pending** - Needs fixes before publishing
- ❌ **Blocked** - Major issues preventing publication

## 📋 Publishing Order

Packages must be published in this order to respect dependencies:

### Phase 1: Core Infrastructure
1. `@caia/core` - Foundation for all other packages
2. `@caia/util-cc-orchestrator` - Orchestration utilities
3. `@caia/testing-test-utils` - Testing infrastructure

### Phase 2: Modules & Engines
4. `@caia/module-memory` - Memory management
5. `@caia/module-autonomy` - Autonomous behavior
6. `@caia/engine-reasoning` - AI reasoning
7. `@caia/engine-learning` - Machine learning
8. `@caia/engine-planning` - Task planning
9. `@caia/engine-workflow` - Workflow orchestration
10. `@caia/engine-code-generation` - Code generation

### Phase 3: Agents
11. `@caia/agent-jira-connect` - JIRA integration
12. `@caia/agent-frontend-engineer` - Frontend development
13. `@caia/agent-backend-engineer` - Backend development
14. `@caia/agent-solution-architect` - Architecture planning
15. `@caia/agent-product-owner` - Product management
16. `@caia/agent-training-system` - Agent training
17. `@caia/agent-paraforge` - ParaForge integration
18. `@caia/agent-chatgpt-autonomous` - Autonomous ChatGPT

### Phase 4: Integrations
19. `@caia/integration-jira` - JIRA integration
20. `@caia/integration-mcp-chatgpt` - MCP ChatGPT
21. `@caia/integration-orchestra` - Orchestra integration

## 📊 Package Details

### Core Packages

#### @caia/core
- **Purpose**: Foundation package providing core orchestration and agent management
- **Key Features**: Event handling, agent lifecycle, configuration management
- **Dependencies**: `eventemitter3`, `zod`, `winston`, `uuid`
- **Exports**: Agent classes, orchestration utilities, type definitions

#### @caia/util-cc-orchestrator
- **Purpose**: Parallel execution orchestrator for Claude Code operations
- **Key Features**: Dynamic resource calculation, connection pooling, rate limiting
- **Dependencies**: `p-queue`, `p-limit`, `bottleneck`, `eventemitter3`, `winston`
- **CLI**: Provides `cco` command for orchestration tasks

### Engine Packages

#### @caia/engine-workflow
- **Purpose**: Workflow orchestration and task management
- **Key Features**: Workflow definition, execution, monitoring
- **Dependencies**: TBD
- **Integration**: Works with all agent types

#### @caia/engine-reasoning
- **Purpose**: AI reasoning and decision-making capabilities
- **Key Features**: Logic processing, decision trees, inference
- **Dependencies**: TBD
- **Integration**: Core reasoning for all agents

### Agent Packages

#### @caia/agent-frontend-engineer
- **Purpose**: Specialized agent for frontend development tasks
- **Key Features**: React/Vue/Angular support, UI/UX optimization, performance tuning
- **Dependencies**: `@caia/core`, React, Vue, Angular ecosystems
- **Capabilities**: Component generation, styling, testing, deployment

#### @caia/agent-jira-connect
- **Purpose**: JIRA integration and project management
- **Key Features**: Issue creation, workflow automation, reporting
- **Dependencies**: `@caia/core`, `axios`
- **API**: RESTful JIRA integration with rate limiting

## 🔧 Development Setup

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0
- TypeScript
- Git

### Installation
```bash
# Clone repository
git clone https://github.com/caia-ai/caia.git
cd caia

# Install dependencies
npm install

# Bootstrap packages
npm run bootstrap

# Build all packages
npm run build:all

# Run tests
npm run test:all
```

### Publishing Commands

```bash
# Prepare packages for publishing
./scripts/prepare-npm-publish.sh

# Dry run publishing
./scripts/npm-publish.sh --dry-run

# Publish all packages
./scripts/npm-publish.sh

# Publish specific packages
PACKAGES="packages/core packages/utils/cc-orchestrator" ./scripts/npm-publish.sh

# Force publish (override existing versions)
./scripts/npm-publish.sh --force
```

## 📈 Version Management

### Versioning Strategy
- **Major (x.0.0)**: Breaking changes, incompatible API changes
- **Minor (x.y.0)**: New features, backward compatible
- **Patch (x.y.z)**: Bug fixes, backward compatible

### Current Version Status
- **Core packages**: v1.0.0 (stable)
- **New packages**: v0.1.0 (initial release)
- **Experimental**: v0.0.x (development)

### Release Process
1. Update version numbers using `npm run version:patch|minor|major`
2. Run tests: `npm run test:all`
3. Build packages: `npm run build:all`
4. Prepare for publishing: `./scripts/prepare-npm-publish.sh`
5. Dry run: `./scripts/npm-publish.sh --dry-run`
6. Publish: `./scripts/npm-publish.sh`
7. Tag release: `git tag v{version}`
8. Update documentation

## 🔐 Security & Access

### NPM Access
- All packages use `"publishConfig": {"access": "public"}`
- Packages are published under `@caia` scope
- Requires NPM authentication for publishing

### Authentication Setup
```bash
# Option 1: NPM login
npm login

# Option 2: Environment variable
export NPM_TOKEN=your_npm_token
```

## 🐛 Troubleshooting

### Common Issues

#### Authentication Errors
```bash
# Check current user
npm whoami

# Re-authenticate
npm login
```

#### Build Failures
```bash
# Clean and rebuild
npm run clean
npm install
npm run build:all
```

#### Publishing Conflicts
```bash
# Check package exists
npm view @caia/package-name

# Force publish if needed
./scripts/npm-publish.sh --force
```

#### Dependency Issues
```bash
# Bootstrap workspace
npm run bootstrap

# Check for circular dependencies
npm ls
```

## 📚 Resources

- [NPM Documentation](https://docs.npmjs.com/)
- [Lerna Monorepo Management](https://lerna.js.org/)
- [TypeScript Configuration](https://www.typescriptlang.org/tsconfig)
- [CAIA Documentation](./DOCUMENTATION.md)
- [Contributing Guide](./CONTRIBUTING.md)

## 📝 Notes

- Package names follow the pattern `@caia/{type}-{name}`
- All packages include TypeScript definitions
- README files are included in published packages
- Tests are run before publishing
- Builds are created in `dist/` directories
- Source maps are included for debugging

---

*Last updated: $(date)*
*Total packages: 21*
*Ready for publishing: 21*