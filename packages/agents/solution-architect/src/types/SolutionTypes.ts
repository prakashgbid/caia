/**
 * Type definitions for Solution Architect Agent
 * Comprehensive types for solution design, architecture, and technical planning
 */

export interface SystemArchitecture {
  id: string;
  name: string;
  description: string;
  components: ArchitecturalComponent[];
  layers: ArchitecturalLayer[];
  patterns: ArchitecturalPattern[];
  dataFlow: DataFlowDiagram;
  constraints: ArchitecturalConstraint[];
  qualityAttributes: QualityAttribute[];
  createdAt: Date;
  version: string;
}

export interface ArchitecturalComponent {
  id: string;
  name: string;
  type: ComponentType;
  description: string;
  responsibilities: string[];
  interfaces: ComponentInterface[];
  dependencies: ComponentDependency[];
  technologies: string[];
  scalabilityCharacteristics: ScalabilityCharacteristics;
  securityRequirements: string[];
}

export interface ArchitecturalLayer {
  id: string;
  name: string;
  type: LayerType;
  components: string[]; // Component IDs
  responsibilities: string[];
  interfaces: LayerInterface[];
  constraints: string[];
}

export interface ArchitecturalPattern {
  id: string;
  name: string;
  type: PatternType;
  description: string;
  applicableComponents: string[];
  benefits: string[];
  tradeoffs: string[];
  implementation: PatternImplementation;
}

export interface TechnologyStack {
  id: string;
  name: string;
  description: string;
  technologies: Technology[];
  frameworks: Framework[];
  databases: Database[];
  infrastructure: InfrastructureComponent[];
  devOpsTools: DevOpseTool[];
  monitoringTools: MonitoringTool[];
  securityTools: SecurityTool[];
  rationale: SelectionRationale[];
}

export interface Technology {
  id: string;
  name: string;
  category: TechnologyCategory;
  version: string;
  description: string;
  maturityLevel: MaturityLevel;
  communitySupport: CommunitySupport;
  licenseType: LicenseType;
  performanceCharacteristics: PerformanceCharacteristics;
  scalabilitySupport: ScalabilitySupport;
  securityFeatures: string[];
  maintenanceComplexity: ComplexityLevel;
  learningCurve: ComplexityLevel;
  ecosystemSupport: EcosystemSupport;
}

export interface SecurityRequirements {
  id: string;
  threatModel: ThreatModel;
  securityControls: SecurityControl[];
  complianceRequirements: ComplianceRequirement[];
  authenticationStrategy: AuthenticationStrategy;
  authorizationStrategy: AuthorizationStrategy;
  dataProtection: DataProtectionStrategy;
  networkSecurity: NetworkSecurityStrategy;
  auditingRequirements: AuditingRequirement[];
  incidentResponse: IncidentResponsePlan;
}

export interface PerformanceRequirements {
  id: string;
  responseTimeTargets: ResponseTimeTarget[];
  throughputTargets: ThroughputTarget[];
  scalabilityRequirements: ScalabilityRequirement[];
  availabilityTargets: AvailabilityTarget[];
  reliabilityTargets: ReliabilityTarget[];
  capacityPlanning: CapacityPlan;
  performanceTestingStrategy: PerformanceTestingStrategy;
  monitoringStrategy: PerformanceMonitoringStrategy;
}

export interface IntegrationPattern {
  id: string;
  name: string;
  type: IntegrationPatternType;
  description: string;
  components: string[];
  benefits: string[];
  tradeoffs: string[];
  implementationGuidance: string[];
  securityConsiderations: string[];
  performanceImplications: string[];
}

export interface ArchitecturalDecision {
  id: string;
  title: string;
  status: DecisionStatus;
  context: string;
  decision: string;
  rationale: string;
  consequences: string[];
  alternatives: Alternative[];
  stakeholders: string[];
  decidedAt: Date;
  decidedBy: string;
  reviewDate?: Date;
}

export interface SolutionDesign {
  id: string;
  architecture: SystemArchitecture;
  technologyStack: TechnologyStack;
  securityArchitecture: SecurityRequirements;
  performanceArchitecture: PerformanceRequirements;
  integrationPatterns: IntegrationPattern[];
  decisions: ArchitecturalDecision[];
  recommendations: Recommendation[];
  createdAt: Date;
  version: string;
}

