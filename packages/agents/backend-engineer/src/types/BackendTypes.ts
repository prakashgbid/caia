/**
 * Type definitions for Backend Engineer Agent
 * Comprehensive types for backend development, APIs, databases, and infrastructure
 */

export interface ApiSpecification {
  id: string;
  name: string;
  version: string;
  description: string;
  baseUrl: string;
  endpoints: ApiEndpoint[];
  authentication: AuthenticationType;
  rateLimit: RateLimitConfiguration;
  versioning: VersioningStrategy;
  documentation: DocumentationConfiguration;
  errorHandling: ErrorHandlingConfiguration;
  validation: ValidationConfiguration;
  createdAt: Date;
}

export interface ApiEndpoint {
  id: string;
  path: string;
  method: HttpMethod;
  summary: string;
  description: string;
  parameters: ApiParameter[];
  requestBody?: RequestBodyConfiguration;
  responses: ApiResponse[];
  security: SecurityRequirement[];
  tags: string[];
  deprecated?: boolean;
}

export interface DatabaseSchema {
  id: string;
  name: string;
  type: DatabaseType;
  version: string;
  tables: TableDefinition[];
  relationships: Relationship[];
  indexes: IndexDefinition[];
  constraints: ConstraintDefinition[];
  triggers: TriggerDefinition[];
  views: ViewDefinition[];
  procedures: ProcedureDefinition[];
  migrations: MigrationDefinition[];
  seedData: SeedDataDefinition[];
  createdAt: Date;
}

export interface MicroserviceArchitecture {
  id: string;
  name: string;
  domain: string;
  services: ServiceDefinition[];
  boundaries: BoundaryDefinition[];
  communication: CommunicationPattern[];
  dataConsistency: ConsistencyStrategy;
  serviceDiscovery: ServiceDiscoveryConfiguration;
  loadBalancing: LoadBalancingConfiguration;
  monitoring: MonitoringConfiguration;
  logging: LoggingConfiguration;
  tracing: TracingConfiguration;
  resilience: ResilienceConfiguration;
  deployment: DeploymentConfiguration;
  createdAt: Date;
}

export interface AuthenticationSystem {
  id: string;
  strategy: AuthenticationStrategy;
  providers: AuthenticationProvider[];
  configuration: AuthenticationConfiguration;
  security: SecurityConfiguration;
  session: SessionConfiguration;
  token: TokenConfiguration;
  mfa: MFAConfiguration;
  oauth: OAuthConfiguration;
  sso: SSOConfiguration;
  createdAt: Date;
}

export interface MessageQueueConfiguration {
  id: string;
  broker: MessageBroker;
  patterns: MessagingPattern[];
  exchanges: ExchangeConfiguration[];
  queues: QueueConfiguration[];
  routing: RoutingConfiguration[];
  consumers: ConsumerConfiguration[];
  producers: ProducerConfiguration[];
  deadLetterQueues: DeadLetterConfiguration[];
  monitoring: QueueMonitoringConfiguration;
  createdAt: Date;
}

export interface ServerConfiguration {
  webServer: WebServerConfiguration;
  applicationServer: ApplicationServerConfiguration;
  loadBalancer: LoadBalancerConfiguration;
  ssl: SSLConfiguration;
  firewall: FirewallConfiguration;
  monitoring: InfrastructureMonitoringConfiguration;
  deployment: DeploymentScriptConfiguration;
}

export interface BackendImplementation {
  api: ApiImplementation;
  database: DatabaseImplementation;
  services: ServiceImplementation[];
  middleware: MiddlewareImplementation[];
  tests: TestImplementation;
  documentation: DocumentationImplementation;
  deployment: DeploymentImplementation;
}

export interface DataModel {
  entities: EntityDefinition[];
  valueObjects: ValueObjectDefinition[];
  aggregates: AggregateDefinition[];
  repositories: RepositoryDefinition[];
  services: DomainServiceDefinition[];
  events: DomainEventDefinition[];
}

export interface BusinessLogic {
  services: BusinessServiceDefinition[];
  workflows: WorkflowDefinition[];
  validations: ValidationRuleDefinition[];
  rules: BusinessRuleDefinition[];
  events: BusinessEventDefinition[];
  aggregates: AggregateRootDefinition[];
}

export interface IntegrationConfiguration {
  adapters: IntegrationAdapterDefinition[];
  clients: ApiClientDefinition[];
  transformers: DataTransformerDefinition[];
  errorHandling: IntegrationErrorHandlingDefinition;
  monitoring: IntegrationMonitoringDefinition;
  testing: IntegrationTestingDefinition;
}

