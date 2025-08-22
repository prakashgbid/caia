# @caia/ui-monitoring-dashboard

Real-time monitoring and management dashboard for the CAIA agent ecosystem.

## Features

🚀 **Real-time Agent Monitoring**
- Live agent status updates via WebSockets
- Performance metrics visualization
- Task execution tracking
- Health monitoring and alerts

📊 **Advanced Analytics**
- Interactive charts and graphs
- Historical performance data
- Trend analysis and forecasting
- Custom metric dashboards

🔍 **Workflow Visualization**
- Interactive workflow diagrams
- Real-time execution state
- Dependency tracking
- Critical path analysis

💬 **Communication Monitoring**
- Message flow visualization
- Communication patterns analysis
- Latency tracking
- Error detection

🛠️ **Debugging Tools**
- Advanced log viewer with filtering
- Interactive debugging console
- Distributed tracing
- Error tracking and analysis

⚙️ **Configuration Management**
- Visual configuration editor
- Bulk agent operations
- Template management
- Environment-specific configs

## Quick Start

### Installation

```bash
npm install @caia/ui-monitoring-dashboard
```

### Basic Usage

```typescript
import { MonitoringDashboard } from '@caia/ui-monitoring-dashboard';
import '@caia/ui-monitoring-dashboard/dist/style.css';

function App() {
  return (
    <MonitoringDashboard
      apiUrl="http://localhost:3001/api"
      wsUrl="ws://localhost:3001"
      authToken="your-auth-token"
    />
  );
}
```

### Development Setup

```bash
# Clone the CAIA repository
git clone https://github.com/caia-ai/caia.git
cd caia/packages/ui/monitoring-dashboard

# Install dependencies
npm install

# Start development server
npm run dev

# Open in browser
open http://localhost:3000
```

## Components

### Dashboard Components

#### AgentDashboard
Main dashboard showing agent overview and grid.

```typescript
import { AgentDashboard } from '@caia/ui-monitoring-dashboard';

<AgentDashboard
  onAgentSelect={(agent) => console.log('Selected:', agent)}
  filters={{ status: ['idle', 'busy'] }}
/>
```

#### WorkflowMonitor
Interactive workflow visualization.

```typescript
import { WorkflowMonitor } from '@caia/ui-monitoring-dashboard';

<WorkflowMonitor
  workflowId="workflow-123"
  onNodeClick={(node) => console.log('Node clicked:', node)}
  readOnly={false}
/>
```

#### MetricsDashboard
Performance metrics and charts.

```typescript
import { MetricsDashboard } from '@caia/ui-monitoring-dashboard';

<MetricsDashboard
  timeRange="1h"
  metrics={['cpu', 'memory', 'network', 'tasks']}
  refreshInterval={5000}
/>
```

### Utility Components

#### LogViewer
Advanced log viewing and filtering.

```typescript
import { LogViewer } from '@caia/ui-monitoring-dashboard';

<LogViewer
  agentIds={['agent-1', 'agent-2']}
  levels={['error', 'warn', 'info']}
  autoScroll={true}
/>
```

#### ConfigurationEditor
Visual agent configuration management.

```typescript
import { ConfigurationEditor } from '@caia/ui-monitoring-dashboard';

<ConfigurationEditor
  agentId="agent-123"
  config={agentConfig}
  onSave={(newConfig) => saveConfig(newConfig)}
/>
```

## Hooks

### useAgents
Manage agent data with real-time updates.

```typescript
import { useAgents } from '@caia/ui-monitoring-dashboard';

function AgentList() {
  const { agents, isLoading, error, refetch } = useAgents();
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return (
    <div>
      {agents.map(agent => (
        <div key={agent.id}>{agent.name}</div>
      ))}
    </div>
  );
}
```

### useWebSocket
Real-time WebSocket connection management.

```typescript
import { useWebSocket } from '@caia/ui-monitoring-dashboard';

function RealTimeComponent() {
  const { socket, connected, subscribe, unsubscribe } = useWebSocket();
  
  useEffect(() => {
    const unsubAgent = subscribe('agent:status', (data) => {
      console.log('Agent status update:', data);
    });
    
    return unsubAgent;
  }, [subscribe]);
  
  return <div>Connected: {connected ? 'Yes' : 'No'}</div>;
}
```

### usePerformanceMetrics
Performance data with caching and real-time updates.

```typescript
import { usePerformanceMetrics } from '@caia/ui-monitoring-dashboard';

function MetricsChart() {
  const { metrics, isLoading, timeRange, setTimeRange } = usePerformanceMetrics('1h');
  
  return (
    <div>
      <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
        <option value="15m">15 minutes</option>
        <option value="1h">1 hour</option>
        <option value="24h">24 hours</option>
      </select>
      {/* Chart component using metrics data */}
    </div>
  );
}
```

## Configuration

### Environment Variables

```bash
# API Configuration
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001

# Authentication
VITE_AUTH_ENABLED=true
VITE_AUTH_PROVIDER=jwt

# Features
VITE_ENABLE_DEBUGGING=true
VITE_ENABLE_CONFIGURATION=true
VITE_REALTIME_UPDATES=true

# Monitoring
VITE_METRICS_INTERVAL=5000
VITE_LOG_RETENTION_HOURS=24
VITE_MAX_LOG_ENTRIES=10000
```

