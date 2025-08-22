/**
 * @caia/test-runner
 * Parallel test runner leveraging all CAIA utilities for maximum performance
 */

import { WorkDivider } from '@caia/work-divider';
import { ResourceCalculator } from '@caia/resource-calculator';
import { CoverageAggregator } from '@caia/coverage-aggregator';
import { MetricCollector } from '@caia/metric-collector';
import { ProgressTracker } from '@caia/progress-tracker';
import { TaskScheduler } from '@caia/task-scheduler';
import { DependencyAnalyzer } from '@caia/dependency-analyzer';
import { ReportGenerator } from '@caia/report-generator';
import { PatternRecognizer } from '@caia/pattern-recognizer';
// @ts-ignore - CCO might not have types yet
import { CCOrchestrator } from '@caia/cc-orchestrator';

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { glob } from 'glob';

export interface TestRunnerConfig {
  // Test discovery
  testPattern?: string;
  testMatch?: string[];
  testPathIgnorePatterns?: string[];
  rootDir?: string;
  
  // Parallelization
  maxWorkers?: number | 'auto';
  workerIdleMemoryLimit?: number;
  
  // Coverage
  collectCoverage?: boolean;
  coverageDirectory?: string;
  coverageThreshold?: {
    global?: {
      branches?: number;
      functions?: number;
      lines?: number;
      statements?: number;
    };
  };
  
  // Reporting
  reporters?: string[];
  outputDirectory?: string;
  verbose?: boolean;
  
  // Framework
  testFramework?: 'jest' | 'vitest' | 'mocha' | 'auto';
  
  // Performance
  bail?: boolean | number;
  timeout?: number;
  retries?: number;
  
  // Sharding
  shard?: string; // e.g., "1/3"
  shardStrategy?: 'round-robin' | 'duration' | 'complexity';
}

export interface TestFile {
  path: string;
  size: number;
  complexity?: number;
  estimatedDuration?: number;
  dependencies?: string[];
}

export interface TestResult {
  file: string;
  passed: boolean;
  duration: number;
  tests: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  };
  coverage?: any;
  errors?: Error[];
}

export interface TestReport {
  results: TestResult[];
  coverage?: any;
  metrics: any;
  duration: number;
  passed: boolean;
}

export class ParallelTestRunner extends EventEmitter {
  private config: TestRunnerConfig;
  private workDivider: WorkDivider;
  private resourceCalculator: ResourceCalculator;
  private coverageAggregator: CoverageAggregator;
  private metricCollector: MetricCollector;
  private progressTracker: ProgressTracker;
  private taskScheduler: TaskScheduler;
  private dependencyAnalyzer: DependencyAnalyzer;
  private reportGenerator: ReportGenerator;
  private patternRecognizer: PatternRecognizer;
  private cco?: CCOrchestrator;
  
  constructor(config: TestRunnerConfig = {}) {
    super();
    
    this.config = {
      testPattern: '**/*.{test,spec}.{js,ts,jsx,tsx}',
      maxWorkers: 'auto',
      collectCoverage: true,
      coverageDirectory: 'coverage',
      outputDirectory: 'test-results',
      verbose: false,
      testFramework: 'auto',
      bail: false,
      timeout: 5000,
      retries: 0,
      shardStrategy: 'complexity',
      ...config
    };
    
    // Initialize utilities
    this.workDivider = new WorkDivider();
    this.resourceCalculator = new ResourceCalculator();
    this.coverageAggregator = new CoverageAggregator();
    this.metricCollector = new MetricCollector();
    this.progressTracker = new ProgressTracker();
    this.taskScheduler = new TaskScheduler();
    this.dependencyAnalyzer = new DependencyAnalyzer();
    this.reportGenerator = new ReportGenerator();
    this.patternRecognizer = new PatternRecognizer();
    
    this.setupEventHandlers();
  }
  
