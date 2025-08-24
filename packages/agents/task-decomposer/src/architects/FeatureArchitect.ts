import { EventEmitter } from 'events';
import {
  Initiative,
  Feature,
  QualityGate,
  ValidationResult,
  QualityIssue
} from '@caia/shared/hierarchical-types';

/**
 * Configuration for FeatureArchitect
 */
export interface FeatureArchitectConfig {
  confidenceThreshold: number;
  maxFeaturesPerInitiative: number;
  minFeaturesPerInitiative: number;
  enableUserJourneyMapping: boolean;
  platformAnalysisDepth: 'basic' | 'comprehensive';
  integrationDiscoveryLevel: 'surface' | 'deep';
}

/**
 * Feature breakdown result
 */
interface FeatureBreakdown {
  features: Feature[];
  userJourneys: UserJourney[];
  technicalComponents: TechnicalComponent[];
  platformRequirements: PlatformRequirement[];
  integrationPoints: IntegrationPoint[];
  featureMap: FeatureMap;
}

interface UserJourney {
  id: string;
  name: string;
  persona: string;
  steps: JourneyStep[];
  touchpoints: string[];
  painPoints: string[];
  successCriteria: string[];
  relatedFeatures: string[];
}

interface JourneyStep {
  id: string;
  name: string;
  description: string;
  userAction: string;
  systemResponse: string;
  requiredFeatures: string[];
  alternativeFlows: string[];
}

interface TechnicalComponent {
  id: string;
  name: string;
  type: 'frontend' | 'backend' | 'database' | 'integration' | 'infrastructure';
  description: string;
  dependencies: string[];
  interfaces: ComponentInterface[];
  complexity: 'low' | 'medium' | 'high';
  reusability: 'specific' | 'moderate' | 'high';
}

interface ComponentInterface {
  name: string;
  type: 'api' | 'event' | 'data' | 'ui';
  specification: string;
  consumers: string[];
}

interface PlatformRequirement {
  platform: 'web' | 'mobile' | 'desktop' | 'api' | 'cloud';
  components: string[];
  specifications: PlatformSpec[];
  constraints: string[];
  recommendations: string[];
}

interface PlatformSpec {
  category: 'performance' | 'security' | 'scalability' | 'compatibility' | 'accessibility';
  requirement: string;
  priority: 'must' | 'should' | 'could';
  acceptance: string;
}

interface IntegrationPoint {
  id: string;
  name: string;
  type: 'internal' | 'external' | 'third-party';
  direction: 'inbound' | 'outbound' | 'bidirectional';
  protocol: string;
  dataFormat: string;
  authentication: string;
  rateLimits?: string;
  errorHandling: string[];
  relatedFeatures: string[];
}

interface FeatureMap {
  initiativeFeatures: Map<string, string[]>;
  featureDependencies: Map<string, string[]>;
  componentFeatures: Map<string, string[]>;
  journeyFeatures: Map<string, string[]>;
}

/**
 * Enhanced FeatureArchitect that breaks initiatives into detailed features
 * with user journey mapping, technical component identification, and platform analysis
 */
export class FeatureArchitect extends EventEmitter {
  private config: FeatureArchitectConfig;
  private featureTemplates: Map<string, FeatureTemplate> = new Map();
  private journeyPatterns: Map<string, JourneyPattern> = new Map();
  private componentLibrary: Map<string, TechnicalComponent> = new Map();

  constructor(config: FeatureArchitectConfig) {
    super();
    this.config = {
      confidenceThreshold: 0.85,
      maxFeaturesPerInitiative: 12,
      minFeaturesPerInitiative: 5,
      enableUserJourneyMapping: true,
      platformAnalysisDepth: 'comprehensive',
      integrationDiscoveryLevel: 'deep',
      ...config
    };
    
    this.initializeTemplates();
    this.initializeJourneyPatterns();
    this.initializeComponentLibrary();
  }

  /**
   * Architects features from strategic initiatives
   */
  async architectFeatures(initiatives: Initiative[]): Promise<FeatureBreakdown> {
    this.emit('architecture:start', { initiativeCount: initiatives.length });

    try {
      // Generate features for each initiative
      const features = await this.generateFeatures(initiatives);
      
      // Map user journeys if enabled
      const userJourneys = this.config.enableUserJourneyMapping 
        ? await this.mapUserJourneys(features, initiatives)
        : [];
      
      // Identify technical components
      const technicalComponents = await this.identifyTechnicalComponents(features);
      
      // Analyze platform requirements
      const platformRequirements = await this.analyzePlatformRequirements(features);
      
      // Discover integration points
      const integrationPoints = await this.discoverIntegrationPoints(features, initiatives);
      
      // Create feature mapping
      const featureMap = await this.createFeatureMap(features, initiatives, technicalComponents, userJourneys);

      const breakdown: FeatureBreakdown = {
        features,
        userJourneys,
        technicalComponents,
        platformRequirements,
        integrationPoints,
        featureMap
      };

      this.emit('architecture:complete', { breakdown });
      return breakdown;
    } catch (error) {
      this.emit('architecture:error', error);
      throw error;
    }
  }

