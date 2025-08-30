# CAIA Agent Architecture Guide

## 🎯 Agent Types Comparison Matrix

### 1. Claude Code (CC) Agents
**Purpose**: Task automation within Claude Code sessions
**Best For**: Development tasks, code generation, project management

| Type | Use Case | Implementation | Pros | Cons |
|------|----------|---------------|------|------|
| **CC Task Agents** | Specialized coding tasks | `Task()` tool with subagent_type | - Direct CC integration<br>- Access to all CC tools<br>- Context aware | - Only runs in CC sessions<br>- Stateless between calls |

**Examples in CAIA**:
- `frontend-developer` - UI/UX implementation
- `backend-architect` - API design
- `test-writer-fixer` - Test automation
- `rapid-prototyper` - MVP creation

**When to use**: 
✅ Development automation
✅ Code generation/modification
✅ Project orchestration
✅ CC-specific workflows

---

### 2. MCP (Model Context Protocol) Server Agents
**Purpose**: Bridge between AI and external systems
**Best For**: Service integrations, data access, tool extensions

| Type | Use Case | Implementation | Pros | Cons |
|------|----------|---------------|------|------|
| **MCP Servers** | External service connectors | Standalone servers with JSON-RPC | - Language agnostic<br>- Reusable across AI systems<br>- Persistent connections | - Requires separate process<br>- Additional setup complexity |

**Examples in CAIA**:
- `jira-connect` - JIRA integration
- `github-mcp` - GitHub operations
- `postgres-mcp` - Database access
- `slack-bridge` - Slack messaging

**When to use**:
✅ External API integrations
✅ Database connections
✅ Cross-platform tools
✅ Persistent service bridges

---

### 3. Vertex AI Agents
**Purpose**: Google Cloud ML/AI workloads
**Best For**: ML models, data processing, cloud-native AI

| Type | Use Case | Implementation | Pros | Cons |
|------|----------|---------------|------|------|
| **Vertex Agents** | ML pipelines, model serving | Google Cloud SDK | - Scalable ML infrastructure<br>- Managed services<br>- Enterprise features | - Vendor lock-in<br>- Cost at scale<br>- Requires GCP account |

**Potential uses in CAIA**:
- Training custom models
- Large-scale data processing
- Production ML serving
- AutoML capabilities

**When to use**:
✅ Production ML models
✅ Large-scale processing
✅ Enterprise deployments
❌ Not needed for current CAIA

---

### 4. Custom Python/Node Agents
**Purpose**: Standalone autonomous services
**Best For**: Background tasks, monitoring, continuous processes

| Type | Use Case | Implementation | Pros | Cons |
|------|----------|---------------|------|------|
| **Custom Services** | Long-running processes | Python/Node.js services | - Full control<br>- Can run anywhere<br>- Persistent state | - Must build from scratch<br>- Maintenance overhead |

**Examples in CAIA**:
- CKS (Knowledge System) - Python Flask service
- File watchers - Background monitors
- Training pipelines - Continuous learning
- Health monitors - System status

**When to use**:
✅ Background processing
✅ Continuous monitoring
✅ Stateful services
✅ Custom business logic

---

## 🏗️ CAIA's Hybrid Agent Strategy

### Current Implementation Map

