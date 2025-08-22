# CAIA API Documentation

Comprehensive API reference for the CAIA (Chief AI Agent) framework.

## Table of Contents

- [Core API](#core-api)
- [Agent API](#agent-api)
- [Orchestration API](#orchestration-api)
- [Workflow API](#workflow-api)
- [ParaForge API](#paraforge-api)
- [Utilities API](#utilities-api)
- [Integration Examples](#integration-examples)

## Core API

### CAIA Class

The main entry point for the CAIA framework.

```typescript
import { CAIA } from '@caia/core';

interface CAIAConfig {
  agents?: AgentConfig[];
  orchestration?: OrchestrationConfig;
  monitoring?: MonitoringConfig;
  storage?: StorageConfig;
}

class CAIA {
  constructor(config?: CAIAConfig);
  
  // Core methods
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Agent management
  registerAgent(name: string, agent: BaseAgent): void;
  getAgent(name: string): BaseAgent | undefined;
  listAgents(): string[];
  
  // Task execution
  executeTask(task: Task): Promise<TaskResult>;
  executeBatch(tasks: Task[]): Promise<TaskResult[]>;
  
  // Workflow orchestration
  orchestrate(workflow: WorkflowDefinition): Promise<WorkflowResult>;
  
  // Monitoring
  getMetrics(): Promise<SystemMetrics>;
  getHealth(): Promise<HealthStatus>;
}
```

#### Example Usage

```javascript
const caia = new CAIA({
  orchestration: {
    strategy: 'intelligent',
    parallelLimit: 10
  },
  monitoring: {
    enableMetrics: true,
    logLevel: 'info'
  }
});

await caia.initialize();

// Register agents
caia.registerAgent('product-owner', new ProductOwnerAgent(config));
caia.registerAgent('frontend-engineer', new FrontendEngineerAgent(config));

// Execute task
const result = await caia.executeTask({
  id: 'build-feature',
  type: 'development',
  payload: {
    feature: 'user authentication',
    requirements: 'JWT-based auth with refresh tokens'
  }
});
```

## Agent API

### BaseAgent Class

All CAIA agents extend this base class.

```typescript
abstract class BaseAgent {
  protected config: AgentConfig;
  protected aiProvider: AIProvider;
  protected memory: AgentMemory;
  protected logger: Logger;

  constructor(config: AgentConfig);
  
  // Abstract methods (must be implemented)
  abstract processTask(task: Task): Promise<TaskResult>;
  abstract getCapabilities(): string[];
  abstract getSpecialization(): AgentSpecialization;
  
  // Common methods
  async initialize(): Promise<void>;
  async shutdown(): Promise<void>;
  async callAI(prompt: string, options?: AICallOptions): Promise<string>;
  async storeMemory(key: string, data: any): Promise<void>;
  async retrieveMemory(key: string): Promise<any>;
  async sendMessage(targetAgent: string, message: Message): Promise<void>;
  
  // Health and metrics
  getHealth(): HealthStatus;
  getMetrics(): AgentMetrics;
}
```

### Agent Configuration

```typescript
interface AgentConfig {
  name: string;
  version: string;
  description?: string;
  capabilities: string[];
  specialization: AgentSpecialization;
  
  ai: {
    provider: 'openai' | 'anthropic' | 'gemini';
    model: string;
    apiKey: string;
    maxTokens?: number;
    temperature?: number;
  };
  
  memory: {
    type: 'memory' | 'redis' | 'postgres';
    config: MemoryConfig;
  };
  
  communication: {
    protocol: 'direct' | 'message-queue' | 'event-bus';
    config: CommunicationConfig;
  };
  
  monitoring: {
    enableMetrics: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    traceRequests: boolean;
  };
}
```

### Creating Custom Agents

```typescript
import { BaseAgent, AgentConfig, Task, TaskResult } from '@caia/core';

class CustomAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super({
      name: 'Custom Agent',
      version: '1.0.0',
      capabilities: ['custom-processing'],
      specialization: {
        domain: 'custom',
        expertise: ['specialized-task'],
        complexity: 'intermediate'
      },
      ...config
    });
  }

  async processTask(task: Task): Promise<TaskResult> {
    // Implement custom logic
    const result = await this.customProcessing(task.payload);
    
    return {
      success: true,
      data: result,
      metadata: {
        processingTime: Date.now() - task.createdAt,
        agent: this.config.name
      }
    };
  }

  getCapabilities(): string[] {
    return this.config.capabilities;
  }

  getSpecialization(): AgentSpecialization {
    return this.config.specialization;
  }

  private async customProcessing(payload: any): Promise<any> {
    // Custom processing logic
    return payload;
  }
}
```

## Orchestration API

### AgentOrchestrator Class

```typescript
class AgentOrchestrator {
  constructor(config: OrchestratorConfig);
  
  // Initialization
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Agent coordination
  coordinateAgents(request: CoordinationRequest): Promise<CoordinationResult>;
  executeParallel(tasks: Task[], agents: string[]): Promise<TaskResult[]>;
  executeSequential(tasks: Task[], agents: string[]): Promise<TaskResult[]>;
  
  // Workflow execution
  executeWorkflow(workflow: WorkflowDefinition): Promise<WorkflowResult>;
  
  // Agent management
  addAgent(name: string, agent: BaseAgent): void;
  removeAgent(name: string): void;
  getAgent(name: string): BaseAgent | undefined;
  
  // Load balancing
  getOptimalAgent(capability: string): BaseAgent | undefined;
  distributeLoad(tasks: Task[]): Map<string, Task[]>;
}
```

### Coordination Strategies

```typescript
type CoordinationStrategy = 
  | 'sequential'    // Execute agents one after another
  | 'parallel'      // Execute agents simultaneously
  | 'intelligent'   // AI-driven coordination
  | 'conditional';  // Rule-based coordination

interface CoordinationRequest {
  strategy: CoordinationStrategy;
  agents: string[];
  task: Task;
  constraints?: {
    timeout?: number;
    maxRetries?: number;
    failureHandling?: 'abort' | 'continue' | 'retry';
  };
}
```

### Example: Multi-Agent Coordination

```javascript
const orchestrator = new AgentOrchestrator({
  agents: {
    'product-owner': new ProductOwnerAgent(config),
    'solution-architect': new SolutionArchitectAgent(config),
    'frontend-engineer': new FrontendEngineerAgent(config)
  },
  coordination: 'intelligent'
});

// Execute workflow with agent coordination
const result = await orchestrator.executeWorkflow({
  name: 'build-feature',
  steps: [
    {
      name: 'analyze-requirements',
      agent: 'product-owner',
      input: 'Feature requirements document'
    },
    {
      name: 'design-architecture',
      agent: 'solution-architect',
      dependsOn: ['analyze-requirements'],
      input: '${analyze-requirements.output}'
    },
    {
      name: 'implement-frontend',
      agent: 'frontend-engineer',
      dependsOn: ['design-architecture'],
      input: '${design-architecture.output}',
      parallel: true
    }
  ]
});
```

## Workflow API

### WorkflowEngine Class

```typescript
class WorkflowEngine {
  constructor(config: WorkflowConfig);
  
  // Workflow execution
  execute(workflow: WorkflowDefinition): Promise<WorkflowResult>;
  executeStep(step: WorkflowStep): Promise<StepResult>;
  
  // Workflow management
  createWorkflow(definition: WorkflowDefinition): Workflow;
  saveWorkflow(workflow: Workflow): Promise<void>;
  loadWorkflow(id: string): Promise<Workflow>;
  
  // Monitoring
  getExecutionStatus(workflowId: string): Promise<ExecutionStatus>;
  getExecutionHistory(workflowId: string): Promise<ExecutionHistory>;
  
  // Optimization
  optimizeWorkflow(workflow: WorkflowDefinition): Promise<OptimizedWorkflow>;
}
```

### Workflow Definition

```typescript
interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: string;
  
  steps: WorkflowStep[];
  
  // Global configuration
  timeout?: number;
  retryPolicy?: RetryPolicy;
  errorHandling?: ErrorHandling;
  
  // Optimization settings
  optimization?: {
    enableParallel: boolean;
    maxConcurrency: number;
    resourceLimits: ResourceLimits;
  };
}

interface WorkflowStep {
  id: string;
  name: string;
  agent: string;
  
  // Input/Output
  input: any;
  expectedOutput?: any;
  
  // Dependencies
  dependsOn?: string[];
  parallel?: boolean;
  
  // Configuration
  timeout?: number;
  retries?: number;
  condition?: string; // JavaScript expression
  
  // Error handling
  onError?: 'abort' | 'continue' | 'retry' | 'fallback';
  fallback?: WorkflowStep;
}
```

### Example: Complex Workflow

```javascript
const workflow = {
  id: 'e-commerce-build',
  name: 'E-commerce Platform Build',
  version: '1.0.0',
  
  steps: [
    {
      id: 'requirements',
      name: 'Analyze Requirements',
      agent: 'product-owner',
      input: {
        idea: 'Modern e-commerce platform',
        features: ['user-auth', 'product-catalog', 'payments']
      }
    },
    {
      id: 'architecture',
      name: 'Design Architecture',
      agent: 'solution-architect',
      dependsOn: ['requirements'],
      input: '${requirements.output}'
    },
    {
      id: 'frontend',
      name: 'Build Frontend',
      agent: 'frontend-engineer',
      dependsOn: ['architecture'],
      parallel: true,
      input: {
        architecture: '${architecture.output}',
        requirements: '${requirements.output.userStories}'
      }
    },
    {
      id: 'backend',
      name: 'Build Backend',
      agent: 'backend-engineer',
      dependsOn: ['architecture'],
      parallel: true,
      input: {
        architecture: '${architecture.output}',
        requirements: '${requirements.output.apiRequirements}'
      }
    },
    {
      id: 'integration',
      name: 'Integration Testing',
      agent: 'qa-engineer',
      dependsOn: ['frontend', 'backend'],
      input: {
        frontend: '${frontend.output}',
        backend: '${backend.output}'
      }
    }
  ],
  
  optimization: {
    enableParallel: true,
    maxConcurrency: 5
  }
};

const engine = new WorkflowEngine({ orchestrator });
const result = await engine.execute(workflow);
```

## ParaForge API

### ParaForgeCore Class

The main ParaForge agent for transforming ideas into JIRA structures.

```typescript
class ParaForgeCore {
  constructor(config: ParaForgeConfig);
  
  // Initialization
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Core functionality
  processIdea(idea: ProjectIdea): Promise<ProjectResult>;
  analyzeRequirements(requirements: string, options?: AnalysisOptions): Promise<RequirementsAnalysis>;
  createJiraHierarchy(projectData: ProjectData): Promise<JiraCreationResult>;
  
  // JIRA operations
  ensureProject(projectConfig: JiraProjectConfig): Promise<JiraProject>;
  createIssue(issueData: IssueData): Promise<JiraIssue>;
  linkIssues(parentKey: string, childKey: string, linkType: string): Promise<void>;
  
  // Optimization
  optimizeSchedule(tasks: Task[]): Promise<OptimizedSchedule>;
  
  // Learning and improvement
  learn(projectOutcome: ProjectOutcome): Promise<LearningResult>;
  
  // Utilities
  testConnection(): Promise<ConnectionResult>;
  getStatistics(projectKey?: string): Promise<ProjectStatistics>;
}
```

### ParaForge Configuration

```typescript
interface ParaForgeConfig {
  jira: {
    host: string;
    email: string;
    apiToken: string;
  };
  
  ai: {
    openai?: string;
    anthropic?: string;
    gemini?: string;
  };
  
  options?: {
    enableLearning?: boolean;
    optimizeParallel?: boolean;
    generateDocumentation?: boolean;
    enableMetrics?: boolean;
  };
}
```

### Example: Processing an Idea

```javascript
const paraforge = new ParaForgeCore({
  jira: {
    host: 'company.atlassian.net',
    email: 'user@company.com',
    apiToken: 'api-token'
  },
  ai: {
    anthropic: 'anthropic-api-key'
  },
  options: {
    enableLearning: true,
    optimizeParallel: true
  }
});

await paraforge.initialize();

const result = await paraforge.processIdea({
  title: 'E-commerce Platform',
  description: 'Build a modern e-commerce platform with user accounts, product catalog, and payment processing',
  goals: ['Launch MVP in 3 months', 'Support 10,000 users'],
  constraints: {
    timeline: '3 months',
    budget: '$100,000',
    team: '5 developers'
  }
});

console.log('Created:', result.created);
console.log('Optimization:', result.optimization);
```

### CLI API

```bash
# ParaForge CLI commands
paraforge process --idea "Build a todo app"
paraforge process --file requirements.txt
paraforge analyze requirements.md
paraforge create epic --title "User Management" --project DEMO
paraforge workflow sprint --project DEMO --duration 2
paraforge test
paraforge config
paraforge interactive
```

## Utilities API

### CC Orchestrator

Parallel execution utility for Claude Code instances.

```typescript
class CCOrchestrator {
  constructor(config: CCOConfig);
  
  // Execution
  executeWorkflow(workflow: WorkflowConfig): Promise<WorkflowResult>;
  executeParallel(tasks: ParallelTask[]): Promise<TaskResult[]>;
  
  // Resource management
  calculateOptimalInstances(): Promise<number>;
  adjustInstances(newCount: number): Promise<void>;
  
  // Monitoring
  getSystemResources(): Promise<SystemResources>;
  getInstanceStatus(): Promise<InstanceStatus[]>;
  
  // Cleanup
  shutdown(): Promise<void>;
}
```

### Memory Systems

```typescript
interface AgentMemory {
  // Basic operations
  store(key: string, data: any, ttl?: number): Promise<void>;
  retrieve(key: string): Promise<any>;
  delete(key: string): Promise<void>;
  
  // Bulk operations
  storeBatch(items: MemoryItem[]): Promise<void>;
  retrieveBatch(keys: string[]): Promise<any[]>;
  
  // Search and query
  search(query: string): Promise<SearchResult[]>;
  findSimilar(data: any, limit?: number): Promise<SimilarityResult[]>;
  
  // Lifecycle
  clear(): Promise<void>;
  export(): Promise<MemoryExport>;
  import(data: MemoryExport): Promise<void>;
}
```

### Monitoring and Metrics

```typescript
interface MetricsCollector {
  // Counters
  increment(metric: string, value?: number, tags?: Tags): void;
  decrement(metric: string, value?: number, tags?: Tags): void;
  
  // Gauges
  gauge(metric: string, value: number, tags?: Tags): void;
  
  // Timers
  startTimer(metric: string, tags?: Tags): Timer;
  time<T>(metric: string, fn: () => Promise<T>, tags?: Tags): Promise<T>;
  
  // Histograms
  histogram(metric: string, value: number, tags?: Tags): void;
  
  // Collection
  getMetrics(): Promise<MetricsSnapshot>;
  exportMetrics(format: 'prometheus' | 'json'): Promise<string>;
}
```

## Integration Examples

### Express.js Integration

```javascript
const express = require('express');
const { CAIA } = require('@caia/core');

const app = express();
const caia = new CAIA();

app.use(express.json());

// Initialize CAIA
app.listen(3000, async () => {
  await caia.initialize();
  console.log('CAIA server running on port 3000');
});

// API endpoint for task execution
app.post('/api/execute', async (req, res) => {
  try {
    const { task } = req.body;
    const result = await caia.executeTask(task);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = await caia.getHealth();
  res.json(health);
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  const metrics = await caia.getMetrics();
  res.json(metrics);
});
```

### React Integration

```typescript
// React hook for CAIA integration
import { useState, useEffect } from 'react';
import { CAIAClient } from '@caia/client';

interface UseCAIAOptions {
  apiUrl: string;
  apiKey?: string;
}

export function useCAIA(options: UseCAIAOptions) {
  const [client] = useState(() => new CAIAClient(options));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeTask = async (task: Task) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await client.executeTask(task);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const executeWorkflow = async (workflow: WorkflowDefinition) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await client.executeWorkflow(workflow);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    executeTask,
    executeWorkflow,
    loading,
    error
  };
}

// Usage in component
function MyComponent() {
  const caia = useCAIA({ apiUrl: 'http://localhost:3000' });
  
  const handleExecuteTask = async () => {
    const result = await caia.executeTask({
      id: 'generate-component',
      type: 'code-generation',
      payload: {
        component: 'UserProfile',
        framework: 'react',
        features: ['validation', 'responsive']
      }
    });
    
    console.log('Generated component:', result);
  };
  
  return (
    <div>
      <button onClick={handleExecuteTask} disabled={caia.loading}>
        {caia.loading ? 'Generating...' : 'Generate Component'}
      </button>
      {caia.error && <div className="error">{caia.error}</div>}
    </div>
  );
}
```

### Python Integration

```python
# Python client for CAIA
import asyncio
import aiohttp
from typing import Dict, Any, Optional

class CAIAClient:
    def __init__(self, api_url: str, api_key: Optional[str] = None):
        self.api_url = api_url.rstrip('/')
        self.api_key = api_key
        self.session = None
    
    async def __aenter__(self):
        headers = {}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'
        
        self.session = aiohttp.ClientSession(headers=headers)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def execute_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a task using CAIA"""
        async with self.session.post(
            f'{self.api_url}/api/execute',
            json={'task': task}
        ) as response:
            response.raise_for_status()
            return await response.json()
    
    async def execute_workflow(self, workflow: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a workflow using CAIA"""
        async with self.session.post(
            f'{self.api_url}/api/workflow',
            json={'workflow': workflow}
        ) as response:
            response.raise_for_status()
            return await response.json()
    
    async def get_health(self) -> Dict[str, Any]:
        """Get CAIA health status"""
        async with self.session.get(f'{self.api_url}/health') as response:
            response.raise_for_status()
            return await response.json()

# Usage example
async def main():
    async with CAIAClient('http://localhost:3000') as caia:
        # Execute a task
        result = await caia.execute_task({
            'id': 'analyze-data',
            'type': 'data-analysis',
            'payload': {
                'dataset': 'sales_data.csv',
                'analysis_type': 'trend_analysis'
            }
        })
        
        print('Analysis result:', result)
        
        # Check health
        health = await caia.get_health()
        print('CAIA health:', health)

if __name__ == '__main__':
    asyncio.run(main())
```

### CLI Integration

```bash
#!/bin/bash
# CAIA CLI wrapper script

CAIA_API_URL="http://localhost:3000"
CAIA_API_KEY="your-api-key"

# Function to execute CAIA task
caia_execute() {
    local task_type="$1"
    local payload="$2"
    
    curl -X POST "$CAIA_API_URL/api/execute" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $CAIA_API_KEY" \
        -d "{
            \"task\": {
                \"id\": \"$(uuidgen)\",
                \"type\": \"$task_type\",
                \"payload\": $payload
            }
        }"
}

# Function to check CAIA health
caia_health() {
    curl -s "$CAIA_API_URL/health" | jq '.'
}

# Usage examples
case "$1" in
    "generate-code")
        caia_execute "code-generation" '{
            "component": "'"$2"'",
            "framework": "'"$3"'",
            "features": ["validation", "responsive"]
        }'
        ;;
    "analyze-requirements")
        caia_execute "requirements-analysis" '{
            "requirements": "'"$2"'",
            "format": "structured"
        }'
        ;;
    "health")
        caia_health
        ;;
    *)
        echo "Usage: $0 {generate-code|analyze-requirements|health} [args...]"
        exit 1
        ;;
esac
```

## Error Handling

### Standard Error Format

```typescript
interface CAIAError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
  requestId?: string;
  agent?: string;
}

// Common error codes
const ErrorCodes = {
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  TASK_VALIDATION_FAILED: 'TASK_VALIDATION_FAILED',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  WORKFLOW_EXECUTION_FAILED: 'WORKFLOW_EXECUTION_FAILED',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  TIMEOUT: 'TIMEOUT',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
};
```

### Error Handling Best Practices

```javascript
try {
  const result = await caia.executeTask(task);
  // Handle success
} catch (error) {
  switch (error.code) {
    case 'AGENT_NOT_FOUND':
      // Handle agent not found
      console.error('Agent not available:', error.details.agentName);
      break;
    
    case 'TASK_VALIDATION_FAILED':
      // Handle validation errors
      console.error('Invalid task:', error.details.validationErrors);
      break;
    
    case 'AI_PROVIDER_ERROR':
      // Handle AI provider issues
      console.error('AI provider error:', error.details.providerError);
      break;
    
    case 'TIMEOUT':
      // Handle timeouts
      console.error('Task timed out:', error.details.timeout);
      break;
    
    default:
      // Handle unknown errors
      console.error('Unknown error:', error.message);
  }
}
```

## Rate Limiting and Quotas

### Rate Limiting Configuration

```typescript
interface RateLimitConfig {
  // Requests per time window
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  
  // AI provider limits
  aiCallsPerMinute: number;
  aiTokensPerDay: number;
  
  // Burst handling
  burstSize: number;
  burstRecoveryTime: number;
  
  // Quotas
  dailyTaskQuota: number;
  monthlyWorkflowQuota: number;
}
```

### Quota Management

```javascript
// Check current usage
const usage = await caia.getUsage();
console.log('Current usage:', {
  tasksToday: usage.tasksToday,
  aiCallsThisHour: usage.aiCallsThisHour,
  remainingQuota: usage.remainingQuota
});

// Handle rate limits
try {
  const result = await caia.executeTask(task);
} catch (error) {
  if (error.code === 'RATE_LIMIT_EXCEEDED') {
    const retryAfter = error.details.retryAfter;
    console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return caia.executeTask(task);
  }
  throw error;
}
```

This comprehensive API documentation provides everything needed to effectively use the CAIA framework. Each API includes detailed examples, error handling, and best practices for production use.