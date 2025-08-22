/**
 * Type definitions for @caia/test-runner
 */

export interface TestFrameworkAdapter {
  name: string;
  detectConfig(): Promise<FrameworkConfig>;
  parseTestFiles(): Promise<TestSuite[]>;
  executeTests(files: string[], options: TestOptions): Promise<TestResult[]>;
  collectCoverage(): Promise<CoverageData>;
}

export interface FrameworkConfig {
  configFile?: string;
  setupFiles?: string[];
  testEnvironment?: string;
  transform?: Record<string, string>;
  moduleNameMapper?: Record<string, string>;
}

export interface TestSuite {
  file: string;
  name: string;
  tests: Test[];
}

export interface Test {
  id: string;
  name: string;
  suite: string;
  file: string;
  timeout?: number;
  retry?: number;
}

export interface TestOptions {
  bail?: boolean;
  timeout?: number;
  retries?: number;
  coverage?: boolean;
  updateSnapshots?: boolean;
  verbose?: boolean;
}

export interface CoverageData {
  [file: string]: {
    path: string;
    statementMap: any;
    fnMap: any;
    branchMap: any;
    s: Record<string, number>;
    f: Record<string, number>;
    b: Record<string, number[]>;
  };
}

export interface TestMetrics {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDuration: number;
  averageDuration: number;
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
}

export interface TestPlan {
  shards: TestShard[];
  estimatedDuration: number;
  workerCount: number;
  strategy: string;
}

export interface TestShard {
  id: string;
  files: string[];
  estimatedDuration: number;
  workerId: number;
}

export interface TestIntelligence {
  analyzeTestHistory(): TestMetrics;
  predictTestDuration(test: Test): number;
  optimizeDistribution(tests: Test[], workers: number): TestShard[];
  identifyCriticalPaths(): Test[];
}