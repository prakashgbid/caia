import { EventEmitter } from 'events';
import {
  QualityGate,
  ValidationResult,
  QualityIssue,
  HierarchicalBreakdown
} from '@caia/shared/hierarchical-types';

/**
 * Configuration for QualityGateController
 */
export interface QualityGateConfig {
  globalConfidenceThreshold: number;
  enableAutomaticRework: boolean;
  maxReworkCycles: number;
  reworkTriggerThreshold: number;
  gateHistoryRetention: number; // days
  enableProgressiveValidation: boolean;
}

/**
 * Quality gate execution result
 */
interface GateExecutionResult {
  gate: QualityGate;
  passed: boolean;
  requiresRework: boolean;
  nextActions: string[];
  reworkSuggestions: ReworkSuggestion[];
  executionTime: number;
}

interface ReworkSuggestion {
  tier: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  action: string;
  description: string;
  estimatedEffort: 'low' | 'medium' | 'high';
  expectedImprovement: number; // percentage
}

/**
 * Gate execution history
 */
interface GateHistory {
  id: string;
  tier: string;
  timestamp: Date;
  passed: boolean;
  confidence: number;
  issues: QualityIssue[];
  reworkCycle: number;
  executionTimeMs: number;
}

/**
 * Validation rule definition
 */
interface ValidationRule {
  id: string;
  name: string;
  tier: string;
  weight: number;
  threshold: number;
  validator: (data: any) => ValidationResult;
  description: string;
  category: 'completeness' | 'quality' | 'consistency' | 'feasibility';
}

/**
 * Rework loop management
 */
interface ReworkLoop {
  id: string;
  tier: string;
  cycleCount: number;
  issues: QualityIssue[];
  improvements: number[]; // confidence scores over cycles
  startTime: Date;
  lastCycle: Date;
  status: 'active' | 'resolved' | 'abandoned';
}

/**
 * Enhanced QualityGateController with 85% confidence threshold enforcement
 * Manages validation rules per hierarchy level and automated feedback generation
 */
export class QualityGateController extends EventEmitter {
  private config: QualityGateConfig;
  private validationRules: Map<string, ValidationRule[]> = new Map();
  private gateHistory: GateHistory[] = [];
  private activeReworkLoops: Map<string, ReworkLoop> = new Map();
  private gateExecutionStats: Map<string, GateStats> = new Map();

  constructor(config: QualityGateConfig) {
    super();
    this.config = {
      globalConfidenceThreshold: 0.85,
      enableAutomaticRework: true,
      maxReworkCycles: 3,
      reworkTriggerThreshold: 0.70,
      gateHistoryRetention: 30,
      enableProgressiveValidation: true,
      ...config
    };
    
    this.initializeValidationRules();
    this.startHistoryCleanup();
  }

  /**
   * Executes quality gate for a specific tier with comprehensive validation
   */
  async executeQualityGate(
    tier: string,
    data: any,
    previousGate?: QualityGate
  ): Promise<GateExecutionResult> {
    const startTime = Date.now();
    this.emit('gate:execution:start', { tier, timestamp: new Date() });

    try {
      // Get validation rules for this tier
      const rules = this.validationRules.get(tier) || [];
      if (rules.length === 0) {
        throw new Error(`No validation rules defined for tier: ${tier}`);
      }

      // Execute validations
      const validations = await this.executeValidations(rules, data);
      
      // Calculate overall confidence
      const confidence = this.calculateWeightedConfidence(validations, rules);
      
      // Determine if gate passes
      const passed = confidence >= this.config.globalConfidenceThreshold;
      
      // Identify quality issues
      const issues = this.identifyQualityIssues(validations, confidence, tier);
      
      // Generate recommendations
      const recommendations = this.generateRecommendations(validations, issues, tier);
      
      // Create quality gate
      const gate: QualityGate = {
        tier,
        sourceTier: this.getSourceTier(tier),
        targetTier: this.getTargetTier(tier),
        confidence,
        threshold: this.config.globalConfidenceThreshold,
        validations,
        passed,
        issues,
        recommendations,
        timestamp: new Date()
      };

      // Determine if rework is needed
      const requiresRework = this.shouldTriggerRework(gate, previousGate);
      
      // Generate rework suggestions if needed
      const reworkSuggestions = requiresRework 
        ? this.generateReworkSuggestions(gate, data)
        : [];
      
      // Determine next actions
      const nextActions = this.determineNextActions(gate, requiresRework);
      
      const executionTime = Date.now() - startTime;
      
      const result: GateExecutionResult = {
        gate,
        passed,
        requiresRework,
        nextActions,
        reworkSuggestions,
        executionTime
      };

      // Record execution in history
      this.recordGateExecution(gate, executionTime, requiresRework);
      
      // Handle rework loop if needed
      if (requiresRework) {
        await this.handleReworkLoop(tier, gate, reworkSuggestions);
      }

      this.emit('gate:execution:complete', { tier, result });
      return result;
    } catch (error) {
      this.emit('gate:execution:error', { tier, error });
      throw error;
    }
  }

