# 📚 CAIA Documentation Index

> Complete guide to the Chief AI Agent ecosystem

## 🏗️ Project Structure

### Core Organization
```
caia/
├── 📁 core/              # Orchestration engine
├── 🤖 agents/            # All agents (flat structure)
├── ⚙️ engines/           # Processing engines
├── 🔧 utils/             # Helper utilities
├── 📦 modules/           # Business features
└── 🛠️ tools/            # Development tools
```

### Classification System

| Folder | Purpose | Key Question | Example |
|--------|---------|--------------|---------|
| **core/** | Orchestration | "Does it coordinate others?" | CAIA orchestrator |
| **agents/** | Task Execution | "Does it make decisions/perform tasks?" | jira-connect, npm-connector |
| **engines/** | Data Processing | "Does it transform data systematically?" | code-synthesis, template-engine |
| **utils/** | Helpers | "Is it a simple, reusable function?" | logger, validator |
| **modules/** | Business Features | "Is it a complete business capability?" | ecommerce, authentication |
| **tools/** | Dev Tools | "Does it help during development?" | CLI, debugger |

## 🤖 Agent Categories

### 1. Connectors (`*-connector`)
External service integrations
- `jira-connector` - Jira API/MCP integration
- `npm-connector` - NPM registry operations  
- `github-connector` - GitHub API integration
- `vercel-connector` - Deployment management

### 2. SME Agents (`*-sme`)
Living knowledge experts
- `react-sme` - React ecosystem expert
- `nextjs-sme` - Next.js expert
- `prisma-sme` - Prisma ORM expert
- `langchain-sme` - LangChain expert

### 3. Role Agents (`*-agent`)
Team role emulation
- `product-owner-agent` - Requirements gathering
- `architect-agent` - System design
- `qa-agent` - Testing and quality
- `devops-agent` - Infrastructure

### 4. Processor Agents (`*-processor`)
Content transformation
- `code-processor` - Code generation/analysis
- `doc-processor` - Documentation generation
- `test-processor` - Test generation

### 5. Guardian Agents (`*-guardian`)
Quality monitoring
- `security-guardian` - Security monitoring
- `performance-guardian` - Performance tracking
- `compliance-guardian` - Regulatory compliance

## 📖 Documentation Files

| File | Purpose |
|------|---------|
| [README.md](./README.md) | Project overview and quick start |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | How to contribute |
| [STRUCTURE.md](./STRUCTURE.md) | Project structure details |
| [COMPONENT-CLASSIFICATION.md](./COMPONENT-CLASSIFICATION.md) | Detailed classification guide |
| [CLASSIFICATION-FLOWCHART.md](./CLASSIFICATION-FLOWCHART.md) | Visual decision flowchart |
| [agents/AGENT-CATEGORIES.md](./agents/AGENT-CATEGORIES.md) | Agent categorization system |
| [agents/README.md](./agents/README.md) | Agent development guide |
| [PARAFORGE-MIGRATION.md](./PARAFORGE-MIGRATION.md) | ParaForge integration plan |

## 🚀 Quick Start

### Installation
```bash
# Clone repository
git clone https://github.com/prakashgbid/caia.git
cd caia

# Install dependencies
npm install
npm run bootstrap

# Build all packages
npm run build:all
```

### Using CAIA
```typescript
import { CAIA } from '@caia/core';
import { NPMConnector } from '@caia/agent-npm-connector';

const caia = new CAIA();
caia.registerAgent('npm-connector', new NPMConnector());

// Execute agent task
await caia.execute({
  agent: 'npm-connector',
  input: { operation: 'publish' }
});
```

## 🔄 Decision Process

### How to Classify Components

1. **Start with primary purpose**
   - What is the main job of this component?

2. **Follow the flowchart**
   - Use [CLASSIFICATION-FLOWCHART.md](./CLASSIFICATION-FLOWCHART.md)

3. **Check size guidelines**
   - Utils: < 200 lines
   - Engines/Agents: 200-2000 lines
   - Modules: 1000+ lines

4. **Verify with examples**
   - Check similar existing components

5. **Consider edge cases**
   - Review [COMPONENT-CLASSIFICATION.md](./COMPONENT-CLASSIFICATION.md)

## 💡 Key Principles

### Component Rules
- **Agents** = Workers with personality/role (interact with external world)
- **Engines** = Factories that transform (pure processing)
- **Utils** = Small helpers (< 200 lines)
- **Modules** = Complete features (could be sold as product)
- **Tools** = Developer aids (not production code)
- **Core** = The conductor (orchestrates everything)

### Design Principles
1. **Single Responsibility** - Each component does ONE thing well
2. **Flat Structure** - All agents in `/agents/`, no deep nesting
3. **Clear Naming** - Self-descriptive names with category suffixes
4. **Full TypeScript** - Type safety throughout
5. **Comprehensive Tests** - 80%+ coverage target
6. **Living Documentation** - Always up to date

## 📦 Package Naming

```
@caia/core                 # Core orchestration
@caia/agent-{name}         # Agents
@caia/engine-{name}        # Engines
@caia/util-{name}          # Utilities
@caia/module-{name}        # Modules
@caia/tool-{name}          # Tools
```

## 🧪 Development

### Creating Components
```bash
npm run create:agent my-agent      # Create new agent
npm run create:engine my-engine    # Create new engine
npm run create:util my-util        # Create new utility
npm run create:module my-module    # Create new module
npm run create:tool my-tool        # Create new tool
```

### Testing
```bash
npm run test:all                   # Test everything
npm test -- my-component           # Test specific component
npm run test:coverage              # With coverage
```

### Publishing
```bash
npm run build:all                  # Build all packages
npm run publish:changed            # Publish changed packages
npm run publish:all                # Publish everything
```

## 🎯 Why Component Categories Matter

### SME Agents vs Claude Code

| Aspect | Claude Code | SME Agents |
|--------|-------------|------------|
| Knowledge Currency | Training cutoff | Real-time |
| Version Awareness | May be outdated | Always current |
| Breaking Changes | May not know | Tracks actively |
| Bug Awareness | Unknown | Monitors issues |
| Best Practices | Generic | Framework-specific |

### Connectors vs Direct Integration
- **Connectors** handle authentication, rate limits, retries
- **Direct calls** require manual management
- **MCP servers** provide optimal performance

## 🗺️ Roadmap

### Phase 1: Foundation ✅
- [x] Core architecture
- [x] Basic agents structure
- [x] CI/CD pipeline
- [x] Documentation

### Phase 2: Essential Agents (Q1 2025)
- [ ] 10+ Connectors
- [ ] 5+ SME Agents
- [ ] Core Role Agents
- [ ] npm publishing

### Phase 3: Ecosystem (Q2 2025)
- [ ] 50+ agents
- [ ] 10+ engines
- [ ] Complete modules
- [ ] Cloud platform

### Phase 4: Intelligence (Q3 2025)
- [ ] Self-improving agents
- [ ] Learning system
- [ ] Pattern recognition
- [ ] Autonomous orchestration

## 📊 Project Status

| Component | Count | Status |
|-----------|-------|--------|
| Agents | 3 | 🟡 In Progress |
| Engines | 0 | 📋 Planned |
| Utils | 1 | 🟡 In Progress |
| Modules | 0 | 📋 Planned |
| Tools | 0 | 📋 Planned |

## 🤝 Community

- **Repository**: [github.com/prakashgbid/caia](https://github.com/prakashgbid/caia)
- **Issues**: [Report bugs or request features](https://github.com/prakashgbid/caia/issues)
- **Discussions**: [Community forum](https://github.com/prakashgbid/caia/discussions)
- **Discord**: Coming soon
- **Twitter**: Coming soon

## 📄 Legal

- **License**: MIT (see [LICENSE](./LICENSE))
- **Code of Conduct**: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- **Security**: [SECURITY.md](./SECURITY.md)

## 🙏 Acknowledgments

CAIA is built on the vision of fully automated application development, standing on the shoulders of:
- Model Context Protocol (MCP)
- Open source community
- AI/ML advancement
- Modern web technologies

---

**For detailed information on any topic, refer to the specific documentation files listed above.**

*Last updated: December 2024*