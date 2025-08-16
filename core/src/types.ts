/**
 * CAIA Core Types
 */

export interface AgentConfig {
  name: string;
  version: string;
  description?: string;
  timeout?: number;
  retryAttempts?: number;
  debug?: boolean;
}

export interface EngineConfig {
  name: string;
  version: string;
  description?: string;
  maxConcurrency?: number;
  timeout?: number;
}

export interface AgentInput<T = any> {
  id: string;
  timestamp: Date;
  data: T;
  context?: Record<string, any>;
  constraints?: Record<string, any>;
}

export interface AgentOutput<T = any> {
  id: string;
  timestamp: Date;
  success: boolean;
  data: T;
  errors?: Error[];
  metadata?: Record<string, any>;
  duration?: number;
}

export interface EngineInput<T = any> {
  data: T;
  options?: Record<string, any>;
}

export interface EngineOutput<T = any> {
  success: boolean;
  data: T;
  metrics?: Record<string, any>;
}

export interface OrchestrationPlan {
  id: string;
  name: string;
  steps: OrchestrationStep[];
  parallel?: boolean;
}

export interface OrchestrationStep {
  id: string;
  agent?: string;
  engine?: string;
  input: any;
  dependsOn?: string[];
}

export interface TaskDefinition {
  id: string;
  name: string;
  description: string;
  agents: string[];
  engines?: string[];
  workflow: OrchestrationPlan;
}

export abstract class BaseAgent {
  abstract name: string;
  abstract version: string;
  abstract execute(input: AgentInput): Promise<AgentOutput>;
}

export abstract class BaseEngine {
  abstract name: string;
  abstract version: string;
  abstract process(input: EngineInput): Promise<EngineOutput>;
}

export interface CAIAPlugin {
  name: string;
  version: string;
  install(caia: any): void;
}

export interface Metrics {
  executionTime: number;
  memoryUsage: number;
  successRate: number;
  errorRate: number;
  throughput: number;
}