import { EventEmitter } from 'events';
import {
  Idea,
  Initiative,
  Timeline,
  Milestone,
  Metric,
  ResourceRequirement,
  Priority,
  QualityGate,
  ValidationResult,
  QualityIssue
} from '@caia/shared/hierarchical-types';

/**
 * Configuration for InitiativePlanner
 */
export interface InitiativePlannerConfig {
  confidenceThreshold: number;
  maxInitiatives: number;
  defaultTimelineMonths: number;
  resourceEstimationAccuracy: 'rough' | 'detailed';
  enableROICalculation: boolean;
  dependencyAnalysisDepth: 'basic' | 'comprehensive';
}

/**
 * Strategic initiative breakdown result
 */
interface InitiativeBreakdown {
  initiatives: Initiative[];
  timeline: Timeline;
  resourceMap: Map<string, ResourceRequirement[]>;
  dependencyMatrix: DependencyMatrix;
  roiProjections: ROIProjection[];
}

interface DependencyMatrix {
  dependencies: InitiativeDependency[];
  criticalPath: string[];
  parallelGroups: string[][];
}

interface InitiativeDependency {
  sourceId: string;
  targetId: string;
  type: 'blocks' | 'enables' | 'influences';
  strength: number;
  description: string;
}

interface ROIProjection {
  initiativeId: string;
  investmentRequired: number;
  expectedReturn: number;
  timeToBreakeven: number;
  riskAdjustedROI: number;
  assumptions: string[];
}

/**
 * Enhanced InitiativePlanner that breaks ideas into strategic initiatives
 * with timeline generation, resource estimation, and ROI calculation
 */
export class InitiativePlanner extends EventEmitter {
  private config: InitiativePlannerConfig;
  private initiativeTemplates: Map<string, InitiativeTemplate> = new Map();
  private resourceProfiles: Map<string, ResourceProfile> = new Map();

  constructor(config: InitiativePlannerConfig) {
    super();
    this.config = {
      confidenceThreshold: 0.85,
      maxInitiatives: 7,
      defaultTimelineMonths: 6,
      resourceEstimationAccuracy: 'detailed',
      enableROICalculation: true,
      dependencyAnalysisDepth: 'comprehensive',
      ...config
    };
    
    this.initializeTemplates();
    this.initializeResourceProfiles();
  }

  /**
   * Plans strategic initiatives from analyzed idea
   */
  async planInitiatives(idea: Idea): Promise<InitiativeBreakdown> {
    this.emit('planning:start', { ideaId: idea.id });

    try {
      // Generate strategic initiatives
      const initiatives = await this.generateInitiatives(idea);
      
      // Create overall timeline
      const timeline = await this.generateTimeline(initiatives, idea);
      
      // Estimate resources for each initiative
      const resourceMap = await this.estimateResources(initiatives);
      
      // Analyze dependencies between initiatives
      const dependencyMatrix = await this.analyzeDependencies(initiatives);
      
      // Calculate ROI projections if enabled
      const roiProjections = this.config.enableROICalculation 
        ? await this.calculateROI(initiatives, idea)
        : [];

      const breakdown: InitiativeBreakdown = {
        initiatives,
        timeline,
        resourceMap,
        dependencyMatrix,
        roiProjections
      };

      this.emit('planning:complete', { ideaId: idea.id, breakdown });
      return breakdown;
    } catch (error) {
      this.emit('planning:error', { ideaId: idea.id, error });
      throw error;
    }
  }

  /**
   * Generates 3-7 strategic initiatives from the idea
   */
  private async generateInitiatives(idea: Idea): Promise<Initiative[]> {
    const initiatives: Initiative[] = [];
    
    // Analyze the idea to identify strategic areas
    const strategicAreas = this.identifyStrategicAreas(idea);
    
    // Limit to configured maximum
    const selectedAreas = strategicAreas.slice(0, this.config.maxInitiatives);
    
    for (const area of selectedAreas) {
      const initiative = await this.createInitiativeFromArea(area, idea);
      initiatives.push(initiative);
    }

    // Ensure we have at least 3 initiatives
    while (initiatives.length < 3 && initiatives.length < this.config.maxInitiatives) {
      const syntheticInitiative = this.createSyntheticInitiative(idea, initiatives.length);
      initiatives.push(syntheticInitiative);
    }

    return initiatives;
  }