export interface RiskAssessment {
  id: string;
  risks: Risk[];
  overallRiskLevel: RiskLevel;
  mitigationStrategies: MitigationStrategy[];
  assessmentDate: Date;
}

export interface CostEstimation {
  id: string;
  developmentCosts: CostBreakdown;
  infrastructureCosts: CostBreakdown;
  operationalCosts: CostBreakdown;
  maintenanceCosts: CostBreakdown;
  totalCostOfOwnership: TCOAnalysis;
  costOptimizationRecommendations: CostOptimization[];
  estimationDate: Date;
  assumptions: string[];
}

export interface ComplianceRequirement {
  id: string;
  regulation: string;
  description: string;
  applicableComponents: string[];
  controlRequirements: ControlRequirement[];
  implementationGuidance: string[];
  verificationMethods: string[];
  documentationRequired: string[];
}

// Supporting types

export enum ComponentType {
  UI_COMPONENT = 'ui-component',
  SERVICE = 'service',
  DATABASE = 'database',
  API_GATEWAY = 'api-gateway',
  MESSAGE_QUEUE = 'message-queue',
  CACHE = 'cache',
  LOAD_BALANCER = 'load-balancer',
  AUTHENTICATION_SERVICE = 'auth-service',
  MONITORING_SERVICE = 'monitoring-service'
}

export enum LayerType {
  PRESENTATION = 'presentation',
  APPLICATION = 'application',
  BUSINESS = 'business',
  DATA_ACCESS = 'data-access',
  INFRASTRUCTURE = 'infrastructure'
}

export enum PatternType {
  ARCHITECTURAL = 'architectural',
  DESIGN = 'design',
  INTEGRATION = 'integration',
  SECURITY = 'security',
  PERFORMANCE = 'performance'
}

export enum TechnologyCategory {
  FRONTEND_FRAMEWORK = 'frontend-framework',
  BACKEND_FRAMEWORK = 'backend-framework',
  DATABASE = 'database',
  MESSAGE_BROKER = 'message-broker',
  CACHE = 'cache',
  MONITORING = 'monitoring',
  SECURITY = 'security',
  DEVOPS = 'devops',
  INFRASTRUCTURE = 'infrastructure'
}

export enum MaturityLevel {
  EXPERIMENTAL = 'experimental',
  EMERGING = 'emerging',
  MATURE = 'mature',
  LEGACY = 'legacy'
}

export enum ComplexityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum DecisionStatus {
  PROPOSED = 'proposed',
  ACCEPTED = 'accepted',
  DEPRECATED = 'deprecated',
  SUPERSEDED = 'superseded'
}

export enum IntegrationPatternType {
  SYNCHRONOUS = 'synchronous',
  ASYNCHRONOUS = 'asynchronous',
  EVENT_DRIVEN = 'event-driven',
  REQUEST_RESPONSE = 'request-response',
  PUBLISH_SUBSCRIBE = 'publish-subscribe',
  GATEWAY = 'gateway'
}

export enum LicenseType {
  OPEN_SOURCE = 'open-source',
  COMMERCIAL = 'commercial',
  FREEMIUM = 'freemium',
  ENTERPRISE = 'enterprise'
}

// Detailed interface definitions

export interface ComponentInterface {
  id: string;
  name: string;
  type: 'API' | 'EVENT' | 'DATABASE' | 'FILE';
  protocol: string;
  specification: any; // OpenAPI, AsyncAPI, etc.
  securityRequirements: string[];
}

export interface ComponentDependency {
  componentId: string;
  dependencyType: 'USES' | 'CALLS' | 'SUBSCRIBES_TO' | 'PUBLISHES_TO';
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  fallbackStrategy?: string;
}

export interface ScalabilityCharacteristics {
  horizontalScaling: boolean;
  verticalScaling: boolean;
  autoScaling: boolean;
  maxInstances?: number;
  scalingTriggers: string[];
}

