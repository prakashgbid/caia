# ParaForge Agents

This directory contains all specialized agents used by ParaForge for AI-powered requirements gathering and Jira modeling.

## 📦 Agent Architecture

Each agent is designed to be:
- **Self-contained**: Works independently with clear interfaces
- **Extractable**: Can be moved to its own package later
- **Testable**: Has its own tests and documentation
- **Composable**: Works seamlessly with other agents

## 🤖 Available Agents

### 1. jira-connect
**Purpose**: MCP-based Jira integration for parallel operations at scale
- Handles 100s of parallel connections
- Connection pooling and rate limiting
- Bulk operations optimization
- **Status**: ✅ Implemented

### 2. product-owner
**Purpose**: Conducts comprehensive requirements gathering interviews
- Use case clarification
- Feature requirements elicitation
- Business logic understanding
- Acceptance criteria definition
- **Status**: 🔄 In Development

### 3. solution-architect
**Purpose**: Provides technical architecture and design specifications
- System architecture design
- Technology stack recommendations
- Integration patterns
- Performance requirements
- **Status**: 📋 Planned

### 4. ux-designer
**Purpose**: Creates UI/UX specifications and design requirements
- User flow design
- Wireframe generation
- Accessibility requirements
- Responsive design specs
- **Status**: 📋 Planned

### 5. qa-engineer
**Purpose**: Generates comprehensive test cases and quality requirements
- Test case generation
- Edge case identification
- Performance criteria
- Security requirements
- **Status**: 📋 Planned

### 6. sme-base
**Purpose**: Base class for Subject Matter Expert agents
- Domain-specific knowledge
- Industry best practices
- Compliance requirements
- **Status**: 📋 Planned

## 🏗️ Agent Structure

Each agent follows this structure:
```
agent-name/
├── index.ts          # Main agent implementation
├── types.ts          # TypeScript interfaces
├── prompts.ts        # AI prompts and templates
├── utils.ts          # Helper functions
├── README.md         # Agent documentation
├── package.json      # Dependencies (for extraction)
└── __tests__/        # Agent-specific tests
```

## 🔄 Agent Lifecycle

### Development Phase (Current)
Agents are developed within the ParaForge project for rapid iteration and testing.

### Extraction Phase (Future)
Once stable, agents will be extracted to independent packages:
- `@autoforge/agent-jira-connect`
- `@autoforge/agent-product-owner`
- `@autoforge/agent-solution-architect`
- etc.

### Integration Phase
ParaForge will then import these as npm dependencies, allowing:
- Independent versioning
- Community contributions
- Reuse in other projects

## 🧪 Testing Agents

```bash
# Test all agents
npm run test:agents

# Test specific agent
npm run test:agents -- jira-connect

# Test with coverage
npm run test:agents:coverage
```

## 🚀 Using Agents

### Within ParaForge
```typescript
import { JiraConnect } from './agents/jira-connect';
import { ProductOwner } from './agents/product-owner';

const jira = new JiraConnect(config);
const po = new ProductOwner(config);

// Agents work together
const requirements = await po.gatherRequirements(userInput);
const tickets = await jira.bulkCreateIssues(requirements.tickets);
```

### After Extraction (Future)
```typescript
import { JiraConnect } from '@autoforge/agent-jira-connect';
import { ProductOwner } from '@autoforge/agent-product-owner';

// Same usage, but from npm packages
```

## 📝 Creating New Agents

1. Create folder: `agents/new-agent-name/`
2. Implement core functionality in `index.ts`
3. Define types in `types.ts`
4. Add documentation in `README.md`
5. Write tests in `__tests__/`
6. Register in main agents index

## 🎯 Agent Communication Protocol

Agents communicate through well-defined interfaces:

```typescript
interface AgentRequest {
  context: ProjectContext;
  input: any;
  constraints?: any;
}

interface AgentResponse {
  success: boolean;
  data: any;
  metadata?: any;
  recommendations?: any;
}
```

## 📊 Agent Metrics

Each agent tracks:
- Execution time
- Success rate
- Token usage (for AI agents)
- Error patterns
- Performance metrics

## 🔒 Security

- Credentials are never stored in agent code
- Use environment variables or secure config
- Agents validate all inputs
- Rate limiting built-in
- Audit logging for sensitive operations

---

**Note**: These agents are currently part of ParaForge but designed for future extraction as independent packages in the AutoForge ecosystem.