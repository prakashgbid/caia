# 🎯 CAIA Component Classification Guide

## Decision Framework: Where Does My Code Belong?

### Quick Decision Tree
```
Is it orchestrating other components?
  └─ YES → **core/**

Does it perform autonomous tasks with AI/logic?
  └─ YES → **agents/**

Does it process/transform data systematically?
  └─ YES → **engines/**

Is it a small, reusable function?
  └─ YES → **utils/**

Is it a complete business feature?
  └─ YES → **modules/**

Is it for development/debugging?
  └─ YES → **tools/**
```

---

## 📁 Detailed Classification Rules

### 1. **core/** - Orchestration & Foundation
**What goes here:**
- Main CAIA orchestrator
- Agent registry and management
- Communication bus between components
- Core interfaces and base classes
- Event system
- Plugin system

**Key Questions:**
- Does it coordinate multiple components? → **core**
- Is it foundational to how CAIA works? → **core**
- Does it manage the lifecycle of other components? → **core**

**Examples:**
```
✅ CAIA orchestrator
✅ Agent registry
✅ Event bus
✅ Plugin loader
❌ Individual agents
❌ Utility functions
```

---

### 2. **agents/** - Autonomous Actors
**What goes here:**
- Components that make decisions
- Components that perform complete tasks
- Components with AI/ML capabilities
- Components that interact with external services
- Components that have a "personality" or role

**Key Questions:**
- Can it work independently? → **agent**
- Does it make decisions? → **agent**
- Does it represent a role (PO, QA, etc.)? → **agent**
- Does it interact with external APIs? → **agent**

**Examples:**
```
✅ product-owner (gathers requirements)
✅ jira-connect (manages Jira)
✅ npm-connector (handles npm)
✅ qa-engineer (generates tests)
✅ translator (translates content)
❌ JSON parser (utility)
❌ Retry logic (utility)
```

**Special Cases:**
- API clients that do complex operations → **agent**
- Simple API wrappers → **utils**

---

### 3. **engines/** - Processing Powerhouses
**What goes here:**
- Data transformation pipelines
- Code generators
- Parsers and compilers
- Optimization algorithms
- Machine learning models
- Consensus mechanisms

**Key Questions:**
- Does it transform input to output systematically? → **engine**
- Is it a complex algorithm? → **engine**
- Does it generate something? → **engine**
- Is it stateless processing? → **engine**

**Examples:**
```
✅ code-synthesis (generates code)
✅ app-genesis (generates apps)
✅ consensus-engine (multi-agent agreement)
✅ parallelization-engine (distributes work)
✅ template-engine (processes templates)
❌ API client (agent)
❌ Simple formatter (utility)
```

**Rule of Thumb:** 
- Engines are "factories" that produce output
- Agents are "workers" that perform tasks

---

### 4. **utils/** - Helper Functions
**What goes here:**
- Pure functions
- Simple utilities
- Common helpers
- Formatting functions
- Validation functions
- Small, focused tools

**Key Questions:**
- Is it a pure function? → **util**
- Is it under 200 lines? → **util**
- Is it used by multiple components? → **util**
- Does it have no external dependencies? → **util**

**Examples:**
```
✅ logger (logging utility)
✅ validator (input validation)
✅ formatter (data formatting)
✅ retry (retry logic)
✅ debounce (function debouncing)
❌ Jira client (agent)
❌ Code generator (engine)
```

**Size Rule:**
- < 200 lines → **util**
- > 200 lines with logic → **engine** or **agent**

---

### 5. **modules/** - Business Components
**What goes here:**
- Complete business features
- Domain-specific functionality
- Reusable business logic
- Industry-specific components
- Feature bundles

**Key Questions:**
- Is it a complete business feature? → **module**
- Could it be sold as a product? → **module**
- Is it industry-specific? → **module**
- Does it bundle multiple related features? → **module**

**Examples:**
```
✅ ecommerce (cart, checkout, inventory)
✅ authentication (login, OAuth, 2FA)
✅ payment-processing (Stripe, PayPal)
✅ social-feed (posts, likes, comments)
✅ analytics-dashboard (charts, reports)
❌ JSON parser (utility)
❌ Test generator (agent)
```

**Business Test:**
If you can imagine selling it as a SaaS feature → **module**

---