export interface LayerInterface {
  name: string;
  description: string;
  contracts: string[];
}

export interface PatternImplementation {
  steps: string[];
  codeExamples: { [language: string]: string };
  configurationExamples: any;
  bestPractices: string[];
}

export interface Framework {
  name: string;
  category: string;
  version: string;
  purpose: string;
  pros: string[];
  cons: string[];
}

export interface Database {
  name: string;
  type: 'SQL' | 'NoSQL' | 'Graph' | 'Time-series' | 'Search';
  useCase: string;
  scalabilityFeatures: string[];
  consistencyModel: string;
}

export interface InfrastructureComponent {
  name: string;
  category: 'COMPUTE' | 'STORAGE' | 'NETWORK' | 'CONTAINER' | 'SERVERLESS';
  provider: string;
  scalingCharacteristics: string[];
  costModel: string;
}

export interface DevOpseTool {
  name: string;
  category: 'CI/CD' | 'DEPLOYMENT' | 'MONITORING' | 'LOGGING' | 'TESTING';
  purpose: string;
  integrations: string[];
}

export interface MonitoringTool {
  name: string;
  type: 'APM' | 'INFRASTRUCTURE' | 'LOGS' | 'METRICS' | 'TRACING';
  capabilities: string[];
  alertingFeatures: string[];
}

export interface SecurityTool {
  name: string;
  category: 'SAST' | 'DAST' | 'DEPENDENCY' | 'RUNTIME' | 'COMPLIANCE';
  capabilities: string[];
  integrations: string[];
}

export interface SelectionRationale {
  technology: string;
  reasons: string[];
  alternatives: string[];
  tradeoffs: string[];
  risksAndMitigations: string[];
}

export interface CommunitySupport {
  documentation: 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT';
  communitySize: 'SMALL' | 'MEDIUM' | 'LARGE';
  activeContributors: number;
  issueResponseTime: string;
  stackOverflowQuestions: number;
}

export interface PerformanceCharacteristics {
  throughput: string;
  latency: string;
  memoryUsage: string;
  cpuUsage: string;
  benchmarkResults?: any;
}

export interface ScalabilitySupport {
  horizontalScaling: boolean;
  verticalScaling: boolean;
  clustering: boolean;
  loadBalancing: boolean;
  distributedFeatures: string[];
}

export interface EcosystemSupport {
  plugins: number;
  extensions: number;
  integrations: string[];
  thirdPartySupport: 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT';
}

export interface ThreatModel {
  threats: Threat[];
  attackVectors: AttackVector[];
  vulnerabilities: Vulnerability[];
  riskAssessment: SecurityRiskAssessment;
}

