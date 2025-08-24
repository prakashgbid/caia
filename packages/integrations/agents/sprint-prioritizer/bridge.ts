/**
 * Sprint Prioritizer Agent Integration Bridge
 * Connects hierarchical decomposition system to existing sprint-prioritizer agent
 * 
 * Responsibilities:
 * - Feed decomposed items for sprint planning
 * - Priority scoring integration
 * - Capacity planning alignment
 * - Velocity-based timeline adjustment
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { 
  Initiative, 
  Feature, 
  EnhancedEpic,
  Priority,
  ResourceRequirement
} from '@caia/shared/hierarchical-types';
import { 
  AgentConfig,
  Task,
  TaskResult,
  TaskStatus,
  TaskPriority
} from '@caia/core';
import { v4 as uuidv4 } from 'uuid';

// Define Sprint Prioritizer Agent interface (since it doesn't exist yet)
interface SprintPrioritizerAgent {
  executeTask(task: Task): Promise<TaskResult>;
}

export interface SprintPlanningRequest {
  id: string;
  items: (Initiative | Feature | EnhancedEpic)[];
  sprintCapacity: {
    teamSize: number;
    sprintLengthWeeks: number;
    velocityPoints: number;
    availabilityPercent: number;
  };
  constraints?: {
    deadlines?: Map<string, Date>;
    dependencies?: Map<string, string[]>;
    resourceLimitations?: string[];
  };
  priorities?: {
    businessValue: number; // weight 0-1
    technicalRisk: number; // weight 0-1
    customerImpact: number; // weight 0-1
    strategicAlignment: number; // weight 0-1
  };
}

export interface SprintPlanningResult {
  sprintPlan: Array<{
    sprintNumber: number;
    items: Array<{
      id: string;
      title: string;
      type: 'initiative' | 'feature' | 'epic';
      estimatedPoints: number;
      priority: number;
      dependencies: string[];
      risks: string[];
    }>;
    totalPoints: number;
    confidence: number;
    risks: string[];
  }>;
  backlogPrioritization: Array<{
    id: string;
    priority: number;
    reasoning: string[];
    estimatedValue: number;
    estimatedEffort: number;
    riskLevel: 'low' | 'medium' | 'high';
  }>;
  capacityUtilization: {
    averageUtilization: number;
    peakUtilization: number;
    recommendedAdjustments: string[];
  };
  timeline: {
    totalSprints: number;
    estimatedDuration: string;
    majorMilestones: Array<{
      name: string;
      sprintNumber: number;
      deliverables: string[];
    }>;
  };
}

export interface PriorityScoreRequest {
  items: (Initiative | Feature | EnhancedEpic)[];
  scoringCriteria: {
    businessValue: {
      weight: number;
      factors: string[];
    };
    technicalComplexity: {
      weight: number;
      factors: string[];
    };
    riskLevel: {
      weight: number;
      factors: string[];
    };
    strategicAlignment: {
      weight: number;
      factors: string[];
    };
  };
  context?: any;
}

export interface PriorityScoreResult {
  scores: Map<string, {
    totalScore: number;
    businessValue: number;
    technicalComplexity: number;
    riskLevel: number;
    strategicAlignment: number;
    confidence: number;
    reasoning: string[];
  }>;
  ranking: Array<{
    id: string;
    rank: number;
    score: number;
    category: 'must-have' | 'should-have' | 'could-have' | 'wont-have';
  }>;
  recommendations: string[];
}

export interface CapacityPlanningRequest {
  team: {
    members: Array<{
      name: string;
      role: string;
      skillLevel: 'junior' | 'mid' | 'senior' | 'lead';
      availability: number; // 0-1
      skills: string[];
    }>;
    historicalVelocity: number[];
    sprintLength: number;
  };
  workItems: Array<{
    id: string;
    title: string;
    estimatedEffort: number;
    requiredSkills: string[];
    dependencies: string[];
  }>;
  constraints?: {
    fixedDeadlines?: Date[];
    resourceConstraints?: string[];
    qualityGates?: string[];
  };
}

export interface CapacityPlanningResult {
  capacityAnalysis: {
    totalCapacity: number;
    availableCapacity: number;
    utilizationRate: number;
    bottlenecks: Array<{
      skill: string;
      demand: number;
      supply: number;
      impact: 'low' | 'medium' | 'high';
    }>;
  };
  resourceAllocation: Map<string, Array<{
    workItemId: string;
    allocation: number;
    startSprint: number;
    duration: number;
  }>>;
  recommendations: {
    hiring: string[];
    training: string[];
    workRebalancing: string[];
    riskMitigation: string[];
  };
}

export interface VelocityAdjustmentRequest {
  currentItems: (Initiative | Feature | EnhancedEpic)[];
  historicalVelocity: {
    sprints: Array<{
      number: number;
      plannedPoints: number;
      actualPoints: number;
      completionRate: number;
    }>;
    trends: {
      velocityTrend: 'increasing' | 'stable' | 'decreasing';
      predictabilityScore: number;
    };
  };
  teamChanges?: {
    additions: number;
    departures: number;
    skillChanges: string[];
  };
}

export interface VelocityAdjustmentResult {
  adjustedEstimates: Map<string, {
    originalEstimate: number;
    adjustedEstimate: number;
    adjustmentFactor: number;
    reasoning: string[];
  }>;
  timelineImpact: {
    originalTimeline: number; // sprints
    adjustedTimeline: number; // sprints
    confidenceLevel: number;
    risks: string[];
  };
  recommendations: string[];
}

/**
 * Sprint Prioritizer Bridge
 * Provides hierarchical system integration with sprint planning capabilities
 */
