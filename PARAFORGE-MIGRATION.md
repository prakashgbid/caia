# 📦 ParaForge → CAIA Migration Guide

## Overview
This guide documents how ParaForge components will be migrated into the CAIA ecosystem.

## Migration Map

### From ParaForge → To CAIA

```
paraforge/agents/
├── jira-connect/      → @caia/agent-jira-connect
├── product-owner/     → @caia/agent-product-owner
├── solution-architect/ → @caia/agent-solution-architect
├── ux-designer/       → @caia/agent-ux-designer
└── qa-engineer/       → @caia/agent-qa-engineer

paraforge/src/
├── core/              → @caia/agent-paraforge
├── utils/             → @caia/util-*
└── engines/           → @caia/engine-*
```

## Step-by-Step Migration

### Step 1: Copy Agent to CAIA
```bash
# Copy jira-connect agent
cp -r ~/Documents/projects/paraforge/agents/jira-connect \
      ~/Documents/projects/caia/agents/integration/

# Copy product-owner agent
cp -r ~/Documents/projects/paraforge/agents/product-owner \
      ~/Documents/projects/caia/agents/development/
```

### Step 2: Create Package Structure
Each agent becomes an independent package:

```
caia/agents/integration/jira-connect/
├── package.json       # Independent package
├── tsconfig.json      # TypeScript config
├── README.md          # Documentation
├── src/
│   ├── index.ts       # Main export
│   └── ...
├── tests/
│   └── index.test.ts
└── dist/              # Build output
```

### Step 3: Update Package.json
```json
{
  "name": "@caia/agent-jira-connect",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "publishConfig": {
    "access": "public"
  }
}
```

### Step 4: Update Imports in ParaForge
```typescript
// Before (local)
import { JiraConnect } from './agents/jira-connect';

// After (CAIA package)
import { JiraConnect } from '@caia/agent-jira-connect';
```

### Step 5: ParaForge Becomes CAIA Agent
ParaForge itself becomes an orchestration agent:

```typescript
// @caia/agent-paraforge
export class ParaForge extends CAIAOrchestrationAgent {
  name = 'paraforge';
  description = 'Requirements to Jira transformation';
  
  async orchestrate(input: ProjectIdea) {
    // Use other CAIA agents
    const po = await this.getAgent('@caia/agent-product-owner');
    const jira = await this.getAgent('@caia/agent-jira-connect');
    
    // ParaForge orchestration logic
  }
}
```

## Timeline

### Week 1: Foundation
- [x] Create CAIA repository structure
- [ ] Setup monorepo with Lerna
- [ ] Create core orchestration

### Week 2: Agent Migration
- [ ] Migrate jira-connect → @caia/agent-jira-connect
- [ ] Migrate product-owner → @caia/agent-product-owner
- [ ] Create paraforge → @caia/agent-paraforge

### Week 3: Testing & Publishing
- [ ] Test all migrated components
- [ ] Publish to npm registry
- [ ] Update ParaForge to use CAIA packages

### Week 4: Documentation
- [ ] Complete API documentation
- [ ] Create migration guides
- [ ] Update examples

## Benefits After Migration

### For ParaForge:
- Access to entire CAIA ecosystem
- Community contributions to agents
- Automatic updates from CAIA
- Enterprise-grade infrastructure

### For CAIA:
- ParaForge as flagship orchestration agent
- Real-world usage patterns
- Community growth
- Proven architecture

## Commands

```bash
# In CAIA repository
cd ~/Documents/projects/caia

# Build specific agent
npm run build --workspace=@caia/agent-jira-connect

# Test specific agent
npm run test --workspace=@caia/agent-product-owner

# Publish all changed packages
npm run publish:changed

# Use in ParaForge
cd ~/Documents/projects/paraforge
npm install @caia/agent-jira-connect @caia/agent-product-owner
```

## Future State

### ParaForge Using CAIA:
```typescript
import { CAIA } from '@caia/core';
import { ParaForge } from '@caia/agent-paraforge';

// ParaForge is now part of CAIA
const caia = new CAIA();
caia.registerAgent(ParaForge);

// Execute ParaForge workflow
await caia.execute({
  agent: 'paraforge',
  input: 'Build a social media app',
  output: 'jira'
});
```

### CAIA Using ParaForge:
```typescript
// CAIA can use ParaForge for requirements
const requirements = await caia.execute({
  agent: 'paraforge',
  task: 'gather-requirements',
  input: projectIdea
});

// Then use other agents for implementation
const code = await caia.execute({
  agent: 'app-genesis',
  input: requirements
});
```

## Success Metrics

- [ ] All ParaForge agents published as CAIA packages
- [ ] ParaForge running on CAIA infrastructure
- [ ] Zero breaking changes during migration
- [ ] Community adoption of agents
- [ ] 10x performance improvement

---

**Migration Status**: 🟡 In Progress

**Next Action**: Setup Lerna monorepo and begin agent migration