/**
 * ConfigAnalyzer
 * Analyzes CC configurations for impact, conflicts, and optimization opportunities
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/logger';

interface ConfigAnalysis {
  isValid: boolean;
  conflicts: string[];
  impact: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  compatibility: number; // 0-1 score
  recommendations: string[];
}

export class ConfigAnalyzer {
  private logger: Logger;
  private currentConfig: any;

  constructor() {
    this.logger = new Logger('ConfigAnalyzer');
  }

  async loadConfiguration(configPath: string): Promise<void> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      this.currentConfig = yaml.load(content);
      this.logger.info(`Loaded configuration: ${this.currentConfig.version}`);
    } catch (error) {
      this.logger.error('Failed to load configuration', error);
      throw error;
    }
  }

  /**
   * Analyze a configuration discovery for viability
   */
  async analyzeConfiguration(config: any): Promise<ConfigAnalysis> {
    const analysis: ConfigAnalysis = {
      isValid: true,
      conflicts: [],
      impact: 'medium',
      category: 'general',
      compatibility: 0.8,
      recommendations: []
    };

    // Validate structure
    if (!this.validateStructure(config)) {
      analysis.isValid = false;
      analysis.recommendations.push('Fix configuration structure');
    }

    // Check for conflicts
    analysis.conflicts = this.detectConflicts(config);
    if (analysis.conflicts.length > 0) {
      analysis.compatibility -= 0.2;
    }

    // Assess impact
    analysis.impact = this.assessImpact(config);

    // Categorize
    analysis.category = this.categorizeConfiguration(config);

    // Generate recommendations
    analysis.recommendations.push(...this.generateRecommendations(config, analysis));

    return analysis;
  }

  /**
   * Validate configuration structure
   */
  private validateStructure(config: any): boolean {
    // Check required fields
    const requiredFields = ['setting', 'value'];
    for (const field of requiredFields) {
      if (!(field in config)) {
        this.logger.warn(`Missing required field: ${field}`);
        return false;
      }
    }

    // Validate setting name format
    if (typeof config.setting !== 'string' || config.setting.length === 0) {
      this.logger.warn('Invalid setting name');
      return false;
    }

    return true;
  }

  /**
   * Detect conflicts with existing configurations
   */
  private detectConflicts(config: any): string[] {
    const conflicts: string[] = [];

    if (!this.currentConfig) {
      return conflicts;
    }

    // Check for direct setting conflicts
    for (const category of Object.keys(this.currentConfig.configurations || {})) {
      const configurations = this.currentConfig.configurations[category];
      
      for (const existingConfig of configurations) {
        if (existingConfig.config?.setting === config.setting) {
          if (JSON.stringify(existingConfig.config.value) !== JSON.stringify(config.value)) {
            conflicts.push(`Conflicting value for setting '${config.setting}'`);
          }
        }

        // Check for logical conflicts
        if (this.hasLogicalConflict(config, existingConfig.config)) {
          conflicts.push(`Logical conflict with ${existingConfig.name}`);
        }
      }
    }

    return conflicts;
  }

  /**
   * Check for logical conflicts between configurations
   */
  private hasLogicalConflict(config1: any, config2: any): boolean {
    // Define conflict patterns
    const conflictPatterns = [
      // Memory vs Performance trade-offs
      {
        pattern1: { setting: /memory_.*/, value: 'aggressive' },
        pattern2: { setting: /performance_.*/, value: 'high' },
        reason: 'Aggressive memory optimization may conflict with high performance'
      },
      
      // Parallel vs Sequential
      {
        pattern1: { setting: /parallel_.*/, value: true },
        pattern2: { setting: /sequential_.*/, value: true },
        reason: 'Parallel and sequential processing conflict'
      }
    ];

    for (const conflict of conflictPatterns) {
      if (this.matchesPattern(config1, conflict.pattern1) && 
          this.matchesPattern(config2, conflict.pattern2)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if config matches a pattern
   */
  private matchesPattern(config: any, pattern: any): boolean {
    if (pattern.setting instanceof RegExp) {
      return pattern.setting.test(config.setting) && config.value === pattern.value;
    }
    
    return config.setting === pattern.setting && config.value === pattern.value;
  }

  /**
   * Assess configuration impact
   */
  private assessImpact(config: any): 'low' | 'medium' | 'high' | 'critical' {
    // High impact indicators
    const highImpactSettings = [
      /parallel.*/,
      /memory.*/,
      /performance.*/,
      /cache.*/,
      /async.*/
    ];

    // Critical impact indicators  
    const criticalImpactSettings = [
      /rate_limit.*/,
      /timeout.*/,
      /error_recovery.*/
    ];

    const setting = config.setting.toLowerCase();

    if (criticalImpactSettings.some(pattern => pattern.test(setting))) {
      return 'critical';
    }

    if (highImpactSettings.some(pattern => pattern.test(setting))) {
      return 'high';
    }

    // Check for performance keywords in description
    const description = (config.description || '').toLowerCase();
    const performanceKeywords = ['speed', 'faster', 'optimization', 'performance', 'efficiency'];
    
    if (performanceKeywords.some(keyword => description.includes(keyword))) {
      return 'high';
    }

    return 'medium';
  }

  /**
   * Categorize configuration
   */
  private categorizeConfiguration(config: any): string {
    const setting = config.setting.toLowerCase();
    const description = (config.description || '').toLowerCase();

    // Category mapping
    const categories = {
      performance: ['performance', 'speed', 'optimization', 'parallel'],
      memory: ['memory', 'cache', 'buffer', 'heap'],
      api: ['api', 'request', 'response', 'rate_limit'],
      context: ['context', 'claude_md', 'hierarchy'],
      errors: ['error', 'retry', 'timeout', 'recovery'],
      parallel: ['parallel', 'concurrent', 'async', 'worker']
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => setting.includes(keyword) || description.includes(keyword))) {
        return category;
      }
    }

    return 'general';
  }

  /**
   * Generate recommendations for configuration
   */
  private generateRecommendations(config: any, analysis: ConfigAnalysis): string[] {
    const recommendations: string[] = [];

    if (analysis.impact === 'critical') {
      recommendations.push('Test in isolated environment before applying');
      recommendations.push('Create backup before implementation');
    }

    if (analysis.conflicts.length > 0) {
      recommendations.push('Resolve conflicts before applying');
      recommendations.push('Review related configurations');
    }

    if (analysis.compatibility < 0.6) {
      recommendations.push('Manual review required');
      recommendations.push('Consider alternative implementation');
    }

    if (analysis.impact === 'high' || analysis.impact === 'critical') {
      recommendations.push('Monitor performance after applying');
      recommendations.push('Have rollback plan ready');
    }

    return recommendations;
  }

  /**
   * Generate compatibility score for configuration
   */
  async calculateCompatibilityScore(config: any): Promise<number> {
    let score = 1.0;

    // Reduce score for conflicts
    const conflicts = this.detectConflicts(config);
    score -= conflicts.length * 0.1;

    // Reduce score for structural issues
    if (!this.validateStructure(config)) {
      score -= 0.3;
    }

    // Reduce score for risky configurations
    if (this.assessImpact(config) === 'critical') {
      score -= 0.2;
    }

    return Math.max(0, Math.min(1, score));
  }
}