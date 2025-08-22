# @caia/test-utils

Comprehensive testing utilities and framework for CAIA (Chief AI Agent) packages.

## Overview

This package provides a complete testing infrastructure for CAIA, including:

- 🧪 Advanced test runners with performance monitoring
- 🎭 Realistic mocks for agents, APIs, and services
- 🔧 Integration test setup and teardown helpers
- 📊 Performance benchmarking and profiling
- ✅ Enhanced assertion libraries
- 📈 Coverage reporting and analysis

## Installation

```bash
npm install @caia/test-utils --save-dev
# or
pnpm add @caia/test-utils --save-dev
```

## Quick Start

### Basic Agent Testing

```typescript
import { createMockAgent, assert } from '@caia/test-utils';

describe('Agent Tests', () => {
  test('should execute task successfully', async () => {
    const agent = createMockAgent({
      name: 'Test Agent',
      type: 'worker'
    });

    const result = await agent.execute({ action: 'process', data: 'test' });
    
    assert.assertValidAgent(agent);
    expect(result.success).toBe(true);
  });
});
```

### Integration Testing

```typescript
import { integrationSetup, TestEnvironmentConfig } from '@caia/test-utils';

describe('Integration Tests', () => {
  let environment: TestEnvironment;

  beforeAll(async () => {
    const config: TestEnvironmentConfig = {
      name: 'test-env',
      services: [
        {
          name: 'api-service',
          type: 'api',
          port: 3001,
          config: { version: 'v1' }
        }
      ],
      agents: [
        {
          id: 'orchestrator-1',
          type: 'orchestrator',
          config: { maxConcurrency: 5 }
        }
      ],
      networking: { isolation: true },
      storage: { type: 'memory', config: {}, cleanup: true },
      monitoring: { metrics: true, logs: true, tracing: false }
    };

    environment = await integrationSetup.createEnvironment(config);
  });

  afterAll(async () => {
    await integrationSetup.cleanupAll();
  });

  test('should orchestrate multiple agents', async () => {
    const orchestrator = environment.getAgent('orchestrator-1');
    const workflow = {
      steps: [
        { id: 'step1', action: 'prepare' },
        { id: 'step2', action: 'execute' },
        { id: 'step3', action: 'finalize' }
      ]
    };

    const result = await orchestrator.getMockAgent().execute(workflow);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);
  });
});
```

### Performance Testing

```typescript
import { CAIATestRunner, createTestSuite, createTestCase } from '@caia/test-utils';

describe('Performance Tests', () => {
  test('should measure execution performance', async () => {
    const runner = new CAIATestRunner();
    
    const suite = createTestSuite('Performance Suite', {
      parallel: true,
      tests: [
        createTestCase('Fast operation', async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        }),
        createTestCase('Medium operation', async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
        }, { timeout: 100 })
      ]
    });

    const results = await runner.runSuite(suite);
    const stats = runner.getPerformanceStats();
    
    expect(stats.passRate).toBe(100);
    expect(stats.averageExecutionTime).toBeLessThan(100);
  });
});
```

## Core Features

### 1. Mock System

#### Agent Mocks
```typescript
import { createMockAgent, createMockOrchestrator, createMockAgentCluster } from '@caia/test-utils';

// Single agent
const agent = createMockAgent({
  id: 'test-agent',
  name: 'Test Agent',
  capabilities: ['execute', 'monitor']
});

// Orchestrator
const orchestrator = createMockOrchestrator();

// Cluster of agents
const cluster = createMockAgentCluster(5);
```

#### API Mocks
```typescript
import { createApiMock } from '@caia/test-utils';

const apiMock = createApiMock({
  baseUrl: 'https://api.example.com',
  responses: [
    {
      path: '/users',
      method: 'GET',
      response: { users: [] }
    }
  ]
});
```

### 2. Advanced Assertions

```typescript
import { assert, that } from '@caia/test-utils';

// Enhanced assertions
await assert.eventually(() => agent.status === 'ready', { timeout: 5000 });
assert.assertValidAgent(agent);
assert.assertPerformanceMetrics(metrics, { maxExecutionTime: 1000 });

// Fluent assertions
that(result)
  .isDefined()
  .hasProperty('success')
  .satisfies(r => r.success === true);
```

### 3. Test Environment Management

