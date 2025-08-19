# @caia/core

Core orchestration and agent management system for CAIA (Comprehensive AI Agent) framework.

## Features

- **Agent Management**: Register, manage, and coordinate multiple AI agents
- **Task Distribution**: Intelligent task routing based on agent capabilities
- **Event-Driven Communication**: Robust message bus for inter-agent communication
- **Plugin Architecture**: Extensible plugin system for custom functionality
- **Error Handling**: Comprehensive error handling and recovery mechanisms
- **Health Monitoring**: Built-in health checks and monitoring
- **TypeScript Support**: Full TypeScript support with strict type checking

## Installation

```bash
npm install @caia/core
# or
pnpm add @caia/core
# or
yarn add @caia/core
```

## Quick Start

```typescript
import { 
  Orchestrator, 
  BaseAgent, 
  createDevelopmentConfig,
  TaskPriority 
} from '@caia/core';
import { createLogger } from 'winston';

// Create a custom agent
class MyAgent extends BaseAgent {
  protected async onInitialize(): Promise<void> {
    // Agent initialization logic
  }

  protected async onShutdown(): Promise<void> {
    // Agent cleanup logic
  }

  protected async executeTask(task: Task): Promise<TaskResult> {
    // Task execution logic
    return {
      taskId: task.id,
      status: TaskStatus.COMPLETED,
      result: `Processed: ${task.type}`,
      executionTime: 0,
      completedAt: new Date()
    };
  }

  protected async onTaskCancel(task: Task): Promise<void> {
    // Task cancellation logic
  }
}

// Set up orchestrator
const config = createDevelopmentConfig();
const orchestrator = new Orchestrator(config);
const logger = createLogger(/* winston config */);

// Create and register agent
const agent = new MyAgent({
  id: 'my-agent',
  name: 'My Agent',
  capabilities: [
    { name: 'text-processing', version: '1.0.0' }
  ],
  maxConcurrentTasks: 2
}, logger);

// Start the system
async function start() {
  await orchestrator.start();
  await orchestrator.registerAgent(agent);
  
  // Submit a task
  const taskId = await orchestrator.submitTask({
    type: 'text-processing',
    priority: TaskPriority.MEDIUM,
    payload: { text: 'Hello, world!' }
  });
  
  console.log(`Task submitted: ${taskId}`);
}

start().catch(console.error);
```

## Core Components

### Orchestrator

The central coordination hub that manages agents, distributes tasks, and handles system-wide operations.

```typescript
import { Orchestrator, createProductionConfig } from '@caia/core';

const config = createProductionConfig();
const orchestrator = new Orchestrator(config);

await orchestrator.start();
```

### BaseAgent

Abstract base class for creating custom agents with built-in lifecycle management, error handling, and communication.

```typescript
import { BaseAgent, Task, TaskResult, TaskStatus } from '@caia/core';

class CustomAgent extends BaseAgent {
  protected async executeTask(task: Task): Promise<TaskResult> {
    // Your task execution logic here
    return {
      taskId: task.id,
      status: TaskStatus.COMPLETED,
      result: 'Task completed successfully',
      executionTime: 0,
      completedAt: new Date()
    };
  }
  
  // Implement other abstract methods...
}
```

### MessageBus

Event-driven communication system for inter-agent messaging with support for subscriptions, broadcasts, and request-response patterns.

```typescript
const messageBus = orchestrator.getMessageBus();

// Subscribe to messages
const subscriptionId = messageBus.subscribe(
  { type: MessageType.SYSTEM_EVENT },
  'my-subscriber',
  async (message) => {
    console.log('Received:', message);
  }
);

// Send a message
await messageBus.send({
  type: MessageType.SYSTEM_EVENT,
  from: 'my-agent',
  to: 'target-agent',
  payload: { data: 'Hello!' }
});
```

### PluginManager

Extensible plugin system for adding custom functionality with dependency management and lifecycle control.

