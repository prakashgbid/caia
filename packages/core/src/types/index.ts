import { z } from 'zod';

// Base types for agent system
export interface AgentId {
  readonly value: string;
}

export interface TaskId {
  readonly value: string;
}

export interface PluginId {
  readonly value: string;
}

// Agent Status
export enum AgentStatus {
  INACTIVE = 'inactive',
  IDLE = 'idle',
  BUSY = 'busy',
  ERROR = 'error',
  TERMINATED = 'terminated'
}

// Task Status
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// Task Priority
export enum TaskPriority {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4
}

// Message Types
export enum MessageType {
  TASK_ASSIGNMENT = 'task_assignment',
  TASK_RESULT = 'task_result',
  AGENT_STATUS = 'agent_status',
  SYSTEM_EVENT = 'system_event',
  PLUGIN_EVENT = 'plugin_event',
  ERROR = 'error'
}

// Zod schemas for validation
export const AgentCapabilitySchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional()
});

export const TaskSchema = z.object({
  id: z.string(),
  type: z.string().min(1),
  priority: z.nativeEnum(TaskPriority),
  payload: z.record(z.unknown()),
  requirements: z.array(z.string()).optional(),
  timeout: z.number().positive().optional(),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).default(3),
  createdAt: z.date(),
  scheduledAt: z.date().optional(),
  deadline: z.date().optional()
});

export const MessageSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(MessageType),
  from: z.string(),
  to: z.string().optional(), // undefined means broadcast
  payload: z.record(z.unknown()),
  timestamp: z.date(),
  correlationId: z.string().optional()
});

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  capabilities: z.array(AgentCapabilitySchema),
  maxConcurrentTasks: z.number().int().positive().default(1),
  healthCheckInterval: z.number().positive().default(30000),
  timeout: z.number().positive().default(60000),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).default(3),
    baseDelay: z.number().positive().default(1000),
    maxDelay: z.number().positive().default(30000),
    backoffFactor: z.number().positive().default(2)
  }).optional(),
  metadata: z.record(z.unknown()).optional()
});

export const PluginConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  enabled: z.boolean().default(true),
  dependencies: z.array(z.string()).optional(),
  configuration: z.record(z.unknown()).optional()
});

// Type exports
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// Task result types
export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  result?: unknown;
  error?: Error;
  executionTime: number;
  completedAt: Date;
  metadata?: Record<string, unknown>;
}

// Agent metadata
export interface AgentMetadata {
  id: string;
  name: string;
  status: AgentStatus;
  capabilities: AgentCapability[];
  currentTasks: string[];
  completedTasks: number;
  failedTasks: number;
  uptime: number;
  lastHeartbeat: Date;
  version: string;
}

// Plugin interface
export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  initialize(config: Record<string, unknown>): Promise<void>;
  destroy(): Promise<void>;
  onAgentRegistered?(agentId: string): Promise<void>;
  onTaskAssigned?(task: Task): Promise<void>;
  onTaskCompleted?(result: TaskResult): Promise<void>;
  onMessage?(message: Message): Promise<void>;
}

// Event types
export interface AgentRegisteredEvent {
  agentId: string;
  config: AgentConfig;
  timestamp: Date;
}

export interface AgentUnregisteredEvent {
  agentId: string;
  reason: string;
  timestamp: Date;
}

export interface TaskCompletedEvent {
  task: Task;
  result: TaskResult;
  agentId: string;
  timestamp: Date;
}

export interface SystemEvent {
  type: string;
  data: unknown;
  timestamp: Date;
  source: string;
}

// Error types
export class CAIAError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CAIAError';
  }
}

export class AgentError extends CAIAError {
  constructor(message: string, public readonly agentId: string, details?: Record<string, unknown>) {
    super(message, 'AGENT_ERROR', { agentId, ...details });
    this.name = 'AgentError';
  }
}

export class TaskError extends CAIAError {
  constructor(message: string, public readonly taskId: string, details?: Record<string, unknown>) {
    super(message, 'TASK_ERROR', { taskId, ...details });
    this.name = 'TaskError';
  }
}

export class PluginError extends CAIAError {
  constructor(message: string, public readonly pluginId: string, details?: Record<string, unknown>) {
    super(message, 'PLUGIN_ERROR', { pluginId, ...details });
    this.name = 'PluginError';
  }
}

// Utility types
export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;
export type TaskHandler = (task: Task) => Promise<TaskResult>;
export type HealthCheckFunction = () => Promise<boolean>;

// Configuration interfaces
export interface OrchestratorConfig {
  maxConcurrentTasks: number;
  taskTimeout: number;
  healthCheckInterval: number;
  retryPolicy: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffFactor: number;
  };
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    format: 'json' | 'simple';
  };
  plugins: PluginConfig[];
}

export interface MessageBusConfig {
  maxListeners: number;
  messageTimeout: number;
  enableTracing: boolean;
}