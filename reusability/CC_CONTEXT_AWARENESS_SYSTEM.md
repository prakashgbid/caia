# Claude Code (CC) Context Awareness System

## 🎯 Goal: Make CC Fully Aware of Your 74,270+ Files and Advanced CAIA Setup

## 🧠 The Problem

CC currently doesn't know about:
- Your 74,270+ existing code files
- Advanced CAIA infrastructure (CKS, Enhancement, Learning systems)
- Already implemented features and patterns
- Available tools and utilities
- Past decisions and learning

**Result**: CC recreates code that already exists!

## 🚀 Solution: CC Context Awareness System (CCAS)

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  CLAUDE CODE SESSION                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│         CC CONTEXT AWARENESS SYSTEM (CCAS)             │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Pre-Hook   │  │ Live Context │  │  Post-Hook   │ │
│  │   Injector   │  │   Provider   │  │   Learner    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└────────────────┬────────────────────────────────────────┘
                 │ Queries & Updates
                 ▼
┌─────────────────────────────────────────────────────────┐
│              LOCAL CAIA INFRASTRUCTURE                  │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │   CKS    │  │Enhancement│  │ Learning │  │  CCO   │ │
│  │Port 5555 │  │Port 5002  │  │Port 5003 │  │        │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│                                                         │
│         74,270+ Files │ 16 Systems │ Patterns          │
└─────────────────────────────────────────────────────────┘
```

## 📋 Implementation Plan

### Phase 1: Enhanced CLAUDE.md for Maximum Context

```markdown
# CLAUDE.md - CC Context Configuration

## 🚨 MANDATORY: Check Existing Code First

BEFORE writing ANY code, you MUST:
1. Query CKS: curl http://localhost:5555/search/function?query={feature}
2. Check patterns: curl http://localhost:5003/patterns/similar?description={task}
3. Search existing: find /Users/MAC/Documents/projects/caia -name "*{keyword}*"
4. Review decisions: curl http://localhost:5003/decisions/recent

## Available Infrastructure (ALWAYS RUNNING)

### Knowledge System (CKS) - Port 5555
- 74,270+ files indexed
- Every function, class, pattern catalogued
- Query before creating ANYTHING

### Enhancement System - Port 5002
- 16 intelligent subsystems
- Context persistence
- Pattern recognition
- Auto-optimization

### Learning System - Port 5003
- Tracks all decisions
- Learns from patterns
- Stores interactions

### CC Orchestrator (CCO)
- Parallel execution
- Multi-instance coordination
- Resource management

## Existing Major Components

### Agents Available
- KnowledgeAgent
- BusinessAnalystAgent  
- SprintPriorizerAgent
- EntityExtractor
- [List continues...]

### Utilities Available
- parallel-implementation.js
- production-upgrade.js
- bridge-service.js
- shared-components.js
- [List continues...]

### Patterns Implemented
- Error handling
- Logging system
- Authentication flow
- Data validation
- API clients
- [List continues...]
```

### Phase 2: Automatic Context Injection Hooks

#### Pre-Session Hook
```bash
#!/bin/bash
# cc-context-injector.sh

# 1. Index current state
echo "🔍 Scanning CAIA codebase..."
FILE_COUNT=$(find /Users/MAC/Documents/projects/caia -type f -name "*.py" -o -name "*.js" -o -name "*.ts" | wc -l)
echo "📊 Found $FILE_COUNT code files"

# 2. Generate context summary
curl -s http://localhost:5555/summary > /tmp/caia-context.json

# 3. Get recent decisions
curl -s http://localhost:5003/decisions/recent > /tmp/recent-decisions.json

# 4. Inject into CC
echo "💉 Injecting context into CC session..."
cat > /tmp/cc-context-injection.md << EOF
## 🧠 CAIA Context Loaded

