# CAIA Frontend Implementation Guide

## Quick Start Implementation

### Project Setup
```bash
# Create the monitoring dashboard
npm create vite@latest caia-dashboard -- --template react-ts
cd caia-dashboard

# Install dependencies
npm install @reduxjs/toolkit react-redux socket.io-client
npm install tailwindcss @headlessui/react @heroicons/react
npm install d3 @types/d3 chart.js react-chartjs-2
npm install react-flow-renderer @vitejs/plugin-react
npm install date-fns lodash @types/lodash
npm install vitest @testing-library/react jsdom

# Development dependencies
npm install -D @types/react @types/react-dom
npm install -D eslint @typescript-eslint/eslint-plugin
npm install -D prettier eslint-config-prettier
```

### Core Store Configuration
```typescript
// src/store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import { agentsApi } from './api/agentsApi';
import { workflowsApi } from './api/workflowsApi';
import { metricsApi } from './api/metricsApi';
import uiReducer from './slices/uiSlice';
import settingsReducer from './slices/settingsSlice';

export const store = configureStore({
  reducer: {
    ui: uiReducer,
    settings: settingsReducer,
    [agentsApi.reducerPath]: agentsApi.reducer,
    [workflowsApi.reducerPath]: workflowsApi.reducer,
    [metricsApi.reducerPath]: metricsApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
      },
    })
    .concat(agentsApi.middleware)
    .concat(workflowsApi.middleware)
    .concat(metricsApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

### RTK Query API Definitions
```typescript
// src/store/api/agentsApi.ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { AgentMetadata, AgentConfig, TaskResult } from '@caia/core';

export const agentsApi = createApi({
  reducerPath: 'agentsApi',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api/agents',
    prepareHeaders: (headers) => {
      headers.set('authorization', `Bearer ${localStorage.getItem('token')}`);
      return headers;
    },
  }),
  tagTypes: ['Agent', 'Task'],
  endpoints: (builder) => ({
    getAgents: builder.query<AgentMetadata[], void>({
      query: () => '/',
      providesTags: ['Agent'],
    }),
    getAgent: builder.query<AgentMetadata, string>({
      query: (id) => `/${id}`,
      providesTags: (result, error, id) => [{ type: 'Agent', id }],
    }),
    updateAgentConfig: builder.mutation<AgentMetadata, { id: string; config: Partial<AgentConfig> }>({
      query: ({ id, config }) => ({
        url: `/${id}/config`,
        method: 'PATCH',
        body: config,
      }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Agent', id }],
    }),
    getAgentTasks: builder.query<TaskResult[], string>({
      query: (agentId) => `/${agentId}/tasks`,
      providesTags: (result, error, agentId) => [{ type: 'Task', id: agentId }],
    }),
    restartAgent: builder.mutation<void, string>({
      query: (id) => ({
        url: `/${id}/restart`,
        method: 'POST',
      }),
      invalidatesTags: (result, error, id) => [{ type: 'Agent', id }],
    }),
  }),
});

export const {
  useGetAgentsQuery,
  useGetAgentQuery,
  useUpdateAgentConfigMutation,
  useGetAgentTasksQuery,
  useRestartAgentMutation,
} = agentsApi;
```

### WebSocket Integration
```typescript
// src/hooks/useWebSocket.ts
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAppDispatch } from '../store/hooks';
import { agentsApi } from '../store/api/agentsApi';

interface WebSocketEvents {
  'agent:status': (data: AgentMetadata) => void;
  'task:completed': (data: TaskResult) => void;
  'workflow:updated': (data: WorkflowState) => void;
  'metric:updated': (data: PerformanceMetric) => void;
}

