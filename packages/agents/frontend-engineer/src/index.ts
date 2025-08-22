/**
 * @caia/agent-frontend-engineer
 * 
 * Frontend Engineer Agent for UI/UX implementation, React/Vue/Angular development, and performance optimization
 */

export { FrontendEngineerAgent } from './FrontendEngineerAgent.js';
export * from './types/FrontendTypes.js';

// Service exports
export { UIDesigner } from './services/UIDesigner.js';
export { ComponentGenerator } from './services/ComponentGenerator.js';
export { StateManager } from './services/StateManager.js';
export { PerformanceOptimizer } from './services/PerformanceOptimizer.js';
export { AccessibilityService } from './services/AccessibilityService.js';
export { ResponsiveDesigner } from './services/ResponsiveDesigner.js';
export { TestingService } from './services/TestingService.js';
export { BuildService } from './services/BuildService.js';
export { DeploymentService } from './services/DeploymentService.js';
export { ThemeService } from './services/ThemeService.js';
export { UXService } from './services/UXService.js';
export { FormService } from './services/FormService.js';

// Re-export core types for convenience
export type {
  AgentConfig,
  Task,
  TaskResult,
  AgentCapability,
  AgentMetadata
} from '@caia/core';

/**
 * Create a pre-configured Frontend Engineer Agent
 */
export function createFrontendEngineerAgent(config?: Partial<import('@caia/core').AgentConfig>) {
  const { FrontendEngineerAgent } = require('./FrontendEngineerAgent.js');
  const defaultConfig = FrontendEngineerAgent.createDefaultConfig();
  
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
  
  return new FrontendEngineerAgent(finalConfig, logger);
}

/**
 * Get default capabilities for Frontend Engineer Agent
 */
export function getDefaultCapabilities() {
  const { FrontendEngineerAgent } = require('./FrontendEngineerAgent.js');
  return FrontendEngineerAgent.getDefaultCapabilities();
}

/**
 * Package version
 */
export const VERSION = '1.0.0';