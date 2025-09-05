/**
 * Hierarchical Agent System - Orchestration Module
 * Main entry point for Stream 5 orchestration components
 */

// Core orchestration
export { MasterOrchestrator } from './master/MasterOrchestrator';

// CLI interface
export { HierarchicalCommands } from './cli/commands/HierarchicalCommands';
export * from './cli';

// Automation
export { TriggerManager } from './automation/triggers/TriggerManager';

// Monitoring
export { MetricsCollector } from './monitoring/metrics/MetricsCollector';

// Caching
export { CacheService } from './cache/CacheService';

// Types
export * from './types/OrchestrationTypes';

// Version info
export const VERSION = '1.0.0';

/**
 * Factory function to create a complete orchestration system
 */
export function createOrchestrationSystem(config: any) {
  const orchestrator = new MasterOrchestrator(config);
  const cli = new HierarchicalCommands(config);
  const triggers = new TriggerManager(config);
  const metrics = new MetricsCollector(config);
  const cache = new CacheService(config);
  
  return {
    orchestrator,
    cli,
    triggers,
    metrics,
    cache,
    async initialize() {
      await Promise.all([
        orchestrator.initialize(),
        triggers.initialize(),
        metrics.initialize(),
        cache.initialize()
      ]);
    },
    async shutdown() {
      await Promise.all([
        orchestrator.shutdown(),
        triggers.shutdown(),
        metrics.shutdown(),
        cache.shutdown()
      ]);
    }
  };
}