  /**
   * Identifies strategic areas within the idea
   */
  private identifyStrategicAreas(idea: Idea): StrategicArea[] {
    const areas: StrategicArea[] = [];
    const description = idea.description.toLowerCase();
    
    // Core development area (always present)
    areas.push({
      name: 'Core Development',
      description: 'Build the fundamental system components',
      priority: 'critical',
      complexity: this.assessComplexity(idea.description),
      businessValue: idea.feasibility?.business || 60
    });
    
    // Market validation (if market analysis exists)
    if (idea.marketAnalysis) {
      areas.push({
        name: 'Market Validation',
        description: 'Validate market assumptions and user needs',
        priority: 'high',
        complexity: 'medium',
        businessValue: 80
      });
    }
    
    // Technology foundation (for complex technical solutions)
    if (this.isTechHeavy(description)) {
      areas.push({
        name: 'Technology Foundation',
        description: 'Establish technical infrastructure and architecture',
        priority: 'high',
        complexity: 'complex',
        businessValue: 50
      });
    }
    
    // User experience (for user-facing solutions)
    if (this.isUserFacing(description)) {
      areas.push({
        name: 'User Experience',
        description: 'Design and implement user interface and experience',
        priority: 'high',
        complexity: 'medium',
        businessValue: 70
      });
    }
    
    // Integration (if mentions existing systems)
    if (this.requiresIntegration(description)) {
      areas.push({
        name: 'System Integration',
        description: 'Integrate with existing systems and data sources',
        priority: 'medium',
        complexity: 'complex',
        businessValue: 60
      });
    }
    
    // Go-to-Market (if business value is high)
    if ((idea.feasibility?.business || 0) > 70) {
      areas.push({
        name: 'Go-to-Market',
        description: 'Launch strategy and market penetration',
        priority: 'medium',
        complexity: 'medium',
        businessValue: 90
      });
    }
    
    // Operations & Scaling (for complex solutions)
    if (areas.length > 3) {
      areas.push({
        name: 'Operations & Scaling',
        description: 'Operational setup and scalability planning',
        priority: 'low',
        complexity: 'medium',
        businessValue: 40
      });
    }
    
    return areas.sort((a, b) => {
      const priorityScore = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityScore[b.priority] - priorityScore[a.priority];
    });
  }

  /**
   * Creates an initiative from a strategic area
   */
  private async createInitiativeFromArea(area: StrategicArea, idea: Idea): Promise<Initiative> {
    const initiative: Initiative = {
      id: this.generateInitiativeId(idea.id, area.name),
      ideaId: idea.id,
      title: area.name,
      description: area.description,
      objectives: this.generateObjectives(area, idea),
      timeline: this.generateInitiativeTimeline(area),
      successMetrics: this.generateSuccessMetrics(area, idea),
      dependencies: [], // Will be populated later
      resources: this.estimateInitiativeResources(area),
      priority: area.priority
    };
    
    return initiative;
  }

  /**
   * Generates timeline for all initiatives
   */
  private async generateTimeline(initiatives: Initiative[], idea: Idea): Promise<Timeline> {
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + this.config.defaultTimelineMonths);
    
    const milestones: Milestone[] = [];
    
    // Create milestones for each initiative
    initiatives.forEach((initiative, index) => {
      const milestoneDate = new Date(startDate);
      milestoneDate.setMonth(milestoneDate.getMonth() + (index + 1) * 2); // Stagger by 2 months
      
      milestones.push({
        name: `${initiative.title} Completion`,
        date: milestoneDate,
        deliverables: initiative.objectives
      });
    });
    
