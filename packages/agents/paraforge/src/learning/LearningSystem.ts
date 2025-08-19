/**
 * Learning System - Captures and analyzes patterns from project decompositions
 */

import { logger } from '../utils/logger';
import type { ProjectIdea } from '../core/ParaForgeCore';
import type { OptimizedPlan } from '../optimizer/ParallelizationOptimizer';

export interface LearningData {
  id: string;
  timestamp: Date;
  projectIdea: ProjectIdea;
  plan: OptimizedPlan;
  execution?: ExecutionResults;
  patterns: ExtractedPattern[];
}

export interface ExecutionResults {
  success: boolean;
  duration: number;
  issuesCreated: number;
  errors: string[];
}

export interface ExtractedPattern {
  type: string;
  context: Record<string, any>;
  confidence: number;
  applicability: string[];
}

export interface PatternTemplate {
  name: string;
  domain: string;
  structure: any;
  conditions: Record<string, any>;
  success_rate: number;
}

export class LearningSystem {
  private databaseUrl?: string;
  private learningData: Map<string, LearningData> = new Map();
  private patterns: Map<string, PatternTemplate> = new Map();

  constructor(databaseUrl?: string) {
    this.databaseUrl = databaseUrl;
    this.initializeDefaultPatterns();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Learning System');
    
    if (this.databaseUrl) {
      // In production, would connect to actual database
      logger.info('Database connection would be established here');
    } else {
      logger.info('Using in-memory learning storage');
    }

    // Load existing patterns
    await this.loadPatterns();
    
    logger.info('Learning System initialized', { 
      patterns: this.patterns.size,
      learningEntries: this.learningData.size
    });
  }