export interface SecurityControl {
  id: string;
  name: string;
  type: 'PREVENTIVE' | 'DETECTIVE' | 'CORRECTIVE';
  description: string;
  implementation: string[];
  effectiveness: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface AuthenticationStrategy {
  mechanisms: string[];
  protocols: string[];
  multiFactorAuth: boolean;
  singleSignOn: boolean;
  tokenStrategy: string;
}

export interface AuthorizationStrategy {
  model: 'RBAC' | 'ABAC' | 'PBAC';
  granularity: 'COARSE' | 'FINE';
  implementation: string[];
}

export interface DataProtectionStrategy {
  encryptionAtRest: boolean;
  encryptionInTransit: boolean;
  keyManagement: string;
  dataClassification: string[];
  privacyControls: string[];
}

export interface NetworkSecurityStrategy {
  networkSegmentation: boolean;
  firewallRules: string[];
  vpnRequirements: boolean;
  dnsSecurityFeatures: string[];
}

export interface AuditingRequirement {
  eventTypes: string[];
  retentionPeriod: string;
  logFormat: string;
  complianceMapping: string[];
}

export interface IncidentResponsePlan {
  phases: string[];
  escalationProcedures: string[];
  communicationPlan: string[];
  recoveryProcedures: string[];
}

export interface ResponseTimeTarget {
  operation: string;
  target: string;
  percentile: number;
  conditions: string[];
}

export interface ThroughputTarget {
  operation: string;
  target: string;
  conditions: string[];
  scalingRequirements: string[];
}

export interface ScalabilityRequirement {
  dimension: 'USERS' | 'DATA' | 'TRANSACTIONS' | 'GEOGRAPHY';
  currentScale: string;
  targetScale: string;
  timeline: string;
  constraints: string[];
}

export interface AvailabilityTarget {
  service: string;
  target: string; // e.g., "99.9%"
  downTimeAllowance: string;
  maintenanceWindows: string[];
}

export interface ReliabilityTarget {
  service: string;
  errorRate: string;
  recoveryTime: string;
  failureToleranceStrategy: string[];
}

export interface CapacityPlan {
  currentCapacity: any;
  projectedGrowth: any;
  capacityTargets: any;
  scalingStrategy: string[];
}

export interface PerformanceTestingStrategy {
  testTypes: string[];
  testEnvironments: string[];
  testData: string[];
  successCriteria: string[];
}

export interface PerformanceMonitoringStrategy {
  metrics: string[];
  alertingRules: string[];
  dashboards: string[];
  reportingFrequency: string;
}

export interface Alternative {
  option: string;
  pros: string[];
  cons: string[];
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string;
  impact: string;
  effort: string;
  timeline: string;
  dependencies: string[];
}

export interface Risk {
  id: string;
  category: 'TECHNICAL' | 'SECURITY' | 'PERFORMANCE' | 'OPERATIONAL' | 'COMPLIANCE';
  level: RiskLevel;
  description: string;
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  probability: 'LOW' | 'MEDIUM' | 'HIGH';
  components: string[];
  triggers: string[];
}

export interface MitigationStrategy {
  riskId: string;
  strategy: string;
  actions: string[];
  timeline: string;
  owner: string;
  cost?: string;
  effectiveness: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface CostBreakdown {
  items: CostItem[];
  subtotal: number;
  currency: string;
  period: 'MONTHLY' | 'YEARLY' | 'ONE_TIME';
}

export interface CostItem {
  name: string;
  category: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  notes?: string;
}

export interface TCOAnalysis {
  timeHorizon: string;
  totalCost: number;
  yearlyBreakdown: { [year: string]: number };
  costDrivers: string[];
  savingsOpportunities: string[];
}

export interface CostOptimization {
  area: string;
  description: string;
  potentialSavings: string;
  implementationEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  impact: string;
}

export interface ControlRequirement {
  controlId: string;
  description: string;
  implementationApproach: string[];
  verificationMethod: string;
  documentation: string[];
}

export interface DataFlowDiagram {
  entities: DataEntity[];
  processes: DataProcess[];
  dataStores: DataStore[];
  flows: DataFlow[];
}

export interface DataEntity {
  id: string;
  name: string;
  type: 'EXTERNAL' | 'INTERNAL';
  description: string;
}

export interface DataProcess {
  id: string;
  name: string;
  description: string;
  inputs: string[];
  outputs: string[];
  transformations: string[];
}

export interface DataStore {
  id: string;
  name: string;
  type: string;
  description: string;
  dataRetention: string;
  accessPatterns: string[];
}

export interface DataFlow {
  id: string;
  from: string;
  to: string;
  dataType: string;
  protocol: string;
  security: string[];
  volume: string;
}

export interface QualityAttribute {
  name: string;
  description: string;
  measurableRequirements: string[];
  designStrategies: string[];
  tradeoffs: string[];
}

export interface ArchitecturalConstraint {
  type: 'TECHNICAL' | 'BUSINESS' | 'REGULATORY' | 'OPERATIONAL';
  description: string;
  impact: string[];
  workarounds?: string[];
}

export interface Threat {
  id: string;
  name: string;
  description: string;
  likelihood: 'LOW' | 'MEDIUM' | 'HIGH';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  category: string;
}

export interface AttackVector {
  name: string;
  description: string;
  techniques: string[];
  mitigations: string[];
}

export interface Vulnerability {
  id: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  cweId?: string;
  affectedComponents: string[];
  mitigations: string[];
}

export interface SecurityRiskAssessment {
  overallRisk: RiskLevel;
  riskFactors: string[];
  priorityThreats: string[];
  recommendedControls: string[];
}