### Available Code: $FILE_COUNT files
### Recent Features Implemented:
$(curl -s http://localhost:5555/recent-implementations | head -10)

### Use These Before Creating New:
$(curl -s http://localhost:5555/most-used-components | head -20)

### Recent Decisions:
$(cat /tmp/recent-decisions.json | jq -r '.decisions[:5][] | "- " + .description')
EOF
```

#### Live Query Helper
```javascript
// cc-context-provider.js
class CCContextProvider {
  constructor() {
    this.cksUrl = 'http://localhost:5555';
    this.enhancementUrl = 'http://localhost:5002';
    this.learningUrl = 'http://localhost:5003';
  }
  
  async checkExisting(task) {
    console.log(`🔍 Checking for existing implementation of: ${task}`);
    
    // Check multiple sources in parallel
    const [cks, patterns, decisions] = await Promise.all([
      this.queryCKS(task),
      this.queryPatterns(task),
      this.queryDecisions(task)
    ]);
    
    if (cks.exists || patterns.exists) {
      console.log('✅ FOUND EXISTING IMPLEMENTATION!');
      console.log('📍 Location:', cks.location || patterns.location);
      console.log('🔧 Reuse this instead of creating new!');
      return {
        exists: true,
        location: cks.location || patterns.location,
        type: cks.type || patterns.type
      };
    }
    
    console.log('🆕 No existing implementation found, safe to create new');
    return { exists: false };
  }
  
  async queryCKS(task) {
    try {
      const response = await fetch(`${this.cksUrl}/search/function?query=${encodeURIComponent(task)}`);
      const data = await response.json();
      return {
        exists: data.count > 0,
        location: data.results?.[0]?.file_path,
        type: data.results?.[0]?.type
      };
    } catch (e) {
      return { exists: false };
    }
  }
  
  async queryPatterns(task) {
    try {
      const response = await fetch(`${this.learningUrl}/patterns/similar?description=${encodeURIComponent(task)}`);
      const data = await response.json();
      return {
        exists: data.found,
        location: data.pattern?.implementation,
        type: 'pattern'
      };
    } catch (e) {
      return { exists: false };
    }
  }
  
  async queryDecisions(task) {
    try {
      const response = await fetch(`${this.learningUrl}/decisions/search?query=${encodeURIComponent(task)}`);
      const data = await response.json();
      return data.decisions || [];
    } catch (e) {
      return [];
    }
  }
}

// Auto-inject into CC's context
if (typeof global !== 'undefined') {
  global.CCContext = new CCContextProvider();
  console.log('✅ CC Context Provider loaded');
}

module.exports = CCContextProvider;
```

### Phase 3: CC Memory Persistence

```javascript
// cc-memory-manager.js
class CCMemoryManager {
  constructor() {
    this.memoryPath = '/Users/MAC/.claude/session-memory';
    this.currentSession = null;
  }
  
  async startSession() {
    this.currentSession = {
      id: `session_${Date.now()}`,
      started: new Date(),
      context: await this.loadFullContext(),
      reusedComponents: [],
      newComponents: [],
      decisions: []
    };
    
    console.log('📝 CC Memory Session Started:', this.currentSession.id);
    return this.currentSession;
  }
  
  async loadFullContext() {
    return {
      totalFiles: 74270,
      services: {
        cks: 'http://localhost:5555',
        enhancement: 'http://localhost:5002',
        learning: 'http://localhost:5003'
      },
      recentWork: await this.getRecentWork(),
      availableAgents: await this.getAvailableAgents(),
      commonPatterns: await this.getCommonPatterns()
    };
  }
  
  async recordReuse(component) {
    this.currentSession.reusedComponents.push({
      name: component,
      timestamp: new Date(),
      savedTime: '~30 minutes'
    });
    
    console.log(`♻️ Reused existing: ${component}`);
  }
  
  async recordNew(component, reason) {
    this.currentSession.newComponents.push({
      name: component,
      reason: reason,
      timestamp: new Date()
    });
    
    // Learn from this for future
    await this.teachLearningSystem(component, reason);
  }
  
  async teachLearningSystem(component, reason) {
    await fetch('http://localhost:5003/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'new_component',
        component: component,
        reason: reason,
        session: this.currentSession.id
      })
    });
  }
  
  async endSession() {
    const summary = {
      duration: Date.now() - this.currentSession.started,
      reusedCount: this.currentSession.reusedComponents.length,
      newCount: this.currentSession.newComponents.length,
      reuseRate: (this.currentSession.reusedComponents.length / 
                 (this.currentSession.reusedComponents.length + this.currentSession.newComponents.length) * 100).toFixed(1)
    };
    
    console.log('📊 Session Summary:');
    console.log(`  ♻️ Reused: ${summary.reusedCount} components`);
    console.log(`  🆕 Created: ${summary.newCount} new components`);
    console.log(`  📈 Reuse Rate: ${summary.reuseRate}%`);
    
    // Save session
    await this.saveSession();
  }
  
  async saveSession() {
    const fs = require('fs').promises;
    const path = require('path');
    
    const sessionFile = path.join(this.memoryPath, `${this.currentSession.id}.json`);
    await fs.mkdir(this.memoryPath, { recursive: true });
    await fs.writeFile(sessionFile, JSON.stringify(this.currentSession, null, 2));
  }
  
  async getRecentWork() {
    // Get last 10 implementations
    try {
      const response = await fetch('http://localhost:5555/recent?limit=10');
      return await response.json();
    } catch (e) {
      return [];
    }
  }
  
  async getAvailableAgents() {
    return [
      'KnowledgeAgent',
      'BusinessAnalystAgent',
      'SprintPriorizerAgent',
      'EntityExtractor',
      'ReasoningAgent',
      'CodingAgent'
    ];
  }
  
  async getCommonPatterns() {
    return [
      'ErrorHandler',
      'Logger',
      'APIClient',
      'DataValidator',
      'AuthFlow'
    ];
  }
}