  /**
   * Initialize CCO for parallel execution
   */
  private async initializeCCO(): Promise<void> {
    try {
      const resources = this.resourceCalculator.getAvailableResources();
      const optimalWorkers = this.config.maxWorkers === 'auto' 
        ? this.resourceCalculator.calculateOptimalWorkers()
        : this.config.maxWorkers;
      
      this.cco = new CCOrchestrator({
        maxInstances: optimalWorkers,
        taskTimeout: this.config.timeout,
        contextPreservation: true,
        debug: this.config.verbose
      });
      
      await this.cco.initialize();
      
      this.emit('cco:initialized', {
        workers: optimalWorkers,
        resources
      });
    } catch (error) {
      console.warn('CCO initialization failed, falling back to local execution:', error);
    }
  }
  
  /**
   * Discover test files
   */
  async discoverTestFiles(): Promise<TestFile[]> {
    const rootDir = this.config.rootDir || process.cwd();
    const pattern = path.join(rootDir, this.config.testPattern!);
    
    const files = await glob(pattern, {
      ignore: this.config.testPathIgnorePatterns || ['**/node_modules/**']
    });
    
    const testFiles: TestFile[] = await Promise.all(
      files.map(async (filePath) => {
        const stats = await fs.stat(filePath);
        
        // Analyze file for complexity
        const content = await fs.readFile(filePath, 'utf-8');
        const complexity = this.calculateTestComplexity(content);
        
        // Get dependencies
        const deps = await this.dependencyAnalyzer.analyzeDependencies(filePath);
        
        // Estimate duration based on historical data
        const pattern = await this.patternRecognizer.detectPatterns(
          [{ timestamp: Date.now(), value: stats.size }],
          { type: 'trend' }
        );
        
        return {
          path: filePath,
          size: stats.size,
          complexity,
          estimatedDuration: pattern[0]?.confidence || 1000,
          dependencies: deps.dependencies.map(d => d.source)
        };
      })
    );
    
    this.emit('discovery:complete', {
      count: testFiles.length,
      totalSize: testFiles.reduce((sum, f) => sum + f.size, 0)
    });
    
    return testFiles;
  }
  
  /**
   * Run tests in parallel
   */
  async run(): Promise<TestReport> {
    const startTime = Date.now();
    
    // Initialize CCO if available
    await this.initializeCCO();
    
    // Start resource monitoring
    this.resourceCalculator.startMonitoring(1000);
    
    // Discover test files
    const testFiles = await this.discoverTestFiles();
    
    // Create progress tracker
    const mainTracker = this.progressTracker.createProgressItem({
      id: 'main',
      label: 'Test Execution',
      total: testFiles.length
    });
    
    // Divide work intelligently
    const shards = await this.createTestShards(testFiles);
    
    // Schedule test execution
    const results = await this.executeTestShards(shards, mainTracker);
    
    // Aggregate coverage if enabled
    let coverage;
    if (this.config.collectCoverage) {
      coverage = await this.aggregateCoverage(results);
    }
    
    // Collect metrics
    const metrics = this.metricCollector.getMetrics();
    
    // Generate report
    const report = await this.generateReport(results, coverage, metrics);
    
    // Stop monitoring
    this.resourceCalculator.stopMonitoring();
    
    const duration = Date.now() - startTime;
    
    return {
      results,
      coverage,
      metrics,
      duration,
      passed: results.every(r => r.passed)
    };
  }
  
