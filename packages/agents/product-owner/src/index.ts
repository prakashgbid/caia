/**
 * @caia/agent-product-owner
 * 
 * Certified Product Owner agent with expertise in agile product management,
 * value maximization, and stakeholder alignment. Owns the product vision and
 * is responsible for delivering maximum value to users and the business.
 */

import { BaseAgent } from '@caia/core';

export interface ProductVision {
  statement: string;
  goals: string[];
  metrics: string[];
  targetMarket: string;
  valueProposition: string;
}

export interface BacklogItem {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  estimatedValue: number;
  estimatedEffort: number;
  labels: string[];
  dependencies: string[];
  status: 'ready' | 'in-progress' | 'done' | 'blocked';
}

export interface PrioritizationResult {
  items: BacklogItem[];
  reasoning: string;
  methodology: string;
  riskFactors: string[];
}

export interface ReleaseGoal {
  version: string;
  targetDate: Date;
  objectives: string[];
  features: string[];
  successCriteria: string[];
  risks: string[];
}

export interface StakeholderFeedback {
  stakeholder: string;
  priority: 'high' | 'medium' | 'low';
  feedback: string;
  actionItems: string[];
}

/**
 * Product Owner Agent
 * 
 * Specializes in product vision, backlog prioritization, stakeholder alignment,
 * and release planning to maximize product value and manage the product lifecycle.
 */
export class ProductOwnerAgent extends BaseAgent {
  constructor() {
    super({
      name: 'product-owner',
      description: 'Product vision, backlog prioritization, stakeholder alignment, and release planning',
      version: '1.0.0',
      capabilities: [
        'product-vision',
        'backlog-management',
        'prioritization',
        'stakeholder-management',
        'release-planning',
        'data-driven-decisions'
      ]
    });
  }

  /**
   * Define and communicate the product vision
   */
  async createProductVision(context: {
    businessGoals: string[];
    marketResearch: any;
    userPersonas: any[];
    competitiveAnalysis: any;
  }): Promise<ProductVision> {
    console.log('[product-owner] Creating product vision...');

    const vision: ProductVision = {
      statement: await this.synthesizeVisionStatement(context),
      goals: context.businessGoals,
      metrics: await this.defineSuccessMetrics(context),
      targetMarket: await this.identifyTargetMarket(context),
      valueProposition: await this.craftValueProposition(context)
    };

    await this.logDecision('product-vision-created', {
      vision,
      methodology: 'vision-synthesis',
      stakeholders: 'all'
    });

    return vision;
  }

  /**
   * Prioritize product backlog using value-based techniques
   */
  async prioritizeBacklog(
    items: BacklogItem[],
    methodology: 'WSJF' | 'RICE' | 'Value-vs-Effort' | 'MoSCoW' = 'WSJF'
  ): Promise<PrioritizationResult> {
    console.log(`[product-owner] Prioritizing ${items.length} backlog items using ${methodology}...`);

    let prioritizedItems: BacklogItem[];
    let reasoning: string;

    switch (methodology) {
      case 'WSJF':
        prioritizedItems = await this.applyWSJF(items);
        reasoning = 'Weighted Shortest Job First - maximizes economic value by considering value and job size';
        break;
      case 'RICE':
        prioritizedItems = await this.applyRICE(items);
        reasoning = 'RICE scoring - balances Reach, Impact, Confidence, and Effort';
        break;
      case 'Value-vs-Effort':
        prioritizedItems = await this.applyValueVsEffort(items);
        reasoning = 'Value vs Effort matrix - identifies quick wins and strategic bets';
        break;
      case 'MoSCoW':
        prioritizedItems = await this.applyMoSCoW(items);
        reasoning = 'MoSCoW prioritization - Must, Should, Could, Won\'t have this release';
        break;
    }

    const result: PrioritizationResult = {
      items: prioritizedItems,
      reasoning,
      methodology,
      riskFactors: await this.identifyRiskFactors(prioritizedItems)
    };

    await this.logDecision('backlog-prioritized', {
      methodology,
      itemCount: items.length,
      topPriorities: prioritizedItems.slice(0, 5).map(item => item.title)
    });

    return result;
  }

  /**
   * Create release plan with goals and timeline
   */
  async planRelease(context: {
    version: string;
    targetDate: Date;
    availableCapacity: number;
    backlogItems: BacklogItem[];
    businessPriorities: string[];
  }): Promise<ReleaseGoal> {
    console.log(`[product-owner] Planning release ${context.version}...`);

    const releaseGoal: ReleaseGoal = {
      version: context.version,
      targetDate: context.targetDate,
      objectives: await this.defineReleaseObjectives(context),
      features: await this.selectFeaturesForRelease(context),
      successCriteria: await this.defineSuccessCriteria(context),
      risks: await this.identifyReleaseRisks(context)
    };

    await this.logDecision('release-planned', {
      version: context.version,
      featureCount: releaseGoal.features.length,
      targetDate: context.targetDate,
      objectives: releaseGoal.objectives
    });

    return releaseGoal;
  }