  async recordDecomposition(idea: ProjectIdea, plan: OptimizedPlan): Promise<void> {
    const id = `decomp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const patterns = this.extractPatterns(idea, plan);
    
    const learningEntry: LearningData = {
      id,
      timestamp: new Date(),
      projectIdea: idea,
      plan,
      patterns
    };

    this.learningData.set(id, learningEntry);
    
    // Update patterns based on new data
    await this.updatePatterns(patterns);
    
    logger.info('Decomposition recorded for learning', { 
      id, 
      patterns: patterns.length,
      totalStoryPoints: plan.structure.totalStoryPoints
    });
  }

  async recordExecution(jiraModel: any, executionResult: any): Promise<void> {
    logger.info('Recording execution results for learning');
    
    // Find corresponding decomposition
    const decomposition = Array.from(this.learningData.values())
      .find(entry => !entry.execution); // Find first without execution data

    if (decomposition) {
      decomposition.execution = {
        success: executionResult.success,
        duration: executionResult.timing?.duration || 0,
        issuesCreated: executionResult.createdItems?.length || 0,
        errors: executionResult.errors?.map((e: any) => e.error) || []
      };

      this.learningData.set(decomposition.id, decomposition);
      logger.info('Execution results recorded', { 
        decompositionId: decomposition.id,
        success: decomposition.execution.success
      });
    }
  }

  async getPatterns(domain?: string): Promise<PatternTemplate[]> {
    const patterns = Array.from(this.patterns.values());
    
    if (domain) {
      return patterns.filter(pattern => 
        pattern.domain === domain || 
        pattern.name.toLowerCase().includes(domain.toLowerCase())
      );
    }
    
    return patterns;
  }

  private extractPatterns(idea: ProjectIdea, plan: OptimizedPlan): ExtractedPattern[] {
    const patterns: ExtractedPattern[] = [];

    // Architecture pattern
    patterns.push({
      type: 'architecture',
      context: {
        approach: plan.architecture.approach,
        technologies: plan.architecture.technologies,
        team_size: plan.team.size
      },
      confidence: 0.8,
      applicability: [plan.project.type, 'web-application']
    });

    // Structure pattern
    patterns.push({
      type: 'structure',
      context: {
        initiatives_count: plan.structure.initiatives.length,
        total_story_points: plan.structure.totalStoryPoints,
        avg_features_per_initiative: plan.structure.initiatives.reduce((sum, init) => 
          sum + init.features.length, 0) / plan.structure.initiatives.length
      },
      confidence: 0.75,
      applicability: ['project-structure', plan.project.type]
    });

    // Timeline pattern
    patterns.push({
      type: 'timeline',
      context: {
        total_duration: plan.timeline.totalDuration,
        phases: plan.timeline.phases.length,
        methodology: plan.team.methodology
      },
      confidence: 0.7,
      applicability: ['timeline-estimation', plan.team.methodology]
    });

    // Parallelization pattern
    patterns.push({
      type: 'parallelization',
      context: {
        strategy: plan.parallelization.strategy,
        batch_size: plan.parallelization.batchSize,
        levels: plan.parallelization.execution.length,
        total_items: plan.parallelization.execution.reduce((sum, level) => 
          sum + level.items.length, 0)
      },
      confidence: 0.85,
      applicability: ['parallel-execution', 'jira-automation']
    });

    return patterns;
  }

  private async updatePatterns(newPatterns: ExtractedPattern[]): Promise<void> {
    for (const pattern of newPatterns) {
      const key = `${pattern.type}-${pattern.applicability[0]}`;
      
      const existing = this.patterns.get(key);
      if (existing) {
        // Update existing pattern
        existing.success_rate = (existing.success_rate + pattern.confidence) / 2;
        existing.structure = this.mergeContext(existing.structure, pattern.context);
      } else {
        // Create new pattern template
        const template: PatternTemplate = {
          name: `${pattern.type} Pattern`,
          domain: pattern.applicability[0],
          structure: pattern.context,
          conditions: this.extractConditions(pattern),
          success_rate: pattern.confidence
        };
        
        this.patterns.set(key, template);
      }
    }
  }

  private mergeContext(existing: any, newContext: any): any {
    // Simple merge logic - in production would be more sophisticated
    return { ...existing, ...newContext };
  }

  private extractConditions(pattern: ExtractedPattern): Record<string, any> {
    // Extract conditions under which this pattern applies
    const conditions: Record<string, any> = {};
    
    switch (pattern.type) {
      case 'architecture':
        conditions.team_size_range = this.getTeamSizeRange(pattern.context.team_size);
        conditions.technology_stack = pattern.context.technologies;
        break;
        
      case 'structure':
        conditions.story_points_range = this.getStoryPointsRange(pattern.context.total_story_points);
        conditions.initiatives_count = pattern.context.initiatives_count;
        break;
        
      case 'timeline':
        conditions.methodology = pattern.context.methodology;
        conditions.phase_count = pattern.context.phases;
        break;
        
      case 'parallelization':
        conditions.strategy = pattern.context.strategy;
        conditions.min_items = Math.floor(pattern.context.total_items * 0.8);
        conditions.max_items = Math.floor(pattern.context.total_items * 1.2);
        break;
    }
    
    return conditions;
  }

  private getTeamSizeRange(size: number): string {
    if (size <= 3) return 'small';
    if (size <= 8) return 'medium';
    return 'large';
  }

  private getStoryPointsRange(points: number): string {
    if (points <= 20) return 'small';
    if (points <= 50) return 'medium';
    if (points <= 100) return 'large';
    return 'enterprise';
  }

  private initializeDefaultPatterns(): void {
    // Seed with common patterns
    const webAppPattern: PatternTemplate = {
      name: 'Standard Web Application',
      domain: 'web-application',
      structure: {
        architecture: 'microservices',
        technologies: ['Node.js', 'React', 'PostgreSQL'],
        initiatives: ['Authentication', 'Core Features', 'Admin'],
        typical_story_points: 45
      },
      conditions: {
        team_size_range: 'medium',
        story_points_range: 'medium'
      },
      success_rate: 0.85
    };

    const mobileAppPattern: PatternTemplate = {
      name: 'Mobile Application',
      domain: 'mobile-application',
      structure: {
        architecture: 'client-server',
        technologies: ['React Native', 'Node.js', 'MongoDB'],
        initiatives: ['Authentication', 'Core Features', 'Offline Support'],
        typical_story_points: 35
      },
      conditions: {
        team_size_range: 'small',
        story_points_range: 'medium'
      },
      success_rate: 0.8
    };

    this.patterns.set('web-app-standard', webAppPattern);
    this.patterns.set('mobile-app-standard', mobileAppPattern);
  }

  private async loadPatterns(): Promise<void> {
    // In production, would load from database
    logger.info('Loaded default patterns', { count: this.patterns.size });
  }

  // Analytics methods for insights
  async getSuccessMetrics(): Promise<any> {
    const entries = Array.from(this.learningData.values())
      .filter(entry => entry.execution);

    if (entries.length === 0) {
      return { total: 0, success_rate: 0, avg_duration: 0 };
    }

    const successful = entries.filter(entry => entry.execution?.success);
    const totalDuration = entries.reduce((sum, entry) => 
      sum + (entry.execution?.duration || 0), 0);

    return {
      total: entries.length,
      success_rate: successful.length / entries.length,
      avg_duration: totalDuration / entries.length,
      avg_issues_created: entries.reduce((sum, entry) => 
        sum + (entry.execution?.issuesCreated || 0), 0) / entries.length
    };
  }

  async getMostSuccessfulPatterns(): Promise<PatternTemplate[]> {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.success_rate - a.success_rate)
      .slice(0, 5);
  }
}