  /**
   * Create test shards based on strategy
   */
  private async createTestShards(testFiles: TestFile[]): Promise<any[]> {
    const workItems = testFiles.map(file => ({
      id: file.path,
      size: file.size,
      complexity: file.complexity,
      dependencies: file.dependencies,
      estimatedDuration: file.estimatedDuration
    }));
    
    let shards;
    
    switch (this.config.shardStrategy) {
      case 'duration':
        // Use historical duration data
        const patterns = await this.patternRecognizer.detectPatterns(
          testFiles.map(f => ({ timestamp: Date.now(), value: f.estimatedDuration || 1000 })),
          { type: 'trend' }
        );
        
        const maxDuration = Math.max(...testFiles.map(f => f.estimatedDuration || 1000));
        shards = this.workDivider.divideByComplexity(workItems, maxDuration / 4);
        break;
        
      case 'round-robin':
        const workers = this.resourceCalculator.calculateOptimalWorkers();
        shards = this.workDivider.divideBySize(workItems, workers);
        break;
        
      case 'complexity':
      default:
        const avgComplexity = workItems.reduce((sum, w) => sum + (w.complexity || 1), 0) / workItems.length;
        shards = this.workDivider.divideByComplexity(workItems, avgComplexity * 10);
        break;
    }
    
    // Apply shard filtering if specified
    if (this.config.shard) {
      const [current, total] = this.config.shard.split('/').map(Number);
      const shardSize = Math.ceil(shards.length / total);
      const start = (current - 1) * shardSize;
      const end = start + shardSize;
      shards = shards.slice(start, end);
    }
    
    this.emit('sharding:complete', {
      shards: shards.length,
      strategy: this.config.shardStrategy
    });
    
    return shards;
  }
  
  /**
   * Execute test shards in parallel
   */
  private async executeTestShards(shards: any[], tracker: any): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    // Create tasks for scheduler
    const tasks = shards.map((shard, index) => ({
      id: `shard-${index}`,
      priority: shard.items.length, // Prioritize larger shards
      dependencies: [],
      data: shard,
      execute: async () => {
        if (this.cco) {
          // Use CCO for execution
          return await this.cco.executeTask({
            type: 'test',
            data: shard,
            timeout: this.config.timeout
          });
        } else {
          // Fallback to local execution
          return await this.executeTestShard(shard);
        }
      }
    }));
    
    // Schedule and execute tasks
    await this.taskScheduler.addTasks(tasks);
    await this.taskScheduler.start();
    
    // Wait for all tasks to complete
    await new Promise<void>((resolve) => {
      this.taskScheduler.on('queue:empty', () => {
        resolve();
      });
    });
    
    // Collect results
    const completedTasks = this.taskScheduler.getCompletedTasks();
    completedTasks.forEach(task => {
      if (task.result) {
        results.push(...task.result);
      }
    });
    
    this.progressTracker.updateProgress(tracker.id, results.length);
    