```typescript
import { TestEnvironment } from '@caia/test-utils';

const environment = new TestEnvironment({
  services: [
    {
      name: 'database',
      type: 'database',
      config: { connectionString: 'sqlite::memory:' }
    }
  ],
  agents: [
    {
      id: 'worker-1',
      type: 'worker',
      config: { queueSize: 100 }
    }
  ]
});

await environment.initialize();
// Run tests...
await environment.cleanup();
```

### 4. Performance Monitoring

```typescript
import { CAIATestRunner } from '@caia/test-utils';

const runner = new CAIATestRunner();
const results = await runner.runSuite(suite);

// Get detailed performance metrics
const stats = runner.getPerformanceStats();
console.log(`Average execution: ${stats.averageExecutionTime}ms`);
console.log(`Memory peak: ${stats.memoryPeak} bytes`);
console.log(`Pass rate: ${stats.passRate}%`);
```

## Configuration

### Jest Configuration

Add to your `jest.config.js`:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['@caia/test-utils/setup'],
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/**/*.d.ts',
    '!src/setup.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

### TypeScript Configuration

Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "types": ["jest", "@caia/test-utils"]
  }
}
```

## Best Practices

### 1. Test Structure

```typescript
describe('Feature: Agent Orchestration', () => {
  describe('Scenario: Basic orchestration', () => {
    test('should coordinate multiple agents', async () => {
      // Given
      const orchestrator = createMockOrchestrator();
      const workers = createMockAgentCluster(3);
      
      // When
      const result = await orchestrator.execute({
        workers: workers.map(w => w.id),
        task: 'parallel-processing'
      });
      
      // Then
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
    });
  });
});
```

### 2. Environment Setup

```typescript
// Use consistent test data
const testFixtures = {
  basicWorkflow: {
    steps: [
      { id: 'step1', action: 'initialize' },
      { id: 'step2', action: 'process' },
      { id: 'step3', action: 'finalize' }
    ]
  }
};

// Reusable environment configurations
const environments = {
  minimal: {
    agents: [{ id: 'basic-agent', type: 'worker' }],
    services: []
  },
  full: {
    agents: [
      { id: 'orchestrator', type: 'orchestrator' },
      { id: 'worker-1', type: 'worker' },
      { id: 'worker-2', type: 'worker' }
    ],
    services: [
      { name: 'api', type: 'api', port: 3001 },
      { name: 'queue', type: 'queue' }
    ]
  }
};
```

### 3. Performance Testing

```typescript
describe('Performance: Agent execution', () => {
  test('should complete tasks within time limits', async () => {
    const agent = createMockAgent();
    const startTime = performance.now();
    
    await agent.execute({ action: 'heavy-task' });
    
    const duration = performance.now() - startTime;
    expect(duration).toBeLessThan(1000); // Max 1 second
  });
});
```

## API Reference

### Mock Creators

- `createMockAgent(options?)` - Create a mock agent
- `createMockOrchestrator()` - Create a mock orchestrator
- `createMockExecutionEngine()` - Create a mock execution engine
- `createMockDecisionEngine()` - Create a mock decision engine
- `createMockAgentCluster(count)` - Create multiple mock agents

### Assertion Helpers

- `assert.eventually(condition, options)` - Wait for condition
- `assert.assertValidAgent(agent)` - Validate agent structure
- `assert.assertPerformanceMetrics(metrics, thresholds)` - Check performance
- `assert.assertHttpResponse(response, status, properties)` - Validate HTTP responses

### Test Environment

- `integrationSetup.createEnvironment(config)` - Create test environment
- `environment.getService(name)` - Get service instance
- `environment.getAgent(id)` - Get agent instance
- `environment.cleanup()` - Clean up environment

### Performance Testing

- `CAIATestRunner` - Advanced test runner with monitoring
- `createTestSuite(name, options)` - Create test suite
- `createTestCase(name, fn, options)` - Create test case

## Examples

See the `examples/` directory for complete examples:

- `examples/basic-agent-test.ts` - Basic agent testing
- `examples/integration-test.ts` - Full integration test setup
- `examples/performance-test.ts` - Performance benchmarking
- `examples/mock-setup.ts` - Advanced mock configurations

## Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Ensure all tests pass

## License

MIT - See LICENSE file for details