export interface SecurityConfiguration {
  threats: ThreatDefinition[];
  controls: SecurityControlDefinition[];
  compliance: ComplianceRequirementDefinition[];
  measures: SecurityMeasureDefinition[];
  vulnerabilities: VulnerabilityAssessment[];
  policies: SecurityPolicyDefinition[];
}

export interface PerformanceConfiguration {
  targets: PerformanceTargetDefinition[];
  optimizations: PerformanceOptimizationDefinition[];
  monitoring: PerformanceMonitoringDefinition;
  caching: CachingConfiguration;
  scaling: ScalingConfiguration;
  bottlenecks: BottleneckAnalysis[];
}

export interface MonitoringConfiguration {
  metrics: MetricDefinition[];
  alerting: AlertingConfiguration;
  dashboards: DashboardConfiguration[];
  logging: LoggingConfiguration;
  tracing: TracingConfiguration;
  apm: APMConfiguration;
  tools: MonitoringToolConfiguration;
}

// Enums

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  OPTIONS = 'OPTIONS',
  HEAD = 'HEAD'
}

export enum DatabaseType {
  POSTGRESQL = 'postgresql',
  MYSQL = 'mysql',
  MONGODB = 'mongodb',
  REDIS = 'redis',
  ELASTICSEARCH = 'elasticsearch',
  CASSANDRA = 'cassandra',
  DYNAMODB = 'dynamodb'
}

export enum AuthenticationType {
  JWT = 'jwt',
  OAUTH2 = 'oauth2',
  BASIC = 'basic',
  BEARER = 'bearer',
  API_KEY = 'api_key',
  COOKIE = 'cookie'
}

export enum MessageBroker {
  RABBITMQ = 'rabbitmq',
  KAFKA = 'kafka',
  REDIS = 'redis',
  AWS_SQS = 'aws_sqs',
  AZURE_SERVICE_BUS = 'azure_service_bus',
  GOOGLE_PUBSUB = 'google_pubsub'
}

export enum MessagingPattern {
  PUB_SUB = 'pub_sub',
  WORK_QUEUE = 'work_queue',
  REQUEST_REPLY = 'request_reply',
  SAGA = 'saga',
  EVENT_SOURCING = 'event_sourcing'
}

export enum AuthenticationStrategy {
  LOCAL = 'local',
  LDAP = 'ldap',
  OAUTH2 = 'oauth2',
  SAML = 'saml',
  JWT = 'jwt'
}

export enum ConsistencyStrategy {
  STRONG = 'strong',
  EVENTUAL = 'eventual',
  WEAK = 'weak'
}

export enum VersioningStrategy {
  URL = 'url',
  HEADER = 'header',
  QUERY = 'query',
  CONTENT_TYPE = 'content_type'
}

// Supporting interface definitions (simplified for brevity)

export interface ApiParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required: boolean;
  schema: any;
  description?: string;
}

export interface RequestBodyConfiguration {
  required: boolean;
  content: any;
  description?: string;
}

export interface ApiResponse {
  statusCode: number;
  description: string;
  content?: any;
  headers?: any;
}

export interface SecurityRequirement {
  type: string;
  scopes?: string[];
}

export interface RateLimitConfiguration {
  enabled: boolean;
  requests: number;
  window: string;
  strategy: 'fixed' | 'sliding';
}

export interface DocumentationConfiguration {
  format: 'openapi' | 'swagger' | 'apiblueprint';
  ui: boolean;
  playground: boolean;
}

export interface ErrorHandlingConfiguration {
  format: 'rfc7807' | 'custom';
  logging: boolean;
  monitoring: boolean;
}

export interface ValidationConfiguration {
  library: 'joi' | 'yup' | 'zod';
  strategies: string[];
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  primaryKey: string[];
  foreignKeys: ForeignKeyDefinition[];
  indexes: string[];
  constraints: string[];
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: any;
  unique: boolean;
  autoIncrement: boolean;
}

export interface Relationship {
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  fromTable: string;
  toTable: string;
  foreignKey: string;
  onDelete: 'cascade' | 'restrict' | 'set null';
}

export interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  type: 'btree' | 'hash' | 'gin' | 'gist';
}

export interface ConstraintDefinition {
  name: string;
  type: 'check' | 'unique' | 'foreign_key';
  definition: string;
}