    return results;
  }
  
  /**
   * Execute a single test shard
   */
  private async executeTestShard(shard: any): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    for (const item of shard.items) {
      const startTime = Date.now();
      
      try {
        // This would actually run the test using the appropriate framework
        // For now, simulate test execution
        const result: TestResult = {
          file: item.id,
          passed: Math.random() > 0.1, // 90% pass rate simulation
          duration: Date.now() - startTime,
          tests: {
            passed: Math.floor(Math.random() * 10) + 1,
            failed: Math.random() > 0.9 ? 1 : 0,
            skipped: Math.random() > 0.95 ? 1 : 0,
            total: 0
          }
        };
        
        result.tests.total = result.tests.passed + result.tests.failed + result.tests.skipped;
        
        // Simulate coverage data
        if (this.config.collectCoverage) {
          result.coverage = {
            lines: { total: 100, covered: Math.floor(Math.random() * 30) + 70 },
            branches: { total: 50, covered: Math.floor(Math.random() * 20) + 30 },
            functions: { total: 20, covered: Math.floor(Math.random() * 5) + 15 },
            statements: { total: 150, covered: Math.floor(Math.random() * 40) + 110 }
          };
        }
        
        results.push(result);
        
        // Record metrics
        this.metricCollector.recordMetric({
          name: 'test.duration',
          value: result.duration,
          unit: 'ms',
          tags: { file: item.id, passed: String(result.passed) }
        });
        
      } catch (error) {
        results.push({
          file: item.id,
          passed: false,
          duration: Date.now() - startTime,
          tests: { passed: 0, failed: 1, skipped: 0, total: 1 },
          errors: [error as Error]
        });
      }
    }
    
    return results;
  }
  
  /**
   * Aggregate coverage from all test results
   */
  private async aggregateCoverage(results: TestResult[]): Promise<any> {
    const coverageReports = results
      .filter(r => r.coverage)
      .map(r => r.coverage);
    
    if (coverageReports.length === 0) {
      return null;
    }
    
    const aggregated = await this.coverageAggregator.mergeCoverage(coverageReports);
    
    // Check thresholds if configured
    if (this.config.coverageThreshold?.global) {
      const thresholdResult = this.coverageAggregator.checkThresholds(
        aggregated,
        this.config.coverageThreshold.global
      );
      
      if (!thresholdResult.passed) {
        this.emit('coverage:threshold:failed', thresholdResult);
      }
    }
    
    return aggregated;
  }
  
  /**
   * Generate test report
   */
  private async generateReport(results: TestResult[], coverage: any, metrics: any): Promise<any> {
    const report = await this.reportGenerator.generateReport({
      title: 'Test Execution Report',
      sections: [
        {
          type: 'metrics',
          title: 'Summary',
          data: {
            'Total Tests': results.length,
            'Passed': results.filter(r => r.passed).length,
            'Failed': results.filter(r => !r.passed).length,
            'Duration': `${results.reduce((sum, r) => sum + r.duration, 0)}ms`,
            'Pass Rate': `${(results.filter(r => r.passed).length / results.length * 100).toFixed(2)}%`
          }
        },
        {
          type: 'table',
          title: 'Test Results',
          data: {
            headers: ['File', 'Status', 'Duration', 'Tests'],
            rows: results.map(r => [
              path.basename(r.file),
              r.passed ? '✅' : '❌',
              `${r.duration}ms`,
              `${r.tests.passed}/${r.tests.total}`
            ])
          }
        }
      ]
    });
    
    // Save report
    const outputPath = path.join(this.config.outputDirectory!, 'report.html');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, report.content);
    
    this.emit('report:generated', { path: outputPath });
    
    return report;
  }
  
  /**
   * Calculate test file complexity
   */
  private calculateTestComplexity(content: string): number {
    let complexity = 1;
    
    // Count test/describe/it blocks
    const testMatches = content.match(/\b(test|it|describe)\s*\(/g);
    if (testMatches) {
      complexity += testMatches.length * 0.5;
    }
    
    // Count assertions
    const assertMatches = content.match(/\b(expect|assert|should)\s*\(/g);
    if (assertMatches) {
      complexity += assertMatches.length * 0.1;
    }
    
    // Count async operations
    const asyncMatches = content.match(/\b(async|await|Promise)\b/g);
    if (asyncMatches) {
      complexity += asyncMatches.length * 0.2;
    }
    
    // Count mocks
    const mockMatches = content.match(/\b(mock|spy|stub)\b/gi);
    if (mockMatches) {
      complexity += mockMatches.length * 0.3;
    }
    
    return Math.round(complexity * 10) / 10;
  }
  
  /**
   * Setup event handlers for utilities
   */
  private setupEventHandlers(): void {
    // Resource calculator events
    this.resourceCalculator.on('bottlenecks', (bottlenecks) => {
      this.emit('resource:bottleneck', bottlenecks);
    });
    
    // Progress tracker events
    this.progressTracker.on('progress', (progress) => {
      this.emit('progress', progress);
    });
    
    // Task scheduler events
    this.taskScheduler.on('task:complete', (task) => {
      this.emit('test:complete', task);
    });
    
    this.taskScheduler.on('task:failed', (task, error) => {
      this.emit('test:failed', { task, error });
    });
    
    // Pattern recognizer events
    this.patternRecognizer.on('anomaly', (anomaly) => {
      this.emit('anomaly:detected', anomaly);
    });
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): any {
    return {
      resources: this.resourceCalculator.getAvailableResources(),
      metrics: this.metricCollector.getMetrics(),
      progress: this.progressTracker.getProgressItems(),
      scheduler: this.taskScheduler.getMetrics()
    };
  }
}

// Export types
export * from './types';

// Export default
export default ParallelTestRunner;