# CCO (CC-Orchestrator) Usage Instructions

## When to Use CCO

ALWAYS use CCO when:
1. Task involves 3+ similar operations
2. Multiple files need same changes
3. Parallel execution would save time
4. User mentions "all", "every", "batch", "multiple"

## How to Use CCO

### Step 1: Identify Parallel Tasks
```javascript
const tasks = [
  { id: 'T1', operation: 'fix_typescript', target: 'package1' },
  { id: 'T2', operation: 'fix_typescript', target: 'package2' },
  // ... more tasks
];
```

### Step 2: Create CCO Configuration
```javascript
const config = {
  maxInstances: 10,  // Parallel instances
  taskTimeout: 30000, // 30 seconds per task
  retryAttempts: 2
};
```

### Step 3: Execute with CCO
```javascript
const orchestrator = new CCOrchestrator(config);
await orchestrator.executeBatch(tasks);
```

## Available for These Operations

1. **Configuration Implementation** - All CCU configs
2. **Package Fixes** - TypeScript, ESLint, tests
3. **Bulk Updates** - Dependencies, versions, configs
4. **Parallel Testing** - Run tests across packages
5. **Monitoring Setup** - Multiple monitoring endpoints
6. **Hook Installation** - All session hooks
7. **Documentation Generation** - Multiple packages

## Performance Gains

- Sequential: 82 configs = 15 hours
- With CCO: 82 configs = 30 minutes

## Command to Check CCO Status
```bash
node $CCO_PATH/src/cli.ts status
```