    // Add overall completion milestone
    milestones.push({
      name: `${idea.title} - Full Implementation`,
      date: endDate,
      deliverables: [`Complete implementation of ${idea.title}`, 'All initiatives delivered']
    });
    
    return {
      startDate,
      endDate,
      milestones: milestones.sort((a, b) => a.date.getTime() - b.date.getTime())
    };
  }

  /**
   * Estimates resources for all initiatives
   */
  private async estimateResources(initiatives: Initiative[]): Promise<Map<string, ResourceRequirement[]>> {
    const resourceMap = new Map<string, ResourceRequirement[]>();
    
    for (const initiative of initiatives) {
      const resources = await this.estimateInitiativeResources({
        name: initiative.title,
        description: initiative.description,
        priority: initiative.priority,
        complexity: this.assessComplexity(initiative.description),
        businessValue: 60
      });
      
      resourceMap.set(initiative.id, resources);
    }
    
    return resourceMap;
  }

  /**
   * Analyzes dependencies between initiatives
   */
  private async analyzeDependencies(initiatives: Initiative[]): Promise<DependencyMatrix> {
    const dependencies: InitiativeDependency[] = [];
    
    // Analyze each pair of initiatives for dependencies
    for (let i = 0; i < initiatives.length; i++) {
      for (let j = i + 1; j < initiatives.length; j++) {
        const sourceInit = initiatives[i];
        const targetInit = initiatives[j];
        
        const dependency = this.analyzePairDependency(sourceInit, targetInit);
        if (dependency) {
          dependencies.push(dependency);
        }
      }
    }
    
    // Calculate critical path
    const criticalPath = this.calculateCriticalPath(initiatives, dependencies);
    
    // Identify parallel groups
    const parallelGroups = this.identifyParallelGroups(initiatives, dependencies);
    
    return {
      dependencies,
      criticalPath,
      parallelGroups
    };
  }

  /**
   * Calculates ROI projections for initiatives
   */
  private async calculateROI(initiatives: Initiative[], idea: Idea): Promise<ROIProjection[]> {
    const projections: ROIProjection[] = [];
    
    for (const initiative of initiatives) {
      const projection = await this.calculateInitiativeROI(initiative, idea);
      projections.push(projection);
    }
    
    return projections;
  }

  /**
   * Creates quality gate for initiative planning validation
   */
  async validateInitiativePlanning(breakdown: InitiativeBreakdown): Promise<QualityGate> {
    const validations: ValidationResult[] = [];
    
    // Validate initiative count and coverage
    validations.push(this.validateInitiativeCount(breakdown.initiatives));
    
    // Validate timeline feasibility
    validations.push(this.validateTimeline(breakdown.timeline));
    
    // Validate resource allocation
    validations.push(this.validateResourceAllocation(breakdown.resourceMap));
    
    // Validate dependencies
    validations.push(this.validateDependencies(breakdown.dependencyMatrix));
    
    // Validate ROI if available
    if (breakdown.roiProjections.length > 0) {
      validations.push(this.validateROI(breakdown.roiProjections));
    }
    
    const confidence = this.calculateOverallConfidence(validations);
    const passed = confidence >= this.config.confidenceThreshold;
    const issues = this.identifyQualityIssues(validations, confidence);
    const recommendations = this.generateRecommendations(validations, issues);
    
    return {
      tier: 'initiative',
      sourceTier: 'idea',
      targetTier: 'feature',
      confidence,
      threshold: this.config.confidenceThreshold,
      validations,
      passed,
      issues,
      recommendations,
      timestamp: new Date()
    };
  }

  // === PRIVATE HELPER METHODS ===

  private initializeTemplates(): void {
    // Initialize common initiative templates
    this.initiativeTemplates.set('development', {
      name: 'Development',
      baseResources: [
        { type: 'Developer', quantity: 3, skills: ['TypeScript', 'React'], availability: 'full-time' },
        { type: 'Designer', quantity: 1, skills: ['UI/UX'], availability: 'part-time' }
      ],
      baseTimeline: 12, // weeks
      objectives: ['Build core functionality', 'Implement user interface', 'Create test suite']
    });
    
    this.initiativeTemplates.set('validation', {
      name: 'Validation',
      baseResources: [
        { type: 'Product Manager', quantity: 1, skills: ['Market Research'], availability: 'part-time' },
        { type: 'Analyst', quantity: 1, skills: ['Data Analysis'], availability: 'part-time' }
      ],
      baseTimeline: 6, // weeks
      objectives: ['Conduct market research', 'Validate assumptions', 'Define success metrics']
    });
  }

  private initializeResourceProfiles(): void {
    // Initialize resource profiles for different skills
    this.resourceProfiles.set('Developer', {
      hourlyRate: 100,
      skills: ['TypeScript', 'React', 'Node.js', 'Database'],
      availability: 0.8, // 80% utilization
      scalingFactor: 1.2 // Complexity multiplier
    });
    
    this.resourceProfiles.set('Designer', {
      hourlyRate: 80,
      skills: ['UI/UX', 'Figma', 'User Research'],
      availability: 0.7,
      scalingFactor: 1.1
    });
  }

  private generateInitiativeId(ideaId: string, areaName: string): string {
    const sanitized = areaName.toLowerCase().replace(/\s+/g, '_');
    return `${ideaId}_init_${sanitized}_${Date.now()}`;
  }

  private generateObjectives(area: StrategicArea, idea: Idea): string[] {
    const objectives: string[] = [];
    
    switch (area.name) {
      case 'Core Development':
        objectives.push('Implement core business logic');
        objectives.push('Build essential system components');
        objectives.push('Establish technical foundation');
        break;
      case 'Market Validation':
        objectives.push('Conduct user research and interviews');
        objectives.push('Validate product-market fit');
        objectives.push('Define go-to-market strategy');
        break;
      case 'Technology Foundation':
        objectives.push('Set up development infrastructure');
        objectives.push('Implement security and scalability measures');
        objectives.push('Establish CI/CD pipelines');
        break;
      case 'User Experience':
        objectives.push('Design user interface and workflows');
        objectives.push('Implement responsive design');
        objectives.push('Conduct usability testing');
        break;
      default:
        objectives.push(`Deliver ${area.name.toLowerCase()} components`);
        objectives.push(`Achieve ${area.name.toLowerCase()} goals`);
        objectives.push(`Validate ${area.name.toLowerCase()} assumptions`);
    }
    
    return objectives;
  }

  private generateInitiativeTimeline(area: StrategicArea): Timeline {
    const startDate = new Date();
    const endDate = new Date(startDate);
    
    // Adjust timeline based on complexity
    const weeksByComplexity = { simple: 6, medium: 12, complex: 18 };
    const weeks = weeksByComplexity[area.complexity] || 12;
    
    endDate.setDate(endDate.getDate() + weeks * 7);
    
    const milestones: Milestone[] = [
      {
        name: `${area.name} - Planning Complete`,
        date: new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000 * 0.2),
        deliverables: ['Requirements finalized', 'Team assigned']
      },
      {
        name: `${area.name} - Development Complete`,
        date: new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000 * 0.8),
        deliverables: ['Core implementation finished', 'Testing complete']
      },
      {
        name: `${area.name} - Delivery`,
        date: endDate,
        deliverables: ['Solution deployed', 'Documentation complete']
      }
    ];
    
    return { startDate, endDate, milestones };
  }

  private generateSuccessMetrics(area: StrategicArea, idea: Idea): Metric[] {
    const metrics: Metric[] = [];
    
    // Default completion metric
    metrics.push({
      name: 'Completion Rate',
      target: 100,
      unit: 'percent',
      measurementMethod: 'Percentage of objectives completed'
    });
    
    // Area-specific metrics
    switch (area.name) {
      case 'Core Development':
        metrics.push({
          name: 'Code Coverage',
          target: 90,
          unit: 'percent',
          measurementMethod: 'Automated test coverage measurement'
        });
        break;
      case 'Market Validation':
        metrics.push({
          name: 'User Interviews',
          target: 50,
          unit: 'interviews',
          measurementMethod: 'Number of completed user interviews'
        });
        break;
      case 'User Experience':
        metrics.push({
          name: 'Usability Score',
          target: 85,
          unit: 'score',
          measurementMethod: 'SUS (System Usability Scale) score'
        });
        break;
    }
    
    return metrics;
  }

  private estimateInitiativeResources(area: StrategicArea): ResourceRequirement[] {
    const resources: ResourceRequirement[] = [];
    
    // Base resource estimation
    const complexityMultiplier = { simple: 1, medium: 1.5, complex: 2.2 }[area.complexity];
    const baseEffort = 4; // 4 person-weeks base
    
    // Developer resources
    if (['Core Development', 'Technology Foundation', 'System Integration'].includes(area.name)) {
      resources.push({
        type: 'Senior Developer',
        quantity: Math.ceil(2 * complexityMultiplier),
        skills: ['TypeScript', 'Architecture', 'Testing'],
        availability: 'full-time'
      });
      
      if (complexityMultiplier > 1.5) {
        resources.push({
          type: 'Junior Developer',
          quantity: 1,
          skills: ['TypeScript', 'Testing'],
          availability: 'full-time'
        });
      }
    }
    
    // Design resources
    if (['User Experience', 'Market Validation'].includes(area.name)) {
      resources.push({
        type: 'UX Designer',
        quantity: 1,
        skills: ['UI/UX', 'User Research', 'Prototyping'],
        availability: 'part-time'
      });
    }
    
    // Business resources
    if (['Market Validation', 'Go-to-Market'].includes(area.name)) {
      resources.push({
        type: 'Product Manager',
        quantity: 1,
        skills: ['Strategy', 'Market Analysis', 'Stakeholder Management'],
        availability: 'part-time'
      });
    }
    
    // Operations resources
    if (['Operations & Scaling', 'System Integration'].includes(area.name)) {
      resources.push({
        type: 'DevOps Engineer',
        quantity: 1,
        skills: ['CI/CD', 'Infrastructure', 'Monitoring'],
        availability: 'part-time'
      });
    }
    
    return resources;
  }

  private createSyntheticInitiative(idea: Idea, index: number): Initiative {
    const syntheticAreas = [
      'Quality Assurance',
      'Documentation',
      'Performance Optimization',
      'Security Implementation',
      'Monitoring & Analytics'
    ];
    
    const areaName = syntheticAreas[index] || 'Support Initiative';
    
    return {
      id: this.generateInitiativeId(idea.id, areaName),
      ideaId: idea.id,
      title: areaName,
      description: `${areaName} initiative for ${idea.title}`,
      objectives: [`Implement ${areaName.toLowerCase()}`, `Ensure ${areaName.toLowerCase()} standards`],
      timeline: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 8 * 7 * 24 * 60 * 60 * 1000), // 8 weeks
        milestones: []
      },
      successMetrics: [{
        name: 'Completion',
        target: 100,
        unit: 'percent',
        measurementMethod: 'Initiative completion rate'
      }],
      dependencies: [],
      resources: [{
        type: 'Specialist',
        quantity: 1,
        skills: [areaName],
        availability: 'part-time'
      }],
      priority: 'medium'
    };
  }

  private assessComplexity(description: string): 'simple' | 'medium' | 'complex' {
    const complexKeywords = ['integrate', 'migrate', 'scale', 'enterprise', 'distributed'];
    const simpleKeywords = ['add', 'update', 'fix', 'simple', 'basic'];
    
    const lowerDesc = description.toLowerCase();
    
    if (complexKeywords.some(k => lowerDesc.includes(k))) return 'complex';
    if (simpleKeywords.some(k => lowerDesc.includes(k))) return 'simple';
    
    return 'medium';
  }

  private isTechHeavy(description: string): boolean {
    const techKeywords = ['api', 'database', 'integration', 'infrastructure', 'architecture', 'system'];
    return techKeywords.some(keyword => description.includes(keyword));
  }

  private isUserFacing(description: string): boolean {
    const uiKeywords = ['user', 'interface', 'dashboard', 'frontend', 'ui', 'ux', 'experience'];
    return uiKeywords.some(keyword => description.includes(keyword));
  }

  private requiresIntegration(description: string): boolean {
    const integrationKeywords = ['integrate', 'existing', 'legacy', 'connect', 'api', 'third-party'];
    return integrationKeywords.some(keyword => description.includes(keyword));
  }

  private analyzePairDependency(source: Initiative, target: Initiative): InitiativeDependency | null {
    // Analyze if source initiative affects target initiative
    
    // Core Development typically blocks other initiatives
    if (source.title === 'Core Development') {
      return {
        sourceId: source.id,
        targetId: target.id,
        type: 'blocks',
        strength: 0.8,
        description: 'Core development must complete before other initiatives can proceed'
      };
    }
    
    // Technology Foundation enables other technical initiatives
    if (source.title === 'Technology Foundation' && this.isTechHeavy(target.description)) {
      return {
        sourceId: source.id,
        targetId: target.id,
        type: 'enables',
        strength: 0.7,
        description: 'Technology foundation enables technical implementation'
      };
    }
    
    // Market Validation influences Go-to-Market
    if (source.title === 'Market Validation' && target.title === 'Go-to-Market') {
      return {
        sourceId: source.id,
        targetId: target.id,
        type: 'influences',
        strength: 0.9,
        description: 'Market validation results influence go-to-market strategy'
      };
    }
    
    return null;
  }

  private calculateCriticalPath(initiatives: Initiative[], dependencies: InitiativeDependency[]): string[] {
    // Simple critical path calculation - could be enhanced with proper CPM algorithm
    const criticalPath: string[] = [];
    
    // Find initiative with no dependencies (start)
    const independentInit = initiatives.find(init => 
      !dependencies.some(dep => dep.targetId === init.id)
    );
    
    if (independentInit) {
      criticalPath.push(independentInit.id);
      
      // Follow the longest dependency chain
      let current = independentInit.id;
      while (true) {
        const nextDep = dependencies
          .filter(dep => dep.sourceId === current && dep.type === 'blocks')
          .sort((a, b) => b.strength - a.strength)[0];
        
        if (!nextDep) break;
        
        criticalPath.push(nextDep.targetId);
        current = nextDep.targetId;
      }
    }
    
    return criticalPath;
  }

  private identifyParallelGroups(initiatives: Initiative[], dependencies: InitiativeDependency[]): string[][] {
    const groups: string[][] = [];
    const processed = new Set<string>();
    
    for (const initiative of initiatives) {
      if (processed.has(initiative.id)) continue;
      
      const group = [initiative.id];
      processed.add(initiative.id);
      
      // Find other initiatives that can run in parallel
      for (const other of initiatives) {
        if (processed.has(other.id)) continue;
        
        const hasConflict = dependencies.some(dep => 
          (dep.sourceId === initiative.id && dep.targetId === other.id) ||
          (dep.sourceId === other.id && dep.targetId === initiative.id)
        );
        
        if (!hasConflict) {
          group.push(other.id);
          processed.add(other.id);
        }
      }
      
      if (group.length > 1) {
        groups.push(group);
      }
    }
    
    return groups;
  }

  private async calculateInitiativeROI(initiative: Initiative, idea: Idea): Promise<ROIProjection> {
    // Simplified ROI calculation - could be enhanced with more sophisticated models
    
    const investmentRequired = this.calculateInvestment(initiative);
    const expectedReturn = this.calculateExpectedReturn(initiative, idea);
    const timeToBreakeven = investmentRequired > 0 ? Math.ceil(investmentRequired / (expectedReturn / 12)) : 0;
    const riskAdjustedROI = this.calculateRiskAdjustedROI(expectedReturn, investmentRequired, initiative);
    
    return {
      initiativeId: initiative.id,
      investmentRequired,
      expectedReturn,
      timeToBreakeven,
      riskAdjustedROI,
      assumptions: this.generateROIAssumptions(initiative, idea)
    };
  }

  private calculateInvestment(initiative: Initiative): number {
    let totalCost = 0;
    
    for (const resource of initiative.resources) {
      const profile = this.resourceProfiles.get(resource.type) || {
        hourlyRate: 75, availability: 0.8, scalingFactor: 1.0
      };
      
      // Estimate hours based on initiative timeline
      const weeks = Math.ceil((initiative.timeline.endDate.getTime() - initiative.timeline.startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
      const hoursPerWeek = resource.availability === 'full-time' ? 40 : 20;
      const totalHours = weeks * hoursPerWeek * resource.quantity * profile.scalingFactor;
      
      totalCost += totalHours * profile.hourlyRate;
    }
    
    return totalCost;
  }

  private calculateExpectedReturn(initiative: Initiative, idea: Idea): number {
    // Base return on idea's business value and market size
    const baseReturn = (idea.marketAnalysis?.marketSize || 100000) * 0.01; // 1% of market
    
    // Adjust by initiative priority and business value
    const priorityMultiplier = { critical: 1.5, high: 1.2, medium: 1.0, low: 0.8 };
    const multiplier = priorityMultiplier[initiative.priority];
    
    return baseReturn * multiplier;
  }

  private calculateRiskAdjustedROI(expectedReturn: number, investment: number, initiative: Initiative): number {
    if (investment === 0) return 0;
    
    const baseROI = (expectedReturn - investment) / investment;
    
    // Risk adjustment based on complexity and dependencies
    const riskFactors = {
      'Core Development': 0.9, // Lower risk
      'Technology Foundation': 0.8, // Higher risk
      'Market Validation': 0.95, // Lower risk
      'User Experience': 0.9,
      'System Integration': 0.7, // Higher risk
      'Go-to-Market': 0.85,
      'Operations & Scaling': 0.8
    };
    
    const riskFactor = riskFactors[initiative.title as keyof typeof riskFactors] || 0.85;
    
    return baseROI * riskFactor;
  }

  private generateROIAssumptions(initiative: Initiative, idea: Idea): string[] {
    const assumptions: string[] = [];
    
    assumptions.push(`Market size estimate: $${(idea.marketAnalysis?.marketSize || 100000).toLocaleString()}`);
    assumptions.push('1% market capture assumed');
    assumptions.push('Resource costs based on market rates');
    assumptions.push(`Initiative priority: ${initiative.priority}`);
    
    if (initiative.dependencies.length > 0) {
      assumptions.push('Dependencies will be resolved on schedule');
    }
    
    return assumptions;
  }

  private validateInitiativeCount(initiatives: Initiative[]): ValidationResult {
    const count = initiatives.length;
    const isValid = count >= 3 && count <= this.config.maxInitiatives;
    
    return {
      rule: 'Initiative Count',
      passed: isValid,
      score: isValid ? 100 : Math.max(0, 100 - Math.abs(count - 5) * 20),
      details: `${count} initiatives generated (target: 3-${this.config.maxInitiatives})`
    };
  }

  private validateTimeline(timeline: Timeline): ValidationResult {
    const durationMonths = (timeline.endDate.getTime() - timeline.startDate.getTime()) / (30 * 24 * 60 * 60 * 1000);
    const isValid = durationMonths >= 3 && durationMonths <= 12;
    
    return {
      rule: 'Timeline Feasibility',
      passed: isValid,
      score: isValid ? 100 : Math.max(0, 100 - Math.abs(durationMonths - 6) * 15),
      details: `${durationMonths.toFixed(1)} month timeline (target: 3-12 months)`
    };
  }

  private validateResourceAllocation(resourceMap: Map<string, ResourceRequirement[]>): ValidationResult {
    let totalResources = 0;
    let hasKeyRoles = false;
    
    resourceMap.forEach(resources => {
      totalResources += resources.reduce((sum, r) => sum + r.quantity, 0);
      hasKeyRoles = hasKeyRoles || resources.some(r => ['Developer', 'Product Manager'].includes(r.type));
    });
    
    const isValid = totalResources > 0 && hasKeyRoles;
    
    return {
      rule: 'Resource Allocation',
      passed: isValid,
      score: isValid ? 100 : 50,
      details: `${totalResources} total resources allocated across initiatives`
    };
  }

  private validateDependencies(dependencyMatrix: DependencyMatrix): ValidationResult {
    const hasCriticalPath = dependencyMatrix.criticalPath.length > 0;
    const hasParallelWork = dependencyMatrix.parallelGroups.length > 0;
    
    const score = (hasCriticalPath ? 50 : 0) + (hasParallelWork ? 50 : 0);
    
    return {
      rule: 'Dependency Analysis',
      passed: score >= 50,
      score,
      details: `Critical path: ${dependencyMatrix.criticalPath.length} initiatives, Parallel groups: ${dependencyMatrix.parallelGroups.length}`
    };
  }

  private validateROI(roiProjections: ROIProjection[]): ValidationResult {
    const positiveROI = roiProjections.filter(p => p.riskAdjustedROI > 0).length;
    const totalProjections = roiProjections.length;
    const score = totalProjections > 0 ? (positiveROI / totalProjections) * 100 : 0;
    
    return {
      rule: 'ROI Analysis',
      passed: score >= 60,
      score,
      details: `${positiveROI}/${totalProjections} initiatives show positive ROI`
    };
  }

  private calculateOverallConfidence(validations: ValidationResult[]): number {
    if (validations.length === 0) return 0;
    
    const totalScore = validations.reduce((sum, v) => sum + v.score, 0);
    return totalScore / validations.length / 100;
  }

  private identifyQualityIssues(validations: ValidationResult[], confidence: number): QualityIssue[] {
    const issues: QualityIssue[] = [];
    
    if (confidence < this.config.confidenceThreshold) {
      issues.push({
        severity: 'high',
        type: 'Low Confidence',
        description: `Planning confidence ${(confidence * 100).toFixed(1)}% is below threshold`,
        suggestion: 'Refine initiative definitions and resource estimates'
      });
    }
    
    validations.forEach(validation => {
      if (!validation.passed) {
        issues.push({
          severity: validation.score < 30 ? 'critical' : 'medium',
          type: validation.rule,
          description: `Planning validation failed: ${validation.details}`,
          suggestion: 'Address the identified planning gaps'
        });
      }
    });
    
    return issues;
  }

  private generateRecommendations(validations: ValidationResult[], issues: QualityIssue[]): string[] {
    const recommendations: string[] = [];
    
    if (issues.some(i => i.type === 'Initiative Count')) {
      recommendations.push('Adjust the number of initiatives to optimal range (3-7)');
    }
    
    if (issues.some(i => i.type === 'Timeline Feasibility')) {
      recommendations.push('Review timeline constraints and adjust scope or resources');
    }
    
    if (issues.some(i => i.type === 'Resource Allocation')) {
      recommendations.push('Ensure adequate resources are allocated to critical initiatives');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Initiative planning is comprehensive and ready for feature breakdown');
    }
    
    return recommendations;
  }
}

// === SUPPORTING INTERFACES ===

interface StrategicArea {
  name: string;
  description: string;
  priority: Priority;
  complexity: 'simple' | 'medium' | 'complex';
  businessValue: number;
}

interface InitiativeTemplate {
  name: string;
  baseResources: ResourceRequirement[];
  baseTimeline: number; // weeks
  objectives: string[];
}

interface ResourceProfile {
  hourlyRate: number;
  skills: string[];
  availability: number;
  scalingFactor: number;
}