  /**
   * Generates features for all initiatives
   */
  private async generateFeatures(initiatives: Initiative[]): Promise<Feature[]> {
    const allFeatures: Feature[] = [];
    
    for (const initiative of initiatives) {
      const features = await this.generateFeaturesForInitiative(initiative);
      allFeatures.push(...features);
    }

    // Remove duplicates and consolidate similar features
    return this.consolidateFeatures(allFeatures);
  }

  /**
   * Generates features for a single initiative
   */
  private async generateFeaturesForInitiative(initiative: Initiative): Promise<Feature[]> {
    const features: Feature[] = [];
    
    // Analyze initiative to identify feature areas
    const featureAreas = this.identifyFeatureAreas(initiative);
    
    // Limit features per initiative
    const selectedAreas = featureAreas.slice(0, this.config.maxFeaturesPerInitiative);
    
    for (const area of selectedAreas) {
      const feature = await this.createFeatureFromArea(area, initiative);
      features.push(feature);
    }

    // Ensure minimum features
    while (features.length < this.config.minFeaturesPerInitiative) {
      const syntheticFeature = this.createSyntheticFeature(initiative, features.length);
      features.push(syntheticFeature);
    }

    return features;
  }

  /**
   * Maps user journeys across features
   */
  private async mapUserJourneys(features: Feature[], initiatives: Initiative[]): Promise<UserJourney[]> {
    const journeys: UserJourney[] = [];
    
    // Identify user personas from initiatives and features
    const personas = this.identifyUserPersonas(features, initiatives);
    
    for (const persona of personas) {
      // Create journey for each persona
      const journey = await this.createUserJourney(persona, features, initiatives);
      if (journey) {
        journeys.push(journey);
      }
    }
    
    return journeys;
  }

  /**
   * Identifies technical components needed for features
   */
  private async identifyTechnicalComponents(features: Feature[]): Promise<TechnicalComponent[]> {
    const components: TechnicalComponent[] = [];
    const componentMap = new Map<string, TechnicalComponent>();
    
    for (const feature of features) {
      const featureComponents = this.analyzeFeatureComponents(feature);
      
      for (const component of featureComponents) {
        if (componentMap.has(component.name)) {
          // Merge with existing component
          const existing = componentMap.get(component.name)!;
          this.mergeComponents(existing, component);
        } else {
          componentMap.set(component.name, component);
        }
      }
    }
    
    return Array.from(componentMap.values());
  }

  /**
   * Analyzes platform requirements for features
   */
  private async analyzePlatformRequirements(features: Feature[]): Promise<PlatformRequirement[]> {
    const requirements: PlatformRequirement[] = [];
    const platformMap = new Map<string, PlatformRequirement>();
    
    for (const feature of features) {
      const platforms = this.identifyRequiredPlatforms(feature);
      
      for (const platform of platforms) {
        if (platformMap.has(platform)) {
          // Add to existing platform requirement
          const existing = platformMap.get(platform)!;
          existing.components.push(...feature.technicalRequirements);
        } else {
          const requirement = this.createPlatformRequirement(platform, feature);
          platformMap.set(platform, requirement);
        }
      }
    }
    
    return Array.from(platformMap.values());
  }

  /**
   * Discovers integration points from features
   */
  private async discoverIntegrationPoints(features: Feature[], initiatives: Initiative[]): Promise<IntegrationPoint[]> {
    const integrationPoints: IntegrationPoint[] = [];
    
    for (const feature of features) {
      const points = this.analyzeFeatureIntegrations(feature, initiatives);
      integrationPoints.push(...points);
    }
    
    // Deduplicate similar integration points
    return this.deduplicateIntegrationPoints(integrationPoints);
  }

  /**
   * Creates feature mapping relationships
   */
  private async createFeatureMap(
    features: Feature[],
    initiatives: Initiative[],
    components: TechnicalComponent[],
    journeys: UserJourney[]
  ): Promise<FeatureMap> {
    const initiativeFeatures = new Map<string, string[]>();
    const featureDependencies = new Map<string, string[]>();
    const componentFeatures = new Map<string, string[]>();
    const journeyFeatures = new Map<string, string[]>();
    
    // Map initiatives to features
    for (const feature of features) {
      const initId = feature.initiativeId;
      if (!initiativeFeatures.has(initId)) {
        initiativeFeatures.set(initId, []);
      }
      initiativeFeatures.get(initId)!.push(feature.id);
    }
    
    // Map feature dependencies
    for (const feature of features) {
      const dependencies = this.identifyFeatureDependencies(feature, features);
      featureDependencies.set(feature.id, dependencies);
    }
    
    // Map components to features
    for (const component of components) {
      const relatedFeatures = features
        .filter(f => f.technicalRequirements.some(req => req.includes(component.name)))
        .map(f => f.id);
      componentFeatures.set(component.id, relatedFeatures);
    }
    
    // Map journeys to features
    for (const journey of journeys) {
      journeyFeatures.set(journey.id, journey.relatedFeatures);
    }
    
    return {
      initiativeFeatures,
      featureDependencies,
      componentFeatures,
      journeyFeatures
    };
  }