export const useWebSocket = () => {
  const socketRef = useRef<Socket | null>(null);
  const dispatch = useAppDispatch();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(import.meta.env.VITE_WS_URL || 'ws://localhost:3001', {
      auth: {
        token: localStorage.getItem('token'),
      },
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      console.log('Connected to CAIA WebSocket');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from CAIA WebSocket');
    });

    // Agent status updates
    socket.on('agent:status', (agentData) => {
      dispatch(agentsApi.util.updateQueryData('getAgents', undefined, (draft) => {
        const index = draft.findIndex(agent => agent.id === agentData.id);
        if (index >= 0) {
          draft[index] = agentData;
        } else {
          draft.push(agentData);
        }
      }));
    });

    // Task completion updates
    socket.on('task:completed', (taskResult) => {
      dispatch(agentsApi.util.invalidateTags([{ type: 'Task', id: taskResult.agentId }]));
    });

    return () => {
      socket.disconnect();
    };
  }, [dispatch]);

  return {
    socket: socketRef.current,
    connected,
  };
};
```

## Component Implementations

### 1. Agent Dashboard Components

#### Agent Overview Widget
```typescript
// src/components/dashboard/AgentOverview.tsx
import React from 'react';
import { AgentMetadata, AgentStatus } from '@caia/core';
import { useGetAgentsQuery } from '../../store/api/agentsApi';

interface AgentOverviewProps {
  className?: string;
}