export class SprintPrioritizerBridge extends EventEmitter {
  private agent?: SprintPrioritizerAgent; // Will be implemented later
  private logger: Logger;
  private requestCache: Map<string, any> = new Map();
  private activeRequests: Map<string, Promise<any>> = new Map();
  private mockMode: boolean = true; // Enable mock responses until agent is implemented

  constructor(agent: SprintPrioritizerAgent | undefined, logger: Logger) {
    super();
    this.agent = agent;
    this.logger = logger;
    
    if (!agent) {
      this.logger.warn('Sprint Prioritizer Agent not provided, using mock responses');
    }
  }

  /**
   * Create comprehensive sprint plans from decomposed hierarchical items
   */
  async planSprints(
    requests: SprintPlanningRequest[]
  ): Promise<SprintPlanningResult[]> {
    this.logger.info('Planning sprints for hierarchical items', {
      requestCount: requests.length,
      totalItems: requests.reduce((sum, req) => sum + req.items.length, 0)
    });

    // Process requests in parallel for better performance
    const tasks = requests.map(request => this.createSprintPlanningTask(request));
    const results = await this.executeParallelRequests(tasks);

    this.emit('sprints:planned', { requests, results });
    return results;
  }

  /**
   * Score items for prioritization using multiple criteria
   */
  async scorePriorities(
    requests: PriorityScoreRequest[]
  ): Promise<PriorityScoreResult[]> {
    this.logger.info('Scoring item priorities', {
      requestCount: requests.length,
      totalItems: requests.reduce((sum, req) => sum + req.items.length, 0)
    });

    const tasks = requests.map(request => this.createPriorityScoreTask(request));
    const results = await this.executeParallelRequests(tasks);

    this.emit('priorities:scored', { requests, results });
    return results;
  }

  /**
   * Analyze team capacity and resource allocation
   */
  async analyzeCapacity(
    requests: CapacityPlanningRequest[]
  ): Promise<CapacityPlanningResult[]> {
    this.logger.info('Analyzing team capacity', {
      requestCount: requests.length
    });

    const tasks = requests.map(request => this.createCapacityPlanningTask(request));
    const results = await this.executeParallelRequests(tasks);

    this.emit('capacity:analyzed', { requests, results });
    return results;
  }

  /**
   * Adjust timelines based on historical velocity data
   */
  async adjustVelocityTimelines(
    requests: VelocityAdjustmentRequest[]
  ): Promise<VelocityAdjustmentResult[]> {
    this.logger.info('Adjusting timelines based on velocity', {
      requestCount: requests.length
    });

    const tasks = requests.map(request => this.createVelocityAdjustmentTask(request));
    const results = await this.executeParallelRequests(tasks);

    this.emit('velocity:adjusted', { requests, results });
    return results;
  }

