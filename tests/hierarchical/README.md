# Hierarchical Agent System - Comprehensive Test Suite

A complete parallel testing framework for the CAIA Hierarchical Agent System with CC Orchestrator integration for maximum performance.

## 🧪 Test Structure

```
tests/hierarchical/
├── unit/                     # Unit tests for individual components
│   ├── idea-analyzer.test.ts       # Stream 1: Idea analysis tests
│   ├── initiative-planner.test.ts  # Stream 2: Initiative planning tests
│   ├── feature-architect.test.ts   # Stream 3: Feature architecture tests
│   └── quality-gate-controller.test.ts # Stream 4: Quality gate tests
├── integration/              # Integration tests between streams
│   ├── stream1-to-stream2.test.ts  # Idea analysis → Initiative planning
│   └── stream2-to-stream3.test.ts  # Initiative planning → Architecture
├── performance/              # Performance and scalability tests
│   └── large-scale-decomposition.test.ts # Large-scale processing tests
├── e2e/                     # End-to-end workflow tests
│   └── complete-workflow.test.ts   # Full idea-to-JIRA workflows
├── fixtures/                # Test data and fixtures
│   ├── sample-ideas.ts           # Sample ideas for testing
│   ├── data-generator.js         # Generates test data
│   └── generated/               # Auto-generated test data
├── mocks/                   # Mock implementations
│   └── jira-connector.mock.ts    # JIRA connector mock
└── src/                     # Test utilities and runners
    ├── config/                  # Test configuration
    └── test-runner.js          # Parallel test runner with CC Orchestrator
```

## 🚀 Quick Start

### Prerequisites

```bash
# Install dependencies
npm install

# Generate test fixtures
npm run fixtures:generate
```

### Running Tests

```bash
# Run all test suites in parallel
npm test

# Run specific test suite
npm run test:unit
npm run test:integration  
npm run test:performance
npm run test:e2e

# Run with parallel execution (CC Orchestrator)
npm run test:parallel

# Run with coverage
npm run test:coverage
```

### Advanced Usage

```bash
# Custom parallel execution
node src/test-runner.js --suite=unit,integration --maxWorkers=8 --verbose

# Performance testing
node src/test-runner.js --suite=performance --timeout=600000

# Watch mode
node src/test-runner.js --watch --suite=unit

# No parallel execution
node src/test-runner.js --no-parallel
```

## 📊 Test Categories

### Unit Tests
- **Coverage**: Individual component functionality
- **Speed**: Fast execution (< 30s per suite)
- **Scope**: IdeaAnalyzer, InitiativePlanner, FeatureArchitect, QualityGateController
- **Parallelization**: Full parallel execution

### Integration Tests  
- **Coverage**: Stream-to-stream data flow and consistency
- **Speed**: Medium execution (< 2min per suite)
- **Scope**: Cross-component workflows and data integrity
- **Parallelization**: Parallel with dependency management

### Performance Tests
- **Coverage**: Large-scale processing, memory usage, concurrency
- **Speed**: Slow execution (< 10min per suite)  
- **Scope**: 1000+ items, stress testing, resource monitoring
- **Parallelization**: Sequential execution for accurate metrics

### End-to-End Tests
- **Coverage**: Complete workflows from idea to JIRA creation
- **Speed**: Medium execution (< 5min per suite)
- **Scope**: Full system integration with external services
- **Parallelization**: Parallel with mock services

## ⚡ CC Orchestrator Integration

The test runner automatically uses CC Orchestrator when available for:

- **Dynamic Resource Calculation**: Automatically determines optimal worker count
- **Intelligent Distribution**: Distributes tests based on complexity and dependencies  
- **Context Preservation**: Maintains test context across parallel instances
- **Real-time Monitoring**: Tracks resource usage and adjusts during execution
- **Failure Recovery**: Automatic retries and graceful degradation

### Configuration

```javascript
// Automatic configuration (recommended)
const orchestrator = new CCOrchestrator({
  autoCalculateInstances: true,     // Auto-detect system resources
  apiRateLimit: 100,               // Conservative API limits
  taskTimeout: 300000,             // 5 minute timeout
  contextPreservation: true,       // Maintain context
  debug: false                     // Enable for troubleshooting
});
```

## 🧰 Test Utilities

### Sample Data

```typescript
import { sampleIdeas, generateLargeBatchIdeas } from './fixtures/sample-ideas';

// Pre-defined sample ideas
const simpleIdea = sampleIdeas.simpleButton;
const complexIdea = sampleIdeas.ecommerce;

// Generated test data
const performanceIdeas = generateLargeBatchIdeas(1000);
```

### Mock Services

