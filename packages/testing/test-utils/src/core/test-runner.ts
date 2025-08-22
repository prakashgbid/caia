/**
 * @fileoverview Advanced test runner utilities for CAIA
 * Provides enhanced testing capabilities beyond basic Jest
 */

import { performance } from 'perf_hooks';

export interface TestSuite {
  name: string;
  tests: TestCase[];
  setup?: () => Promise<void> | void;
  teardown?: () => Promise<void> | void;
  parallel?: boolean;
}

export interface TestCase {
  name: string;
  fn: () => Promise<void> | void;
  timeout?: number;
  skip?: boolean;
  only?: boolean;
}

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: Error;
  performance?: PerformanceMetrics;
}

export interface PerformanceMetrics {
  memoryUsage: NodeJS.MemoryUsage;
  executionTime: number;
  cpuUsage?: NodeJS.CpuUsage;
}

/**
 * Enhanced test runner with performance monitoring
 */
export class CAIATestRunner {
  private results: TestResult[] = [];
  private startTime: number = 0;

  /**
   * Run a test suite with enhanced monitoring
   */
  async runSuite(suite: TestSuite): Promise<TestResult[]> {
    console.log(`\n🧪 Running test suite: ${suite.name}`);
    this.startTime = performance.now();

    // Setup
    if (suite.setup) {
      await this.executeWithErrorHandling('Setup', suite.setup);
    }

    try {
      if (suite.parallel) {
        await this.runTestsInParallel(suite.tests);
      } else {
        await this.runTestsSequentially(suite.tests);
      }
    } finally {
      // Teardown
      if (suite.teardown) {
        await this.executeWithErrorHandling('Teardown', suite.teardown);
      }
    }

    this.printResults();
    return this.results;
  }

  /**
   * Run tests in parallel for faster execution
   */
  private async runTestsInParallel(tests: TestCase[]): Promise<void> {
    const promises = tests
      .filter(test => !test.skip)
      .map(test => this.runSingleTest(test));

    await Promise.allSettled(promises);
  }

  /**
   * Run tests sequentially for isolated execution
   */
  private async runTestsSequentially(tests: TestCase[]): Promise<void> {
    for (const test of tests) {
      if (!test.skip) {
        await this.runSingleTest(test);
      }
    }
  }

  /**
   * Run a single test with performance monitoring
   */
  private async runSingleTest(test: TestCase): Promise<void> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();
    const startCpu = process.cpuUsage();

    try {
      // Set timeout if specified
      if (test.timeout) {
        await Promise.race([
          this.executeTest(test),
          this.createTimeoutPromise(test.timeout, test.name)
        ]);
      } else {
        await this.executeTest(test);
      }

      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const endCpu = process.cpuUsage(startCpu);

      this.results.push({
        name: test.name,
        passed: true,
        duration: endTime - startTime,
        performance: {
          memoryUsage: endMemory,
          executionTime: endTime - startTime,
          cpuUsage: endCpu
        }
      });

      console.log(`✅ ${test.name} (${(endTime - startTime).toFixed(2)}ms)`);
    } catch (error) {
      const endTime = performance.now();
      
      this.results.push({
        name: test.name,
        passed: false,
        duration: endTime - startTime,
        error: error as Error
      });

      console.log(`❌ ${test.name} (${(endTime - startTime).toFixed(2)}ms)`);
      console.error(`   Error: ${(error as Error).message}`);
    }
  }

  /**
   * Execute test function with proper error handling
   */
  private async executeTest(test: TestCase): Promise<void> {
    const result = test.fn();
    if (result instanceof Promise) {
      await result;
    }
  }

  /**
   * Create timeout promise for test execution
   */
  private createTimeoutPromise(timeout: number, testName: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Test "${testName}" timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Execute function with error handling
   */
  private async executeWithErrorHandling(
    context: string, 
    fn: () => Promise<void> | void
  ): Promise<void> {
    try {
      const result = fn();
      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      console.error(`❌ ${context} failed:`, error);
      throw error;
    }
  }

  /**
   * Print test results summary
   */
  private printResults(): void {
    const totalTime = performance.now() - this.startTime;
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;

    console.log(`\n📊 Test Results:`);
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⏱️  Total time: ${totalTime.toFixed(2)}ms`);

    if (failed > 0) {
      console.log(`\n💥 Failed tests:`);
      this.results
        .filter(r => !r.passed)
        .forEach(result => {
          console.log(`   - ${result.name}: ${result.error?.message}`);
        });
    }
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): PerformanceStats {
    const validResults = this.results.filter(r => r.performance);
    
    return {
      averageExecutionTime: this.calculateAverage(validResults.map(r => r.duration)),
      totalExecutionTime: validResults.reduce((sum, r) => sum + r.duration, 0),
      memoryPeak: Math.max(...validResults.map(r => r.performance!.memoryUsage.heapUsed)),
      testCount: this.results.length,
      passRate: (this.results.filter(r => r.passed).length / this.results.length) * 100
    };
  }

  private calculateAverage(numbers: number[]): number {
    return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
  }
}

export interface PerformanceStats {
  averageExecutionTime: number;
  totalExecutionTime: number;
  memoryPeak: number;
  testCount: number;
  passRate: number;
}

/**
 * Utility function to create a test suite
 */
export function createTestSuite(name: string, options?: Partial<TestSuite>): TestSuite {
  return {
    name,
    tests: [],
    parallel: false,
    ...options
  };
}

/**
 * Utility function to create a test case
 */
export function createTestCase(name: string, fn: () => Promise<void> | void, options?: Partial<TestCase>): TestCase {
  return {
    name,
    fn,
    timeout: 5000,
    ...options
  };
}