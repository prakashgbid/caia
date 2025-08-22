/**
 * @caia/agent-backend-engineer
 * 
 * Backend Engineer Agent for API development, database design, and server infrastructure
 */

export { BackendEngineerAgent } from './BackendEngineerAgent.js';
export * from './types/BackendTypes.js';

// Service exports
export { ApiGenerator } from './services/ApiGenerator.js';
export { DatabaseDesigner } from './services/DatabaseDesigner.js';
export { AuthenticationService } from './services/AuthenticationService.js';
export { MicroserviceDesigner } from './services/MicroserviceDesigner.js';
export { MessageQueueService } from './services/MessageQueueService.js';
export { SecurityService } from './services/SecurityService.js';
export { PerformanceOptimizer } from './services/PerformanceOptimizer.js';
export { MonitoringService } from './services/MonitoringService.js';
export { CodeGenerator } from './services/CodeGenerator.js';
export { DatabaseMigrator } from './services/DatabaseMigrator.js';

// Re-export core types for convenience
export type {
  AgentConfig,
  Task,
  TaskResult,
  AgentCapability,
  AgentMetadata
} from '@caia/core';

/**
 * Create a pre-configured Backend Engineer Agent
 */
export function createBackendEngineerAgent(config?: Partial<import('@caia/core').AgentConfig>) {
  const { BackendEngineerAgent } = require('./BackendEngineerAgent.js');
  const defaultConfig = BackendEngineerAgent.createDefaultConfig();
  
  const finalConfig = {
    ...defaultConfig,
    ...config
  };
  
  // Logger would typically be injected
  const winston = require('winston');
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console()
    ]
  });
  
  return new BackendEngineerAgent(finalConfig, logger);
}

/**
 * Get default capabilities for Backend Engineer Agent
 */
export function getDefaultCapabilities() {
  const { BackendEngineerAgent } = require('./BackendEngineerAgent.js');
  return BackendEngineerAgent.getDefaultCapabilities();
}

/**
 * Package version
 */
export const VERSION = '1.0.0';