```typescript
import { Plugin } from '@caia/core';

class MyPlugin implements Plugin {
  readonly id = 'my-plugin';
  readonly name = 'My Plugin';
  readonly version = '1.0.0';
  
  async initialize(config: Record<string, unknown>): Promise<void> {
    // Plugin initialization
  }
  
  async destroy(): Promise<void> {
    // Plugin cleanup
  }
  
  async onTaskCompleted(result: TaskResult): Promise<void> {
    // Handle task completion
  }
}

const pluginManager = orchestrator.getPluginManager();
await pluginManager.loadPlugin('my-plugin', () => new MyPlugin());
await pluginManager.initializePlugin('my-plugin');
```

## Configuration

### Development Configuration

```typescript
import { createDevelopmentConfig } from '@caia/core';

const config = createDevelopmentConfig();
// Lower limits, verbose logging, suitable for development
```

### Production Configuration

```typescript
import { createProductionConfig } from '@caia/core';

const config = createProductionConfig();
// Higher limits, optimized for production use
```

### Custom Configuration

```typescript
import { OrchestratorConfig } from '@caia/core';

const config: OrchestratorConfig = {
  maxConcurrentTasks: 1000,
  taskTimeout: 300000,
  healthCheckInterval: 30000,
  retryPolicy: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2
  },
  logging: {
    level: 'info',
    format: 'json'
  },
  plugins: []
};
```

## Task Management

### Task Submission

```typescript
import { TaskPriority } from '@caia/core';

const taskId = await orchestrator.submitTask({
  type: 'data-processing',
  priority: TaskPriority.HIGH,
  payload: { data: 'input data' },
  requirements: ['data-processing'], // Required capabilities
  timeout: 60000, // 1 minute timeout
  deadline: new Date(Date.now() + 300000) // 5 minute deadline
});
```

### Task Status Tracking

```typescript
const status = orchestrator.getTaskStatus(taskId);
console.log(`Task ${taskId} status: ${status}`);

// Listen for task completion
orchestrator.on('taskCompleted', (event) => {
  console.log(`Task ${event.result.taskId} completed with status: ${event.result.status}`);
});
```

## Error Handling

The framework provides comprehensive error handling with specific error types:

```typescript
import { CAIAError, AgentError, TaskError, PluginError } from '@caia/core';

try {
  await orchestrator.submitTask(invalidTask);
} catch (error) {
  if (error instanceof TaskError) {
    console.error('Task error:', error.message, error.taskId);
  } else if (error instanceof AgentError) {
    console.error('Agent error:', error.message, error.agentId);
  } else if (error instanceof PluginError) {
    console.error('Plugin error:', error.message, error.pluginId);
  } else if (error instanceof CAIAError) {
    console.error('CAIA error:', error.message, error.code);
  }
}
```

## Monitoring and Statistics

```typescript
// Get system statistics
const stats = orchestrator.getStats();
console.log('System stats:', {
  totalTasks: stats.totalTasks,
  completedTasks: stats.completedTasks,
  failedTasks: stats.failedTasks,
  activeAgents: stats.activeAgents,
  averageTaskTime: stats.averageTaskTime
});

// Get agent metadata
const agentMetadata = orchestrator.getAgentMetadata('agent-id');
console.log('Agent stats:', {
  status: agentMetadata.status,
  currentTasks: agentMetadata.currentTasks.length,
  completedTasks: agentMetadata.completedTasks,
  uptime: agentMetadata.uptime
});
```

## Examples

Check the `examples/` directory for complete usage examples:

- `SimpleAgent.ts` - Basic agent implementation
- `usage.ts` - Complete system setup and usage

To run the examples:

```bash
npm run build
node dist/examples/usage.js
```

## API Reference

### Classes

- `Orchestrator` - Main orchestration hub
- `BaseAgent` - Abstract base class for agents
- `MessageBus` - Inter-agent communication
- `PluginManager` - Plugin system management

### Types

- `Task` - Task definition
- `TaskResult` - Task execution result
- `AgentConfig` - Agent configuration
- `Message` - Communication message
- `Plugin` - Plugin interface

### Enums

- `AgentStatus` - Agent lifecycle states
- `TaskStatus` - Task execution states
- `TaskPriority` - Task priority levels
- `MessageType` - Message categories

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
npm run lint:fix
```

### Type Checking

```bash
npx tsc --noEmit
```

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## Support

For issues and questions, please use the GitHub issue tracker.