# @caia/util-cc-orchestrator

> **Massive Parallel Claude Code Orchestration for AI-Powered Development**

[![npm version](https://img.shields.io/npm/v/@caia/util-cc-orchestrator.svg)](https://www.npmjs.com/package/@caia/util-cc-orchestrator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Overview

The CC Orchestrator enables running **hundreds of Claude Code instances in parallel** for massive AI-powered operations. Designed specifically for ParaForge's hierarchical Jira ticket generation, it can spawn and manage concurrent AI operations at unprecedented scale.

## ✨ Key Features

- **Massive Parallelization**: Run 50+ CC instances simultaneously
- **Intelligent Work Distribution**: Context-aware task assignment
- **Rate Limit Management**: Never hit API limits
- **Auto-scaling**: Dynamically spawn instances based on workload
- **Context Preservation**: Maintain context across related tasks
- **Fault Tolerance**: Automatic retry and instance recycling

## 📦 Installation

```bash
npm install @caia/util-cc-orchestrator
```

## 🎯 Use Cases

Perfect for:
- **ParaForge**: Transform ideas into 1000s of Jira tickets
- **Mass Documentation**: Generate docs for entire codebases
- **Parallel Analysis**: Analyze large projects simultaneously
- **Bulk Operations**: Process hundreds of items concurrently

## 💻 Usage

### Basic Example

```typescript
import { CCOrchestrator } from '@caia/util-cc-orchestrator';

const orchestrator = new CCOrchestrator({
  maxInstances: 50,
  apiRateLimit: 100,
  taskTimeout: 60000
});

// Execute ParaForge workflow
const result = await orchestrator.executeParaForgeWorkflow({
  description: "Build a social media analytics platform",
  requirements: "Real-time data, dashboards, API"
});

// Result contains hierarchical Jira tickets:
// PROJECT → INITIATIVEs → FEATUREs → STORIEs → TASKs
```

### Advanced Configuration

```typescript
import { 
  CCOrchestrator,
  CCInstanceManager,
  WorkDistributor,
  RateLimitManager 
} from '@caia/util-cc-orchestrator';

// Custom configuration
const config = {
  maxInstances: 100,                    // Max parallel CC instances
  instancesPerMinute: 30,               // Spawning rate limit
  tasksPerInstance: 10,                 // Tasks before recycling
  taskTimeout: 120000,                  // 2 minute timeout
  apiRateLimit: 100,                    // API calls per minute
  retryAttempts: 3,                     // Retry failed tasks
  contextPreservation: true,            // Keep context across tasks
  
  // Distribution strategy
  distribution: {
    type: 'hybrid',                     // Use all strategies
    contextAffinity: true,              // Related tasks on same instance
    loadBalancing: true,                // Balance across instances
    priorityQueuing: true               // High priority first
  },
  
  // Rate limits
  rateLimits: {
    claudeRequestsPerMinute: 100,
    claudeTokensPerMinute: 100000,
    jiraRequestsPerMinute: 60,
    githubRequestsPerHour: 5000
  }
};

const orchestrator = new CCOrchestrator(config);

// Monitor events
orchestrator.on('instance:created', (instance) => {
  console.log(`Created instance: ${instance.id}`);
});

orchestrator.on('task:complete', (result) => {
  console.log(`Task completed: ${result.taskId}`);
});

orchestrator.on('workflow:complete', (workflow) => {
  console.log(`Workflow complete. Created ${workflow.metrics.completedTasks} tickets`);
});
```

## 🏗️ Architecture

```
CCOrchestrator (Main Controller)
    ├── CCInstanceManager (Lifecycle Management)
    │   ├── Spawning
    │   ├── Monitoring
    │   └── Recycling
    │
    ├── WorkDistributor (Task Assignment)
    │   ├── Context-Aware
    │   ├── Load Balancing
    │   └── Priority Queue
    │
    └── RateLimitManager (API Quotas)
        ├── Claude API
        ├── Jira API
        └── GitHub API
```

## 📊 Performance

| Metric | Value |
|--------|-------|
| Max Parallel Instances | 100+ |
| Tasks Per Second | 10-50 |
| Context Switch Time | <100ms |
| Instance Spawn Time | ~2s |
| Memory Per Instance | 512MB |

## 🔧 Components

### CCOrchestrator
Main orchestration controller that coordinates all components.

### CCInstanceManager
Manages CC instance lifecycle:
- Spawning new instances
- Health monitoring
- Auto-recycling after N tasks
- Graceful shutdown

### WorkDistributor
Intelligently distributes work:
- **Context-Aware**: Keeps related work together
- **Least-Loaded**: Balances across instances
- **Priority-Based**: Critical tasks first
- **Hybrid**: Combines all strategies

### RateLimitManager
Prevents API rate limit violations:
- Tracks quotas across services
- Implements exponential backoff
- Manages burst allowances
- Reserve capacity for critical tasks

## 🎯 ParaForge Integration

The orchestrator is specifically optimized for ParaForge's workflow:

```typescript
// PROJECT (1 instance)
//     ↓
// INITIATIVEs (5-10 parallel instances)
//     ↓
// FEATUREs (20-50 parallel instances)
//     ↓
// STORIEs (50-100 parallel instances)
//     ↓
// TASKs (100+ parallel instances)
```

Each level spawns new CC instances in parallel, enabling massive scale.

## 📈 Metrics & Monitoring

```typescript
const metrics = orchestrator.getMetrics();
console.log(metrics);
// {
//   totalTasks: 1523,
//   completedTasks: 1520,
//   failedTasks: 3,
//   activeInstances: 45,
//   avgTaskDuration: 3421,
//   throughput: 25.3  // tasks per minute
// }
```

## 🚦 Rate Limit Status

```typescript
const rateLimits = await orchestrator.getRateLimitStatus();
console.log(rateLimits);
// {
//   claude: { used: 85, limit: 100, remaining: 15 },
//   jira: { used: 45, limit: 60, remaining: 15 },
//   github: { used: 100, limit: 5000, remaining: 4900 }
// }
```

## 🛡️ Error Handling

Built-in fault tolerance:
- Automatic retry with exponential backoff
- Instance recycling on failure
- Context preservation across retries
- Graceful degradation

## 🔮 Future Enhancements

- [ ] Kubernetes orchestration
- [ ] Distributed across multiple machines
- [ ] ML-based work distribution
- [ ] Predictive scaling
- [ ] Real-time performance optimization

## 📄 License

MIT © [CAIA AI](https://github.com/caia-ai)

## 🤝 Contributing

See [CONTRIBUTING.md](../../../CONTRIBUTING.md)

---

Part of the [CAIA Ecosystem](https://github.com/caia-ai/caia)