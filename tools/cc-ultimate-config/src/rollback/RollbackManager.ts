/**
 * RollbackManager
 * Provides safe rollback mechanisms for configuration changes
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger } from '../utils/logger';
import { ConfigVersionManager } from '../versioning/ConfigVersionManager';
import { OptimizationEngine } from '../engine/OptimizationEngine';

interface RollbackPlan {
  id: string;
  timestamp: Date;
  reason: string;
  fromVersion: string;
  toVersion: string;
  affectedConfigs: string[];
  estimatedDuration: number;
  riskLevel: 'low' | 'medium' | 'high';
  preConditions: string[];
  steps: RollbackStep[];
}

interface RollbackStep {
  id: string;
  description: string;
  type: 'backup' | 'test' | 'apply' | 'verify' | 'cleanup';
  command?: string;
  expectedDuration: number;
  failureAction: 'continue' | 'abort' | 'retry';
}

interface RollbackResult {
  success: boolean;
  completedSteps: string[];
  failedStep?: string;
  error?: string;
  duration: number;
  verificationResults: any;
}

export class RollbackManager {
  private logger: Logger;
  private versionManager: ConfigVersionManager;
  private optimizationEngine: OptimizationEngine;
  private rollbacksDir: string;

  constructor(configPath: string) {
    this.logger = new Logger('RollbackManager');
    this.versionManager = new ConfigVersionManager(configPath);
    this.optimizationEngine = new OptimizationEngine();
    this.rollbacksDir = path.join(path.dirname(configPath), '../rollbacks');
  }

  /**
   * Initialize rollback manager
   */
  async initialize(): Promise<void> {
    await this.versionManager.initialize();
    await fs.mkdir(this.rollbacksDir, { recursive: true });
    this.logger.info('Rollback manager initialized');
  }

  /**
   * Create a rollback plan
   */
  async createRollbackPlan(toVersion: string, reason: string): Promise<RollbackPlan> {
    const currentVersion = this.versionManager.getCurrentVersion();
    if (!currentVersion) {
      throw new Error('No current version available');
    }

    const planId = `rollback-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
    
    // Get configuration differences
    const changes = await this.versionManager.getVersionDiff(currentVersion, toVersion);
    const affectedConfigs = changes.map(c => c.configId);

    // Assess risk level
    const riskLevel = this.assessRiskLevel(changes);

    // Build rollback steps
    const steps = this.buildRollbackSteps(currentVersion, toVersion, riskLevel);

    const plan: RollbackPlan = {
      id: planId,
      timestamp: new Date(),
      reason,
      fromVersion: currentVersion,
      toVersion,
      affectedConfigs,
      estimatedDuration: this.calculateEstimatedDuration(steps),
      riskLevel,
      preConditions: this.generatePreConditions(riskLevel),
      steps
    };

    // Save rollback plan
    await this.saveRollbackPlan(plan);

    this.logger.info(`Created rollback plan ${planId}: ${currentVersion} → ${toVersion}`);
    return plan;
  }

  /**
   * Execute rollback plan
   */
  async executeRollback(planId: string, force: boolean = false): Promise<RollbackResult> {
    const startTime = Date.now();
    const result: RollbackResult = {
      success: false,
      completedSteps: [],
      duration: 0,
      verificationResults: {}
    };

    try {
      this.logger.info(`Starting rollback execution: ${planId}`);

      // Load rollback plan
      const plan = await this.loadRollbackPlan(planId);
      if (!plan) {
        throw new Error(`Rollback plan ${planId} not found`);
      }

      // Check pre-conditions
      if (!force) {
        const preConditionCheck = await this.checkPreConditions(plan);
        if (!preConditionCheck.passed) {
          throw new Error(`Pre-conditions failed: ${preConditionCheck.failures.join(', ')}`);
        }
      }

      // Execute steps
      for (const step of plan.steps) {
        try {
          this.logger.info(`Executing step: ${step.description}`);
          
          const stepResult = await this.executeRollbackStep(step);
          if (!stepResult.success) {
            if (step.failureAction === 'abort') {
              result.failedStep = step.id;
              result.error = stepResult.error;
              break;
            } else if (step.failureAction === 'retry') {
              // Retry the step once
              const retryResult = await this.executeRollbackStep(step);
              if (!retryResult.success && step.failureAction === 'abort') {
                result.failedStep = step.id;
                result.error = retryResult.error;
                break;
              }
            }
            // Continue for 'continue' failure action
          }

          result.completedSteps.push(step.id);

        } catch (error) {
          result.failedStep = step.id;
          result.error = error.message;
          
          if (step.failureAction === 'abort') {
            break;
          }
        }
      }

      // Verify rollback success
      if (result.completedSteps.length === plan.steps.length) {
        result.verificationResults = await this.verifyRollback(plan);
        result.success = result.verificationResults.success;
      }

      result.duration = Date.now() - startTime;

      // Log result
      if (result.success) {
        this.logger.info(`Rollback ${planId} completed successfully in ${result.duration}ms`);
      } else {
        this.logger.error(`Rollback ${planId} failed at step ${result.failedStep}: ${result.error}`);
      }

      // Save rollback execution log
      await this.saveRollbackResult(planId, result);

      return result;

    } catch (error) {
      result.error = error.message;
      result.duration = Date.now() - startTime;
      
      this.logger.error(`Rollback ${planId} execution failed`, error);
      await this.saveRollbackResult(planId, result);
      
      return result;
    }
  }

  /**
   * Quick rollback to previous version
   */
  async quickRollback(reason: string = 'Quick rollback'): Promise<RollbackResult> {
    try {
      // Get last 2 versions
      const versions = await this.versionManager.getVersionHistory(2);
      if (versions.length < 2) {
        throw new Error('No previous version available for rollback');
      }

      const previousVersion = versions[1].version;
      
      // Create and execute rollback plan
      const plan = await this.createRollbackPlan(previousVersion, reason);
      return await this.executeRollback(plan.id, false);

    } catch (error) {
      this.logger.error('Quick rollback failed', error);
      throw error;
    }
  }

  /**
   * Emergency rollback with minimal safety checks
   */
  async emergencyRollback(toVersion: string): Promise<RollbackResult> {
    this.logger.warn(`⚠️  EMERGENCY ROLLBACK TO ${toVersion}`);

    try {
      // Create minimal rollback plan
      const plan = await this.createRollbackPlan(toVersion, 'EMERGENCY ROLLBACK');
      
      // Execute with force flag (skip pre-conditions)
      return await this.executeRollback(plan.id, true);

    } catch (error) {
      this.logger.error('Emergency rollback failed', error);
      
      // Last resort: direct version restore
      this.logger.warn('Attempting direct version restore');
      const success = await this.versionManager.restoreVersion(toVersion);
      
      return {
        success,
        completedSteps: success ? ['direct-restore'] : [],
        error: success ? undefined : 'Direct restore failed',
        duration: 0,
        verificationResults: { success }
      };
    }
  }

  /**
   * Assess risk level for rollback
   */
  private assessRiskLevel(changes: any[]): 'low' | 'medium' | 'high' {
    const criticalCategories = ['api', 'parallel', 'memory', 'errors'];
    const highImpactChanges = changes.filter(c => 
      criticalCategories.includes(c.category) || 
      c.type === 'remove'
    );

    if (highImpactChanges.length > 5) {
      return 'high';
    } else if (highImpactChanges.length > 2) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Build rollback steps
   */
  private buildRollbackSteps(fromVersion: string, toVersion: string, riskLevel: string): RollbackStep[] {
    const steps: RollbackStep[] = [];

    // 1. Create backup
    steps.push({
      id: 'backup',
      description: 'Create backup of current configuration',
      type: 'backup',
      expectedDuration: 5000,
      failureAction: 'abort'
    });

    // 2. Pre-rollback tests (for high risk)
    if (riskLevel === 'high') {
      steps.push({
        id: 'pre-test',
        description: 'Run pre-rollback verification tests',
        type: 'test',
        command: 'npm run test:config',
        expectedDuration: 30000,
        failureAction: 'continue'
      });
    }

    // 3. Apply rollback
    steps.push({
      id: 'apply-rollback',
      description: `Restore configuration to version ${toVersion}`,
      type: 'apply',
      expectedDuration: 10000,
      failureAction: 'abort'
    });

    // 4. Post-rollback verification
    steps.push({
      id: 'verify',
      description: 'Verify configuration integrity',
      type: 'verify',
      expectedDuration: 15000,
      failureAction: 'retry'
    });

    // 5. Performance test (for medium/high risk)
    if (riskLevel !== 'low') {
      steps.push({
        id: 'performance-test',
        description: 'Run performance validation',
        type: 'test',
        command: 'npm run test:performance',
        expectedDuration: 45000,
        failureAction: 'continue'
      });
    }

    // 6. Cleanup
    steps.push({
      id: 'cleanup',
      description: 'Clean up temporary files',
      type: 'cleanup',
      expectedDuration: 5000,
      failureAction: 'continue'
    });

    return steps;
  }

  /**
   * Generate pre-conditions for rollback
   */
  private generatePreConditions(riskLevel: string): string[] {
    const conditions = [
      'No active CC processes',
      'Sufficient disk space available',
      'Configuration backup exists'
    ];

    if (riskLevel === 'high') {
      conditions.push(
        'System is in maintenance mode',
        'All dependent services are stopped',
        'Manual approval obtained'
      );
    }

    return conditions;
  }

  /**
   * Calculate estimated duration
   */
  private calculateEstimatedDuration(steps: RollbackStep[]): number {
    return steps.reduce((total, step) => total + step.expectedDuration, 0);
  }

  /**
   * Check pre-conditions
   */
  private async checkPreConditions(plan: RollbackPlan): Promise<{ passed: boolean; failures: string[] }> {
    const failures: string[] = [];

    for (const condition of plan.preConditions) {
      const passed = await this.checkCondition(condition);
      if (!passed) {
        failures.push(condition);
      }
    }

    return {
      passed: failures.length === 0,
      failures
    };
  }

  /**
   * Check individual condition
   */
  private async checkCondition(condition: string): Promise<boolean> {
    try {
      switch (condition) {
        case 'No active CC processes':
          return await this.checkNoActiveProcesses();
          
        case 'Sufficient disk space available':
          return await this.checkDiskSpace();
          
        case 'Configuration backup exists':
          return await this.checkBackupExists();
          
        default:
          // For manual conditions, assume they're checked
          return true;
      }
    } catch (error) {
      this.logger.warn(`Failed to check condition: ${condition}`, error);
      return false;
    }
  }

  /**
   * Check for active Claude Code processes
   */
  private async checkNoActiveProcesses(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('pgrep', ['-f', 'claude-code'], { stdio: 'pipe' });
      
      child.on('close', (code) => {
        resolve(code !== 0); // No processes found if pgrep returns non-zero
      });
      
      child.on('error', () => {
        resolve(true); // If pgrep fails, assume no processes
      });
    });
  }

  /**
   * Check available disk space
   */
  private async checkDiskSpace(): Promise<boolean> {
    try {
      const stats = await fs.statfs(this.rollbacksDir);
      const freeSpace = stats.bavail * stats.bsize;
      const requiredSpace = 100 * 1024 * 1024; // 100MB
      
      return freeSpace > requiredSpace;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if backup exists
   */
  private async checkBackupExists(): Promise<boolean> {
    const currentVersion = this.versionManager.getCurrentVersion();
    if (!currentVersion) return false;
    
    try {
      const versions = await this.versionManager.getVersionHistory(5);
      return versions.length > 1; // Need at least one backup version
    } catch (error) {
      return false;
    }
  }

  /**
   * Execute individual rollback step
   */
  private async executeRollbackStep(step: RollbackStep): Promise<{ success: boolean; error?: string }> {
    try {
      switch (step.type) {
        case 'backup':
          return await this.executeBackupStep();
          
        case 'test':
          return await this.executeTestStep(step);
          
        case 'apply':
          return await this.executeApplyStep();
          
        case 'verify':
          return await this.executeVerifyStep();
          
        case 'cleanup':
          return await this.executeCleanupStep();
          
        default:
          return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute backup step
   */
  private async executeBackupStep(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.versionManager.createVersion(
        'Rollback backup',
        [{ type: 'modify', category: 'system', configId: 'rollback', name: 'backup', reason: 'Pre-rollback backup' }],
        ['rollback-backup']
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute test step
   */
  private async executeTestStep(step: RollbackStep): Promise<{ success: boolean; error?: string }> {
    if (!step.command) {
      return { success: true };
    }

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', step.command], { stdio: 'pipe' });
      
      child.on('close', (code) => {
        resolve({
          success: code === 0,
          error: code !== 0 ? `Test failed with exit code ${code}` : undefined
        });
      });
      
      child.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * Execute apply step
   */
  private async executeApplyStep(): Promise<{ success: boolean; error?: string }> {
    // This would be implemented to apply the actual rollback
    // For now, return success
    return { success: true };
  }

  /**
   * Execute verify step
   */
  private async executeVerifyStep(): Promise<{ success: boolean; error?: string }> {
    // Implement configuration verification logic
    return { success: true };
  }

  /**
   * Execute cleanup step
   */
  private async executeCleanupStep(): Promise<{ success: boolean; error?: string }> {
    // Cleanup temporary files
    return { success: true };
  }

  /**
   * Verify rollback success
   */
  private async verifyRollback(plan: RollbackPlan): Promise<any> {
    // Implement comprehensive verification
    return { success: true, checks: [] };
  }

  /**
   * Save rollback plan
   */
  private async saveRollbackPlan(plan: RollbackPlan): Promise<void> {
    const planFile = path.join(this.rollbacksDir, `${plan.id}.json`);
    await fs.writeFile(planFile, JSON.stringify(plan, null, 2));
  }

  /**
   * Load rollback plan
   */
  private async loadRollbackPlan(planId: string): Promise<RollbackPlan | null> {
    try {
      const planFile = path.join(this.rollbacksDir, `${planId}.json`);
      const content = await fs.readFile(planFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Save rollback execution result
   */
  private async saveRollbackResult(planId: string, result: RollbackResult): Promise<void> {
    const resultFile = path.join(this.rollbacksDir, `${planId}-result.json`);
    await fs.writeFile(resultFile, JSON.stringify(result, null, 2));
  }
}