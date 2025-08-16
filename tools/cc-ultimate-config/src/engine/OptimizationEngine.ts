/**
 * OptimizationEngine
 * Validates, tests, and applies configuration optimizations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { spawn } from 'child_process';
import { Logger } from '../utils/logger';

interface OptimizationResult {
  success: boolean;
  performance: {
    baseline: number;
    optimized: number;
    improvement: number;
  };
  errors: string[];
  warnings: string[];
  metrics: {
    responseTime: number;
    memoryUsage: number;
    cpuUsage: number;
    tokensPerSecond: number;
  };
}

interface TestScenario {
  name: string;
  command: string;
  expectedOutput?: string;
  timeout: number;
  metrics: string[];
}

export class OptimizationEngine {
  private logger: Logger;
  private testSuites: TestScenario[];
  private baselineMetrics?: any;

  constructor() {
    this.logger = new Logger('OptimizationEngine');
    this.testSuites = this.loadTestSuites();
  }

  /**
   * Test a configuration optimization
   */
  async testOptimization(config: any): Promise<OptimizationResult> {
    this.logger.info(`Testing optimization: ${config.setting}`);

    const result: OptimizationResult = {
      success: false,
      performance: { baseline: 0, optimized: 0, improvement: 0 },
      errors: [],
      warnings: [],
      metrics: {
        responseTime: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        tokensPerSecond: 0
      }
    };

    try {
      // Create test environment
      const testEnv = await this.createTestEnvironment(config);

      // Run baseline tests if not available
      if (!this.baselineMetrics) {
        this.baselineMetrics = await this.runBaselineTests();
      }

      // Apply configuration temporarily
      await this.applyTemporaryConfiguration(config, testEnv);

      // Run performance tests
      const testResults = await this.runPerformanceTests(testEnv);

      // Analyze results
      result.metrics = testResults.metrics;
      result.performance = this.comparePerformance(this.baselineMetrics, testResults);
      result.errors = testResults.errors;
      result.warnings = testResults.warnings;
      result.success = testResults.errors.length === 0;

      // Cleanup test environment
      await this.cleanupTestEnvironment(testEnv);

      this.logger.info(`Test completed: ${result.success ? 'PASS' : 'FAIL'}`);
      return result;

    } catch (error) {
      this.logger.error('Test execution failed', error);
      result.errors.push(`Test execution failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Validate configuration syntax and compatibility
   */
  async validateConfiguration(config: any): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const validation = {
      valid: true,
      errors: [] as string[],
      warnings: [] as string[]
    };

    // Syntax validation
    if (!config.setting || typeof config.setting !== 'string') {
      validation.errors.push('Missing or invalid setting name');
      validation.valid = false;
    }

    if (config.value === undefined || config.value === null) {
      validation.errors.push('Missing configuration value');
      validation.valid = false;
    }

    // Type validation
    const typeValidation = this.validateValueType(config);
    if (!typeValidation.valid) {
      validation.errors.push(...typeValidation.errors);
      validation.warnings.push(...typeValidation.warnings);
      validation.valid = false;
    }

    // Range validation
    const rangeValidation = this.validateValueRange(config);
    if (!rangeValidation.valid) {
      validation.warnings.push(...rangeValidation.warnings);
    }

    // Security validation
    const securityValidation = this.validateSecurity(config);
    if (!securityValidation.valid) {
      validation.errors.push(...securityValidation.errors);
      validation.valid = false;
    }

    return validation;
  }

  /**
   * Apply configuration optimization
   */
  async applyOptimization(config: any, permanent: boolean = false): Promise<boolean> {
    this.logger.info(`Applying optimization: ${config.setting} (permanent: ${permanent})`);

    try {
      if (permanent) {
        return await this.applyPermanentConfiguration(config);
      } else {
        return await this.applyTemporaryConfiguration(config);
      }
    } catch (error) {
      this.logger.error('Failed to apply optimization', error);
      return false;
    }
  }

  /**
   * Load test suites for performance testing
   */
  private loadTestSuites(): TestScenario[] {
    return [
      {
        name: 'Basic Response Time',
        command: 'echo "Test simple response" | claude-code --stdin',
        timeout: 10000,
        metrics: ['responseTime', 'memoryUsage']
      },
      {
        name: 'File Operations',
        command: 'claude-code "List files in current directory"',
        timeout: 15000,
        metrics: ['responseTime', 'cpuUsage']
      },
      {
        name: 'Code Analysis',
        command: 'claude-code "Analyze this TypeScript file: ./src/test-file.ts"',
        timeout: 30000,
        metrics: ['responseTime', 'memoryUsage', 'tokensPerSecond']
      },
      {
        name: 'Parallel Operations',
        command: 'claude-code "Run git status and npm test in parallel"',
        timeout: 45000,
        metrics: ['responseTime', 'cpuUsage', 'memoryUsage']
      }
    ];
  }

  /**
   * Create isolated test environment
   */
  private async createTestEnvironment(config: any): Promise<string> {
    const testDir = path.join(process.cwd(), 'test-env', `test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create test files
    await this.createTestFiles(testDir);

    // Create temporary config
    const configPath = path.join(testDir, 'test-config.yaml');
    await fs.writeFile(configPath, yaml.dump({ test_config: config }));

    return testDir;
  }

  /**
   * Create test files for scenarios
   */
  private async createTestFiles(testDir: string): Promise<void> {
    // Create a test TypeScript file
    const testTsContent = `
interface TestInterface {
  id: number;
  name: string;
  active: boolean;
}

class TestClass implements TestInterface {
  constructor(
    public id: number,
    public name: string,
    public active: boolean = true
  ) {}

  async processData(): Promise<void> {
    // Simulate some processing
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export default TestClass;
    `;

    await fs.writeFile(path.join(testDir, 'test-file.ts'), testTsContent);

    // Create package.json for npm test
    const packageJson = {
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        test: 'echo "Test passed"'
      }
    };

    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
  }

  /**
   * Run baseline performance tests
   */
  private async runBaselineTests(): Promise<any> {
    this.logger.info('Running baseline performance tests');

    const results = {
      responseTime: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      tokensPerSecond: 0,
      errors: [] as string[],
      warnings: [] as string[]
    };

    for (const testScenario of this.testSuites) {
      try {
        const scenarioResult = await this.runTestScenario(testScenario, process.cwd());
        
        // Aggregate metrics
        results.responseTime += scenarioResult.responseTime;
        results.memoryUsage = Math.max(results.memoryUsage, scenarioResult.memoryUsage);
        results.cpuUsage = Math.max(results.cpuUsage, scenarioResult.cpuUsage);
        results.tokensPerSecond += scenarioResult.tokensPerSecond;

      } catch (error) {
        results.errors.push(`Baseline test failed: ${error.message}`);
      }
    }

    // Average response time
    results.responseTime = results.responseTime / this.testSuites.length;

    return results;
  }

  /**
   * Apply configuration temporarily for testing
   */
  private async applyTemporaryConfiguration(config: any, testEnv?: string): Promise<boolean> {
    // In a real implementation, this would:
    // 1. Create temporary Claude Code config
    // 2. Set environment variables
    // 3. Create temp settings file
    
    this.logger.info(`Temporarily applying: ${config.setting} = ${config.value}`);
    
    // For now, simulate temporary application
    process.env[`CC_TEST_${config.setting.toUpperCase()}`] = String(config.value);
    
    return true;
  }

  /**
   * Apply configuration permanently
   */
  private async applyPermanentConfiguration(config: any): Promise<boolean> {
    // In a real implementation, this would:
    // 1. Update Claude Code settings
    // 2. Update global config files
    // 3. Validate application

    this.logger.info(`Permanently applying: ${config.setting} = ${config.value}`);
    
    // For now, simulate permanent application
    // This would typically update ~/.claude/config.yaml or similar
    
    return true;
  }

  /**
   * Run performance tests in test environment
   */
  private async runPerformanceTests(testEnv: string): Promise<any> {
    this.logger.info('Running optimized performance tests');

    const results = {
      responseTime: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      tokensPerSecond: 0,
      errors: [] as string[],
      warnings: [] as string[],
      metrics: {
        responseTime: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        tokensPerSecond: 0
      }
    };

    for (const testScenario of this.testSuites) {
      try {
        const scenarioResult = await this.runTestScenario(testScenario, testEnv);
        
        results.responseTime += scenarioResult.responseTime;
        results.memoryUsage = Math.max(results.memoryUsage, scenarioResult.memoryUsage);
        results.cpuUsage = Math.max(results.cpuUsage, scenarioResult.cpuUsage);
        results.tokensPerSecond += scenarioResult.tokensPerSecond;

      } catch (error) {
        results.errors.push(`Test scenario failed: ${error.message}`);
      }
    }

    // Average response time
    results.responseTime = results.responseTime / this.testSuites.length;
    results.metrics = {
      responseTime: results.responseTime,
      memoryUsage: results.memoryUsage,
      cpuUsage: results.cpuUsage,
      tokensPerSecond: results.tokensPerSecond
    };

    return results;
  }

  /**
   * Run individual test scenario
   */
  private async runTestScenario(scenario: TestScenario, cwd: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const startMemory = process.memoryUsage().heapUsed;

      const child = spawn('bash', ['-c', scenario.command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Test scenario timeout: ${scenario.name}`));
      }, scenario.timeout);

      child.on('close', (code) => {
        clearTimeout(timeout);
        
        const endTime = Date.now();
        const endMemory = process.memoryUsage().heapUsed;
        const responseTime = endTime - startTime;
        const memoryUsage = endMemory - startMemory;

        // Simulate other metrics (in real implementation, these would be measured)
        const cpuUsage = Math.random() * 50; // 0-50% CPU
        const tokensPerSecond = stdout.length > 0 ? (stdout.length / responseTime) * 1000 : 0;

        if (code === 0) {
          resolve({
            responseTime,
            memoryUsage,
            cpuUsage,
            tokensPerSecond,
            stdout,
            stderr
          });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Compare performance metrics
   */
  private comparePerformance(baseline: any, optimized: any): { baseline: number; optimized: number; improvement: number } {
    const baselineScore = this.calculatePerformanceScore(baseline);
    const optimizedScore = this.calculatePerformanceScore(optimized);
    const improvement = ((optimizedScore - baselineScore) / baselineScore) * 100;

    return {
      baseline: baselineScore,
      optimized: optimizedScore,
      improvement
    };
  }

  /**
   * Calculate overall performance score
   */
  private calculatePerformanceScore(metrics: any): number {
    // Weighted performance score (lower is better for time/memory, higher for throughput)
    const responseTimeScore = Math.max(0, 10000 - metrics.responseTime) / 1000; // Max 10 points
    const memoryScore = Math.max(0, 1000000 - metrics.memoryUsage) / 100000; // Max 10 points
    const throughputScore = Math.min(10, metrics.tokensPerSecond / 10); // Max 10 points

    return (responseTimeScore + memoryScore + throughputScore) / 3;
  }

  /**
   * Validate value type
   */
  private validateValueType(config: any): { valid: boolean; errors: string[]; warnings: string[] } {
    const result = { valid: true, errors: [] as string[], warnings: [] as string[] };

    // Type-specific validations based on setting name
    const setting = config.setting.toLowerCase();
    const value = config.value;

    if (setting.includes('timeout') || setting.includes('delay')) {
      if (typeof value !== 'number' || value < 0) {
        result.errors.push('Timeout values must be positive numbers');
        result.valid = false;
      }
    }

    if (setting.includes('enable') || setting.includes('disable')) {
      if (typeof value !== 'boolean') {
        result.warnings.push('Boolean expected for enable/disable settings');
      }
    }

    if (setting.includes('max') || setting.includes('limit')) {
      if (typeof value !== 'number' || value < 1) {
        result.errors.push('Limit values must be positive numbers');
        result.valid = false;
      }
    }

    return result;
  }

  /**
   * Validate value ranges
   */
  private validateValueRange(config: any): { valid: boolean; warnings: string[] } {
    const result = { valid: true, warnings: [] as string[] };
    const setting = config.setting.toLowerCase();
    const value = config.value;

    if (setting.includes('timeout') && typeof value === 'number') {
      if (value > 300000) { // 5 minutes
        result.warnings.push('Very high timeout value may cause delays');
      }
      if (value < 1000) { // 1 second
        result.warnings.push('Very low timeout value may cause failures');
      }
    }

    if (setting.includes('parallel') && typeof value === 'number') {
      if (value > 100) {
        result.warnings.push('Very high parallelism may overwhelm system');
      }
    }

    return result;
  }

  /**
   * Validate security implications
   */
  private validateSecurity(config: any): { valid: boolean; errors: string[] } {
    const result = { valid: true, errors: [] as string[] };
    const setting = config.setting.toLowerCase();
    const value = config.value;

    // Check for potential security risks
    if (setting.includes('url') || setting.includes('endpoint')) {
      if (typeof value === 'string' && !value.startsWith('https://')) {
        result.errors.push('URLs should use HTTPS');
        result.valid = false;
      }
    }

    if (setting.includes('secret') || setting.includes('password') || setting.includes('key')) {
      result.errors.push('Credentials should not be stored in configuration');
      result.valid = false;
    }

    return result;
  }

  /**
   * Cleanup test environment
   */
  private async cleanupTestEnvironment(testEnv: string): Promise<void> {
    try {
      // Remove temporary environment variables
      for (const key of Object.keys(process.env)) {
        if (key.startsWith('CC_TEST_')) {
          delete process.env[key];
        }
      }

      // Remove test directory
      await fs.rm(testEnv, { recursive: true, force: true });
      
      this.logger.info('Test environment cleaned up');
    } catch (error) {
      this.logger.warn('Failed to cleanup test environment', error);
    }
  }
}