export const AgentOverview: React.FC<AgentOverviewProps> = ({ className }) => {
  const { data: agents = [], isLoading } = useGetAgentsQuery();

  const stats = React.useMemo(() => {
    const total = agents.length;
    const active = agents.filter(a => a.status === AgentStatus.BUSY).length;
    const idle = agents.filter(a => a.status === AgentStatus.IDLE).length;
    const error = agents.filter(a => a.status === AgentStatus.ERROR).length;
    const avgUptime = total > 0 ? agents.reduce((sum, a) => sum + a.uptime, 0) / total : 0;
    const totalTasks = agents.reduce((sum, a) => sum + a.completedTasks, 0);

    return { total, active, idle, error, avgUptime, totalTasks };
  }, [agents]);

  if (isLoading) {
    return <OverviewSkeleton />;
  }

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 ${className}`}>
      <StatCard
        title="Total Agents"
        value={stats.total}
        icon={<CubeIcon className="w-8 h-8" />}
        color="blue"
      />
      <StatCard
        title="Active Agents"
        value={stats.active}
        icon={<BoltIcon className="w-8 h-8" />}
        color="green"
      />
      <StatCard
        title="Idle Agents"
        value={stats.idle}
        icon={<ClockIcon className="w-8 h-8" />}
        color="yellow"
      />
      <StatCard
        title="Error Agents"
        value={stats.error}
        icon={<ExclamationTriangleIcon className="w-8 h-8" />}
        color="red"
      />
      <StatCard
        title="Avg Uptime"
        value={formatUptime(stats.avgUptime)}
        icon={<ChartBarIcon className="w-8 h-8" />}
        color="indigo"
        span="md:col-span-2"
      />
      <StatCard
        title="Tasks Completed"
        value={stats.totalTasks.toLocaleString()}
        icon={<CheckCircleIcon className="w-8 h-8" />}
        color="emerald"
        span="md:col-span-2"
      />
    </div>
  );
};

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'indigo' | 'emerald';
  span?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color, span }) => {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  };

  return (
    <div className={`p-6 bg-white rounded-lg border shadow-sm ${span || ''}`}>
      <div className="flex items-center">
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
        <div className="ml-4">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
};
```

#### Agent Grid Component
```typescript
// src/components/dashboard/AgentGrid.tsx
import React, { useState } from 'react';
import { AgentMetadata, AgentStatus } from '@caia/core';
import { useGetAgentsQuery } from '../../store/api/agentsApi';
import { AgentCard } from './AgentCard';
import { AgentFilters } from './AgentFilters';

export const AgentGrid: React.FC = () => {
  const { data: agents = [], isLoading } = useGetAgentsQuery();
  const [filters, setFilters] = useState({
    status: [] as AgentStatus[],
    search: '',
    capabilities: [] as string[],
  });

  const filteredAgents = React.useMemo(() => {
    return agents.filter(agent => {
      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(agent.status)) {
        return false;
      }

      // Search filter
      if (filters.search && !agent.name.toLowerCase().includes(filters.search.toLowerCase())) {
        return false;
      }

      // Capabilities filter
      if (filters.capabilities.length > 0) {
        const agentCapabilities = agent.capabilities.map(c => c.name);
        if (!filters.capabilities.some(cap => agentCapabilities.includes(cap))) {
          return false;
        }
      }

      return true;
    });
  }, [agents, filters]);

  if (isLoading) {
    return <AgentGridSkeleton />;
  }

  return (
    <div className="space-y-6">
      <AgentFilters
        filters={filters}
        onFiltersChange={setFilters}
        availableCapabilities={getUniqueCapabilities(agents)}
      />
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredAgents.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onSelect={() => handleAgentSelect(agent)}
          />
        ))}
      </div>

      {filteredAgents.length === 0 && (
        <div className="text-center py-12">
          <CubeIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No agents found</h3>
          <p className="mt-1 text-sm text-gray-500">
            Try adjusting your filters or search terms.
          </p>
        </div>
      )}
    </div>
  );
};
```

#### Agent Detail Modal
```typescript
// src/components/dashboard/AgentDetailModal.tsx
import React from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { AgentMetadata } from '@caia/core';
import { useGetAgentQuery, useGetAgentTasksQuery } from '../../store/api/agentsApi';
import { AgentConfigTab } from './AgentConfigTab';
import { AgentTasksTab } from './AgentTasksTab';
import { AgentLogsTab } from './AgentLogsTab';
import { AgentMetricsTab } from './AgentMetricsTab';

interface AgentDetailModalProps {
  agentId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AgentDetailModal: React.FC<AgentDetailModalProps> = ({
  agentId,
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState('overview');
  const { data: agent, isLoading } = useGetAgentQuery(agentId!, {
    skip: !agentId,
  });

  const tabs = [
    { id: 'overview', name: 'Overview', icon: <InformationCircleIcon className="w-5 h-5" /> },
    { id: 'tasks', name: 'Tasks', icon: <ListBulletIcon className="w-5 h-5" /> },
    { id: 'metrics', name: 'Metrics', icon: <ChartBarIcon className="w-5 h-5" /> },
    { id: 'config', name: 'Configuration', icon: <CogIcon className="w-5 h-5" /> },
    { id: 'logs', name: 'Logs', icon: <DocumentTextIcon className="w-5 h-5" /> },
  ];

  return (
    <Transition appear show={isOpen} as={React.Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={React.Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={React.Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-6xl transform overflow-hidden rounded-2xl bg-white shadow-xl transition-all">
                {isLoading || !agent ? (
                  <AgentDetailSkeleton />
                ) : (
                  <>
                    <div className="flex items-center justify-between p-6 border-b">
                      <div className="flex items-center space-x-4">
                        <AgentStatusBadge status={agent.status} />
                        <div>
                          <Dialog.Title className="text-xl font-semibold text-gray-900">
                            {agent.name}
                          </Dialog.Title>
                          <p className="text-sm text-gray-500">ID: {agent.id}</p>
                        </div>
                      </div>
                      <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <XMarkIcon className="w-6 h-6" />
                      </button>
                    </div>

                    <div className="flex border-b">
                      {tabs.map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`flex items-center space-x-2 px-6 py-3 text-sm font-medium border-b-2 ${
                            activeTab === tab.id
                              ? 'border-blue-500 text-blue-600'
                              : 'border-transparent text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          {tab.icon}
                          <span>{tab.name}</span>
                        </button>
                      ))}
                    </div>

                    <div className="p-6 max-h-96 overflow-y-auto">
                      {activeTab === 'overview' && <AgentOverviewTab agent={agent} />}
                      {activeTab === 'tasks' && <AgentTasksTab agentId={agent.id} />}
                      {activeTab === 'metrics' && <AgentMetricsTab agentId={agent.id} />}
                      {activeTab === 'config' && <AgentConfigTab agent={agent} />}
                      {activeTab === 'logs' && <AgentLogsTab agentId={agent.id} />}
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
```

### 2. Workflow Monitor Components

#### Workflow Canvas
```typescript
// src/components/workflow/WorkflowCanvas.tsx
import React, { useCallback, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { AgentNode } from './nodes/AgentNode';
import { TaskNode } from './nodes/TaskNode';
import { DecisionNode } from './nodes/DecisionNode';
import { DataNode } from './nodes/DataNode';

const nodeTypes = {
  agent: AgentNode,
  task: TaskNode,
  decision: DecisionNode,
  data: DataNode,
};

interface WorkflowCanvasProps {
  workflowId: string;
  initialNodes?: Node[];
  initialEdges?: Edge[];
  readOnly?: boolean;
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  workflowId,
  initialNodes = [],
  initialEdges = [],
  readOnly = false,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!readOnly) {
        setEdges((eds) => addEdge(params, eds));
      }
    },
    [setEdges, readOnly]
  );

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  return (
    <div className="h-full w-full bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        className="react-flow-dark-theme"
      >
        <Background color="#aaa" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            switch (node.type) {
              case 'agent': return '#3b82f6';
              case 'task': return '#10b981';
              case 'decision': return '#f59e0b';
              case 'data': return '#8b5cf6';
              default: return '#6b7280';
            }
          }}
          nodeStrokeWidth={3}
          zoomable
          pannable
        />
      </ReactFlow>

      {selectedNodeId && (
        <WorkflowNodePanel
          nodeId={selectedNodeId}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
};
```

#### Custom Node Components
```typescript
// src/components/workflow/nodes/AgentNode.tsx
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { AgentStatus } from '@caia/core';

interface AgentNodeData {
  name: string;
  status: AgentStatus;
  currentTasks: number;
  maxTasks: number;
}

export const AgentNode: React.FC<NodeProps<AgentNodeData>> = ({ data, selected }) => {
  const getStatusColor = (status: AgentStatus) => {
    switch (status) {
      case AgentStatus.BUSY: return 'bg-green-100 border-green-500 text-green-800';
      case AgentStatus.IDLE: return 'bg-yellow-100 border-yellow-500 text-yellow-800';
      case AgentStatus.ERROR: return 'bg-red-100 border-red-500 text-red-800';
      default: return 'bg-gray-100 border-gray-500 text-gray-800';
    }
  };

  return (
    <div
      className={`px-4 py-2 shadow-md rounded-md border-2 bg-white min-w-[150px] ${
        selected ? 'border-blue-500' : 'border-gray-300'
      }`}
    >
      <Handle type="target" position={Position.Top} />
      
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-sm">{data.name}</div>
          <div className={`px-2 py-1 rounded text-xs ${getStatusColor(data.status)}`}>
            {data.status}
          </div>
        </div>
        
        <div className="text-xs text-gray-600">
          Tasks: {data.currentTasks}/{data.maxTasks}
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
          <div
            className="bg-blue-600 h-1.5 rounded-full"
            style={{ width: `${(data.currentTasks / data.maxTasks) * 100}%` }}
          />
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};
```

### 3. Performance Metrics Components

#### Real-time Metrics Dashboard
```typescript
// src/components/metrics/MetricsDashboard.tsx
import React, { useState } from 'react';
import { TimeRange } from '../../types/metrics';
import { usePerformanceMetrics } from '../../hooks/usePerformanceMetrics';
import { CPUChart } from './charts/CPUChart';
import { MemoryChart } from './charts/MemoryChart';
import { NetworkChart } from './charts/NetworkChart';
import { TaskThroughputChart } from './charts/TaskThroughputChart';

export const MetricsDashboard: React.FC = () => {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const { data: metrics, isLoading } = usePerformanceMetrics(timeRange);

  const timeRanges: { value: TimeRange; label: string }[] = [
    { value: '15m', label: '15 minutes' },
    { value: '1h', label: '1 hour' },
    { value: '6h', label: '6 hours' },
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
  ];

  if (isLoading || !metrics) {
    return <MetricsDashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Performance Metrics</h2>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as TimeRange)}
          className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        >
          {timeRanges.map(range => (
            <option key={range.value} value={range.value}>
              {range.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartContainer title="CPU Usage" subtitle="System and per-agent CPU utilization">
          <CPUChart data={metrics.cpu} timeRange={timeRange} />
        </ChartContainer>

        <ChartContainer title="Memory Usage" subtitle="Memory consumption across agents">
          <MemoryChart data={metrics.memory} timeRange={timeRange} />
        </ChartContainer>

        <ChartContainer title="Network I/O" subtitle="Inbound and outbound network traffic">
          <NetworkChart data={metrics.network} timeRange={timeRange} />
        </ChartContainer>

        <ChartContainer title="Task Throughput" subtitle="Task completion rate and latency">
          <TaskThroughputChart data={metrics.tasks} timeRange={timeRange} />
        </ChartContainer>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <AlertsPanel />
        <TopPerformersPanel />
        <SystemHealthPanel />
      </div>
    </div>
  );
};

interface ChartContainerProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

const ChartContainer: React.FC<ChartContainerProps> = ({ title, subtitle, children }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm border">
    <div className="mb-4">
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500">{subtitle}</p>
    </div>
    <div className="h-64">
      {children}
    </div>
  </div>
);
```

### 4. Debugging Tools Implementation

#### Advanced Log Viewer
```typescript
// src/components/debugging/LogViewer.tsx
import React, { useState, useRef, useEffect } from 'react';
import { VirtualList } from '@tanstack/react-virtual';
import { LogEntry, LogLevel } from '../../types/logging';
import { useLogStream } from '../../hooks/useLogStream';
import { LogFilters } from './LogFilters';
import { LogEntryComponent } from './LogEntry';

export const LogViewer: React.FC = () => {
  const [filters, setFilters] = useState({
    levels: ['error', 'warn', 'info'] as LogLevel[],
    agentIds: [] as string[],
    search: '',
    correlationId: '',
    timeRange: '1h' as const,
  });
  
  const [autoScroll, setAutoScroll] = useState(true);
  const parentRef = useRef<HTMLDivElement>(null);
  
  const { logs, isLoading, searchLogs } = useLogStream(filters);

  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 10,
  });

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logs.length > 0) {
      virtualizer.scrollToIndex(logs.length - 1);
    }
  }, [logs.length, autoScroll, virtualizer]);

  const handleSearch = async (query: string) => {
    if (query.trim()) {
      await searchLogs(query);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-sm border">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">System Logs</h3>
          <div className="flex items-center space-x-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">Auto-scroll</span>
            </label>
            <button
              onClick={() => logs.length > 0 && virtualizer.scrollToIndex(logs.length - 1)}
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md"
            >
              Jump to Latest
            </button>
          </div>
        </div>
        
        <LogFilters
          filters={filters}
          onFiltersChange={setFilters}
          onSearch={handleSearch}
        />
      </div>

      <div
        ref={parentRef}
        className="flex-1 overflow-auto bg-gray-900 text-green-400 font-mono text-sm"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {isLoading ? (
          <LogLoadingSkeleton />
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            No logs found matching the current filters
          </div>
        ) : (
          virtualizer.getVirtualItems().map((virtualItem) => (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <LogEntryComponent
                entry={logs[virtualItem.index]}
                searchTerm={filters.search}
              />
            </div>
          ))
        )}
      </div>

      <div className="p-2 border-t bg-gray-50 text-xs text-gray-500 flex justify-between">
        <span>{logs.length} log entries</span>
        <span>Updated: {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
};
```

## Testing Strategy

### Component Testing
```typescript
// src/components/dashboard/__tests__/AgentGrid.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { AgentGrid } from '../AgentGrid';
import { createTestStore } from '../../../test/utils';
import { mockAgents } from '../../../test/fixtures';

describe('AgentGrid', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore({
      agentsApi: {
        queries: {
          'getAgents(undefined)': {
            data: mockAgents,
            status: 'fulfilled',
          },
        },
      },
    });
  });

  it('renders agent cards for all agents', async () => {
    render(
      <Provider store={store}>
        <AgentGrid />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Agent 1')).toBeInTheDocument();
      expect(screen.getByText('Agent 2')).toBeInTheDocument();
    });
  });

  it('filters agents by status', async () => {
    const user = userEvent.setup();
    
    render(
      <Provider store={store}>
        <AgentGrid />
      </Provider>
    );

    // Open status filter
    await user.click(screen.getByText('Status'));
    
    // Select only "BUSY" status
    await user.click(screen.getByLabelText('Busy'));
    
    await waitFor(() => {
      expect(screen.queryByText('Idle Agent')).not.toBeInTheDocument();
      expect(screen.getByText('Busy Agent')).toBeInTheDocument();
    });
  });

  it('searches agents by name', async () => {
    const user = userEvent.setup();
    
    render(
      <Provider store={store}>
        <AgentGrid />
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText('Search agents...');
    await user.type(searchInput, 'Test Agent');

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
      expect(screen.queryByText('Other Agent')).not.toBeInTheDocument();
    });
  });
});
```

### Integration Testing
```typescript
// src/test/integration/dashboard.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { AgentDashboard } from '../../components/dashboard/AgentDashboard';
import { TestProvider } from '../utils/TestProvider';

