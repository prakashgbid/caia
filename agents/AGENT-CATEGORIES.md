# 🗂️ CAIA Agent Categories

## Agent Classification System

All agents remain in the flat `/agents/` folder but are logically grouped by their primary function.

## 1. 🔌 Connectors
**Purpose**: Integrate with external services, APIs, and platforms

### Naming Convention: `{service}-connector`

### Examples:
```
agents/
├── jira-connector/        # Jira API/MCP integration
├── npm-connector/         # NPM registry operations
├── github-connector/      # GitHub API integration
├── figma-connector/       # Figma design API
├── vercel-connector/      # Vercel deployment
├── aws-connector/         # AWS services
├── stripe-connector/      # Payment processing
├── slack-connector/       # Team notifications
├── discord-connector/     # Community integration
├── notion-connector/      # Documentation sync
├── linear-connector/      # Project management
├── salesforce-connector/  # CRM integration
└── ...
```

### Characteristics:
- Handles authentication with external service
- Manages API rate limits
- Provides unified interface to service
- Handles service-specific quirks
- May use MCP servers when available

### Template:
```typescript
export class ServiceConnector extends BaseAgent {
  name = 'service-connector';
  
  async connect() { }
  async authenticate() { }
  async executeOperation() { }
  async handleRateLimit() { }
}
```

---

## 2. 🎓 SME (Subject Matter Expert) Agents
**Purpose**: Maintain deep, current knowledge about specific technologies/frameworks

### Naming Convention: `{technology}-sme`

### Examples:
```
agents/
├── react-sme/            # React ecosystem expert
├── nextjs-sme/           # Next.js expert
├── tailwind-sme/         # TailwindCSS expert
├── prisma-sme/           # Prisma ORM expert
├── langchain-sme/        # LangChain expert
├── tensorflow-sme/       # TensorFlow expert
├── kubernetes-sme/       # K8s expert
├── graphql-sme/          # GraphQL expert
├── rust-sme/             # Rust language expert
├── web3-sme/             # Blockchain/Web3 expert
└── ...
```

### Why SME Agents Are Needed:

#### 1. **Real-time Knowledge**
```typescript
class ReactSME extends BaseAgent {
  async getLatestVersion() {
    // Fetches current React version (18.3.x? 19.0?)
    // CC doesn't know versions released after training
  }
  
  async getBreakingChanges(fromVersion: string) {
    // Tracks actual breaking changes between versions
    // CC might not know about recent deprecations
  }
  
  async getBestPractices() {
    // Fetches current community best practices
    // These evolve faster than CC's training data
  }
}
```

#### 2. **Deep Internals Understanding**
```typescript
class PrismaSME extends BaseAgent {
  async analyzeSchema(schema: string) {
    // Understands Prisma-specific optimizations
    // Knows about recent performance improvements
    // Aware of current bugs and workarounds
  }
  
  async suggestMigrationStrategy() {
    // Based on latest Prisma migration patterns
    // Knows about community-discovered pitfalls
  }
}
```

#### 3. **Ecosystem Awareness**
```typescript
class NextJSSME extends BaseAgent {
  async getCompatiblePackages() {
    // Knows which versions work together NOW
    // Tracks active community packages
    // Aware of deprecated/abandoned packages
  }
  
  async getDeploymentStrategy() {
    // Current Vercel optimizations
    // Latest edge runtime capabilities
    // Recent performance techniques
  }
}
```

### How SME Agents Work:
```typescript
class SMEAgent extends BaseAgent {
  private knowledgeBase: KnowledgeStore;
  
  async initialize() {
    // Scan GitHub repos
    await this.scanRepository('facebook/react');
    await this.scanDocumentation('https://react.dev');
    await this.scanIssues();
    await this.scanDiscussions();
    await this.analyzeChangelog();
  }
  
  async updateKnowledge() {
    // Periodic updates
    await this.fetchLatestCommits();
    await this.analyzeNewReleases();
    await this.trackBreakingChanges();
    await this.monitorCommunityPatterns();
  }
  
  async answer(question: string) {
    // Combines:
    // 1. Base knowledge (from training)
    // 2. Current documentation
    // 3. Recent GitHub activity
    // 4. Community discussions
    return this.synthesizeAnswer(question);
  }
}
```

---