```
┌─────────────────────────────────────────────┐
│            CAIA Agent Ecosystem             │
├─────────────────────────────────────────────┤
│                                             │
│  Claude Code Layer (Development)           │
│  ┌─────────────────────────────────────┐   │
│  │ • rapid-prototyper                  │   │
│  │ • frontend-developer                │   │
│  │ • backend-architect                 │   │
│  │ • test-writer-fixer                 │   │
│  │ • project-director (orchestrator)   │   │
│  └─────────────────────────────────────┘   │
│                    ↓                        │
│  MCP Bridge Layer (Integrations)           │
│  ┌─────────────────────────────────────┐   │
│  │ • jira-connect (~/.claude/agents)   │   │
│  │ • github-mcp                        │   │
│  │ • slack-bridge                      │   │
│  │ • Integration Agent (wrapper)       │   │
│                    ↓                        │
│  Custom Services Layer (Intelligence)       │
│  ┌─────────────────────────────────────┐   │
│  │ • CKS API (port 5000)               │   │
│  │ • Training pipelines                │   │
│  │ • Monitoring daemons                │   │
│  │ • CC Orchestrator                   │   │
│  └─────────────────────────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 🎯 Decision Framework: Which Agent Type to Use?

### Quick Decision Tree

```
Need to integrate external service?
├─ YES → Use MCP Server Agent
│   └─ Examples: JIRA, GitHub, Slack, Databases
│
├─ NO → Need continuous background processing?
│   ├─ YES → Use Custom Python/Node Service
│   │   └─ Examples: CKS, monitors, watchers
│   │
│   └─ NO → Need to automate development tasks?
│       ├─ YES → Use CC Task Agent
│       │   └─ Examples: coding, testing, building
│       │
│       └─ NO → Consider if agent is needed
```

---

## 🚀 Recommended Agent Architecture for CAIA

### 1. **Primary Development Layer** - CC Agents
- Keep using CC agents for all development tasks
- They have direct access to the codebase
- Can coordinate through shared filesystem
- Perfect for our CC-only development model

### 2. **Integration Layer** - MCP Servers
- Use MCP for ALL external service connections
- Already implemented: `jira-connect`
- To implement: `confluence-mcp`, `discord-mcp`, `notion-mcp`
- Benefits: Connection pooling, rate limiting, reusability

### 3. **Intelligence Layer** - Custom Services
- CKS for knowledge management (already running)
- Pattern recognition services
- Code quality monitors
- Continuous learning systems

### 4. **Orchestration Layer** - Hybrid
- CC Orchestrator for parallel task distribution
- Custom Python coordinators for complex workflows
- MCP servers for cross-system coordination

---

## 📋 Implementation Priority

### Phase 1: Strengthen Existing (Current)
✅ CC agents for development
✅ CKS for knowledge
✅ Basic MCP integrations

### Phase 2: Expand MCP Layer (Next)
- [ ] `confluence-mcp` - Documentation sync
- [ ] `discord-mcp` - Community updates  
- [ ] `notion-mcp` - Project management
- [ ] `firebase-mcp` - Backend services

### Phase 3: Enhance Intelligence (Future)
- [ ] Pattern detection service
- [ ] Auto-optimization daemon
- [ ] Performance monitoring agent
- [ ] Security scanning service

### Phase 4: Consider Cloud (Optional)
- [ ] Vertex AI for production ML
- [ ] Cloud Run for scalable services
- [ ] BigQuery for analytics
- [ ] Only if scaling beyond single machine

---

## 💡 Key Insights for CAIA

### DO Use:
1. **CC Agents** - For ALL development tasks
2. **MCP Servers** - For ALL external integrations
3. **Custom Python** - For background intelligence
4. **CC Orchestrator** - For parallel execution

### DON'T Use:
1. **Vertex AI** - Overkill for current needs
2. **Complex microservices** - Keep it simple
3. **Direct API calls** - Always use MCP
4. **Manual coordination** - Let agents handle it

### Remember:
- We're building for Claude Code, not humans
- Parallel execution is always preferred
- MCP provides the best integration pattern
- Keep services lightweight and focused

---

## 🔧 Practical Examples

### Example 1: Adding Confluence Integration
```javascript
// DON'T: Direct API call in CC agent
const axios = require('axios');
await axios.post('https://confluence.../rest/api/content');

// DO: Use MCP Server
// 1. Create confluence-mcp server
// 2. Connect via Integration Agent
const agent = new IntegrationAgent();
const confluence = await agent.connect('confluence');
await confluence.createPage(data);
```

### Example 2: Background Code Analysis
```python
# DON'T: Run in CC agent (blocks session)
# DO: Create custom Python service

# /caia/services/code_analyzer.py
class CodeAnalyzerService:
    def __init__(self):
        self.cks = CKSClient()
    
    def run_continuous(self):
        while True:
            changes = self.detect_changes()
            patterns = self.analyze_patterns(changes)
            self.cks.update_knowledge(patterns)
            time.sleep(300)  # Every 5 minutes
```

### Example 3: Parallel Development Tasks
```javascript
// Use CC Orchestrator for parallel CC agents
const orchestrator = new CCOrchestrator();
await orchestrator.executeWorkflow({
    tasks: [
        { agent: 'frontend-developer', task: 'Build UI' },
        { agent: 'backend-architect', task: 'Create API' },
        { agent: 'test-writer-fixer', task: 'Write tests' }
    ],
    strategy: 'parallel'
});
```

---

## 📚 Resources

- CC Agents: `~/.claude/CLAUDE.md`
- MCP Spec: [https://github.com/anthropics/mcp](https://github.com/anthropics/mcp)
- CAIA Agents: `/caia/packages/agents/`
- Integration Agent: `/caia/packages/agents/integration-agent/`
---

*Last Updated: August 2024*
*Status: Living Document - Update as architecture evolves*