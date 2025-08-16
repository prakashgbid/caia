# CAIA Agents

All CAIA agents live in this directory as flat, independent packages.

## 📦 Available Agents

| Agent | Package | Description | Status |
|-------|---------|-------------|--------|
| `npm-connector` | `@caia/agent-npm-connector` | NPM package management & deployment | ✅ Ready |
| `jira-connect` | `@caia/agent-jira-connect` | Jira integration & operations | 🔄 Migrating |
| `paraforge` | `@caia/agent-paraforge` | Requirements → Jira orchestrator | 🔄 Migrating |
| `product-owner` | `@caia/agent-product-owner` | Requirements gathering | 🔄 Migrating |
| `solution-architect` | `@caia/agent-solution-architect` | Technical design | 📋 Planned |
| `qa-engineer` | `@caia/agent-qa-engineer` | Test generation | 📋 Planned |
| `github-sync` | `@caia/agent-github-sync` | GitHub operations | 📋 Planned |
| `frontend-engineer` | `@caia/agent-frontend-engineer` | Frontend development | 📋 Planned |
| `backend-engineer` | `@caia/agent-backend-engineer` | Backend development | 📋 Planned |
| `devops-engineer` | `@caia/agent-devops-engineer` | Infrastructure & deployment | 📋 Planned |

## 🏗️ Agent Structure

Each agent follows this structure:
```
agent-name/
├── package.json       # NPM package config
├── tsconfig.json      # TypeScript config
├── README.md          # Agent documentation
├── src/
│   ├── index.ts       # Main agent class
│   ├── types.ts       # TypeScript types
│   ├── prompts.ts     # AI prompts (if applicable)
│   └── utils.ts       # Helper functions
├── tests/
│   └── index.test.ts  # Agent tests
└── dist/              # Compiled output
```

## 🚀 Creating a New Agent

```bash
# From CAIA root
npm run create:agent my-new-agent

# Or manually
mkdir agents/my-new-agent
cd agents/my-new-agent
npm init -y
```

## 📝 Agent Template

```typescript
// src/index.ts
import { BaseAgent, AgentInput, AgentOutput } from '@caia/core';

export class MyAgent extends BaseAgent {
  name = 'my-agent';
  version = '1.0.0';

  async execute(input: AgentInput): Promise<AgentOutput> {
    // Agent logic here
    return {
      id: input.id,
      timestamp: new Date(),
      success: true,
      data: result
    };
  }
}

export default MyAgent;
```

## 🔗 Using Agents

### In CAIA Core
```typescript
import { CAIA } from '@caia/core';
import { NPMConnector } from '@caia/agent-npm-connector';

const caia = new CAIA();
caia.registerAgent('npm-connector', new NPMConnector());

await caia.execute({
  agent: 'npm-connector',
  input: { operation: 'publish' }
});
```

### Direct Usage
```typescript
import { NPMConnector } from '@caia/agent-npm-connector';

const npm = new NPMConnector();
await npm.execute({
  id: '123',
  timestamp: new Date(),
  data: { operation: 'search', query: 'mcp' }
});
```

## 🧪 Testing Agents

```bash
# Test all agents
npm run test

# Test specific agent
npm test -- npm-connector

# Test with coverage
npm run test:coverage
```

## 📊 Agent Categories

While all agents are in a flat structure, they serve different purposes:

### Orchestration Agents
- `paraforge` - Requirements to Jira transformation
- `chief-ai` - Master orchestrator

### Development Agents
- `product-owner` - Requirements gathering
- `solution-architect` - Technical design
- `frontend-engineer` - UI development
- `backend-engineer` - API development

### Quality Agents
- `qa-engineer` - Test generation
- `security-auditor` - Security analysis
- `performance-tester` - Performance optimization

### Integration Agents
- `jira-connect` - Jira operations
- `github-sync` - GitHub management
- `npm-connector` - NPM operations
- `slack-bridge` - Team notifications

### Utility Agents
- `doc-generator` - Documentation creation
- `translator` - Localization
- `analyzer` - Code analysis

## 🎯 Agent Design Principles

1. **Single Responsibility**: Each agent does ONE thing well
2. **Stateless**: Agents don't maintain state between calls
3. **Composable**: Agents can work together
4. **Testable**: Every agent has comprehensive tests
5. **Documented**: Clear documentation and examples
6. **Typed**: Full TypeScript support

## 🔄 Migration Status

Agents being migrated from ParaForge:
- [x] npm-connector (created fresh with MCP)
- [ ] jira-connect
- [ ] product-owner
- [ ] solution-architect
- [ ] qa-engineer
- [ ] ux-designer

## 📈 Future Agents

Planned agents for CAIA:
- Cloud deployer (AWS, GCP, Azure)
- Database manager
- API gateway
- Load balancer
- Cache manager
- Message queue
- Search engine
- ML trainer
- Analytics tracker
- Payment processor

---

**Remember**: All agents are independent npm packages that can be used individually or orchestrated through CAIA core.