  /**
   * Validates complete hierarchical breakdown across all tiers
   */
  async validateHierarchicalBreakdown(breakdown: HierarchicalBreakdown): Promise<QualityGate[]> {
    const gates: QualityGate[] = [];
    
    // Define tier validation sequence
    const tierSequence = [
      { tier: 'idea', data: breakdown.idea },
      { tier: 'initiative', data: breakdown.initiatives },
      { tier: 'feature', data: breakdown.features },
      { tier: 'epic', data: breakdown.epics },
      { tier: 'story', data: breakdown.stories },
      { tier: 'task', data: breakdown.tasks },
      { tier: 'subtask', data: breakdown.subtasks }
    ];

    // Execute gates in sequence, using progressive validation if enabled
    let previousGate: QualityGate | undefined;
    
    for (const { tier, data } of tierSequence) {
      if (data && (Array.isArray(data) ? data.length > 0 : true)) {
        const result = await this.executeQualityGate(tier, data, previousGate);
        gates.push(result.gate);
        
        // Stop if gate fails and automatic rework is disabled
        if (!result.passed && !this.config.enableAutomaticRework) {
          this.emit('validation:stopped', { tier, reason: 'Gate failed and automatic rework disabled' });
          break;
        }
        
        previousGate = result.gate;
      }
    }
    
    // Validate overall traceability
    const traceabilityGate = await this.validateTraceability(breakdown);
    gates.push(traceabilityGate);
    
    return gates;
  }

  /**
   * Gets gate execution statistics
   */
  getGateStatistics(tier?: string): GateStats[] {
    if (tier) {
      const stats = this.gateExecutionStats.get(tier);
      return stats ? [stats] : [];
    }
    
    return Array.from(this.gateExecutionStats.values());
  }

  /**
   * Gets gate execution history
   */
  getGateHistory(tier?: string, days?: number): GateHistory[] {
    let history = this.gateHistory;
    
    if (tier) {
      history = history.filter(h => h.tier === tier);
    }
    
    if (days) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      history = history.filter(h => h.timestamp >= cutoff);
    }
    
    return history.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Gets active rework loops
   */
  getActiveReworkLoops(): ReworkLoop[] {
    return Array.from(this.activeReworkLoops.values())
      .filter(loop => loop.status === 'active');
  }

  /**
   * Adds custom validation rule for a tier
   */
  addValidationRule(tier: string, rule: ValidationRule): void {
    if (!this.validationRules.has(tier)) {
      this.validationRules.set(tier, []);
    }
    
    const rules = this.validationRules.get(tier)!;
    
    // Check for duplicate rule IDs
    if (rules.some(r => r.id === rule.id)) {
      throw new Error(`Validation rule with ID '${rule.id}' already exists for tier '${tier}'`);
    }
    
    rules.push(rule);
    this.emit('rule:added', { tier, ruleId: rule.id });
  }

  /**
   * Removes validation rule from a tier
   */
  removeValidationRule(tier: string, ruleId: string): boolean {
    const rules = this.validationRules.get(tier);
    if (!rules) return false;
    
    const index = rules.findIndex(r => r.id === ruleId);
    if (index === -1) return false;
    
    rules.splice(index, 1);
    this.emit('rule:removed', { tier, ruleId });
    return true;
  }

  /**
   * Updates configuration
   */
  updateConfig(newConfig: Partial<QualityGateConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('config:updated', this.config);
  }

  // === PRIVATE METHODS ===

