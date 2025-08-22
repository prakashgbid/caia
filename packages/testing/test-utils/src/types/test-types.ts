/**
 * @fileoverview TypeScript type definitions for CAIA testing utilities
 * Provides comprehensive type safety for testing infrastructure
 */

// Core test types
export interface TestContext {
  testId: string;
  testName: string;
  startTime: number;
  metadata?: Record<string, any>;
}

export interface TestEnvironment {
  name: string;
  config: Record<string, any>;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

export interface TestAssertion {
  description: string;
  actual: any;
  expected: any;
  passed: boolean;
  error?: Error;
}

// Agent testing types
export interface AgentTestCase {
  agent: AgentTestConfig;
  scenario: TestScenario;
  expectations: AgentExpectations;
}

export interface AgentTestConfig {
  id: string;
  type: string;
  capabilities: string[];
  configuration?: Record<string, any>;
}

export interface TestScenario {
  name: string;
  description: string;
  inputs: any[];
  preconditions?: TestCondition[];
  postconditions?: TestCondition[];
}

export interface AgentExpectations {
  shouldSucceed: boolean;
  expectedOutputs?: any[];
  performanceThresholds?: PerformanceThresholds;
  sideEffects?: SideEffectExpectation[];
}

export interface TestCondition {
  description: string;
  check: () => boolean | Promise<boolean>;
}

export interface PerformanceThresholds {
  maxExecutionTime?: number;
  maxMemoryUsage?: number;
  minThroughput?: number;
  maxCpuUsage?: number;
}

export interface SideEffectExpectation {
  type: 'file' | 'network' | 'database' | 'event';
  description: string;
  verify: () => boolean | Promise<boolean>;
}

// Integration test types
export interface IntegrationTestSuite {
  name: string;
  services: ServiceConfig[];
  testCases: IntegrationTestCase[];
  environment: TestEnvironment;
}

export interface ServiceConfig {
  name: string;
  type: 'agent' | 'api' | 'database' | 'queue';
  config: Record<string, any>;
  healthCheck: () => Promise<boolean>;
}

export interface IntegrationTestCase {
  name: string;
  workflow: WorkflowStep[];
  assertions: IntegrationAssertion[];
  cleanup?: () => Promise<void>;
}

export interface WorkflowStep {
  service: string;
  action: string;
  inputs: any;
  expectedOutputs?: any;
  timeout?: number;
}

export interface IntegrationAssertion {
  type: 'response' | 'state' | 'performance' | 'sideEffect';
  description: string;
  verify: (context: any) => boolean | Promise<boolean>;
}

// Performance test types
export interface PerformanceTestConfig {
  name: string;
  target: TestTarget;
  loadProfile: LoadProfile;
  metrics: MetricConfig[];
  thresholds: PerformanceThresholds;
}

export interface TestTarget {
  type: 'agent' | 'api' | 'workflow';
  identifier: string;
  configuration?: Record<string, any>;
}

export interface LoadProfile {
  type: 'constant' | 'ramp' | 'spike' | 'stress';
  duration: number;
  concurrency: number;
  rampUpTime?: number;
  rampDownTime?: number;
}

export interface MetricConfig {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'timer';
  unit: string;
  collector: () => number | Promise<number>;
}

// Mock types
export interface MockConfiguration {
  name: string;
  type: MockType;
  behavior: MockBehavior;
  persistence?: boolean;
}

export type MockType = 'agent' | 'api' | 'database' | 'filesystem' | 'network';

export interface MockBehavior {
  defaultResponse?: any;
  responses?: MockResponse[];
  latency?: LatencyConfig;
  reliability?: ReliabilityConfig;
}

export interface MockResponse {
  condition: (input: any) => boolean;
  response: any;
  delay?: number;
}

export interface LatencyConfig {
  min: number;
  max: number;
  distribution: 'uniform' | 'normal' | 'exponential';
}

export interface ReliabilityConfig {
  successRate: number;
  errorTypes?: ErrorType[];
}

export interface ErrorType {
  type: string;
  probability: number;
  error: Error | (() => Error);
}

// Test data types
export interface TestFixture {
  name: string;
  type: FixtureType;
  data: any;
  dependencies?: string[];
}

export type FixtureType = 'agent' | 'request' | 'response' | 'configuration' | 'data';

export interface TestDataBuilder<T> {
  build(): T;
  with(property: keyof T, value: T[keyof T]): TestDataBuilder<T>;
  withDefaults(): TestDataBuilder<T>;
  withRandomData(): TestDataBuilder<T>;
}

// Coverage types
export interface CoverageConfig {
  types: CoverageType[];
  thresholds: CoverageThresholds;
  exclusions?: string[];
  outputFormats: OutputFormat[];
}

export type CoverageType = 'line' | 'branch' | 'function' | 'statement';

export interface CoverageThresholds {
  global: number;
  perFile?: number;
  perFunction?: number;
}

export type OutputFormat = 'text' | 'html' | 'lcov' | 'json';

export interface CoverageReport {
  summary: CoverageSummary;
  files: FileCoverage[];
  timestamp: Date;
}

export interface CoverageSummary {
  lines: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
  statements: CoverageMetric;
}

export interface CoverageMetric {
  total: number;
  covered: number;
  percentage: number;
}

export interface FileCoverage {
  path: string;
  lines: CoverageMetric;
  branches: CoverageMetric;
  functions: FunctionCoverage[];
}

export interface FunctionCoverage {
  name: string;
  line: number;
  called: boolean;
  callCount: number;
}

// Validation types
export interface ValidationRule {
  name: string;
  description: string;
  validate: (value: any) => ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
  value?: any;
}

export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

export interface SchemaValidator {
  validate(data: any, schema: any): ValidationResult;
  addRule(rule: ValidationRule): void;
  removeRule(ruleName: string): void;
}

// Utility types
export interface TestUtils {
  waitFor: (condition: () => boolean, timeout?: number) => Promise<void>;
  retry: <T>(fn: () => Promise<T>, attempts?: number) => Promise<T>;
  timeout: <T>(promise: Promise<T>, ms: number) => Promise<T>;
  delay: (ms: number) => Promise<void>;
}

export interface TestLogger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: Error): void;
  test(testName: string, result: TestResult): void;
}

export interface TestResult {
  name: string;
  status: TestStatus;
  duration: number;
  assertions: TestAssertion[];
  error?: Error;
  metadata?: Record<string, any>;
}

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'pending';

// Event types
export interface TestEvent {
  type: TestEventType;
  timestamp: Date;
  testId: string;
  data?: any;
}

export type TestEventType = 
  | 'test:start'
  | 'test:end'
  | 'test:pass'
  | 'test:fail'
  | 'test:skip'
  | 'suite:start'
  | 'suite:end'
  | 'assertion:pass'
  | 'assertion:fail';

export interface TestEventListener {
  (event: TestEvent): void | Promise<void>;
}

// Configuration types
export interface TestConfiguration {
  timeout: number;
  retries: number;
  parallel: boolean;
  coverage: CoverageConfig;
  reporting: ReportingConfig;
  environment: Record<string, any>;
}

export interface ReportingConfig {
  formats: ReportFormat[];
  outputDir: string;
  includeLogs: boolean;
  includeMetadata: boolean;
}

export type ReportFormat = 'junit' | 'json' | 'html' | 'text';