  /**
   * Generate comprehensive release planning recommendation
   */
  async generateReleasePlan(
    initiatives: Initiative[],
    features: Feature[],
    epics: EnhancedEpic[],
    teamConfiguration: any,
    releaseConstraints: any
  ): Promise<any> {
    this.logger.info('Generating comprehensive release plan', {
      initiativeCount: initiatives.length,
      featureCount: features.length,
      epicCount: epics.length
    });

    // Execute planning tasks in parallel
    const [sprintPlans, priorityScores, capacityAnalysis, velocityAdjustments] = await Promise.all([
      this.planSprints([
        {
          id: `release-${Date.now()}`,
          items: [...initiatives, ...features, ...epics],
          sprintCapacity: teamConfiguration.capacity || {
            teamSize: 6,
            sprintLengthWeeks: 2,
            velocityPoints: 30,
            availabilityPercent: 0.8
          },
          constraints: releaseConstraints
        }
      ]),
      this.scorePriorities([
        {
          items: [...initiatives, ...features, ...epics],
          scoringCriteria: {
            businessValue: { weight: 0.4, factors: ['revenue', 'customer satisfaction'] },
            technicalComplexity: { weight: 0.2, factors: ['implementation complexity', 'integration challenges'] },
            riskLevel: { weight: 0.2, factors: ['technical risk', 'business risk'] },
            strategicAlignment: { weight: 0.2, factors: ['strategic goals', 'competitive advantage'] }
          }
        }
      ]),
      this.analyzeCapacity([
        {
          team: teamConfiguration.team || this.getDefaultTeamConfig(),
          workItems: [...initiatives, ...features, ...epics].map(item => ({
            id: item.id,
            title: item.title,
            estimatedEffort: this.estimateEffort(item),
            requiredSkills: this.extractRequiredSkills(item),
            dependencies: this.extractDependencies(item)
          }))
        }
      ]),
      this.adjustVelocityTimelines([
        {
          currentItems: [...initiatives, ...features, ...epics],
          historicalVelocity: teamConfiguration.velocity || this.getDefaultVelocityData()
        }
      ])
    ]);

    const releasePlan = {
      summary: {
        totalItems: initiatives.length + features.length + epics.length,
        estimatedSprints: sprintPlans[0]?.timeline.totalSprints || 10,
        confidence: this.calculatePlanConfidence(sprintPlans[0], priorityScores[0], capacityAnalysis[0]),
        generatedAt: new Date()
      },
      sprintPlan: sprintPlans[0] || this.mockSprintPlan({ 
        id: 'default', 
        items: [...initiatives, ...features, ...epics],
        sprintCapacity: teamConfiguration.capacity || {
          teamSize: 6,
          sprintLengthWeeks: 2,
          velocityPoints: 30,
          availabilityPercent: 0.8
        }
      }),
      prioritization: priorityScores[0] || this.mockPriorityScore({ 
        items: [...initiatives, ...features, ...epics],
        scoringCriteria: {
          businessValue: { weight: 0.4, factors: [] },
          technicalComplexity: { weight: 0.2, factors: [] },
          riskLevel: { weight: 0.2, factors: [] },
          strategicAlignment: { weight: 0.2, factors: [] }
        }
      }),
      capacityPlan: capacityAnalysis[0] || this.mockCapacityPlan({ team: this.getDefaultTeamConfig(), workItems: [] }),
      velocityAdjustments: velocityAdjustments[0] || this.mockVelocityAdjustment({ 
        currentItems: [...initiatives, ...features, ...epics],
        historicalVelocity: this.getDefaultVelocityData()
      }),
      risks: this.identifyReleasePlanRisks(sprintPlans[0], capacityAnalysis[0]),
      recommendations: this.generateReleasePlanRecommendations(
        sprintPlans[0], 
        priorityScores[0], 
        capacityAnalysis[0], 
        velocityAdjustments[0]
      )
    };

    this.emit('release-plan:generated', releasePlan);
    return releasePlan;
  }

  // Private helper methods