export interface TriggerDefinition {
  name: string;
  table: string;
  event: 'insert' | 'update' | 'delete';
  timing: 'before' | 'after';
  function: string;
}

export interface ViewDefinition {
  name: string;
  query: string;
  materialized: boolean;
}

export interface ProcedureDefinition {
  name: string;
  parameters: ParameterDefinition[];
  body: string;
  language: string;
}

export interface MigrationDefinition {
  version: string;
  up: string;
  down: string;
  description: string;
}

export interface SeedDataDefinition {
  table: string;
  data: any[];
}

export interface ServiceDefinition {
  name: string;
  description: string;
  responsibilities: string[];
  apis: string[];
  dependencies: string[];
  database: string;
  technology: string;
}

export interface BoundaryDefinition {
  name: string;
  services: string[];
  context: string;
  isolation: string;
}

export interface CommunicationPattern {
  type: 'synchronous' | 'asynchronous';
  protocol: string;
  format: string;
}

export interface ServiceDiscoveryConfiguration {
  tool: 'consul' | 'eureka' | 'etcd';
  healthChecks: boolean;
  loadBalancing: boolean;
}

export interface LoadBalancingConfiguration {
  algorithm: 'round-robin' | 'least-connections' | 'ip-hash';
  healthChecks: boolean;
  failover: boolean;
}

export interface ResilienceConfiguration {
  circuitBreaker: boolean;
  retry: RetryConfiguration;
  timeout: TimeoutConfiguration;
  bulkhead: boolean;
}

export interface RetryConfiguration {
  maxAttempts: number;
  backoff: 'fixed' | 'exponential';
  baseDelay: number;
}

export interface TimeoutConfiguration {
  connection: number;
  request: number;
  circuit: number;
}

export interface AuthenticationConfiguration {
  passwordPolicy: PasswordPolicyConfiguration;
  lockout: LockoutConfiguration;
  session: SessionConfiguration;
}

export interface PasswordPolicyConfiguration {
  minLength: number;
  requireSpecialChars: boolean;
  requireNumbers: boolean;
  requireUppercase: boolean;
  expirationDays: number;
}

export interface LockoutConfiguration {
  maxAttempts: number;
  lockoutDuration: number;
  resetOnSuccess: boolean;
}

export interface SessionConfiguration {
  timeout: number;
  storage: 'memory' | 'redis' | 'database';
  secure: boolean;
}

export interface TokenConfiguration {
  algorithm: string;
  expiration: string;
  refresh: boolean;
  blacklist: boolean;
}

export interface MFAConfiguration {
  enabled: boolean;
  methods: string[];
  required: boolean;
}

export interface OAuthConfiguration {
  providers: OAuthProviderConfiguration[];
  scopes: string[];
  pkce: boolean;
}

export interface OAuthProviderConfiguration {
  name: string;
  clientId: string;
  scope: string[];
  redirectUri: string;
}

export interface SSOConfiguration {
  enabled: boolean;
  protocol: 'saml' | 'oidc';
  provider: string;
}

export interface ExchangeConfiguration {
  name: string;
  type: 'direct' | 'topic' | 'fanout' | 'headers';
  durable: boolean;
  autoDelete: boolean;
}

export interface QueueConfiguration {
  name: string;
  durable: boolean;
  exclusive: boolean;
  autoDelete: boolean;
  deadLetter: boolean;
}

export interface RoutingConfiguration {
  exchange: string;
  queue: string;
  routingKey: string;
}

export interface ConsumerConfiguration {
  queue: string;
  prefetch: number;
  autoAck: boolean;
  retries: number;
}

export interface ProducerConfiguration {
  exchange: string;
  routingKey: string;
  persistent: boolean;
  confirmations: boolean;
}

export interface DeadLetterConfiguration {
  exchange: string;
  queue: string;
  ttl: number;
  maxRetries: number;
}

export interface QueueMonitoringConfiguration {
  metrics: string[];
  alerts: AlertConfiguration[];
  dashboard: boolean;
}

