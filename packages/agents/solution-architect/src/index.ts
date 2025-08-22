/**
 * @caia/agent-solution-architect
 * 
 * Solution Architect Agent for designing end-to-end technical solutions
 */

export { SolutionArchitectAgent } from './SolutionArchitectAgent.js';
export * from './types/SolutionTypes.js';

// Service exports
export { ArchitectureGenerator } from './services/ArchitectureGenerator.js';
export { TechnologySelector } from './services/TechnologySelector.js';
export { SecurityAnalyzer } from './services/SecurityAnalyzer.js';
export { PerformanceAnalyzer } from './services/PerformanceAnalyzer.js';
export { CostAnalyzer } from './services/CostAnalyzer.js';
export { ComplianceAnalyzer } from './services/ComplianceAnalyzer.js';
export { DiagramGenerator } from './services/DiagramGenerator.js';

// Re-export core types for convenience
export type {
  AgentConfig,
  Task,
  TaskResult,
  AgentCapability,
  AgentMetadata
} from '@caia/core';

/**
 * Create a pre-configured Solution Architect Agent
 */
export function createSolutionArchitectAgent(config?: Partial<import('@caia/core').AgentConfig>) {
  const { SolutionArchitectAgent } = require('./SolutionArchitectAgent.js');
  const defaultConfig = SolutionArchitectAgent.createDefaultConfig();
  
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
  
  return new SolutionArchitectAgent(finalConfig, logger);
}

/**
 * Get default capabilities for Solution Architect Agent
 */
export function getDefaultCapabilities() {
  const { SolutionArchitectAgent } = require('./SolutionArchitectAgent.js');
  return SolutionArchitectAgent.getDefaultCapabilities();
}

/**
 * Package version
 */
export const VERSION = '1.0.0';