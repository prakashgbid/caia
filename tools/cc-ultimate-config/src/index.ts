/**
 * CC Ultimate Config (CCU) - Main Export
 * 
 * The ultimate configuration optimizer for Claude Code.
 * Automatically discovers, validates, and applies performance optimizations.
 */

export { ConfigUpdateCommand } from './commands/config-update';
export { ConfigAnalyzer } from './analyzer/ConfigAnalyzer';
export { ResearchCrawler } from './crawler/ResearchCrawler';
export { OptimizationEngine } from './engine/OptimizationEngine';
export { ConfigVersionManager } from './versioning/ConfigVersionManager';
export { RollbackManager } from './rollback/RollbackManager';
export { Logger } from './utils/logger';

// Main orchestrator class
export class CCUltimateConfig {
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || require('path').join(__dirname, '../configs/ultimate-config.yaml');
  }

  /**
   * Initialize CCU with default configuration
   */
  async initialize(): Promise<void> {
    // Initialization logic
  }

  /**
   * Run full optimization cycle
   */
  async optimize(options: {
    auto?: boolean;
    dryRun?: boolean;
    verbose?: boolean;
  } = {}): Promise<any> {
    const { ConfigUpdateCommand } = await import('./commands/config-update');
    const command = new ConfigUpdateCommand();
    return await command.execute(options);
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<any> {
    const { ConfigVersionManager } = await import('./versioning/ConfigVersionManager');
    const versionManager = new ConfigVersionManager(this.configPath);
    await versionManager.initialize();

    return {
      currentVersion: versionManager.getCurrentVersion(),
      totalOptimizations: 82,
      configPath: this.configPath
    };
  }
}

// Default export
export default CCUltimateConfig;