### Dashboard Configuration

```typescript
import { MonitoringDashboard } from '@caia/ui-monitoring-dashboard';

const config = {
  // API endpoints
  apiUrl: 'http://localhost:3001/api',
  wsUrl: 'ws://localhost:3001',
  
  // Authentication
  authToken: 'your-jwt-token',
  
  // Features
  features: {
    debugging: true,
    configuration: true,
    realTimeUpdates: true,
    exportData: true,
  },
  
  // UI preferences
  theme: 'light', // 'light' | 'dark' | 'auto'
  refreshInterval: 5000,
  maxLogEntries: 1000,
  
  // Charts configuration
  charts: {
    animationDuration: 300,
    showDataPoints: true,
    enableZoom: true,
  },
};

<MonitoringDashboard config={config} />
```

## API Integration

### REST API Endpoints

```typescript
// GET /api/agents - Get all agents
interface AgentsResponse {
  agents: AgentMetadata[];
  total: number;
  page: number;
  limit: number;
}

// GET /api/agents/:id - Get specific agent
interface AgentResponse {
  agent: AgentMetadata;
  tasks: TaskResult[];
  metrics: PerformanceMetric[];
}

// PATCH /api/agents/:id/config - Update agent configuration
interface UpdateConfigRequest {
  config: Partial<AgentConfig>;
}

// GET /api/workflows/:id - Get workflow details
interface WorkflowResponse {
  workflow: WorkflowDefinition;
  execution: WorkflowExecution;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// GET /api/metrics - Get performance metrics
interface MetricsResponse {
  cpu: MetricData[];
  memory: MetricData[];
  network: MetricData[];
  tasks: MetricData[];
  timeRange: string;
}

// GET /api/logs - Get system logs
interface LogsResponse {
  logs: LogEntry[];
  total: number;
  page: number;
  limit: number;
  filters: LogFilters;
}
```

### WebSocket Events

```typescript
// Agent events
socket.on('agent:status', (data: AgentMetadata) => {
  // Agent status changed
});

socket.on('agent:registered', (data: AgentRegisteredEvent) => {
  // New agent registered
});

socket.on('agent:unregistered', (data: AgentUnregisteredEvent) => {
  // Agent unregistered
});

// Task events
socket.on('task:assigned', (data: TaskAssignedEvent) => {
  // Task assigned to agent
});

socket.on('task:completed', (data: TaskCompletedEvent) => {
  // Task completed
});

socket.on('task:failed', (data: TaskFailedEvent) => {
  // Task failed
});

// Workflow events
socket.on('workflow:started', (data: WorkflowStartedEvent) => {
  // Workflow execution started
});

socket.on('workflow:updated', (data: WorkflowUpdatedEvent) => {
  // Workflow state changed
});

socket.on('workflow:completed', (data: WorkflowCompletedEvent) => {
  // Workflow execution completed
});

// System events
socket.on('metrics:updated', (data: MetricsUpdatedEvent) => {
  // Performance metrics updated
});

socket.on('log:entry', (data: LogEntry) => {
  // New log entry
});

socket.on('alert:triggered', (data: AlertTriggeredEvent) => {
  // System alert triggered
});
```

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests with UI
npm run test:ui
```

### Component Testing

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { AgentDashboard } from '../AgentDashboard';
import { TestProvider } from '../../test/utils';

describe('AgentDashboard', () => {
  it('renders agent overview correctly', async () => {
    render(
      <TestProvider>
        <AgentDashboard />
      </TestProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Total Agents')).toBeInTheDocument();
      expect(screen.getByText('Active Agents')).toBeInTheDocument();
    });
  });
});
```

### Integration Tests

```typescript
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';

const server = setupServer(...handlers);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Deployment

### Docker

```bash
# Build Docker image
npm run docker:build

# Run container
npm run docker:run

# Or use docker-compose
docker-compose up -d
```

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview

# Analyze bundle size
npm run analyze
```

### CDN Deployment

```bash
# Build and deploy to CDN
npm run build
aws s3 sync dist/ s3://your-cdn-bucket/
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

## Performance

### Optimization Features

- **Code Splitting**: Automatic route-based code splitting
- **Virtual Scrolling**: Handle large datasets efficiently
- **Memoization**: Prevent unnecessary re-renders
- **Real-time Optimization**: Debounced updates and selective listening
- **Bundle Analysis**: Webpack bundle analyzer integration

### Performance Metrics

- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s
- Bundle size: < 300KB gzipped
- Memory usage: < 100MB for 1000+ agents

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

See the main [CAIA contributing guide](../../../CONTRIBUTING.md) for details on:
- Development setup
- Code style guidelines
- Testing requirements
- Pull request process

## License

MIT © [CAIA AI](https://caia.ai)

## Support

- [Documentation](https://docs.caia.ai/ui/monitoring-dashboard)
- [GitHub Issues](https://github.com/caia-ai/caia/issues)
- [Discord Community](https://discord.gg/caia)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/caia)