const server = setupServer(
  rest.get('/api/agents', (req, res, ctx) => {
    return res(ctx.json([
      {
        id: 'agent-1',
        name: 'Test Agent',
        status: 'idle',
        capabilities: [{ name: 'test-capability', version: '1.0.0' }],
        currentTasks: [],
        completedTasks: 10,
        failedTasks: 0,
        uptime: 3600000,
        lastHeartbeat: new Date(),
        version: '1.0.0',
      },
    ]));
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Agent Dashboard Integration', () => {
  it('loads and displays agent data from API', async () => {
    render(
      <TestProvider>
        <AgentDashboard />
      </TestProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument(); // Total agents
      expect(screen.getByText('10')).toBeInTheDocument(); // Completed tasks
    });
  });

  it('handles API errors gracefully', async () => {
    server.use(
      rest.get('/api/agents', (req, res, ctx) => {
        return res(ctx.status(500), ctx.json({ error: 'Internal server error' }));
      })
    );

    render(
      <TestProvider>
        <AgentDashboard />
      </TestProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/error loading agents/i)).toBeInTheDocument();
    });
  });
});
```

## Deployment Configuration

### Vite Configuration
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
      '@hooks': resolve(__dirname, 'src/hooks'),
      '@store': resolve(__dirname, 'src/store'),
      '@types': resolve(__dirname, 'src/types'),
    },
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-redux'],
          rtk: ['@reduxjs/toolkit'],
          charts: ['d3', 'chart.js', 'react-chartjs-2'],
          flow: ['reactflow'],
          ui: ['@headlessui/react', '@heroicons/react'],
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-redux', '@reduxjs/toolkit'],
  },
});
```

### Docker Configuration
```dockerfile
# Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Production Environment Variables
```bash
# .env.production
VITE_API_URL=https://api.caia.ai
VITE_WS_URL=wss://ws.caia.ai
VITE_SENTRY_DSN=your-sentry-dsn
VITE_ANALYTICS_ID=your-analytics-id
VITE_ENVIRONMENT=production
```

This implementation guide provides the foundation for building a comprehensive, production-ready frontend monitoring interface for the CAIA agent ecosystem. The modular architecture, real-time capabilities, and comprehensive testing ensure a robust and maintainable solution.