export interface AlertConfiguration {
  metric: string;
  threshold: number;
  operator: 'gt' | 'lt' | 'eq';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface WebServerConfiguration {
  type: 'nginx' | 'apache' | 'iis';
  port: number;
  ssl: boolean;
  compression: boolean;
  caching: boolean;
}

export interface ApplicationServerConfiguration {
  type: 'nodejs' | 'java' | 'python' | 'dotnet';
  instances: number;
  memory: string;
  cpu: string;
}

export interface LoadBalancerConfiguration {
  type: 'nginx' | 'haproxy' | 'aws-alb';
  algorithm: string;
  healthChecks: boolean;
}

export interface SSLConfiguration {
  certificate: string;
  privateKey: string;
  chain: string;
  protocols: string[];
}

export interface FirewallConfiguration {
  rules: FirewallRule[];
  defaultPolicy: 'allow' | 'deny';
}

export interface FirewallRule {
  port: number;
  protocol: 'tcp' | 'udp';
  source: string;
  action: 'allow' | 'deny';
}

export interface InfrastructureMonitoringConfiguration {
  cpu: boolean;
  memory: boolean;
  disk: boolean;
  network: boolean;
  processes: boolean;
}

export interface DeploymentScriptConfiguration {
  type: 'bash' | 'powershell' | 'ansible' | 'docker';
  scripts: string[];
  environment: string;
}

// More interface definitions would continue here...
// This represents a comprehensive but not exhaustive set of types for backend engineering

export interface ForeignKeyDefinition {
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: string;
  onUpdate: string;
}

export interface ParameterDefinition {
  name: string;
  type: string;
  direction: 'in' | 'out' | 'inout';
}

export interface AuthenticationProvider {
  name: string;
  type: string;
  configuration: any;
}

export interface ApiImplementation {
  framework: string;
  language: string;
  files: CodeFile[];
}

export interface DatabaseImplementation {
  migrations: string[];
  models: CodeFile[];
  repositories: CodeFile[];
}

export interface ServiceImplementation {
  name: string;
  files: CodeFile[];
}

export interface MiddlewareImplementation {
  name: string;
  files: CodeFile[];
}

export interface TestImplementation {
  unit: CodeFile[];
  integration: CodeFile[];
  e2e: CodeFile[];
}

export interface DocumentationImplementation {
  api: string;
  readme: string;
  deployment: string;
}

export interface DeploymentImplementation {
  scripts: CodeFile[];
  configurations: CodeFile[];
}

export interface CodeFile {
  path: string;
  content: string;
  language: string;
}

export interface EntityDefinition {
  name: string;
  properties: PropertyDefinition[];
  methods: MethodDefinition[];
}

export interface PropertyDefinition {
  name: string;
  type: string;
  nullable: boolean;
  validation: ValidationRule[];
}

export interface MethodDefinition {
  name: string;
  parameters: ParameterDefinition[];
  returnType: string;
  body: string;
}

export interface ValidationRule {
  type: string;
  message: string;
  parameters: any;
}

export interface ValueObjectDefinition {
  name: string;
  properties: PropertyDefinition[];
  equality: string;
  validation: ValidationRule[];
}

export interface AggregateDefinition {
  name: string;
  root: string;
  entities: string[];
  valueObjects: string[];
  invariants: string[];
}

export interface RepositoryDefinition {
  name: string;
  entity: string;
  methods: RepositoryMethodDefinition[];
}

export interface RepositoryMethodDefinition {
  name: string;
  parameters: ParameterDefinition[];
  returnType: string;
  query: string;
}

export interface DomainServiceDefinition {
  name: string;
  methods: MethodDefinition[];
  dependencies: string[];
}

export interface DomainEventDefinition {
  name: string;
  properties: PropertyDefinition[];
  aggregateId: string;
}

export interface BusinessServiceDefinition {
  name: string;
  operations: BusinessOperationDefinition[];
  dependencies: string[];
}

export interface BusinessOperationDefinition {
  name: string;
  input: string;
  output: string;
  rules: string[];
  workflow: string;
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStepDefinition[];
  conditions: WorkflowConditionDefinition[];
}

export interface WorkflowStepDefinition {
  name: string;
  type: 'task' | 'decision' | 'parallel' | 'subprocess';
  implementation: string;
  nextStep: string;
}

export interface WorkflowConditionDefinition {
  expression: string;
  trueStep: string;
  falseStep: string;
}

export interface ValidationRuleDefinition {
  name: string;
  expression: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface BusinessRuleDefinition {
  name: string;
  condition: string;
  action: string;
  priority: number;
}

export interface BusinessEventDefinition {
  name: string;
  trigger: string;
  payload: PropertyDefinition[];
  handlers: string[];
}

export interface AggregateRootDefinition {
  name: string;
  identifier: string;
  commands: CommandDefinition[];
  events: string[];
  invariants: string[];
}

export interface CommandDefinition {
  name: string;
  parameters: ParameterDefinition[];
  validation: ValidationRule[];
  events: string[];
}

export interface IntegrationAdapterDefinition {
  name: string;
  externalSystem: string;
  protocol: string;
  methods: IntegrationMethodDefinition[];
}

export interface IntegrationMethodDefinition {
  name: string;
  operation: string;
  mapping: DataMappingDefinition;
  errorHandling: ErrorHandlingStrategy;
}

export interface DataMappingDefinition {
  input: PropertyMappingDefinition[];
  output: PropertyMappingDefinition[];
  transformations: TransformationDefinition[];
}

export interface PropertyMappingDefinition {
  source: string;
  target: string;
  transformation?: string;
}

export interface TransformationDefinition {
  name: string;
  type: 'convert' | 'format' | 'calculate' | 'lookup';
  expression: string;
}

export interface ErrorHandlingStrategy {
  retries: number;
  timeout: number;
  fallback: string;
  circuit: boolean;
}

export interface ApiClientDefinition {
  name: string;
  baseUrl: string;
  authentication: string;
  methods: ClientMethodDefinition[];
}

export interface ClientMethodDefinition {
  name: string;
  endpoint: string;
  method: string;
  parameters: ParameterDefinition[];
  responseType: string;
}

export interface DataTransformerDefinition {
  name: string;
  input: string;
  output: string;
  transformations: TransformationDefinition[];
}

export interface IntegrationErrorHandlingDefinition {
  strategies: ErrorHandlingStrategy[];
  monitoring: boolean;
  alerting: boolean;
  logging: boolean;
}

export interface IntegrationMonitoringDefinition {
  metrics: string[];
  healthChecks: boolean;
  performance: boolean;
  availability: boolean;
}

export interface IntegrationTestingDefinition {
  mocks: MockDefinition[];
  contracts: ContractDefinition[];
  endToEnd: boolean;
}

export interface MockDefinition {
  service: string;
  endpoints: MockEndpointDefinition[];
}

export interface MockEndpointDefinition {
  path: string;
  method: string;
  response: any;
  latency: number;
}

export interface ContractDefinition {
  provider: string;
  consumer: string;
  interactions: InteractionDefinition[];
}

export interface InteractionDefinition {
  description: string;
  request: any;
  response: any;
}

export interface ThreatDefinition {
  name: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  mitigations: string[];
}

export interface SecurityControlDefinition {
  name: string;
  type: 'preventive' | 'detective' | 'corrective';
  implementation: string;
  coverage: string[];
}

export interface ComplianceRequirementDefinition {
  standard: string;
  controls: string[];
  evidence: string[];
  assessment: string;
}

export interface SecurityMeasureDefinition {
  name: string;
  category: string;
  implementation: string;
  testing: string;
}

export interface VulnerabilityAssessment {
  type: 'static' | 'dynamic' | 'dependency';
  tools: string[];
  frequency: string;
  reporting: boolean;
}

export interface SecurityPolicyDefinition {
  name: string;
  scope: string;
  rules: PolicyRuleDefinition[];
  enforcement: string;
}

export interface PolicyRuleDefinition {
  condition: string;
  action: 'allow' | 'deny' | 'log';
  message: string;
}

export interface PerformanceTargetDefinition {
  metric: string;
  target: number;
  threshold: number;
  measurement: string;
}

export interface PerformanceOptimizationDefinition {
  area: string;
  technique: string;
  impact: string;
  effort: string;
}

export interface PerformanceMonitoringDefinition {
  metrics: string[];
  intervals: string;
  alerting: boolean;
  profiling: boolean;
}

export interface CachingConfiguration {
  layers: CachingLayerDefinition[];
  strategies: CachingStrategyDefinition[];
  invalidation: CacheInvalidationDefinition;
}

export interface CachingLayerDefinition {
  name: string;
  type: 'memory' | 'redis' | 'cdn' | 'database';
  ttl: number;
  size: string;
}

export interface CachingStrategyDefinition {
  pattern: 'cache-aside' | 'write-through' | 'write-behind' | 'refresh-ahead';
  keys: string[];
  conditions: string[];
}

export interface CacheInvalidationDefinition {
  triggers: string[];
  strategies: string[];
  cascading: boolean;
}

export interface ScalingConfiguration {
  horizontal: HorizontalScalingDefinition;
  vertical: VerticalScalingDefinition;
  autoscaling: AutoscalingDefinition;
}

export interface HorizontalScalingDefinition {
  enabled: boolean;
  minInstances: number;
  maxInstances: number;
  triggers: string[];
}

export interface VerticalScalingDefinition {
  enabled: boolean;
  cpu: ResourceLimitDefinition;
  memory: ResourceLimitDefinition;
}

export interface ResourceLimitDefinition {
  min: string;
  max: string;
  default: string;
}

export interface AutoscalingDefinition {
  enabled: boolean;
  metrics: string[];
  thresholds: any;
  cooldown: number;
}

export interface BottleneckAnalysis {
  area: string;
  description: string;
  impact: string;
  solutions: string[];
}

export interface MetricDefinition {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  labels: string[];
  description: string;
}

export interface AlertingConfiguration {
  rules: AlertRuleDefinition[];
  channels: NotificationChannelDefinition[];
  escalation: EscalationPolicyDefinition[];
}

export interface AlertRuleDefinition {
  name: string;
  condition: string;
  severity: string;
  duration: string;
  annotations: any;
}

export interface NotificationChannelDefinition {
  name: string;
  type: 'email' | 'slack' | 'webhook' | 'pagerduty';
  configuration: any;
}

export interface EscalationPolicyDefinition {
  name: string;
  steps: EscalationStepDefinition[];
}

export interface EscalationStepDefinition {
  delay: number;
  targets: string[];
  type: 'notify' | 'escalate';
}

export interface DashboardConfiguration {
  name: string;
  panels: DashboardPanelDefinition[];
  variables: DashboardVariableDefinition[];
}

export interface DashboardPanelDefinition {
  title: string;
  type: 'graph' | 'table' | 'stat' | 'gauge';
  queries: string[];
  visualization: any;
}

export interface DashboardVariableDefinition {
  name: string;
  type: 'query' | 'const' | 'interval';
  query: string;
  default: string;
}

export interface LoggingConfiguration {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'text';
  destinations: LogDestinationDefinition[];
  structured: boolean;
}

export interface LogDestinationDefinition {
  type: 'console' | 'file' | 'elasticsearch' | 'cloudwatch';
  configuration: any;
}

export interface TracingConfiguration {
  enabled: boolean;
  sampler: TracingSamplerDefinition;
  exporter: TracingExporterDefinition;
  instrumentation: string[];
}

export interface TracingSamplerDefinition {
  type: 'const' | 'probabilistic' | 'rate';
  configuration: any;
}

export interface TracingExporterDefinition {
  type: 'jaeger' | 'zipkin' | 'otlp';
  endpoint: string;
  configuration: any;
}

export interface APMConfiguration {
  enabled: boolean;
  agent: string;
  features: string[];
  sampling: number;
}

export interface MonitoringToolConfiguration {
  metrics: string;
  logs: string;
  traces: string;
  apm: string;
  dashboards: string;
}

export interface DeploymentConfiguration {
  strategy: 'blue-green' | 'rolling' | 'canary' | 'recreate';
  environments: EnvironmentConfiguration[];
  pipeline: PipelineConfiguration;
  rollback: RollbackConfiguration;
}

export interface EnvironmentConfiguration {
  name: string;
  resources: ResourceConfiguration;
  variables: EnvironmentVariableDefinition[];
  secrets: SecretDefinition[];
}

export interface ResourceConfiguration {
  cpu: string;
  memory: string;
  storage: string;
  replicas: number;
}

export interface EnvironmentVariableDefinition {
  name: string;
  value: string;
  secret: boolean;
}

export interface SecretDefinition {
  name: string;
  type: 'tls' | 'generic' | 'docker-registry';
  data: any;
}

export interface PipelineConfiguration {
  stages: PipelineStageDefinition[];
  triggers: PipelineTriggerDefinition[];
  artifacts: ArtifactDefinition[];
}

export interface PipelineStageDefinition {
  name: string;
  type: 'build' | 'test' | 'deploy' | 'approval';
  script: string;
  dependencies: string[];
}

export interface PipelineTriggerDefinition {
  type: 'git' | 'schedule' | 'manual';
  configuration: any;
}

export interface ArtifactDefinition {
  name: string;
  type: 'docker' | 'binary' | 'package';
  location: string;
}

export interface RollbackConfiguration {
  enabled: boolean;
  automatic: boolean;
  conditions: string[];
  retention: number;
}