  private async createSprintPlanningTask(
    request: SprintPlanningRequest
  ): Promise<SprintPlanningResult> {
    if (this.mockMode || !this.agent) {
      return this.mockSprintPlan(request);
    }

    try {
      const task: Task = {
        id: `sprint-plan-${request.id}-${Date.now()}`,
        type: 'plan_sprints',
        payload: {
          items: request.items,
          capacity: request.sprintCapacity,
          constraints: request.constraints,
          priorities: request.priorities
        },
        priority: TaskPriority.HIGH,
        createdAt: new Date(),
        timeout: 90000
      };

      const result = await this.agent.executeTask(task);
      
      if (result.status === TaskStatus.COMPLETED) {
        return this.processSprintPlanResult(result.result);
      }
    } catch (error) {
      this.logger.error('Sprint planning failed', { error });
    }

    return this.mockSprintPlan(request);
  }

  private async createPriorityScoreTask(
    request: PriorityScoreRequest
  ): Promise<PriorityScoreResult> {
    if (this.mockMode || !this.agent) {
      return this.mockPriorityScore(request);
    }

    // Implementation would create actual task for agent
    return this.mockPriorityScore(request);
  }

  private async createCapacityPlanningTask(
    request: CapacityPlanningRequest
  ): Promise<CapacityPlanningResult> {
    if (this.mockMode || !this.agent) {
      return this.mockCapacityPlan(request);
    }

    // Implementation would create actual task for agent
    return this.mockCapacityPlan(request);
  }

  private async createVelocityAdjustmentTask(
    request: VelocityAdjustmentRequest
  ): Promise<VelocityAdjustmentResult> {
    if (this.mockMode || !this.agent) {
      return this.mockVelocityAdjustment(request);
    }

    // Implementation would create actual task for agent
    return this.mockVelocityAdjustment(request);
  }

  private async executeParallelRequests<T>(tasks: Promise<T>[]): Promise<T[]> {
    try {
      return await Promise.all(tasks);
    } catch (error) {
      this.logger.error('Parallel request execution failed', { error });
      throw error;
    }
  }

  // Mock implementations (used until actual Sprint Prioritizer Agent is implemented)

  private mockSprintPlan(
    request: SprintPlanningRequest
  ): SprintPlanningResult {
    const totalItems = request.items.length;
    const sprintCapacity = request.sprintCapacity.velocityPoints * request.sprintCapacity.availabilityPercent;
    const estimatedSprints = Math.ceil(totalItems * 8 / sprintCapacity); // Rough estimate
    
    const sprintPlan = [];
    let remainingItems = [...request.items];
    
    for (let i = 1; i <= estimatedSprints && remainingItems.length > 0; i++) {
      const sprintItems = remainingItems.splice(0, Math.max(1, Math.floor(sprintCapacity / 8))).map(item => ({
        id: item.id,
        title: item.title,
        type: this.getItemType(item),
        estimatedPoints: this.estimateStoryPoints(item),
        priority: this.getPriorityValue(item.priority || 'medium'),
        dependencies: this.extractDependencies(item),
        risks: this.identifyItemRisks(item)
      }));
      
      sprintPlan.push({
        sprintNumber: i,
        items: sprintItems,
        totalPoints: sprintItems.reduce((sum, item) => sum + item.estimatedPoints, 0),
        confidence: Math.random() * 0.3 + 0.7, // 70-100%
        risks: this.identifySprintRisks(sprintItems)
      });
    }
    
    const backlogPrioritization = request.items.map((item, index) => ({
      id: item.id,
      priority: (request.items.length - index) / request.items.length * 100,
      reasoning: [
        `${item.title} aligns with business objectives`,
        'Technical feasibility assessed',
        'Dependencies analyzed'
      ],
      estimatedValue: Math.floor(Math.random() * 50) + 50, // 50-100
      estimatedEffort: this.estimateStoryPoints(item),
      riskLevel: this.assessRiskLevel(item)
    }));
    
    return {
      sprintPlan,
      backlogPrioritization,
      capacityUtilization: {
        averageUtilization: 0.85,
        peakUtilization: 0.95,
        recommendedAdjustments: [
          'Consider buffer for unexpected work',
          'Plan for knowledge sharing sessions',
          'Account for code review and testing time'
        ]
      },
      timeline: {
        totalSprints: estimatedSprints,
        estimatedDuration: `${estimatedSprints * request.sprintCapacity.sprintLengthWeeks} weeks`,
        majorMilestones: this.generateMilestones(estimatedSprints, request.items)
      }
    };
  }