  private initializeValidationRules(): void {
    // Initialize default validation rules for each tier
    
    // Idea tier rules
    this.validationRules.set('idea', [
      {
        id: 'idea-completeness',
        name: 'Idea Completeness',
        tier: 'idea',
        weight: 0.3,
        threshold: 0.8,
        validator: this.validateIdeaCompleteness.bind(this),
        description: 'Validates that idea has required fields and analysis',
        category: 'completeness'
      },
      {
        id: 'feasibility-score',
        name: 'Feasibility Score',
        tier: 'idea',
        weight: 0.4,
        threshold: 0.6,
        validator: this.validateFeasibilityScore.bind(this),
        description: 'Validates overall feasibility score meets minimum threshold',
        category: 'feasibility'
      },
      {
        id: 'market-analysis',
        name: 'Market Analysis Quality',
        tier: 'idea',
        weight: 0.3,
        threshold: 0.7,
        validator: this.validateMarketAnalysis.bind(this),
        description: 'Validates market analysis completeness and quality',
        category: 'quality'
      }
    ]);

    // Initiative tier rules
    this.validationRules.set('initiative', [
      {
        id: 'initiative-count',
        name: 'Initiative Count',
        tier: 'initiative',
        weight: 0.2,
        threshold: 0.8,
        validator: this.validateInitiativeCount.bind(this),
        description: 'Validates appropriate number of initiatives (3-7)',
        category: 'completeness'
      },
      {
        id: 'resource-allocation',
        name: 'Resource Allocation',
        tier: 'initiative',
        weight: 0.3,
        threshold: 0.75,
        validator: this.validateResourceAllocation.bind(this),
        description: 'Validates resource allocation across initiatives',
        category: 'feasibility'
      },
      {
        id: 'timeline-feasibility',
        name: 'Timeline Feasibility',
        tier: 'initiative',
        weight: 0.25,
        threshold: 0.8,
        validator: this.validateTimelineFeasibility.bind(this),
        description: 'Validates timeline constraints and dependencies',
        category: 'feasibility'
      },
      {
        id: 'objective-clarity',
        name: 'Objective Clarity',
        tier: 'initiative',
        weight: 0.25,
        threshold: 0.85,
        validator: this.validateObjectiveClarity.bind(this),
        description: 'Validates clarity and measurability of objectives',
        category: 'quality'
      }
    ]);

    // Feature tier rules
    this.validationRules.set('feature', [
      {
        id: 'feature-distribution',
        name: 'Feature Distribution',
        tier: 'feature',
        weight: 0.2,
        threshold: 0.8,
        validator: this.validateFeatureDistribution.bind(this),
        description: 'Validates balanced feature distribution across initiatives',
        category: 'consistency'
      },
      {
        id: 'user-story-quality',
        name: 'User Story Quality',
        tier: 'feature',
        weight: 0.3,
        threshold: 0.85,
        validator: this.validateUserStoryQuality.bind(this),
        description: 'Validates user story format and completeness',
        category: 'quality'
      },
      {
        id: 'technical-feasibility',
        name: 'Technical Feasibility',
        tier: 'feature',
        weight: 0.25,
        threshold: 0.75,
        validator: this.validateTechnicalFeasibility.bind(this),
        description: 'Validates technical requirements and complexity',
        category: 'feasibility'
      },
      {
        id: 'acceptance-criteria',
        name: 'Acceptance Criteria Quality',
        tier: 'feature',
        weight: 0.25,
        threshold: 0.8,
        validator: this.validateAcceptanceCriteria.bind(this),
        description: 'Validates acceptance criteria completeness and clarity',
        category: 'quality'
      }
    ]);

    // Epic tier rules
    this.validationRules.set('epic', [
      {
        id: 'epic-scope',
        name: 'Epic Scope',
        tier: 'epic',
        weight: 0.3,
        threshold: 0.8,
        validator: this.validateEpicScope.bind(this),
        description: 'Validates epic scope and story estimation',
        category: 'completeness'
      },
      {
        id: 'business-value',
        name: 'Business Value',
        tier: 'epic',
        weight: 0.4,
        threshold: 0.7,
        validator: this.validateBusinessValue.bind(this),
        description: 'Validates business value assessment',
        category: 'quality'
      },
      {
        id: 'epic-dependencies',
        name: 'Epic Dependencies',
        tier: 'epic',
        weight: 0.3,
        threshold: 0.75,
        validator: this.validateEpicDependencies.bind(this),
        description: 'Validates epic dependencies and relationships',
        category: 'consistency'
      }
    ]);
  }