  /**
   * Manage stakeholder feedback and alignment
   */
  async processStakeholderFeedback(
    feedback: StakeholderFeedback[]
  ): Promise<{
    summary: string;
    prioritizedActions: string[];
    consensusLevel: number;
    conflictResolution: string[];
  }> {
    console.log(`[product-owner] Processing feedback from ${feedback.length} stakeholders...`);

    const highPriorityFeedback = feedback.filter(f => f.priority === 'high');
    const actionItems = feedback.flatMap(f => f.actionItems);

    const result = {
      summary: await this.summarizeFeedback(feedback),
      prioritizedActions: await this.prioritizeActions(actionItems),
      consensusLevel: await this.calculateConsensus(feedback),
      conflictResolution: await this.identifyConflicts(feedback)
    };

    await this.logDecision('stakeholder-feedback-processed', {
      feedbackCount: feedback.length,
      highPriorityCount: highPriorityFeedback.length,
      consensusLevel: result.consensusLevel
    });

    return result;
  }

  /**
   * Define and track product metrics
   */
  async defineProductMetrics(context: {
    productGoals: string[];
    userJourney: any[];
    businessKPIs: string[];
  }): Promise<{
    leadingIndicators: string[];
    laggingIndicators: string[];
    healthMetrics: string[];
    alertThresholds: Record<string, number>;
  }> {
    console.log('[product-owner] Defining product metrics...');

    const metrics = {
      leadingIndicators: [
        'User engagement rate',
        'Feature adoption rate',
        'Trial-to-paid conversion',
        'User onboarding completion'
      ],
      laggingIndicators: [
        'Monthly recurring revenue',
        'Customer lifetime value',
        'Net promoter score',
        'Customer churn rate'
      ],
      healthMetrics: [
        'System uptime',
        'Page load times',
        'Error rates',
        'Support ticket volume'
      ],
      alertThresholds: {
        'engagement_rate': 0.7,
        'conversion_rate': 0.15,
        'churn_rate': 0.05,
        'nps_score': 50
      }
    };

    await this.logDecision('metrics-defined', {
      leadingCount: metrics.leadingIndicators.length,
      laggingCount: metrics.laggingIndicators.length,
      healthCount: metrics.healthMetrics.length
    });

    return metrics;
  }

  /**
   * Conduct sprint planning session
   */
  async planSprint(context: {
    sprintNumber: number;
    capacity: number;
    prioritizedBacklog: BacklogItem[];
    teamVelocity: number;
    sprintGoal: string;
  }): Promise<{
    selectedItems: BacklogItem[];
    sprintGoal: string;
    commitmentLevel: number;
    risks: string[];
  }> {
    console.log(`[product-owner] Planning sprint ${context.sprintNumber}...`);

    const selectedItems = await this.selectSprintItems(context);
    const commitmentLevel = await this.assessCommitmentLevel(selectedItems, context);

    const result = {
      selectedItems,
      sprintGoal: context.sprintGoal,
      commitmentLevel,
      risks: await this.identifySprintRisks(selectedItems, context)
    };

    await this.logDecision('sprint-planned', {
      sprintNumber: context.sprintNumber,
      itemCount: selectedItems.length,
      commitmentLevel,
      sprintGoal: context.sprintGoal
    });

    return result;
  }

  // Private helper methods

  private async synthesizeVisionStatement(context: any): Promise<string> {
    // Synthesize vision from business goals, market research, and user needs
    return `We envision a product that delivers exceptional value to our target users while achieving our business objectives through innovative solutions and user-centric design.`;
  }

  private async defineSuccessMetrics(context: any): Promise<string[]> {
    return [
      'User satisfaction score > 4.5/5',
      'Monthly active users growth > 20%',
      'Revenue growth > 15% quarter-over-quarter',
      'Feature adoption rate > 70%'
    ];
  }

  private async identifyTargetMarket(context: any): Promise<string> {
    return 'Primary target: Tech-savvy professionals aged 25-45 seeking efficient workflow solutions';
  }

  private async craftValueProposition(context: any): Promise<string> {
    return 'Streamline your workflow with intelligent automation that saves time and increases productivity by 40%';
  }

  private async applyWSJF(items: BacklogItem[]): Promise<BacklogItem[]> {
    // Calculate WSJF score: (User-Business Value + Time Criticality + Risk Reduction) / Job Size
    return items.sort((a, b) => {
      const scoreA = (a.estimatedValue + 5 + 3) / a.estimatedEffort;
      const scoreB = (b.estimatedValue + 5 + 3) / b.estimatedEffort;
      return scoreB - scoreA;
    });
  }