### 6. **tools/** - Development Tools
**What goes here:**
- CLI applications
- Debugging tools
- Development utilities
- Build tools
- Testing frameworks
- Monitoring tools

**Key Questions:**
- Is it used during development? → **tool**
- Does it help debug/monitor? → **tool**
- Is it a CLI tool? → **tool**
- Does it analyze code? → **tool**

**Examples:**
```
✅ caia-cli (command line interface)
✅ debugger (debugging tool)
✅ profiler (performance profiling)
✅ test-runner (test execution)
✅ mock-server (development server)
❌ Production API client (agent)
❌ Business logic (module)
```

---

## 🔄 Edge Cases & Special Rules

### When Something Could Fit Multiple Categories

**Agent vs Engine:**
- Has external dependencies? → **agent**
- Pure transformation? → **engine**
- Makes API calls? → **agent**
- Stateless processing? → **engine**

**Agent vs Module:**
- Single responsibility? → **agent**
- Multiple features bundled? → **module**
- Performs tasks? → **agent**
- Provides business value? → **module**

**Util vs Engine:**
- < 200 lines? → **util**
- Complex algorithm? → **engine**
- Single function? → **util**
- Multiple steps? → **engine**

**Module vs Collection of Agents:**
- Need orchestration? → Multiple **agents**
- Self-contained feature? → **module**
- Different roles working together? → **agents**
- Single business domain? → **module**

---

## 📊 Quick Reference Table

| Category | Purpose | Stateful | Size | External Deps | AI/ML | Examples |
|----------|---------|----------|------|---------------|-------|----------|
| **core** | Orchestration | Yes | Large | Yes | Maybe | CAIA orchestrator |
| **agents** | Task execution | Maybe | Medium | Yes | Often | jira-connect, npm-connector |
| **engines** | Processing | No | Medium | Minimal | Maybe | code-synthesis, consensus |
| **utils** | Helpers | No | Small | No | No | logger, validator |
| **modules** | Business features | Yes | Large | Yes | Maybe | ecommerce, auth |
| **tools** | Development | Maybe | Any | Yes | No | CLI, debugger |

---

## 🎯 Decision Examples

### Example 1: "I built a component that fetches GitHub repos and analyzes them"
- Fetches from API? ✓
- Makes decisions? ✓
- **Answer: agent** → `agents/github-analyzer/`

### Example 2: "I built a markdown to HTML converter"
- Pure transformation? ✓
- No external deps? ✓
- **Answer: engine** → `engines/markdown-converter/`

### Example 3: "I built a function to validate email addresses"
- Single function? ✓
- < 200 lines? ✓
- **Answer: util** → `utils/email-validator/`

### Example 4: "I built a complete user authentication system"
- Multiple features? ✓
- Business value? ✓
- **Answer: module** → `modules/authentication/`

### Example 5: "I built a tool to visualize agent communication"
- Development tool? ✓
- Helps debug? ✓
- **Answer: tool** → `tools/agent-visualizer/`

---

## 🚀 Creating New Components

Based on classification:

```bash
# Agent
npm run create:agent my-agent
# Creates: agents/my-agent/

# Engine
npm run create:engine my-engine
# Creates: engines/my-engine/

# Util
npm run create:util my-util
# Creates: utils/my-util/

# Module
npm run create:module my-module
# Creates: modules/my-module/

# Tool
npm run create:tool my-tool
# Creates: tools/my-tool/
```

---

## 📋 Checklist for Classification

Before creating a component, ask:

1. **What is its primary purpose?**
   - Orchestrate → core
   - Perform tasks → agent
   - Transform data → engine
   - Help other code → util
   - Provide business feature → module
   - Assist development → tool

2. **How complex is it?**
   - Very simple → util
   - Medium complexity → agent/engine
   - High complexity → module/core

3. **What are its dependencies?**
   - None → util
   - External APIs → agent
   - Multiple systems → module

4. **Who uses it?**
   - Other components → util/engine
   - End users → module
   - Developers → tool
   - CAIA itself → core

---

## 🔮 Future Categories

As CAIA grows, we might add:

- **plugins/** - Third-party extensions
- **templates/** - Project templates
- **datasets/** - Training data
- **models/** - ML models
- **configs/** - Configuration presets

Each new category will follow the same classification principles.

---

**Remember**: When in doubt, ask "What is its primary responsibility?" and choose the category that best matches that responsibility.