  private mockPriorityScore(
    request: PriorityScoreRequest
  ): PriorityScoreResult {
    const scores = new Map();
    const ranking = [];
    
    request.items.forEach((item, index) => {
      const businessValue = Math.random() * 40 + 60; // 60-100
      const technicalComplexity = Math.random() * 40 + 30; // 30-70
      const riskLevel = Math.random() * 60 + 20; // 20-80
      const strategicAlignment = Math.random() * 30 + 70; // 70-100
      
      const totalScore = (
        businessValue * request.scoringCriteria.businessValue.weight +
        (100 - technicalComplexity) * request.scoringCriteria.technicalComplexity.weight +
        (100 - riskLevel) * request.scoringCriteria.riskLevel.weight +
        strategicAlignment * request.scoringCriteria.strategicAlignment.weight
      );
      
      scores.set(item.id, {
        totalScore,
        businessValue,
        technicalComplexity,
        riskLevel,
        strategicAlignment,
        confidence: Math.random() * 0.3 + 0.7,
        reasoning: [
          `High business value potential for ${item.title}`,
          'Manageable technical complexity',
          'Acceptable risk profile',
          'Strong strategic alignment'
        ]
      });
      
      ranking.push({
        id: item.id,
        rank: index + 1,
        score: totalScore,
        category: this.getMoSCoWCategory(totalScore)
      });
    });
    
    // Sort ranking by score
    ranking.sort((a, b) => b.score - a.score);
    ranking.forEach((item, index) => item.rank = index + 1);
    
    return {
      scores,
      ranking,
      recommendations: [
        'Focus on high-value, low-complexity items first',
        'Consider breaking down large complex items',
        'Validate assumptions for high-risk items',
        'Align implementation with strategic priorities'
      ]
    };
  }

  private mockCapacityPlan(
    request: CapacityPlanningRequest
  ): CapacityPlanningResult {
    const totalCapacity = request.team.members.reduce((sum, member) => 
      sum + (member.availability * this.getSkillMultiplier(member.skillLevel)), 0
    );
    
    const skillDemand = new Map<string, number>();
    const skillSupply = new Map<string, number>();
    
    // Calculate skill demand
    request.workItems.forEach(item => {
      item.requiredSkills.forEach(skill => {
        skillDemand.set(skill, (skillDemand.get(skill) || 0) + item.estimatedEffort);
      });
    });
    
    // Calculate skill supply
    request.team.members.forEach(member => {
      member.skills.forEach(skill => {
        skillSupply.set(skill, (skillSupply.get(skill) || 0) + member.availability);
      });
    });
    
    const bottlenecks = Array.from(skillDemand.entries()).map(([skill, demand]) => {
      const supply = skillSupply.get(skill) || 0;
      return {
        skill,
        demand,
        supply,
        impact: demand > supply * 1.2 ? 'high' : demand > supply ? 'medium' : 'low'
      } as const;
    }).filter(bottleneck => bottleneck.impact !== 'low');
    
    const resourceAllocation = new Map();
    request.team.members.forEach(member => {
      const allocations = request.workItems
        .filter(item => item.requiredSkills.some(skill => member.skills.includes(skill)))
        .slice(0, 3) // Limit to 3 items per member
        .map((item, index) => ({
          workItemId: item.id,
          allocation: member.availability / 3,
          startSprint: Math.floor(index / 2) + 1,
          duration: Math.ceil(item.estimatedEffort / member.availability)
        }));
      
      resourceAllocation.set(member.name, allocations);
    });
    
    return {
      capacityAnalysis: {
        totalCapacity,
        availableCapacity: totalCapacity * 0.8, // Account for overhead
        utilizationRate: 0.85,
        bottlenecks
      },
      resourceAllocation,
      recommendations: {
        hiring: bottlenecks.filter(b => b.impact === 'high').map(b => `Consider hiring ${b.skill} specialist`),
        training: bottlenecks.filter(b => b.impact === 'medium').map(b => `Provide ${b.skill} training to team`),
        workRebalancing: ['Redistribute work based on skill availability', 'Consider pair programming for knowledge transfer'],
        riskMitigation: ['Cross-train team members', 'Document critical processes', 'Plan for potential skill gaps']
      }
    };
  }

