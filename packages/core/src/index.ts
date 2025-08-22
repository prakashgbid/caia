/**
 * @caia/core - Core orchestration and agent management system for CAIA
 * 
 * This package provides the foundational components for building AI agent systems:
 * - Agent registration and management
 * - Task distribution and coordination
 * - Event-driven communication
 * - Plugin architecture
 * - Error handling and logging
 */

// Core orchestrator
export { Orchestrator, type OrchestratorStats } from './orchestrator/Orchestrator.js';

// Base agent class
export { BaseAgent } from './agent/BaseAgent.js';

// Communication system
export { 
  MessageBus, 
  type MessageFilter, 
  type MessageHandler, 
  type MessageSubscription 
} from './communication/MessageBus.js';

// Plugin system
export { 
  PluginManager, 
  type PluginMetadata, 
  type PluginLoadResult, 
  type PluginDependencyGraph 
} from './plugin/PluginManager.js';

// All types and interfaces
export {
  // Core types
  type AgentId,
  type TaskId,
  type PluginId,
  
  // Enums
  AgentStatus,
  TaskStatus,
  TaskPriority,
  MessageType,
  
  // Schemas for validation
  AgentCapabilitySchema,
  TaskSchema,
  MessageSchema,
  AgentConfigSchema,
  PluginConfigSchema,
  
  // Type definitions
  type AgentCapability,
  type Task,
  type Message,
  type AgentConfig,
  type PluginConfig,
  type TaskResult,
  type AgentMetadata,
  type Plugin,
  
  // Event types
  type AgentRegisteredEvent,
  type AgentUnregisteredEvent,
  type TaskCompletedEvent,
  type SystemEvent,
  
  // Error types
  CAIAError,
  AgentError,
  TaskError,
  PluginError,
  
  // Utility types
  type EventHandler,
  type TaskHandler,
  type HealthCheckFunction,
  
  // Configuration interfaces
  type OrchestratorConfig,
  type MessageBusConfig
} from './types/index.js';

// Utility functions and constants
export const VERSION = '1.0.0';

/**
 * Creates a default orchestrator configuration
 */
export function createDefaultConfig(): OrchestratorConfig {
  return {
    maxConcurrentTasks: 100,
    taskTimeout: 60000,
    healthCheckInterval: 30000,
    retryPolicy: {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2
    },
    logging: {
      level: 'info',
      format: 'simple'
    },
    plugins: []
  };
}

/**
 * Creates a production-ready orchestrator configuration
 */
export function createProductionConfig(): OrchestratorConfig {
  return {
    maxConcurrentTasks: 1000,
    taskTimeout: 300000, // 5 minutes
    healthCheckInterval: 10000, // 10 seconds
    retryPolicy: {
      maxRetries: 5,
      baseDelay: 2000,
      maxDelay: 60000,
      backoffFactor: 1.5
    },
    logging: {
      level: 'warn',
      format: 'json'
    },
    plugins: []
  };
}

/**
 * Creates a development orchestrator configuration
 */
export function createDevelopmentConfig(): OrchestratorConfig {
  return {
    maxConcurrentTasks: 10,
    taskTimeout: 30000,
    healthCheckInterval: 60000,
    retryPolicy: {
      maxRetries: 1,
      baseDelay: 500,
      maxDelay: 5000,
      backoffFactor: 2
    },
    logging: {
      level: 'debug',
      format: 'simple'
    },
    plugins: []
  };
}

/**
 * Validates an orchestrator configuration
 */
export function validateConfig(config: OrchestratorConfig): void {
  if (config.maxConcurrentTasks <= 0) {
    throw new Error('maxConcurrentTasks must be positive');
  }
  
  if (config.taskTimeout <= 0) {
    throw new Error('taskTimeout must be positive');
  }
  
  if (config.healthCheckInterval <= 0) {
    throw new Error('healthCheckInterval must be positive');
  }
  
  if (config.retryPolicy.maxRetries < 0) {
    throw new Error('retryPolicy.maxRetries must be non-negative');
  }
  
  if (config.retryPolicy.baseDelay <= 0) {
    throw new Error('retryPolicy.baseDelay must be positive');
  }
  
  if (config.retryPolicy.maxDelay <= 0) {
    throw new Error('retryPolicy.maxDelay must be positive');
  }
  
  if (config.retryPolicy.backoffFactor <= 0) {
    throw new Error('retryPolicy.backoffFactor must be positive');
  }
  
  if (!['error', 'warn', 'info', 'debug'].includes(config.logging.level)) {
    throw new Error('logging.level must be one of: error, warn, info, debug');
  }
  
  if (!['json', 'simple'].includes(config.logging.format)) {
    throw new Error('logging.format must be one of: json, simple');
  }
}