## 3. 👷 Role Agents
**Purpose**: Emulate human roles in development team

### Naming Convention: `{role}-agent`

### Examples:
```
agents/
├── product-owner-agent/    # Requirements gathering
├── architect-agent/         # System design
├── frontend-agent/          # UI development
├── backend-agent/           # API development
├── qa-agent/                # Testing
├── devops-agent/            # Infrastructure
├── security-agent/          # Security audit
├── designer-agent/          # UX/UI design
└── ...
```

---

## 4. 🔄 Processor Agents
**Purpose**: Transform, analyze, or generate content

### Naming Convention: `{action}-processor`

### Examples:
```
agents/
├── code-processor/          # Code analysis/generation
├── doc-processor/           # Documentation generation
├── test-processor/          # Test generation
├── data-processor/          # Data transformation
├── image-processor/         # Image manipulation
└── ...
```

---

## 5. 🛡️ Guardian Agents
**Purpose**: Monitor, validate, and ensure quality

### Naming Convention: `{aspect}-guardian`

### Examples:
```
agents/
├── security-guardian/       # Security monitoring
├── performance-guardian/    # Performance monitoring
├── quality-guardian/        # Code quality
├── compliance-guardian/     # Regulatory compliance
└── ...
```

---

## 📊 Why This Categorization Matters

### 1. **Connectors** handle the "HOW" to integrate
```typescript
// Knows HOW to talk to Jira
const jira = await getAgent('jira-connector');
await jira.createIssue(data);
```

### 2. **SMEs** handle the "WHAT" and "WHY"
```typescript
// Knows WHAT the best React patterns are
const reactExpert = await getAgent('react-sme');
const bestPractice = await reactExpert.recommendPattern(useCase);
```

### 3. **Roles** handle the "WHO" does what
```typescript
// Acts like a Product Owner
const po = await getAgent('product-owner-agent');
const requirements = await po.gatherRequirements(idea);
```

---

## 🚀 Real-World Example

Building a Next.js app with CAIA:

```typescript
// 1. Product Owner gathers requirements
const requirements = await productOwnerAgent.gather(idea);

// 2. Next.js SME provides expertise
const nextjsAdvice = await nextjsSME.getOptimalSetup(requirements);
const compatibleVersions = await nextjsSME.getVersionMatrix();

// 3. Architect designs system
const architecture = await architectAgent.design(requirements, nextjsAdvice);

// 4. Connectors set up integrations
await githubConnector.createRepo(project);
await vercelConnector.setupDeployment(project);

// 5. Frontend agent builds UI
const ui = await frontendAgent.build(architecture, nextjsAdvice);

// 6. Quality guardian validates
await qualityGuardian.validate(ui);
```

---

## 🎯 Decision Matrix

| Need | Category | Example |
|------|----------|---------|
| External service integration | Connector | `jira-connector` |
| Current tech knowledge | SME | `react-sme` |
| Development task | Role | `frontend-agent` |
| Data transformation | Processor | `code-processor` |
| Quality assurance | Guardian | `security-guardian` |

---

## 📝 File Organization

Even with categories, maintain flat structure:
```
agents/
├── README.md
├── CATEGORIES.md (this file)
│
├── aws-connector/
├── backend-agent/
├── code-processor/
├── figma-connector/
├── frontend-agent/
├── github-connector/
├── jira-connector/
├── nextjs-sme/
├── npm-connector/
├── performance-guardian/
├── prisma-sme/
├── product-owner-agent/
├── qa-agent/
├── react-sme/
├── security-guardian/
├── vercel-connector/
└── ...
```

**Note**: Categories are logical groupings, not folders. All agents stay in flat `/agents/` directory.

---

## 🔮 Why SME Agents Beat Generic CC

| Aspect | Claude Code | SME Agent |
|--------|-------------|-----------|
| **Knowledge Currency** | Training cutoff | Real-time |
| **Version Awareness** | Might be outdated | Always current |
| **Breaking Changes** | May not know | Tracks actively |
| **Community Patterns** | General knowledge | Specific ecosystem |
| **Bug Awareness** | Unknown | Monitors issues |
| **Performance Tips** | Generic | Framework-specific |
| **Integration Issues** | Best guess | Known combinations |

SME Agents provide **living knowledge** that evolves with the ecosystem, while CC provides **foundational understanding**.