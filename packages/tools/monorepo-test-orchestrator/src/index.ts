/**
 * @caia/monorepo-test-orchestrator
 * Parallel testing orchestrator with live dashboard for entire monorepo
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import pLimit from 'p-limit';
import { glob } from 'glob';

// Import all our utilities
import { WorkDivider } from '@caia/work-divider';
import { ResourceCalculator } from '@caia/resource-calculator';
import { CoverageAggregator } from '@caia/coverage-aggregator';
import { MetricCollector } from '@caia/metric-collector';
import { ProgressTracker } from '@caia/progress-tracker';
import { TaskScheduler } from '@caia/task-scheduler';
import { DependencyAnalyzer } from '@caia/dependency-analyzer';
import { ReportEngine } from '@caia/report-generator';
import { PatternRecognizer } from '@caia/pattern-recognizer';

const execAsync = promisify(exec);

export interface Package {
  name: string;
  path: string;
  type: 'agent' | 'engine' | 'module' | 'util' | 'integration' | 'tool' | 'app';
  hasTests: boolean;
  testCommand: string;
  dependencies: string[];
  estimatedDuration?: number;
  lastTestDuration?: number;
  coverage?: number;
}

export interface TestResult {
  package: string;
  success: boolean;
  duration: number;
  tests: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
  errors?: string[];
}

export interface OrchestratorConfig {
  maxParallel?: number;
  coverageThreshold?: number;
  timeout?: number;
  bail?: boolean;
  watch?: boolean;
  dashboard?: boolean;
  dashboardPort?: number;
  verbose?: boolean;
  pattern?: string;
  exclude?: string[];
  testCommand?: string;
  useCCO?: boolean;
  shardStrategy?: 'size' | 'complexity' | 'dependencies' | 'history';
}

export interface TestProgress {
  totalPackages: number;
  completedPackages: number;
  runningPackages: string[];
  failedPackages: string[];
  passedPackages: string[];
  currentThroughput: number;
  estimatedTimeRemaining: number;
  coverage: {
    overall: number;
    byPackage: Map<string, number>;
  };
}

export class MonorepoTestOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private packages: Map<string, Package> = new Map();
  private results: Map<string, TestResult> = new Map();
  private startTime: number = 0;
  
  // Utility instances
  private workDivider: WorkDivider;
  private resourceCalculator: ResourceCalculator;
  private coverageAggregator: CoverageAggregator;
  private metricCollector: MetricCollector;
  private progressTracker: ProgressTracker;
  private taskScheduler: TaskScheduler;
  private dependencyAnalyzer: DependencyAnalyzer;
  private reportEngine: ReportEngine;
  private patternRecognizer: PatternRecognizer;
  
  constructor(config: OrchestratorConfig = {}) {
    super();
    
    this.config = {
      maxParallel: config.maxParallel || 'auto',
      coverageThreshold: config.coverageThreshold || 95,
      timeout: config.timeout || 300000, // 5 minutes
      bail: config.bail || false,
      watch: config.watch || false,
      dashboard: config.dashboard !== false,
      dashboardPort: config.dashboardPort || 3000,
      verbose: config.verbose || false,
      pattern: config.pattern || 'packages/**',
      exclude: config.exclude || ['**/node_modules/**', '**/dist/**'],
      testCommand: config.testCommand || 'npm test',
      useCCO: config.useCCO !== false,
      shardStrategy: config.shardStrategy || 'complexity'
    };
    
    // Initialize utilities
    this.workDivider = new WorkDivider();
    this.resourceCalculator = new ResourceCalculator();
    this.coverageAggregator = new CoverageAggregator();
    this.metricCollector = new MetricCollector();
    this.progressTracker = new ProgressTracker();
    this.taskScheduler = new TaskScheduler();
    this.dependencyAnalyzer = new DependencyAnalyzer();
    this.reportEngine = new ReportEngine();
    this.patternRecognizer = new PatternRecognizer();
  }
  
  /**
   * Discover all packages in the monorepo
   */
  async discoverPackages(): Promise<Package[]> {
    this.emit('discovery:start');
    
    const packagePaths = await glob(this.config.pattern + '/package.json', {
      ignore: this.config.exclude
    });
    
    const packages: Package[] = [];
    
    for (const pkgPath of packagePaths) {
      const packageJson = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      const packageDir = path.dirname(pkgPath);
      const relativePath = path.relative(process.cwd(), packageDir);
      
      // Determine package type from path
      let type: Package['type'] = 'util';
      if (relativePath.includes('agents')) type = 'agent';
      else if (relativePath.includes('engines')) type = 'engine';
      else if (relativePath.includes('modules')) type = 'module';
      else if (relativePath.includes('integrations')) type = 'integration';
      else if (relativePath.includes('tools')) type = 'tool';
      else if (relativePath.includes('apps')) type = 'app';
      
      // Check if package has tests
      const hasTests = !!(
        packageJson.scripts?.test ||
        await this.checkForTestFiles(packageDir)
      );
      
      const pkg: Package = {
        name: packageJson.name,
        path: packageDir,
        type,
        hasTests,
        testCommand: packageJson.scripts?.test ? 'npm test' : this.config.testCommand,
        dependencies: Object.keys(packageJson.dependencies || {})
          .filter(dep => dep.startsWith('@caia/')),
        estimatedDuration: await this.estimateTestDuration(packageDir),
        coverage: 0
      };
      
      packages.push(pkg);
      this.packages.set(pkg.name, pkg);
    }
    
    this.emit('discovery:complete', { packages });
    return packages;
  }
  
  /**
   * Check if directory has test files
   */
  private async checkForTestFiles(dir: string): Promise<boolean> {
    const testPatterns = [
      '**/*.test.{js,ts,jsx,tsx}',
      '**/*.spec.{js,ts,jsx,tsx}',
      '**/__tests__/**/*.{js,ts,jsx,tsx}'
    ];
    
    for (const pattern of testPatterns) {
      const files = await glob(path.join(dir, pattern), {
        ignore: ['**/node_modules/**']
      });
      if (files.length > 0) return true;
    }
    
    return false;
  }
  
  /**
   * Estimate test duration based on file size and complexity
   */
  private async estimateTestDuration(dir: string): Promise<number> {
    // Use pattern recognizer to analyze test complexity
    const testFiles = await glob(path.join(dir, '**/*.test.*'), {
      ignore: ['**/node_modules/**']
    });
    
    if (testFiles.length === 0) return 1000; // 1 second for no tests
    
    // Estimate based on number of test files
    const baseTime = 2000; // 2 seconds base
    const perFileTime = 500; // 500ms per test file
    
    return baseTime + (testFiles.length * perFileTime);
  }
  
  /**
   * Create optimal test execution plan
   */
  async createExecutionPlan(packages: Package[]): Promise<any> {
    this.emit('planning:start');
    
    // Analyze dependencies
    const dependencyGraph = await this.dependencyAnalyzer.analyzeDependencies(
      packages.map(p => ({
        id: p.name,
        path: p.path,
        dependencies: p.dependencies
      }))
    );
    
    // Calculate optimal workers
    const optimalWorkers = this.config.maxParallel === 'auto'
      ? await this.resourceCalculator.calculateOptimalWorkers()
      : this.config.maxParallel;
    
    // Divide work based on strategy
    const workItems = packages.map(pkg => ({
      id: pkg.name,
      size: pkg.estimatedDuration || 1000,
      complexity: this.calculatePackageComplexity(pkg),
      dependencies: pkg.dependencies,
      priority: this.calculatePackagePriority(pkg)
    }));
    
    let shards;
    switch (this.config.shardStrategy) {
      case 'dependencies':
        shards = this.workDivider.divideByDependencies(workItems, dependencyGraph);
        break;
      case 'size':
        shards = this.workDivider.divideBySize(workItems, optimalWorkers);
        break;
      case 'complexity':
      default:
        const threshold = workItems.reduce((sum, item) => sum + item.complexity, 0) / optimalWorkers;
        shards = this.workDivider.divideByComplexity(workItems, threshold);
    }
    
    this.emit('planning:complete', { 
      shards, 
      workers: optimalWorkers,
      strategy: this.config.shardStrategy 
    });
    
    return {
      shards,
      workers: optimalWorkers,
      dependencyGraph,
      estimatedDuration: Math.max(...shards.map(s => s.estimatedDuration))
    };
  }
  
  /**
   * Calculate package complexity for sharding
   */
  private calculatePackageComplexity(pkg: Package): number {
    let complexity = 1;
    
    // Factor in package type
    const typeWeights = {
      agent: 3,
      engine: 2.5,
      module: 2,
      integration: 2.5,
      tool: 1.5,
      util: 1,
      app: 3
    };
    complexity *= typeWeights[pkg.type];
    
    // Factor in dependencies
    complexity += pkg.dependencies.length * 0.5;
    
    // Factor in estimated duration
    if (pkg.estimatedDuration) {
      complexity += Math.log10(pkg.estimatedDuration);
    }
    
    return complexity;
  }
  
  /**
   * Calculate package priority for execution order
   */
  private calculatePackagePriority(pkg: Package): number {
    // Utilities and modules should run first (dependencies)
    const typePriority = {
      util: 10,
      module: 9,
      engine: 7,
      integration: 5,
      agent: 3,
      tool: 2,
      app: 1
    };
    
    return typePriority[pkg.type];
  }
  
  /**
   * Execute tests for all packages in parallel
   */
  async execute(): Promise<TestResult[]> {
    this.startTime = Date.now();
    this.emit('execution:start');
    
    // Discover packages
    const packages = await this.discoverPackages();
    const testablePackages = packages.filter(p => p.hasTests);
    
    if (testablePackages.length === 0) {
      this.emit('execution:complete', { results: [] });
      return [];
    }
    
    // Create execution plan
    const plan = await this.createExecutionPlan(testablePackages);
    
    // Initialize progress tracking
    const progressId = this.progressTracker.createProgress(
      'monorepo-tests',
      testablePackages.length
    );
    
    // Set up concurrency limit
    const limit = pLimit(plan.workers);
    
    // Execute tests in parallel with proper sharding
    const results: TestResult[] = [];
    
    for (const shard of plan.shards) {
      const shardPromises = shard.items.map(item =>
        limit(async () => {
          const pkg = this.packages.get(item.id);
          if (!pkg) return null;
          
          this.emit('test:start', { package: pkg.name });
          this.progressTracker.updateProgress(progressId, {
            message: `Testing ${pkg.name}...`
          });
          
          try {
            const result = await this.runPackageTests(pkg);
            results.push(result);
            this.results.set(pkg.name, result);
            
            this.progressTracker.incrementProgress(progressId);
            this.emit('test:complete', { package: pkg.name, result });
            
            // Check if we should bail
            if (this.config.bail && !result.success) {
              throw new Error(`Tests failed for ${pkg.name}, bailing out`);
            }
            
            return result;
          } catch (error) {
            const result: TestResult = {
              package: pkg.name,
              success: false,
              duration: 0,
              tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
              errors: [error.message]
            };
            
            results.push(result);
            this.results.set(pkg.name, result);
            
            this.emit('test:failed', { package: pkg.name, error });
            
            if (this.config.bail) {
              throw error;
            }
            
            return result;
          }
        })
      );
      
      // Wait for shard to complete before moving to next
      await Promise.all(shardPromises);
    }
    
    // Aggregate coverage
    const overallCoverage = await this.coverageAggregator.aggregate(
      results.map(r => ({
        file: r.package,
        coverage: r.coverage
      })).filter(r => r.coverage)
    );
    
    // Generate final report
    const report = await this.generateReport(results, overallCoverage);
    
    this.emit('execution:complete', { results, report });
    
    return results;
  }
  
  /**
   * Run tests for a single package
   */
  private async runPackageTests(pkg: Package): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      // Run test command
      const { stdout, stderr } = await execAsync(pkg.testCommand, {
        cwd: pkg.path,
        timeout: this.config.timeout,
        env: {
          ...process.env,
          CI: 'true',
          FORCE_COLOR: '0'
        }
      });
      
      // Parse test output (this would be more sophisticated in production)
      const result = this.parseTestOutput(stdout + stderr);
      
      return {
        package: pkg.name,
        success: result.failed === 0,
        duration: Date.now() - startTime,
        tests: {
          total: result.total,
          passed: result.passed,
          failed: result.failed,
          skipped: result.skipped
        },
        coverage: result.coverage
      };
      
    } catch (error) {
      return {
        package: pkg.name,
        success: false,
        duration: Date.now() - startTime,
        tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
        errors: [error.message]
      };
    }
  }
  
  /**
   * Parse test output to extract metrics
   */
  private parseTestOutput(output: string): any {
    // Simple parsing - would be more sophisticated in production
    const result = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      coverage: null
    };
    
    // Parse Jest output format
    const testMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
    if (testMatch) {
      result.failed = parseInt(testMatch[1]);
      result.passed = parseInt(testMatch[2]);
      result.total = parseInt(testMatch[3]);
    }
    
    // Parse coverage
    const coverageMatch = output.match(/Lines\s+:\s+([\d.]+)%/);
    if (coverageMatch) {
      result.coverage = {
        lines: parseFloat(coverageMatch[1]),
        branches: 0,
        functions: 0,
        statements: 0
      };
      
      const branchMatch = output.match(/Branches\s+:\s+([\d.]+)%/);
      if (branchMatch) result.coverage.branches = parseFloat(branchMatch[1]);
      
      const funcMatch = output.match(/Functions\s+:\s+([\d.]+)%/);
      if (funcMatch) result.coverage.functions = parseFloat(funcMatch[1]);
      
      const stmtMatch = output.match(/Statements\s+:\s+([\d.]+)%/);
      if (stmtMatch) result.coverage.statements = parseFloat(stmtMatch[1]);
    }
    
    return result;
  }
  
  /**
   * Generate comprehensive test report
   */
  private async generateReport(results: TestResult[], coverage: any): Promise<any> {
    const duration = Date.now() - this.startTime;
    
    const report = {
      summary: {
        totalPackages: results.length,
        passed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        duration,
        coverage: coverage?.summary || null
      },
      results,
      coverage,
      timestamp: new Date().toISOString()
    };
    
    // Use report engine to generate formatted reports
    await this.reportEngine.generateReport({
      data: report,
      template: 'test-results',
      format: 'html',
      outputPath: 'test-results/monorepo-report.html'
    });
    
    return report;
  }
  
  /**
   * Get current test progress
   */
  getProgress(): TestProgress {
    const completed = Array.from(this.results.values());
    const running = Array.from(this.packages.values())
      .filter(p => !this.results.has(p.name) && p.hasTests)
      .map(p => p.name);
    
    const failed = completed.filter(r => !r.success).map(r => r.package);
    const passed = completed.filter(r => r.success).map(r => r.package);
    
    const coverageByPackage = new Map<string, number>();
    completed.forEach(r => {
      if (r.coverage) {
        coverageByPackage.set(r.package, r.coverage.lines);
      }
    });
    
    const overallCoverage = coverageByPackage.size > 0
      ? Array.from(coverageByPackage.values()).reduce((a, b) => a + b, 0) / coverageByPackage.size
      : 0;
    
    const throughput = completed.length / ((Date.now() - this.startTime) / 1000);
    const remaining = this.packages.size - completed.length;
    const estimatedTimeRemaining = remaining / throughput * 1000;
    
    return {
      totalPackages: this.packages.size,
      completedPackages: completed.length,
      runningPackages: running,
      failedPackages: failed,
      passedPackages: passed,
      currentThroughput: throughput,
      estimatedTimeRemaining,
      coverage: {
        overall: overallCoverage,
        byPackage: coverageByPackage
      }
    };
  }
}

export default MonorepoTestOrchestrator;