  private async applyRICE(items: BacklogItem[]): Promise<BacklogItem[]> {
    // Calculate RICE score: (Reach × Impact × Confidence) / Effort
    return items.sort((a, b) => {
      const scoreA = (100 * a.estimatedValue * 0.8) / a.estimatedEffort;
      const scoreB = (100 * b.estimatedValue * 0.8) / b.estimatedEffort;
      return scoreB - scoreA;
    });
  }

  private async applyValueVsEffort(items: BacklogItem[]): Promise<BacklogItem[]> {
    // Sort by value/effort ratio
    return items.sort((a, b) => {
      const ratioA = a.estimatedValue / a.estimatedEffort;
      const ratioB = b.estimatedValue / b.estimatedEffort;
      return ratioB - ratioA;
    });
  }

  private async applyMoSCoW(items: BacklogItem[]): Promise<BacklogItem[]> {
    // Categorize into Must, Should, Could, Won't
    const categorized = items.map(item => ({
      ...item,
      category: item.estimatedValue > 8 ? 'Must' : 
                item.estimatedValue > 5 ? 'Should' : 
                item.estimatedValue > 2 ? 'Could' : 'Wont'
    }));

    return categorized.sort((a, b) => {
      const order = { 'Must': 4, 'Should': 3, 'Could': 2, 'Wont': 1 };
      return (order as any)[b.category] - (order as any)[a.category];
    });
  }

  private async identifyRiskFactors(items: BacklogItem[]): Promise<string[]> {
    const risks = [];
    
    if (items.some(item => item.dependencies.length > 3)) {
      risks.push('High dependency complexity detected');
    }
    
    if (items.filter(item => item.estimatedEffort > 20).length > 2) {
      risks.push('Multiple large items may impact delivery');
    }

    return risks;
  }

  private async defineReleaseObjectives(context: any): Promise<string[]> {
    return [
      'Improve user onboarding experience',
      'Increase feature discoverability',
      'Enhance performance and reliability',
      'Expand integration capabilities'
    ];
  }

  private async selectFeaturesForRelease(context: any): Promise<string[]> {
    const capacity = context.availableCapacity;
    const selectedItems = context.backlogItems
      .sort((a, b) => b.estimatedValue - a.estimatedValue)
      .slice(0, Math.floor(capacity / 5)); // Rough capacity planning

    return selectedItems.map(item => item.title);
  }

  private async defineSuccessCriteria(context: any): Promise<string[]> {
    return [
      'Zero critical bugs in production',
      'User satisfaction score > 4.0',
      'Feature adoption > 60% within 30 days',
      'Performance improvement > 25%'
    ];
  }

  private async identifyReleaseRisks(context: any): Promise<string[]> {
    return [
      'Integration complexity may impact timeline',
      'User adoption may be slower than expected',
      'Technical debt may surface during development'
    ];
  }

  private async summarizeFeedback(feedback: StakeholderFeedback[]): Promise<string> {
    const themes = feedback.flatMap(f => f.feedback.split(' ').filter(word => word.length > 5));
    return `Key themes: ${themes.slice(0, 5).join(', ')}`;
  }

  private async prioritizeActions(actions: string[]): Promise<string[]> {
    return actions.slice(0, 10); // Return top 10 prioritized actions
  }

  private async calculateConsensus(feedback: StakeholderFeedback[]): Promise<number> {
    // Simple consensus calculation (0-100)
    const highPriority = feedback.filter(f => f.priority === 'high').length;
    return Math.max(20, 100 - (highPriority * 15));
  }

  private async identifyConflicts(feedback: StakeholderFeedback[]): Promise<string[]> {
    return [
      'Sales wants faster delivery, Engineering emphasizes quality',
      'Marketing requests new features, Support highlights existing issues'
    ];
  }

  private async selectSprintItems(context: any): Promise<BacklogItem[]> {
    const capacity = context.capacity;
    let totalEffort = 0;
    const selected: BacklogItem[] = [];

    for (const item of context.prioritizedBacklog) {
      if (totalEffort + item.estimatedEffort <= capacity) {
        selected.push(item);
        totalEffort += item.estimatedEffort;
      }
    }

    return selected;
  }

  private async assessCommitmentLevel(items: BacklogItem[], context: any): Promise<number> {
    const totalEffort = items.reduce((sum, item) => sum + item.estimatedEffort, 0);
    const utilizationRate = totalEffort / context.capacity;
    return Math.min(100, utilizationRate * 100);
  }

  private async identifySprintRisks(items: BacklogItem[], context: any): Promise<string[]> {
    const risks = [];
    
    if (items.some(item => item.dependencies.length > 0)) {
      risks.push('Dependencies may block progress');
    }
    
    if (context.commitmentLevel > 90) {
      risks.push('High capacity utilization may lead to overcommitment');
    }

    return risks;
  }

  private async logDecision(type: string, data: any): Promise<void> {
    console.log(`[product-owner] Decision logged: ${type}`, data);
    // Integration with CAIA decision logging system
  }
}

// Export singleton instance
export const productOwnerAgent = new ProductOwnerAgent();

// Export default
export default productOwnerAgent;