  private mockVelocityAdjustment(
    request: VelocityAdjustmentRequest
  ): VelocityAdjustmentResult {
    const adjustmentFactor = this.calculateAdjustmentFactor(
      request.historicalVelocity,
      request.teamChanges
    );
    
    const adjustedEstimates = new Map();
    request.currentItems.forEach(item => {
      const originalEstimate = this.estimateStoryPoints(item);
      const adjustedEstimate = Math.round(originalEstimate * adjustmentFactor);
      
      adjustedEstimates.set(item.id, {
        originalEstimate,
        adjustedEstimate,
        adjustmentFactor,
        reasoning: [
          `Historical velocity trend: ${request.historicalVelocity.trends.velocityTrend}`,
          `Team predictability: ${(request.historicalVelocity.trends.predictabilityScore * 100).toFixed(0)}%`,
          `Adjustment factor applied: ${adjustmentFactor.toFixed(2)}`
        ]
      });
    });
    
    const originalTimeline = Math.ceil(
      request.currentItems.reduce((sum, item) => sum + this.estimateStoryPoints(item), 0) / 30
    );
    const adjustedTimeline = Math.ceil(
      Array.from(adjustedEstimates.values()).reduce((sum, est) => sum + est.adjustedEstimate, 0) / 30
    );
    
    return {
      adjustedEstimates,
      timelineImpact: {
        originalTimeline,
        adjustedTimeline,
        confidenceLevel: request.historicalVelocity.trends.predictabilityScore,
        risks: this.identifyTimelineRisks(request.historicalVelocity, adjustedTimeline)
      },
      recommendations: [
        'Monitor velocity trends closely',
        'Adjust estimates based on team changes',
        'Consider buffer time for uncertainties',
        'Regular retrospectives to improve predictability'
      ]
    };
  }

  // Helper methods for mock implementations

  private getItemType(item: Initiative | Feature | EnhancedEpic): 'initiative' | 'feature' | 'epic' {
    if ('objectives' in item) return 'initiative';
    if ('userStories' in item) return 'feature';
    return 'epic';
  }

  private estimateStoryPoints(item: Initiative | Feature | EnhancedEpic): number {
    // Simple estimation based on item complexity
    const basePoints = {
      initiative: 20,
      feature: 8,
      epic: 5
    };
    
    const type = this.getItemType(item);
    let points = basePoints[type];
    
    // Adjust based on complexity indicators
    if ('technicalRequirements' in item && item.technicalRequirements.length > 5) {
      points += 3;
    }
    if ('integrationPoints' in item && item.integrationPoints.length > 3) {
      points += 2;
    }
    
    return points;
  }

  private getPriorityValue(priority: Priority): number {
    const values = { critical: 100, high: 80, medium: 60, low: 40 };
    return values[priority] || 50;
  }

  private extractDependencies(item: Initiative | Feature | EnhancedEpic): string[] {
    if ('dependencies' in item) {
      return item.dependencies;
    }
    return [];
  }

  private identifyItemRisks(item: Initiative | Feature | EnhancedEpic): string[] {
    const risks = [];
    
    if ('technicalRequirements' in item && item.technicalRequirements.length > 5) {
      risks.push('High technical complexity');
    }
    if ('integrationPoints' in item && item.integrationPoints.length > 3) {
      risks.push('Multiple integration dependencies');
    }
    if (this.estimateStoryPoints(item) > 15) {
      risks.push('Large scope - consider breaking down');
    }
    
    return risks.length > 0 ? risks : ['Standard implementation risks'];
  }

  private identifySprintRisks(items: any[]): string[] {
    const risks = [];
    
    const totalPoints = items.reduce((sum, item) => sum + item.estimatedPoints, 0);
    if (totalPoints > 35) {
      risks.push('Sprint may be overcommitted');
    }
    
    const highRiskItems = items.filter(item => item.risks.length > 1).length;
    if (highRiskItems > 2) {
      risks.push('Multiple high-risk items in sprint');
    }
    
    return risks;
  }

  private assessRiskLevel(item: Initiative | Feature | EnhancedEpic): 'low' | 'medium' | 'high' {
    const points = this.estimateStoryPoints(item);
    if (points > 15) return 'high';
    if (points > 8) return 'medium';
    return 'low';
  }