```typescript
import { createJiraMock } from './mocks/jira-connector.mock';

// Reliable mock (no failures)
const jiraMock = createJiraMock('reliable');

// Unreliable mock (30% failure rate)  
const jiraMock = createJiraMock('unreliable');
```

### Custom Matchers

```typescript
// Available custom Jest matchers
expect(result).toBeValidJiraIssue();
expect(architecture).toHaveValidHierarchy();
expect(operation()).toCompleteWithinTime(5000);
expect(response).toHaveValidAgentResponse();
```

## 📈 Performance Benchmarks

### Expected Performance (with CC Orchestrator)

| Test Suite | Items | Expected Time | Max Time |
|------------|-------|---------------|----------|
| Unit Tests | All components | < 30s | 60s |
| Integration Tests | 2 streams | < 2min | 5min |
| Performance Tests | 1000+ items | < 10min | 20min |
| E2E Tests | Full workflows | < 5min | 10min |

### System Requirements

- **Minimum**: 8GB RAM, 4 CPU cores
- **Recommended**: 16GB RAM, 8 CPU cores
- **Optimal**: 32GB RAM, 16+ CPU cores

## 🔧 Configuration

### Environment Variables

```bash
# CC Orchestrator Settings
CCO_AUTO_INVOKE=true
CCO_AUTO_CALCULATE=true
CCO_MAX_INSTANCES=20
CCO_TASK_TIMEOUT=300000

# Test Settings  
NODE_ENV=test
LOG_LEVEL=error
JIRA_MOCK_MODE=true
MAX_PARALLEL=50
```

### Jest Configuration

The test suite uses a custom Jest configuration optimized for:

- TypeScript compilation
- Parallel execution
- Custom matchers  
- Coverage reporting
- Memory management

## 📋 Test Scenarios

### Validation Testing
```typescript
// Edge cases and boundary conditions
const scenarios = testScenarios.validationTesting;
// Tests: empty data, special characters, invalid formats
```

### Complexity Testing  
```typescript
// Different complexity levels
const scenarios = testScenarios.complexityTesting;
// Tests: simple, medium, complex ideas with appropriate decomposition
```

### Domain Testing
```typescript  
// Industry-specific scenarios
const scenarios = testScenarios.domainTesting;
// Tests: fintech, healthcare, e-commerce, education domains
```

### Performance Testing
```typescript
// Large-scale operations
const scenarios = testScenarios.performanceTesting;  
// Tests: 1000+ items, concurrent processing, memory usage
```

## 🚨 Troubleshooting

### Common Issues

**CC Orchestrator Not Found**
```bash
# Install CC Orchestrator
cd ../../../utils/parallel/cc-orchestrator
npm install
```

**Memory Issues**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=8192"
```

**Test Timeouts**
```bash  
# Increase timeout for slow tests
node src/test-runner.js --timeout=600000
```

**Coverage Issues**
```bash
# Clean coverage directory
rm -rf coverage/
npm run test:coverage
```

### Debug Mode

```bash
# Enable verbose logging
node src/test-runner.js --verbose

# Enable CC Orchestrator debug
CCO_DEBUG=true npm run test:parallel
```

## 📊 Coverage Reports

Coverage reports are generated in multiple formats:

- **HTML**: `coverage/lcov-report/index.html` 
- **JSON**: `coverage/coverage-final.json`
- **LCOV**: `coverage/lcov.info`
- **Text**: Console output during test runs

### Coverage Thresholds

```javascript
coverageThreshold: {
  global: {
    branches: 90,
    functions: 90,  
    lines: 90,
    statements: 90
  }
}
```

## 🤝 Contributing

### Adding New Tests

1. **Unit Tests**: Add to `unit/` directory
2. **Integration Tests**: Add to `integration/` directory  
3. **Performance Tests**: Add to `performance/` directory
4. **E2E Tests**: Add to `e2e/` directory

### Test Guidelines

- Use descriptive test names
- Group related tests with `describe` blocks
- Test both success and failure scenarios
- Include performance assertions for critical paths
- Mock external dependencies
- Clean up resources in `afterEach`/`afterAll`

### Performance Testing

- Set appropriate timeouts
- Monitor memory usage
- Test with realistic data volumes
- Include concurrent execution tests
- Verify resource cleanup

## 📚 Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [CC Orchestrator Documentation](../../../utils/parallel/cc-orchestrator/README.md)
- [CAIA Architecture Guide](../../../docs/CAIA-ARCHITECTURE.md)
- [Testing Best Practices](../../../docs/TESTING_GUIDELINES.md)

---

*For questions or issues, please check the troubleshooting section or open an issue in the project repository.*