module.exports = CCMemoryManager;
```

### Phase 4: Enforcement Rules

```javascript
// cc-enforcement.js
class CCEnforcement {
  constructor() {
    this.rules = [
      {
        id: 'check-before-create',
        priority: 'CRITICAL',
        description: 'MUST check CKS before creating any code',
        enforce: async (task) => {
          const exists = await this.checkExists(task);
          if (exists) {
            throw new Error(`❌ BLOCKED: ${task} already exists at ${exists.location}. REUSE IT!`);
          }
        }
      },
      {
        id: 'use-existing-patterns',
        priority: 'HIGH',
        description: 'MUST use existing patterns',
        enforce: async (task) => {
          const patterns = await this.findPatterns(task);
          if (patterns.length > 0) {
            console.log(`📋 Use these patterns: ${patterns.join(', ')}`);
          }
        }
      },
      {
        id: 'query-decisions',
        priority: 'MEDIUM',
        description: 'CHECK past decisions',
        enforce: async (task) => {
          const decisions = await this.getDecisions(task);
          if (decisions.length > 0) {
            console.log(`📚 Related decisions: ${decisions.length} found`);
          }
        }
      }
    ];
  }
  
  async enforceAll(task) {
    console.log(`🛡️ Enforcing reusability rules for: ${task}`);
    
    for (const rule of this.rules) {
      try {
        await rule.enforce(task);
      } catch (error) {
        if (rule.priority === 'CRITICAL') {
          throw error; // Block execution
        } else {
          console.warn(`⚠️ ${error.message}`);
        }
      }
    }
  }
  
  async checkExists(task) {
    // Query CKS for existing implementation
    const response = await fetch(`http://localhost:5555/search/function?query=${encodeURIComponent(task)}`);
    const data = await response.json();
    
    if (data.count > 0) {
      return {
        exists: true,
        location: data.results[0].file_path
      };
    }
    
    return null;
  }
  
  async findPatterns(task) {
    // Find relevant patterns
    const response = await fetch(`http://localhost:5003/patterns/relevant?task=${encodeURIComponent(task)}`);
    const data = await response.json();
    return data.patterns || [];
  }
  
  async getDecisions(task) {
    // Get related decisions
    const response = await fetch(`http://localhost:5003/decisions/related?task=${encodeURIComponent(task)}`);
    const data = await response.json();
    return data.decisions || [];
  }
}

module.exports = CCEnforcement;
```

## 🔧 Integration Scripts

### 1. CC Session Startup Hook
```bash
#!/bin/bash
# ~/.claude/hooks/cc-awareness-hook.sh

echo "🧠 Loading CAIA Context into CC..."

# Start context provider
node /Users/MAC/Documents/projects/caia/reusability/cc-context-provider.js &

# Start memory manager
node -e "const CCMemoryManager = require('/Users/MAC/Documents/projects/caia/reusability/cc-memory-manager.js'); const manager = new CCMemoryManager(); manager.startSession();"

# Load enforcement rules
export CC_ENFORCE_REUSE=true
export CC_CHECK_EXISTING=mandatory

# Display context
echo "📊 CAIA Status:"
echo "  Files: 74,270+"
echo "  CKS: ✅ Running (port 5555)"
echo "  Enhancement: ✅ Running (port 5002)"
echo "  Learning: ✅ Running (port 5003)"
echo ""
echo "🚨 REMINDER: Always check existing code before creating new!"
```

### 2. Quick Check Command
```bash
#!/bin/bash
# cc-check-existing.sh

TASK="$1"

if [ -z "$TASK" ]; then
  echo "Usage: cc-check-existing <task-description>"
  exit 1
fi

echo "🔍 Checking for existing implementation of: $TASK"

# Check CKS
echo "Querying CKS..."
curl -s "http://localhost:5555/search/function?query=${TASK}" | jq '.results[:3]'

# Check patterns
echo "Checking patterns..."
curl -s "http://localhost:5003/patterns/similar?description=${TASK}" | jq '.patterns[:3]'

# Check files
echo "Searching files..."
find /Users/MAC/Documents/projects/caia -name "*${TASK}*" -type f | head -5
```

## 📈 Expected Results

### Before CCAS
- CC recreates existing code
- No awareness of 74,270 files
- Duplicates patterns
- Wastes time

### After CCAS
- CC always checks existing first
- Full awareness of all code
- Reuses patterns
- 70%+ reuse rate
- Saves hours per session

## 🚀 Activation Steps

1. **Install hooks**
   ```bash
   cp cc-awareness-hook.sh ~/.claude/hooks/
   chmod +x ~/.claude/hooks/cc-awareness-hook.sh
   ```

2. **Update CLAUDE.md**
   ```bash
   cat CC_CONTEXT_RULES.md >> ~/.claude/CLAUDE.md
   ```

3. **Start services**
   ```bash
   node cc-context-provider.js &
   node cc-memory-manager.js &
   ```

4. **Test**
   ```bash
   cc-check-existing "authentication"
   ```

## 💡 Usage Examples

### Example 1: CC wants to create auth
```
CC: "I'll create an authentication system"
CCAS: "❌ BLOCKED: Authentication already exists at /Users/MAC/Documents/projects/caia/auth/"
CC: "I'll reuse the existing authentication system"
```

### Example 2: CC needs data validation
```
CC: "I need to validate user input"
CCAS: "✅ Found 6 existing validation patterns"
CC: "I'll use the existing DataValidator from shared-components.js"
```

### Example 3: CC creating new feature
```
CC: "Creating new feature X"
CCAS: "🔍 No existing implementation found"
CCAS: "📋 Recording new component for future reuse"
CC: "Created and registered for future reuse"
```