  private generateMilestones(totalSprints: number, items: (Initiative | Feature | EnhancedEpic)[]): Array<{
    name: string;
    sprintNumber: number;
    deliverables: string[];
  }> {
    const milestones = [];
    
    // Major milestone at 25%, 50%, 75%, and 100%
    const milestonePoints = [0.25, 0.5, 0.75, 1.0];
    
    milestonePoints.forEach((point, index) => {
      const sprintNumber = Math.ceil(totalSprints * point);
      const relevantItems = items.slice(0, Math.ceil(items.length * point));
      
      milestones.push({
        name: `Milestone ${index + 1}${point === 1 ? ' - Release' : ''}`,
        sprintNumber,
        deliverables: relevantItems.slice(-2).map(item => item.title) // Last 2 items
      });
    });
    
    return milestones;
  }

  private getMoSCoWCategory(score: number): 'must-have' | 'should-have' | 'could-have' | 'wont-have' {
    if (score > 85) return 'must-have';
    if (score > 70) return 'should-have';
    if (score > 50) return 'could-have';
    return 'wont-have';
  }

  private getSkillMultiplier(skillLevel: 'junior' | 'mid' | 'senior' | 'lead'): number {
    const multipliers = { junior: 0.7, mid: 1.0, senior: 1.3, lead: 1.5 };
    return multipliers[skillLevel];
  }

  private calculateAdjustmentFactor(
    historicalVelocity: VelocityAdjustmentRequest['historicalVelocity'],
    teamChanges?: VelocityAdjustmentRequest['teamChanges']
  ): number {
    let factor = 1.0;
    
    // Adjust based on velocity trend
    if (historicalVelocity.trends.velocityTrend === 'increasing') {
      factor *= 0.95; // Optimistic adjustment
    } else if (historicalVelocity.trends.velocityTrend === 'decreasing') {
      factor *= 1.1; // Conservative adjustment
    }
    
    // Adjust based on predictability
    if (historicalVelocity.trends.predictabilityScore < 0.7) {
      factor *= 1.15; // Add buffer for unpredictability
    }
    
    // Adjust based on team changes
    if (teamChanges) {
      const netChange = (teamChanges.additions - teamChanges.departures) / 6; // Assume team of 6
      factor *= (1 - netChange * 0.2); // 20% impact per person change
    }
    
    return Math.max(0.8, Math.min(1.3, factor)); // Limit between 0.8x and 1.3x
  }

  private identifyTimelineRisks(
    historicalVelocity: VelocityAdjustmentRequest['historicalVelocity'],
    adjustedTimeline: number
  ): string[] {
    const risks = [];
    
    if (historicalVelocity.trends.predictabilityScore < 0.6) {
      risks.push('Low velocity predictability may affect timeline accuracy');
    }
    
    if (adjustedTimeline > 20) {
      risks.push('Long timeline increases scope creep risk');
    }
    
    if (historicalVelocity.trends.velocityTrend === 'decreasing') {
      risks.push('Declining velocity trend may extend timeline further');
    }
    
    return risks;
  }

  private estimateEffort(item: Initiative | Feature | EnhancedEpic): number {
    return this.estimateStoryPoints(item);
  }

  private extractRequiredSkills(item: Initiative | Feature | EnhancedEpic): string[] {
    // Extract skills based on item characteristics
    const skills = ['General Development'];
    
    if ('technicalRequirements' in item) {
      const techReqs = item.technicalRequirements.join(' ').toLowerCase();
      if (techReqs.includes('frontend') || techReqs.includes('ui')) skills.push('Frontend Development');
      if (techReqs.includes('backend') || techReqs.includes('api')) skills.push('Backend Development');
      if (techReqs.includes('database')) skills.push('Database Design');
      if (techReqs.includes('security')) skills.push('Security Engineering');
    }
    
    return skills;
  }

  private getDefaultTeamConfig(): any {
    return {
      members: [
        { name: 'Alice', role: 'Tech Lead', skillLevel: 'lead', availability: 0.8, skills: ['Frontend Development', 'Backend Development', 'Architecture'] },
        { name: 'Bob', role: 'Senior Developer', skillLevel: 'senior', availability: 0.9, skills: ['Backend Development', 'Database Design'] },
        { name: 'Charlie', role: 'Frontend Developer', skillLevel: 'mid', availability: 0.85, skills: ['Frontend Development', 'UI/UX'] },
        { name: 'Diana', role: 'QA Engineer', skillLevel: 'mid', availability: 0.9, skills: ['Testing', 'Automation'] },
        { name: 'Eve', role: 'DevOps', skillLevel: 'senior', availability: 0.75, skills: ['Infrastructure', 'Security Engineering'] },
        { name: 'Frank', role: 'Junior Developer', skillLevel: 'junior', availability: 1.0, skills: ['General Development'] }
      ],
      historicalVelocity: [25, 28, 32, 30, 33, 29, 31, 35],
      sprintLength: 2
    };
  }