  /**
   * Creates quality gate for feature architecture validation
   */
  async validateFeatureArchitecture(breakdown: FeatureBreakdown): Promise<QualityGate> {
    const validations: ValidationResult[] = [];
    
    // Validate feature count and distribution
    validations.push(this.validateFeatureDistribution(breakdown.features));
    
    // Validate user journey coverage
    if (breakdown.userJourneys.length > 0) {
      validations.push(this.validateUserJourneyCoverage(breakdown.userJourneys, breakdown.features));
    }
    
    // Validate technical component architecture
    validations.push(this.validateComponentArchitecture(breakdown.technicalComponents));
    
    // Validate platform coverage
    validations.push(this.validatePlatformCoverage(breakdown.platformRequirements));
    
    // Validate integration completeness
    validations.push(this.validateIntegrationCompleteness(breakdown.integrationPoints));
    
    const confidence = this.calculateOverallConfidence(validations);
    const passed = confidence >= this.config.confidenceThreshold;
    const issues = this.identifyQualityIssues(validations, confidence);
    const recommendations = this.generateRecommendations(validations, issues);
    
    return {
      tier: 'feature',
      sourceTier: 'initiative',
      targetTier: 'epic',
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
    // Initialize feature templates for common patterns
    this.featureTemplates.set('user-management', {
      name: 'User Management',
      baseUserStories: [
        'As a user, I want to create an account so I can access the system',
        'As a user, I want to login securely so I can use the application',
        'As a user, I want to manage my profile so I can keep information current'
      ],
      acceptanceCriteria: [
        'User can register with email and password',
        'Password meets security requirements',
        'Email verification is required',
        'Profile information can be updated'
      ],
      technicalRequirements: ['Authentication service', 'User database', 'Email service'],
      platforms: ['web', 'mobile']
    });
    
    this.featureTemplates.set('data-management', {
      name: 'Data Management',
      baseUserStories: [
        'As a user, I want to input data so I can store information',
        'As a user, I want to view my data so I can track progress',
        'As a user, I want to export data so I can use it elsewhere'
      ],
      acceptanceCriteria: [
        'Data can be entered through forms',
        'Data is validated before storage',
        'Data can be filtered and searched',
        'Data export is available in multiple formats'
      ],
      technicalRequirements: ['Database', 'Validation service', 'Export service'],
      platforms: ['web', 'api']
    });
  }

  private initializeJourneyPatterns(): void {
    // Initialize common user journey patterns
    this.journeyPatterns.set('onboarding', {
      name: 'User Onboarding',
      typicalSteps: [
        'User discovers the product',
        'User signs up for account',
        'User completes profile setup',
        'User completes initial tutorial',
        'User performs first meaningful action'
      ],
      successMetrics: ['Registration completion rate', 'Time to first value', 'Tutorial completion rate']
    });
    
    this.journeyPatterns.set('core-workflow', {
      name: 'Core Workflow',
      typicalSteps: [
        'User logs in',
        'User navigates to main function',
        'User inputs or selects data',
        'System processes request',
        'User reviews results',
        'User takes follow-up action'
      ],
      successMetrics: ['Task completion rate', 'Time on task', 'User satisfaction']
    });
  }

  private initializeComponentLibrary(): void {
    // Initialize reusable component library
    this.componentLibrary.set('auth-service', {
      id: 'auth-service',
      name: 'Authentication Service',
      type: 'backend',
      description: 'Handles user authentication and authorization',
      dependencies: ['user-database', 'token-service'],
      interfaces: [
        {
          name: 'AuthAPI',
          type: 'api',
          specification: 'REST API for login, logout, token refresh',
          consumers: ['web-app', 'mobile-app']
        }
      ],
      complexity: 'medium',
      reusability: 'high'
    });
    
    this.componentLibrary.set('user-interface', {
      id: 'user-interface',
      name: 'User Interface Components',
      type: 'frontend',
      description: 'Reusable UI components and layouts',
      dependencies: ['design-system'],
      interfaces: [
        {
          name: 'ComponentLibrary',
          type: 'ui',
          specification: 'React/Vue component library',
          consumers: ['web-app', 'admin-panel']
        }
      ],
      complexity: 'medium',
      reusability: 'high'
    });
  }

  private identifyFeatureAreas(initiative: Initiative): FeatureArea[] {
    const areas: FeatureArea[] = [];
    const description = initiative.description.toLowerCase();
    const objectives = initiative.objectives.join(' ').toLowerCase();
    const context = `${description} ${objectives}`;
    
    // Core functional areas
    if (this.containsKeywords(context, ['user', 'account', 'profile', 'login', 'authentication'])) {
      areas.push({
        name: 'User Management',
        type: 'functional',
        complexity: 'medium',
        userValue: 'high',
        technicalRequirements: ['Authentication', 'User Database', 'Session Management']
      });
    }
    
    if (this.containsKeywords(context, ['data', 'information', 'record', 'store', 'manage'])) {
      areas.push({
        name: 'Data Management',
        type: 'functional',
        complexity: 'medium',
        userValue: 'high',
        technicalRequirements: ['Database', 'Data Validation', 'CRUD Operations']
      });
    }
    
    if (this.containsKeywords(context, ['report', 'analytics', 'dashboard', 'visualization', 'chart'])) {
      areas.push({
        name: 'Reporting & Analytics',
        type: 'functional',
        complexity: 'high',
        userValue: 'medium',
        technicalRequirements: ['Analytics Engine', 'Data Visualization', 'Report Generator']
      });
    }
    
    if (this.containsKeywords(context, ['notification', 'alert', 'message', 'communication', 'email'])) {
      areas.push({
        name: 'Communication',
        type: 'functional',
        complexity: 'medium',
        userValue: 'medium',
        technicalRequirements: ['Notification Service', 'Email Service', 'Message Queue']
      });
    }
    
    if (this.containsKeywords(context, ['search', 'filter', 'find', 'query', 'lookup'])) {
      areas.push({
        name: 'Search & Discovery',
        type: 'functional',
        complexity: 'high',
        userValue: 'high',
        technicalRequirements: ['Search Engine', 'Indexing Service', 'Query Processor']
      });
    }
    
    // Non-functional areas
    if (this.containsKeywords(context, ['security', 'permission', 'role', 'access', 'authorization'])) {
      areas.push({
        name: 'Security & Permissions',
        type: 'non-functional',
        complexity: 'high',
        userValue: 'medium',
        technicalRequirements: ['Authorization Service', 'Permission Management', 'Audit Logging']
      });
    }
    
    if (this.containsKeywords(context, ['performance', 'speed', 'fast', 'optimization', 'cache'])) {
      areas.push({
        name: 'Performance Optimization',
        type: 'non-functional',
        complexity: 'high',
        userValue: 'medium',
        technicalRequirements: ['Caching Layer', 'Performance Monitoring', 'Load Optimization']
      });
    }
    
    // Integration areas
    if (this.containsKeywords(context, ['api', 'integration', 'third-party', 'external', 'webhook'])) {
      areas.push({
        name: 'External Integrations',
        type: 'integration',
        complexity: 'high',
        userValue: 'medium',
        technicalRequirements: ['API Gateway', 'Integration Layer', 'Webhook Handler']
      });
    }
    
    // Ensure we have at least basic areas
    if (areas.length === 0) {
      areas.push({
        name: 'Core Functionality',
        type: 'functional',
        complexity: 'medium',
        userValue: 'high',
        technicalRequirements: ['Core Service', 'Database', 'API Layer']
      });
    }
    
    return areas.sort((a, b) => {
      const userValueScore = { high: 3, medium: 2, low: 1 };
      return userValueScore[b.userValue] - userValueScore[a.userValue];
    });
  }

  private containsKeywords(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword));
  }

  private async createFeatureFromArea(area: FeatureArea, initiative: Initiative): Promise<Feature> {
    const feature: Feature = {
      id: this.generateFeatureId(initiative.id, area.name),
      initiativeId: initiative.id,
      title: area.name,
      description: `${area.name} feature for ${initiative.title}`,
      userStories: this.generateUserStories(area, initiative),
      acceptanceCriteria: this.generateAcceptanceCriteria(area),
      technicalRequirements: area.technicalRequirements,
      platformRequirements: this.determinePlatformRequirements(area),
      integrationPoints: this.identifyIntegrationPoints(area, initiative)
    };
    
    return feature;
  }

  private createSyntheticFeature(initiative: Initiative, index: number): Feature {
    const syntheticAreas = [
      'Configuration Management',
      'Audit & Logging',
      'Help & Documentation',
      'Mobile Responsiveness',
      'Error Handling',
      'Data Import/Export',
      'Backup & Recovery'
    ];
    
    const areaName = syntheticAreas[index] || 'Support Feature';
    
    return {
      id: this.generateFeatureId(initiative.id, areaName),
      initiativeId: initiative.id,
      title: areaName,
      description: `${areaName} feature for ${initiative.title}`,
      userStories: [`As a user, I want ${areaName.toLowerCase()} so that the system is reliable`],
      acceptanceCriteria: [`${areaName} is implemented according to best practices`],
      technicalRequirements: [areaName],
      platformRequirements: ['web'],
      integrationPoints: []
    };
  }

  private consolidateFeatures(features: Feature[]): Feature[] {
    const consolidated: Feature[] = [];
    const seenTitles = new Set<string>();
    
    for (const feature of features) {
      if (!seenTitles.has(feature.title)) {
        seenTitles.add(feature.title);
        consolidated.push(feature);
      } else {
        // Merge similar features
        const existing = consolidated.find(f => f.title === feature.title);
        if (existing) {
          this.mergeFeatures(existing, feature);
        }
      }
    }
    
    return consolidated;
  }

  private mergeFeatures(target: Feature, source: Feature): void {
    // Merge user stories
    source.userStories.forEach(story => {
      if (!target.userStories.includes(story)) {
        target.userStories.push(story);
      }
    });
    
    // Merge acceptance criteria
    source.acceptanceCriteria.forEach(criteria => {
      if (!target.acceptanceCriteria.includes(criteria)) {
        target.acceptanceCriteria.push(criteria);
      }
    });
    
    // Merge technical requirements
    source.technicalRequirements.forEach(req => {
      if (!target.technicalRequirements.includes(req)) {
        target.technicalRequirements.push(req);
      }
    });
  }

  private identifyUserPersonas(features: Feature[], initiatives: Initiative[]): string[] {
    const personas = new Set<string>();
    
    // Extract personas from user stories
    features.forEach(feature => {
      feature.userStories.forEach(story => {
        const personaMatch = story.match(/As an? ([^,]+),/i);
        if (personaMatch) {
          personas.add(personaMatch[1].trim());
        }
      });
    });
    
    // Add default personas if none found
    if (personas.size === 0) {
      personas.add('user');
      personas.add('administrator');
    }
    
    return Array.from(personas);
  }

  private async createUserJourney(persona: string, features: Feature[], initiatives: Initiative[]): Promise<UserJourney | null> {
    const relevantFeatures = features.filter(f => 
      f.userStories.some(story => story.toLowerCase().includes(persona.toLowerCase()))
    );
    
    if (relevantFeatures.length === 0) return null;
    
    const journey: UserJourney = {
      id: this.generateJourneyId(persona),
      name: `${persona} Journey`,
      persona,
      steps: this.generateJourneySteps(persona, relevantFeatures),
      touchpoints: this.identifyTouchpoints(relevantFeatures),
      painPoints: this.identifyPainPoints(persona, relevantFeatures),
      successCriteria: this.generateJourneySuccessCriteria(persona, relevantFeatures),
      relatedFeatures: relevantFeatures.map(f => f.id)
    };
    
    return journey;
  }

  private generateJourneySteps(persona: string, features: Feature[]): JourneyStep[] {
    const steps: JourneyStep[] = [];
    
    // Create steps based on typical user flow
    if (features.some(f => f.title.toLowerCase().includes('user management'))) {
      steps.push({
        id: this.generateStepId('authentication'),
        name: 'Authentication',
        description: `${persona} authenticates to access the system`,
        userAction: 'Login with credentials',
        systemResponse: 'Validate credentials and create session',
        requiredFeatures: features.filter(f => f.title.toLowerCase().includes('user')).map(f => f.id),
        alternativeFlows: ['Registration', 'Password reset']
      });
    }
    
    if (features.some(f => f.title.toLowerCase().includes('data'))) {
      steps.push({
        id: this.generateStepId('data-interaction'),
        name: 'Data Interaction',
        description: `${persona} works with data in the system`,
        userAction: 'Create, view, or modify data',
        systemResponse: 'Process data changes and provide feedback',
        requiredFeatures: features.filter(f => f.title.toLowerCase().includes('data')).map(f => f.id),
        alternativeFlows: ['Bulk operations', 'Import/export']
      });
    }
    
    return steps;
  }

  private identifyTouchpoints(features: Feature[]): string[] {
    const touchpoints: string[] = [];
    
    features.forEach(feature => {
      feature.platformRequirements.forEach(platform => {
        if (!touchpoints.includes(platform)) {
          touchpoints.push(platform);
        }
      });
    });
    
    return touchpoints;
  }

  private identifyPainPoints(persona: string, features: Feature[]): string[] {
    const painPoints: string[] = [];
    
    // Identify potential pain points based on feature complexity
    features.forEach(feature => {
      if (feature.technicalRequirements.length > 5) {
        painPoints.push(`Complex ${feature.title.toLowerCase()} may be overwhelming`);
      }
      
      if (feature.integrationPoints.length > 2) {
        painPoints.push(`Multiple integrations in ${feature.title.toLowerCase()} may cause delays`);
      }
    });
    
    return painPoints;
  }

  private generateJourneySuccessCriteria(persona: string, features: Feature[]): string[] {
    const criteria: string[] = [];
    
    criteria.push(`${persona} can complete primary tasks efficiently`);
    criteria.push(`${persona} achieves their goals with minimal friction`);
    
    if (features.some(f => f.title.toLowerCase().includes('user'))) {
      criteria.push(`${persona} can easily access and navigate the system`);
    }
    
    return criteria;
  }

  private analyzeFeatureComponents(feature: Feature): TechnicalComponent[] {
    const components: TechnicalComponent[] = [];
    
    // Analyze technical requirements to identify components
    feature.technicalRequirements.forEach(req => {
      const component = this.createComponentFromRequirement(req, feature);
      components.push(component);
    });
    
    return components;
  }

  private createComponentFromRequirement(requirement: string, feature: Feature): TechnicalComponent {
    const lowerReq = requirement.toLowerCase();
    
    let type: TechnicalComponent['type'] = 'backend';
    let complexity: TechnicalComponent['complexity'] = 'medium';
    
    if (lowerReq.includes('ui') || lowerReq.includes('interface') || lowerReq.includes('frontend')) {
      type = 'frontend';
    } else if (lowerReq.includes('database') || lowerReq.includes('data')) {
      type = 'database';
    } else if (lowerReq.includes('integration') || lowerReq.includes('api')) {
      type = 'integration';
    } else if (lowerReq.includes('infrastructure') || lowerReq.includes('deployment')) {
      type = 'infrastructure';
    }
    
    if (lowerReq.includes('complex') || lowerReq.includes('advanced') || lowerReq.includes('enterprise')) {
      complexity = 'high';
    } else if (lowerReq.includes('simple') || lowerReq.includes('basic')) {
      complexity = 'low';
    }
    
    return {
      id: this.generateComponentId(requirement),
      name: requirement,
      type,
      description: `${requirement} component for ${feature.title}`,
      dependencies: [],
      interfaces: [{
        name: `${requirement}Interface`,
        type: type === 'frontend' ? 'ui' : 'api',
        specification: `Interface for ${requirement}`,
        consumers: [feature.id]
      }],
      complexity,
      reusability: type === 'database' || type === 'infrastructure' ? 'high' : 'moderate'
    };
  }

  private mergeComponents(target: TechnicalComponent, source: TechnicalComponent): void {
    // Merge dependencies
    source.dependencies.forEach(dep => {
      if (!target.dependencies.includes(dep)) {
        target.dependencies.push(dep);
      }
    });
    
    // Merge interfaces
    source.interfaces.forEach(int => {
      const existing = target.interfaces.find(i => i.name === int.name);
      if (existing) {
        // Merge consumers
        int.consumers.forEach(consumer => {
          if (!existing.consumers.includes(consumer)) {
            existing.consumers.push(consumer);
          }
        });
      } else {
        target.interfaces.push(int);
      }
    });
    
    // Update complexity to highest
    const complexityLevels = { low: 1, medium: 2, high: 3 };
    if (complexityLevels[source.complexity] > complexityLevels[target.complexity]) {
      target.complexity = source.complexity;
    }
  }

  private identifyRequiredPlatforms(feature: Feature): string[] {
    // Return the platform requirements already defined in the feature
    return feature.platformRequirements;
  }

  private createPlatformRequirement(platform: string, feature: Feature): PlatformRequirement {
    const specs: PlatformSpec[] = [];
    
    // Add common platform specifications
    if (platform === 'web') {
      specs.push(
        {
          category: 'compatibility',
          requirement: 'Support modern browsers (Chrome, Firefox, Safari, Edge)',
          priority: 'must',
          acceptance: 'Application works in latest versions of specified browsers'
        },
        {
          category: 'accessibility',
          requirement: 'WCAG 2.1 AA compliance',
          priority: 'should',
          acceptance: 'Passes automated accessibility testing'
        }
      );
    } else if (platform === 'mobile') {
      specs.push(
        {
          category: 'compatibility',
          requirement: 'Support iOS 14+ and Android 8+',
          priority: 'must',
          acceptance: 'Application functions on specified OS versions'
        },
        {
          category: 'performance',
          requirement: 'App launch time under 3 seconds',
          priority: 'should',
          acceptance: 'Performance testing shows consistent launch times'
        }
      );
    }
    
    return {
      platform: platform as PlatformRequirement['platform'],
      components: feature.technicalRequirements,
      specifications: specs,
      constraints: [],
      recommendations: []
    };
  }

  private analyzeFeatureIntegrations(feature: Feature, initiatives: Initiative[]): IntegrationPoint[] {
    const integrations: IntegrationPoint[] = [];
    
    feature.integrationPoints.forEach(point => {
      const integration = this.createIntegrationPoint(point, feature);
      integrations.push(integration);
    });
    
    return integrations;
  }

  private createIntegrationPoint(pointName: string, feature: Feature): IntegrationPoint {
    return {
      id: this.generateIntegrationId(pointName),
      name: pointName,
      type: this.classifyIntegrationType(pointName),
      direction: this.determineIntegrationDirection(pointName),
      protocol: 'HTTP/REST',
      dataFormat: 'JSON',
      authentication: 'API Key',
      errorHandling: ['Retry logic', 'Fallback handling', 'Error logging'],
      relatedFeatures: [feature.id]
    };
  }

  private classifyIntegrationType(pointName: string): IntegrationPoint['type'] {
    const lowerName = pointName.toLowerCase();
    
    if (lowerName.includes('third-party') || lowerName.includes('external')) {
      return 'third-party';
    } else if (lowerName.includes('internal') || lowerName.includes('system')) {
      return 'internal';
    }
    
    return 'external';
  }

  private determineIntegrationDirection(pointName: string): IntegrationPoint['direction'] {
    const lowerName = pointName.toLowerCase();
    
    if (lowerName.includes('webhook') || lowerName.includes('callback')) {
      return 'inbound';
    } else if (lowerName.includes('send') || lowerName.includes('export')) {
      return 'outbound';
    }
    
    return 'bidirectional';
  }

  private deduplicateIntegrationPoints(points: IntegrationPoint[]): IntegrationPoint[] {
    const unique = new Map<string, IntegrationPoint>();
    
    points.forEach(point => {
      const key = `${point.name}_${point.type}`;
      if (unique.has(key)) {
        const existing = unique.get(key)!;
        // Merge related features
        point.relatedFeatures.forEach(featureId => {
          if (!existing.relatedFeatures.includes(featureId)) {
            existing.relatedFeatures.push(featureId);
          }
        });
      } else {
        unique.set(key, point);
      }
    });
    
    return Array.from(unique.values());
  }

  private identifyFeatureDependencies(feature: Feature, allFeatures: Feature[]): string[] {
    const dependencies: string[] = [];
    
    // Check if this feature depends on others based on technical requirements
    allFeatures.forEach(otherFeature => {
      if (otherFeature.id === feature.id) return;
      
      // If other feature provides something this feature needs
      if (this.featureProvidesDependency(otherFeature, feature)) {
        dependencies.push(otherFeature.id);
      }
    });
    
    return dependencies;
  }

  private featureProvidesDependency(provider: Feature, consumer: Feature): boolean {
    // Simple dependency analysis - could be enhanced
    const providerCapabilities = provider.title.toLowerCase();
    const consumerNeeds = consumer.technicalRequirements.join(' ').toLowerCase();
    
    if (providerCapabilities.includes('user') && consumerNeeds.includes('authentication')) {
      return true;
    }
    
    if (providerCapabilities.includes('data') && consumerNeeds.includes('database')) {
      return true;
    }
    
    return false;
  }

  private generateUserStories(area: FeatureArea, initiative: Initiative): string[] {
    const template = this.featureTemplates.get(area.name.toLowerCase().replace(/\s+/g, '-'));
    
    if (template) {
      return template.baseUserStories;
    }
    
    // Generate generic user stories
    return [
      `As a user, I want to use ${area.name.toLowerCase()} so that I can achieve my goals`,
      `As an administrator, I want to manage ${area.name.toLowerCase()} so that the system runs smoothly`
    ];
  }

  private generateAcceptanceCriteria(area: FeatureArea): string[] {
    const template = this.featureTemplates.get(area.name.toLowerCase().replace(/\s+/g, '-'));
    
    if (template) {
      return template.acceptanceCriteria;
    }
    
    // Generate generic acceptance criteria
    return [
      `${area.name} functionality works as expected`,
      `${area.name} handles errors gracefully`,
      `${area.name} meets performance requirements`
    ];
  }

  private determinePlatformRequirements(area: FeatureArea): string[] {
    const template = this.featureTemplates.get(area.name.toLowerCase().replace(/\s+/g, '-'));
    
    if (template) {
      return template.platforms;
    }
    
    // Default platform requirements
    if (area.type === 'integration') {
      return ['api'];
    } else if (area.userValue === 'high') {
      return ['web', 'mobile'];
    } else {
      return ['web'];
    }
  }

  private identifyIntegrationPoints(area: FeatureArea, initiative: Initiative): string[] {
    const points: string[] = [];
    
    if (area.type === 'integration') {
      points.push('External API Integration');
      points.push('Data Synchronization');
    }
    
    if (area.name.toLowerCase().includes('communication')) {
      points.push('Email Service Integration');
      points.push('Notification Service');
    }
    
    return points;
  }

  // Validation methods
  private validateFeatureDistribution(features: Feature[]): ValidationResult {
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
      passed: isBalanced && avgFeatures >= this.config.minFeaturesPerInitiative,
      score: isBalanced ? 100 : 70,
      details: `Average ${avgFeatures.toFixed(1)} features per initiative (range: ${Math.min(...counts)}-${Math.max(...counts)})`
    };
  }

  private validateUserJourneyCoverage(journeys: UserJourney[], features: Feature[]): ValidationResult {
    const totalFeatures = features.length;
    const coveredFeatures = new Set<string>();
    
    journeys.forEach(journey => {
      journey.relatedFeatures.forEach(featureId => {
        coveredFeatures.add(featureId);
      });
    });
    
    const coverage = (coveredFeatures.size / totalFeatures) * 100;
    
    return {
      rule: 'User Journey Coverage',
      passed: coverage >= 80,
      score: coverage,
      details: `${coverage.toFixed(1)}% of features covered by user journeys`
    };
  }

  private validateComponentArchitecture(components: TechnicalComponent[]): ValidationResult {
    const typeDistribution = components.reduce((dist, comp) => {
      dist[comp.type] = (dist[comp.type] || 0) + 1;
      return dist;
    }, {} as Record<string, number>);
    
    const hasBalancedArchitecture = Object.keys(typeDistribution).length >= 3;
    const reusableComponents = components.filter(c => c.reusability === 'high').length;
    const reusabilityScore = (reusableComponents / components.length) * 100;
    
    const score = (hasBalancedArchitecture ? 50 : 0) + (reusabilityScore * 0.5);
    
    return {
      rule: 'Component Architecture',
      passed: score >= 70,
      score,
      details: `${Object.keys(typeDistribution).length} component types, ${reusabilityScore.toFixed(1)}% reusable`
    };
  }

  private validatePlatformCoverage(platformRequirements: PlatformRequirement[]): ValidationResult {
    const platforms = platformRequirements.map(p => p.platform);
    const hasWebCoverage = platforms.includes('web');
    const hasMultiplePlatforms = platforms.length > 1;
    
    const score = (hasWebCoverage ? 60 : 0) + (hasMultiplePlatforms ? 40 : 0);
    
    return {
      rule: 'Platform Coverage',
      passed: score >= 60,
      score,
      details: `${platforms.length} platforms covered: ${platforms.join(', ')}`
    };
  }

  private validateIntegrationCompleteness(integrationPoints: IntegrationPoint[]): ValidationResult {
    const hasIntegrations = integrationPoints.length > 0;
    const hasErrorHandling = integrationPoints.every(p => p.errorHandling.length > 0);
    const hasAuthentication = integrationPoints.every(p => p.authentication && p.authentication !== '');
    
    const score = (hasIntegrations ? 40 : 0) + (hasErrorHandling ? 30 : 0) + (hasAuthentication ? 30 : 0);
    
    return {
      rule: 'Integration Completeness',
      passed: score >= 70,
      score,
      details: `${integrationPoints.length} integration points with error handling: ${hasErrorHandling}, auth: ${hasAuthentication}`
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
        description: `Feature architecture confidence ${(confidence * 100).toFixed(1)}% is below threshold`,
        suggestion: 'Review and refine feature definitions and technical requirements'
      });
    }
    
    validations.forEach(validation => {
      if (!validation.passed) {
        issues.push({
          severity: validation.score < 30 ? 'critical' : 'medium',
          type: validation.rule,
          description: `Architecture validation failed: ${validation.details}`,
          suggestion: 'Address the identified architectural gaps'
        });
      }
    });
    
    return issues;
  }

  private generateRecommendations(validations: ValidationResult[], issues: QualityIssue[]): string[] {
    const recommendations: string[] = [];
    
    if (issues.some(i => i.type === 'Feature Distribution')) {
      recommendations.push('Balance feature distribution across initiatives');
    }
    
    if (issues.some(i => i.type === 'User Journey Coverage')) {
      recommendations.push('Expand user journey mapping to cover more features');
    }
    
    if (issues.some(i => i.type === 'Component Architecture')) {
      recommendations.push('Improve component reusability and architectural balance');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Feature architecture is comprehensive and ready for epic breakdown');
    }
    
    return recommendations;
  }

  // ID generation methods
  private generateFeatureId(initiativeId: string, areaName: string): string {
    const sanitized = areaName.toLowerCase().replace(/\s+/g, '_');
    return `${initiativeId}_feat_${sanitized}_${Date.now()}`;
  }

  private generateJourneyId(persona: string): string {
    return `journey_${persona.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  }

  private generateStepId(stepName: string): string {
    return `step_${stepName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  }

  private generateComponentId(requirement: string): string {
    return `comp_${requirement.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  }

  private generateIntegrationId(pointName: string): string {
    return `integ_${pointName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  }
}

// === SUPPORTING INTERFACES ===

interface FeatureArea {
  name: string;
  type: 'functional' | 'non-functional' | 'integration';
  complexity: 'low' | 'medium' | 'high';
  userValue: 'low' | 'medium' | 'high';
  technicalRequirements: string[];
}

interface FeatureTemplate {
  name: string;
  baseUserStories: string[];
  acceptanceCriteria: string[];
  technicalRequirements: string[];
  platforms: string[];
}

interface JourneyPattern {
  name: string;
  typicalSteps: string[];
  successMetrics: string[];
}