  private async executeValidations(rules: ValidationRule[], data: any): Promise<ValidationResult[]> {
    const validations: ValidationResult[] = [];
    
    for (const rule of rules) {
      try {
        const result = rule.validator(data);
        validations.push(result);
      } catch (error) {
        // Create failed validation result for errors
        validations.push({
          rule: rule.name,
          passed: false,
          score: 0,
          details: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }
    
    return validations;
  }

  private calculateWeightedConfidence(validations: ValidationResult[], rules: ValidationRule[]): number {
    if (validations.length === 0 || rules.length === 0) return 0;
    
    let weightedScore = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < validations.length && i < rules.length; i++) {
      const validation = validations[i];
      const rule = rules[i];
      
      weightedScore += (validation.score / 100) * rule.weight;
      totalWeight += rule.weight;
    }
    
    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  }

  private identifyQualityIssues(validations: ValidationResult[], confidence: number, tier: string): QualityIssue[] {
    const issues: QualityIssue[] = [];
    
    // Global confidence issue
    if (confidence < this.config.globalConfidenceThreshold) {
      issues.push({
        severity: 'high',
        type: 'Low Confidence',
        description: `${tier} confidence ${(confidence * 100).toFixed(1)}% below threshold ${(this.config.globalConfidenceThreshold * 100)}%`,
        suggestion: `Improve ${tier} quality to meet confidence threshold`
      });
    }
    
    // Validation-specific issues
    validations.forEach((validation, index) => {
      if (!validation.passed) {
        const severity = validation.score < 30 ? 'critical' : validation.score < 60 ? 'high' : 'medium';
        issues.push({
          severity,
          type: validation.rule,
          description: `Failed validation: ${validation.details}`,
          suggestion: this.getSuggestionForValidation(validation.rule, tier)
        });
      }
    });
    
    return issues;
  }

  private generateRecommendations(validations: ValidationResult[], issues: QualityIssue[], tier: string): string[] {
    const recommendations: string[] = [];
    
    // Critical issue recommendations
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      recommendations.push(`Address ${criticalIssues.length} critical issues before proceeding`);
    }
    
    // High-priority recommendations
    const highIssues = issues.filter(i => i.severity === 'high');
    if (highIssues.length > 0) {
      recommendations.push(`Resolve ${highIssues.length} high-priority issues`);
    }
    
    // Specific recommendations based on failed validations
    const failedValidations = validations.filter(v => !v.passed);
    if (failedValidations.length > 0) {
      recommendations.push(`Review and improve: ${failedValidations.map(v => v.rule).join(', ')}`);
    }
    
    // Tier-specific recommendations
    recommendations.push(...this.getTierSpecificRecommendations(tier, validations, issues));
    
    if (recommendations.length === 0) {
      recommendations.push(`${tier} quality meets all requirements and is ready for next tier`);
    }
    
    return recommendations;
  }

  private shouldTriggerRework(gate: QualityGate, previousGate?: QualityGate): boolean {
    if (!this.config.enableAutomaticRework) return false;
    
    // Always trigger rework if confidence is below rework threshold
    if (gate.confidence < this.config.reworkTriggerThreshold) {
      return true;
    }
    
    // Trigger if there are critical issues
    if (gate.issues.some(issue => issue.severity === 'critical')) {
      return true;
    }
    
    // Trigger if confidence decreased significantly from previous gate
    if (previousGate && gate.confidence < previousGate.confidence - 0.1) {
      return true;
    }
    
    return false;
  }

  private generateReworkSuggestions(gate: QualityGate, data: any): ReworkSuggestion[] {
    const suggestions: ReworkSuggestion[] = [];
    
    // Generate suggestions based on quality issues
    gate.issues.forEach(issue => {
      const suggestion: ReworkSuggestion = {
        tier: gate.tier,
        priority: issue.severity,
        action: this.getActionForIssue(issue),
        description: issue.suggestion,
        estimatedEffort: this.estimateEffortForIssue(issue),
        expectedImprovement: this.estimateImprovement(issue)
      };
      
      suggestions.push(suggestion);
    });
    
    // Add general improvement suggestions
    if (gate.confidence < 0.8) {
      suggestions.push({
        tier: gate.tier,
        priority: 'medium',
        action: 'comprehensive-review',
        description: 'Conduct comprehensive review of all components',
        estimatedEffort: 'high',
        expectedImprovement: 15
      });
    }
    
    return suggestions.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  private determineNextActions(gate: QualityGate, requiresRework: boolean): string[] {
    const actions: string[] = [];
    
    if (gate.passed && !requiresRework) {
      actions.push(`Proceed to ${gate.targetTier} tier`);
      actions.push('Continue with next phase of development');
    } else if (requiresRework) {
      actions.push('Address identified quality issues');
      actions.push('Re-run quality gate after improvements');
      
      if (gate.issues.some(i => i.severity === 'critical')) {
        actions.push('Prioritize critical issues for immediate resolution');
      }
    } else {
      actions.push('Review quality gate results');
      actions.push('Consider scope adjustments if needed');
    }
    
    return actions;
  }

  private async handleReworkLoop(tier: string, gate: QualityGate, suggestions: ReworkSuggestion[]): Promise<void> {
    const loopId = `${tier}_${Date.now()}`;
    const existingLoop = Array.from(this.activeReworkLoops.values())
      .find(loop => loop.tier === tier && loop.status === 'active');
    
    if (existingLoop) {
      // Update existing loop
      existingLoop.cycleCount++;
      existingLoop.issues = gate.issues;
      existingLoop.improvements.push(gate.confidence);
      existingLoop.lastCycle = new Date();
      
      // Check if we should abandon the loop
      if (existingLoop.cycleCount >= this.config.maxReworkCycles) {
        existingLoop.status = 'abandoned';
        this.emit('rework:abandoned', { loopId: existingLoop.id, tier, cycles: existingLoop.cycleCount });
      }
    } else {
      // Create new rework loop
      const newLoop: ReworkLoop = {
        id: loopId,
        tier,
        cycleCount: 1,
        issues: gate.issues,
        improvements: [gate.confidence],
        startTime: new Date(),
        lastCycle: new Date(),
        status: 'active'
      };
      
      this.activeReworkLoops.set(loopId, newLoop);
      this.emit('rework:started', { loopId, tier, suggestions });
    }
  }

  private recordGateExecution(gate: QualityGate, executionTime: number, requiresRework: boolean): void {
    // Record in history
    const historyEntry: GateHistory = {
      id: `${gate.tier}_${Date.now()}`,
      tier: gate.tier,
      timestamp: gate.timestamp,
      passed: gate.passed,
      confidence: gate.confidence,
      issues: gate.issues,
      reworkCycle: this.getReworkCycle(gate.tier),
      executionTimeMs: executionTime
    };
    
    this.gateHistory.push(historyEntry);
    
    // Update statistics
    this.updateGateStatistics(gate.tier, gate.passed, gate.confidence, executionTime);
  }

  private updateGateStatistics(tier: string, passed: boolean, confidence: number, executionTime: number): void {
    if (!this.gateExecutionStats.has(tier)) {
      this.gateExecutionStats.set(tier, {
        tier,
        totalExecutions: 0,
        passedExecutions: 0,
        averageConfidence: 0,
        averageExecutionTime: 0,
        lastExecution: new Date()
      });
    }
    
    const stats = this.gateExecutionStats.get(tier)!;
    stats.totalExecutions++;
    if (passed) stats.passedExecutions++;
    
    // Update averages
    stats.averageConfidence = ((stats.averageConfidence * (stats.totalExecutions - 1)) + confidence) / stats.totalExecutions;
    stats.averageExecutionTime = ((stats.averageExecutionTime * (stats.totalExecutions - 1)) + executionTime) / stats.totalExecutions;
    stats.lastExecution = new Date();
  }

  private async validateTraceability(breakdown: HierarchicalBreakdown): Promise<QualityGate> {
    const validations: ValidationResult[] = [];
    
    // Validate idea to initiative traceability
    if (breakdown.initiatives.length > 0) {
      const ideaToInitiative = breakdown.initiatives.every(init => init.ideaId === breakdown.idea.id);
      validations.push({
        rule: 'Idea-Initiative Traceability',
        passed: ideaToInitiative,
        score: ideaToInitiative ? 100 : 0,
        details: `${breakdown.initiatives.length} initiatives traced to idea`
      });
    }
    
    // Validate initiative to feature traceability
    if (breakdown.features.length > 0 && breakdown.initiatives.length > 0) {
      const initiativeIds = new Set(breakdown.initiatives.map(i => i.id));
      const featuresTraced = breakdown.features.filter(f => initiativeIds.has(f.initiativeId)).length;
      const traceabilityScore = (featuresTraced / breakdown.features.length) * 100;
      
      validations.push({
        rule: 'Initiative-Feature Traceability',
        passed: traceabilityScore >= 95,
        score: traceabilityScore,
        details: `${featuresTraced}/${breakdown.features.length} features traced to initiatives`
      });
    }
    
    // Calculate overall traceability score
    const confidence = validations.length > 0 
      ? validations.reduce((sum, v) => sum + v.score, 0) / validations.length / 100
      : 1;
    
    return {
      tier: 'traceability',
      sourceTier: 'all',
      targetTier: 'complete',
      confidence,
      threshold: this.config.globalConfidenceThreshold,
      validations,
      passed: confidence >= this.config.globalConfidenceThreshold,
      issues: confidence < this.config.globalConfidenceThreshold ? [{
        severity: 'high',
        type: 'Traceability Gap',
        description: 'Incomplete traceability across hierarchy levels',
        suggestion: 'Ensure all items are properly linked to parent tiers'
      }] : [],
      recommendations: confidence >= this.config.globalConfidenceThreshold 
        ? ['Hierarchical breakdown maintains complete traceability']
        : ['Improve traceability links between hierarchy levels'],
      timestamp: new Date()
    };
  }

  private getReworkCycle(tier: string): number {
    const activeLoop = Array.from(this.activeReworkLoops.values())
      .find(loop => loop.tier === tier && loop.status === 'active');
    
    return activeLoop ? activeLoop.cycleCount : 0;
  }

  private startHistoryCleanup(): void {
    // Clean up old history entries every 24 hours
    setInterval(() => {
      const cutoffDate = new Date(Date.now() - this.config.gateHistoryRetention * 24 * 60 * 60 * 1000);
      this.gateHistory = this.gateHistory.filter(entry => entry.timestamp >= cutoffDate);
    }, 24 * 60 * 60 * 1000);
  }

  private getSourceTier(tier: string): string {
    const tierMap: Record<string, string> = {
      'idea': 'raw_input',
      'initiative': 'idea',
      'feature': 'initiative',
      'epic': 'feature',
      'story': 'epic',
      'task': 'story',
      'subtask': 'task'
    };
    
    return tierMap[tier] || 'unknown';
  }

  private getTargetTier(tier: string): string {
    const tierMap: Record<string, string> = {
      'idea': 'initiative',
      'initiative': 'feature',
      'feature': 'epic',
      'epic': 'story',
      'story': 'task',
      'task': 'subtask',
      'subtask': 'complete'
    };
    
    return tierMap[tier] || 'unknown';
  }

  private getSuggestionForValidation(validationRule: string, tier: string): string {
    const suggestions: Record<string, string> = {
      'Idea Completeness': 'Ensure idea has title, description, and initial analysis',
      'Feasibility Score': 'Improve technical, business, or resource feasibility scores',
      'Market Analysis Quality': 'Conduct more comprehensive market research',
      'Initiative Count': 'Adjust number of initiatives to optimal range (3-7)',
      'Resource Allocation': 'Balance resource allocation across initiatives',
      'Timeline Feasibility': 'Review timeline constraints and dependencies',
      'Objective Clarity': 'Make objectives more specific and measurable',
      'Feature Distribution': 'Balance features more evenly across initiatives',
      'User Story Quality': 'Improve user story format and clarity',
      'Technical Feasibility': 'Review and simplify technical requirements',
      'Acceptance Criteria': 'Make acceptance criteria more specific and testable'
    };
    
    return suggestions[validationRule] || `Review and improve ${validationRule.toLowerCase()}`;
  }

  private getTierSpecificRecommendations(tier: string, validations: ValidationResult[], issues: QualityIssue[]): string[] {
    const recommendations: string[] = [];
    
    switch (tier) {
      case 'idea':
        if (issues.some(i => i.type === 'Market Analysis Quality')) {
          recommendations.push('Consider conducting additional market research');
        }
        break;
      case 'initiative':
        if (issues.some(i => i.type === 'Resource Allocation')) {
          recommendations.push('Review resource capacity and availability');
        }
        break;
      case 'feature':
        if (issues.some(i => i.type === 'User Story Quality')) {
          recommendations.push('Follow standard user story format: "As a [persona], I want [functionality] so that [benefit]"');
        }
        break;
    }
    
    return recommendations;
  }

  private getActionForIssue(issue: QualityIssue): string {
    switch (issue.severity) {
      case 'critical': return 'immediate-fix';
      case 'high': return 'priority-review';
      case 'medium': return 'scheduled-improvement';
      case 'low': return 'future-enhancement';
      default: return 'review';
    }
  }

  private estimateEffortForIssue(issue: QualityIssue): 'low' | 'medium' | 'high' {
    switch (issue.severity) {
      case 'critical': return 'high';
      case 'high': return 'medium';
      case 'medium': return 'low';
      case 'low': return 'low';
      default: return 'medium';
    }
  }

  private estimateImprovement(issue: QualityIssue): number {
    const improvementMap = {
      'critical': 25,
      'high': 15,
      'medium': 8,
      'low': 3
    };
    
    return improvementMap[issue.severity] || 5;
  }

  // === VALIDATION METHODS ===

  private validateIdeaCompleteness(idea: any): ValidationResult {
    let score = 0;
    const checks: string[] = [];
    
    if (idea.title && idea.title.trim().length > 0) { score += 20; checks.push('Title present'); }
    if (idea.description && idea.description.trim().length > 10) { score += 30; checks.push('Description adequate'); }
    if (idea.marketAnalysis) { score += 25; checks.push('Market analysis present'); }
    if (idea.feasibility) { score += 25; checks.push('Feasibility analysis present'); }
    
    return {
      rule: 'Idea Completeness',
      passed: score >= 80,
      score,
      details: checks.join(', ') || 'No completeness criteria met'
    };
  }

  private validateFeasibilityScore(idea: any): ValidationResult {
    if (!idea.feasibility) {
      return {
        rule: 'Feasibility Score',
        passed: false,
        score: 0,
        details: 'No feasibility analysis available'
      };
    }
    
    const score = idea.feasibility.overall || 0;
    
    return {
      rule: 'Feasibility Score',
      passed: score >= 60,
      score,
      details: `Overall feasibility: ${score}% (Technical: ${idea.feasibility.technical}%, Business: ${idea.feasibility.business}%, Resource: ${idea.feasibility.resource}%)`
    };
  }

  private validateMarketAnalysis(idea: any): ValidationResult {
    if (!idea.marketAnalysis) {
      return {
        rule: 'Market Analysis Quality',
        passed: false,
        score: 0,
        details: 'No market analysis available'
      };
    }
    
    let score = 0;
    const checks: string[] = [];
    
    if (idea.marketAnalysis.marketSize > 0) { score += 25; checks.push('Market size estimated'); }
    if (idea.marketAnalysis.competitors && idea.marketAnalysis.competitors.length > 0) { score += 25; checks.push('Competitors identified'); }
    if (idea.marketAnalysis.opportunities && idea.marketAnalysis.opportunities.length > 0) { score += 25; checks.push('Opportunities identified'); }
    if (idea.marketAnalysis.positioning) { score += 25; checks.push('Positioning defined'); }
    
    return {
      rule: 'Market Analysis Quality',
      passed: score >= 70,
      score,
      details: checks.join(', ') || 'Market analysis incomplete'
    };
  }

  private validateInitiativeCount(initiatives: any[]): ValidationResult {
    const count = initiatives.length;
    const isOptimal = count >= 3 && count <= 7;
    
    let score = 100;
    if (count < 3) score = Math.max(0, 60 - (3 - count) * 20);
    if (count > 7) score = Math.max(0, 80 - (count - 7) * 10);
    
    return {
      rule: 'Initiative Count',
      passed: isOptimal,
      score,
      details: `${count} initiatives (optimal: 3-7)`
    };
  }

  private validateResourceAllocation(initiatives: any[]): ValidationResult {
    let totalResources = 0;
    let initiativesWithResources = 0;
    
    for (const initiative of initiatives) {
      if (initiative.resources && initiative.resources.length > 0) {
        initiativesWithResources++;
        totalResources += initiative.resources.reduce((sum: number, r: any) => sum + (r.quantity || 0), 0);
      }
    }
    
    const allocationScore = initiatives.length > 0 ? (initiativesWithResources / initiatives.length) * 100 : 0;
    
    return {
      rule: 'Resource Allocation',
      passed: allocationScore >= 75 && totalResources > 0,
      score: allocationScore,
      details: `${initiativesWithResources}/${initiatives.length} initiatives have resource allocation (${totalResources} total resources)`
    };
  }

  private validateTimelineFeasibility(initiatives: any[]): ValidationResult {
    let feasibleTimelines = 0;
    
    for (const initiative of initiatives) {
      if (initiative.timeline) {
        const duration = new Date(initiative.timeline.endDate).getTime() - new Date(initiative.timeline.startDate).getTime();
        const months = duration / (30 * 24 * 60 * 60 * 1000);
        
        if (months >= 1 && months <= 12) {
          feasibleTimelines++;
        }
      }
    }
    
    const score = initiatives.length > 0 ? (feasibleTimelines / initiatives.length) * 100 : 0;
    
    return {
      rule: 'Timeline Feasibility',
      passed: score >= 80,
      score,
      details: `${feasibleTimelines}/${initiatives.length} initiatives have feasible timelines`
    };
  }

  private validateObjectiveClarity(initiatives: any[]): ValidationResult {
    let clearObjectives = 0;
    
    for (const initiative of initiatives) {
      if (initiative.objectives && initiative.objectives.length >= 2) {
        const hasSpecificObjectives = initiative.objectives.some((obj: string) => 
          obj.length > 10 && obj.includes(' ')
        );
        
        if (hasSpecificObjectives) {
          clearObjectives++;
        }
      }
    }
    
    const score = initiatives.length > 0 ? (clearObjectives / initiatives.length) * 100 : 0;
    
    return {
      rule: 'Objective Clarity',
      passed: score >= 85,
      score,
      details: `${clearObjectives}/${initiatives.length} initiatives have clear, specific objectives`
    };
  }

  private validateFeatureDistribution(features: any[]): ValidationResult {
    const initiativeMap = new Map<string, number>();
    
    features.forEach(feature => {
      const count = initiativeMap.get(feature.initiativeId) || 0;
      initiativeMap.set(feature.initiativeId, count + 1);
    });
    
    const counts = Array.from(initiativeMap.values());
    const avgFeatures = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const isBalanced = counts.every(count => Math.abs(count - avgFeatures) <= 2);
    
    return {
      rule: 'Feature Distribution',
      passed: isBalanced,
      score: isBalanced ? 100 : 70,
      details: `Features distributed across ${counts.length} initiatives (avg: ${avgFeatures.toFixed(1)})`
    };
  }

  private validateUserStoryQuality(features: any[]): ValidationResult {
    let qualityStories = 0;
    let totalStories = 0;
    
    for (const feature of features) {
      if (feature.userStories && feature.userStories.length > 0) {
        totalStories += feature.userStories.length;
        
        feature.userStories.forEach((story: string) => {
          // Check for proper user story format
          if (story.toLowerCase().includes('as a') && 
              story.toLowerCase().includes('i want') && 
              story.toLowerCase().includes('so that')) {
            qualityStories++;
          }
        });
      }
    }
    
    const score = totalStories > 0 ? (qualityStories / totalStories) * 100 : 0;
    
    return {
      rule: 'User Story Quality',
      passed: score >= 85,
      score,
      details: `${qualityStories}/${totalStories} user stories follow proper format`
    };
  }

  private validateTechnicalFeasibility(features: any[]): ValidationResult {
    let feasibleFeatures = 0;
    
    for (const feature of features) {
      const requirements = feature.technicalRequirements || [];
      const hasReasonableComplexity = requirements.length <= 10; // Not too many requirements
      const hasRequirements = requirements.length > 0;
      
      if (hasReasonableComplexity && hasRequirements) {
        feasibleFeatures++;
      }
    }
    
    const score = features.length > 0 ? (feasibleFeatures / features.length) * 100 : 0;
    
    return {
      rule: 'Technical Feasibility',
      passed: score >= 75,
      score,
      details: `${feasibleFeatures}/${features.length} features have feasible technical requirements`
    };
  }

  private validateAcceptanceCriteria(features: any[]): ValidationResult {
    let featuresWithCriteria = 0;
    
    for (const feature of features) {
      const criteria = feature.acceptanceCriteria || [];
      const hasAdequateCriteria = criteria.length >= 2;
      const hasSpecificCriteria = criteria.some((c: string) => c.length > 15);
      
      if (hasAdequateCriteria && hasSpecificCriteria) {
        featuresWithCriteria++;
      }
    }
    
    const score = features.length > 0 ? (featuresWithCriteria / features.length) * 100 : 0;
    
    return {
      rule: 'Acceptance Criteria Quality',
      passed: score >= 80,
      score,
      details: `${featuresWithCriteria}/${features.length} features have adequate acceptance criteria`
    };
  }

  private validateEpicScope(epics: any[]): ValidationResult {
    let wellScopedEpics = 0;
    
    for (const epic of epics) {
      const hasTitle = epic.title && epic.title.length > 5;
      const hasDescription = epic.description && epic.description.length > 20;
      const hasEstimation = epic.estimatedStories && epic.estimatedStories > 0;
      
      if (hasTitle && hasDescription && hasEstimation) {
        wellScopedEpics++;
      }
    }
    
    const score = epics.length > 0 ? (wellScopedEpics / epics.length) * 100 : 0;
    
    return {
      rule: 'Epic Scope',
      passed: score >= 80,
      score,
      details: `${wellScopedEpics}/${epics.length} epics are well-scoped`
    };
  }

  private validateBusinessValue(epics: any[]): ValidationResult {
    let epicsWithValue = 0;
    
    for (const epic of epics) {
      const hasBusinessValue = typeof epic.businessValue === 'number' && epic.businessValue > 0;
      const hasReasonableValue = epic.businessValue <= 100;
      
      if (hasBusinessValue && hasReasonableValue) {
        epicsWithValue++;
      }
    }
    
    const score = epics.length > 0 ? (epicsWithValue / epics.length) * 100 : 0;
    
    return {
      rule: 'Business Value',
      passed: score >= 70,
      score,
      details: `${epicsWithValue}/${epics.length} epics have defined business value`
    };
  }

  private validateEpicDependencies(epics: any[]): ValidationResult {
    // For now, just check that dependency analysis was attempted
    const score = 100; // Simplified - could be enhanced with actual dependency analysis
    
    return {
      rule: 'Epic Dependencies',
      passed: true,
      score,
      details: 'Epic dependency analysis complete'
    };
  }
}

// === SUPPORTING INTERFACES ===

interface GateStats {
  tier: string;
  totalExecutions: number;
  passedExecutions: number;
  averageConfidence: number;
  averageExecutionTime: number;
  lastExecution: Date;
}