  private getDefaultVelocityData(): VelocityAdjustmentRequest['historicalVelocity'] {
    return {
      sprints: [
        { number: 1, plannedPoints: 30, actualPoints: 25, completionRate: 0.83 },
        { number: 2, plannedPoints: 28, actualPoints: 28, completionRate: 1.0 },
        { number: 3, plannedPoints: 32, actualPoints: 30, completionRate: 0.94 },
        { number: 4, plannedPoints: 30, actualPoints: 33, completionRate: 1.1 },
        { number: 5, plannedPoints: 35, actualPoints: 31, completionRate: 0.89 }
      ],
      trends: {
        velocityTrend: 'stable',
        predictabilityScore: 0.75
      }
    };
  }

  private calculatePlanConfidence(
    sprintPlan?: SprintPlanningResult, 
    priorityScores?: PriorityScoreResult, 
    capacityAnalysis?: CapacityPlanningResult
  ): number {
    let confidence = 0.7; // Base confidence
    
    if (sprintPlan && sprintPlan.sprintPlan.length > 0) {
      confidence += 0.1;
    }
    if (priorityScores && priorityScores.scores.size > 0) {
      confidence += 0.1;
    }
    if (capacityAnalysis && capacityAnalysis.capacityAnalysis.utilizationRate > 0.7) {
      confidence += 0.1;
    }
    
    return Math.min(confidence, 1.0);
  }

  private identifyReleasePlanRisks(
    sprintPlan?: SprintPlanningResult, 
    capacityAnalysis?: CapacityPlanningResult
  ): string[] {
    const risks = [];
    
    if (capacityAnalysis?.capacityAnalysis.bottlenecks.length > 0) {
      risks.push('Resource bottlenecks identified');
    }
    
    if (sprintPlan && sprintPlan.timeline.totalSprints > 15) {
      risks.push('Long release timeline increases scope creep risk');
    }
    
    if (sprintPlan?.capacityUtilization.averageUtilization > 0.9) {
      risks.push('High capacity utilization may affect quality');
    }
    
    return risks;
  }

  private generateReleasePlanRecommendations(
    sprintPlan?: SprintPlanningResult,
    priorityScores?: PriorityScoreResult,
    capacityAnalysis?: CapacityPlanningResult,
    velocityAdjustments?: VelocityAdjustmentResult
  ): string[] {
    const recommendations = [
      'Review and validate all estimates with development team',
      'Establish regular checkpoint reviews',
      'Monitor velocity trends and adjust as needed'
    ];
    
    if (capacityAnalysis?.capacityAnalysis.bottlenecks.length > 0) {
      recommendations.push('Address identified resource bottlenecks');
    }
    
    if (priorityScores?.ranking.some(r => r.category === 'wont-have')) {
      recommendations.push('Consider removing low-priority items from scope');
    }
    
    if (velocityAdjustments?.timelineImpact.confidenceLevel < 0.7) {
      recommendations.push('Build in additional buffer time due to velocity uncertainty');
    }
    
    return recommendations;
  }

  private processSprintPlanResult(result: any): SprintPlanningResult {
    // Process actual agent result when agent is implemented
    return result;
  }

  /**
   * Get bridge status and metrics
   */
  getStatus(): any {
    return {
      connected: !!this.agent,
      mockMode: this.mockMode,
      activeRequests: this.activeRequests.size,
      cachedResults: this.requestCache.size,
      agentStatus: this.agent ? 'connected' : 'mock-mode'
    };
  }

  /**
   * Enable/disable mock mode
   */
  setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
    this.emit('mock-mode:changed', { enabled });
  }

  /**
   * Clear request cache
   */
  clearCache(): void {
    this.requestCache.clear();
    this.emit('cache:cleared');
  }
}

export default SprintPrioritizerBridge;