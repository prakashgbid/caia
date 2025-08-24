#!/usr/bin/env node

/**
 * Parallel Test Runner with CC Orchestrator Integration
 * Executes hierarchical agent system tests with maximum parallelization
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const chalk = require('chalk');
const ora = require('ora');

// CC Orchestrator integration
let CCOrchestrator;
try {
  CCOrchestrator = require('../../../utils/parallel/cc-orchestrator/src/index');
} catch (error) {
  console.warn(chalk.yellow('⚠️  CC Orchestrator not found, falling back to basic parallel execution'));
  CCOrchestrator = null;
}

class HierarchicalTestRunner {
  constructor(options = {}) {
    this.options = {
      maxWorkers: options.maxWorkers || 'auto',
      suite: options.suite || 'all',
      coverage: options.coverage !== false,
      verbose: options.verbose || false,
      watch: options.watch || false,
      parallel: options.parallel !== false,
      timeout: options.timeout || 300000, // 5 minutes
      retries: options.retries || 0,
      ...options
    };

    this.testSuites = {
      unit: {
        name: 'Unit Tests',
        pattern: 'unit/**/*.test.{ts,js}',
        timeout: 30000,
        parallel: true,
        priority: 1
      },
      integration: {
        name: 'Integration Tests',
        pattern: 'integration/**/*.test.{ts,js}',
        timeout: 120000,
        parallel: true,
        priority: 2
      },
      performance: {
        name: 'Performance Tests',
        pattern: 'performance/**/*.test.{ts,js}',
        timeout: 600000, // 10 minutes
        parallel: false, // Performance tests should run sequentially
        priority: 3
      },
      e2e: {
        name: 'End-to-End Tests',
        pattern: 'e2e/**/*.test.{ts,js}',
        timeout: 300000, // 5 minutes
        parallel: true,
        priority: 4
      }
    };

    this.results = {
      suites: {},
      summary: {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        startTime: null,
        endTime: null,
        duration: 0
      }
    };

    this.orchestrator = null;
    this.initializeOrchestrator();
  }

  async initializeOrchestrator() {
    if (CCOrchestrator && this.options.parallel) {
      try {
        this.orchestrator = new CCOrchestrator({
          autoCalculateInstances: true,
          apiRateLimit: 100,
          taskTimeout: this.options.timeout,
          contextPreservation: true,
          debug: this.options.verbose
        });

        console.log(chalk.green('✅ CC Orchestrator initialized for parallel test execution'));
      } catch (error) {
        console.warn(chalk.yellow('⚠️  Failed to initialize CC Orchestrator:', error.message));
        this.orchestrator = null;
      }
    }
  }

  /**
   * Run test suites based on configuration
   */
  async run() {
    console.log(chalk.blue.bold('\n🧪 Hierarchical Agent System Test Runner\n'));

    this.results.summary.startTime = Date.now();
    
    // Pre-test setup
    await this.setupTests();

    // Determine which suites to run
    const suitesToRun = this.determineSuitesToRun();
    
    if (suitesToRun.length === 0) {
      console.log(chalk.red('❌ No test suites selected'));
      process.exit(1);
    }

    console.log(chalk.cyan(`Running suites: ${suitesToRun.map(s => s.name).join(', ')}\n`));

    // Run tests
    let overallSuccess = true;

    if (this.orchestrator && suitesToRun.length > 1) {
      // Use CC Orchestrator for parallel suite execution
      overallSuccess = await this.runWithOrchestrator(suitesToRun);
    } else {
      // Run suites sequentially or with basic parallelization
      for (const suite of suitesToRun) {
        const success = await this.runTestSuite(suite);
        if (!success) overallSuccess = false;
        
        // Break on first failure if not retrying
        if (!success && this.options.retries === 0 && !this.options.continueOnFailure) {
          break;
        }
      }
    }

    // Generate reports
    await this.generateReports();
    
    this.results.summary.endTime = Date.now();
    this.results.summary.duration = this.results.summary.endTime - this.results.summary.startTime;

    // Display summary
    this.displaySummary();

    // Cleanup
    await this.cleanup();

    process.exit(overallSuccess ? 0 : 1);
  }

  /**
   * Run tests using CC Orchestrator for maximum parallelization
   */
  async runWithOrchestrator(suites) {
    console.log(chalk.blue('🚀 Running tests with CC Orchestrator...\n'));

    const tasks = suites.map(suite => ({
      id: `test-suite-${suite.key}`,
      name: suite.name,
      priority: suite.priority,
      execute: () => this.runTestSuite(suite),
      timeout: suite.timeout,
      retries: this.options.retries
    }));

    try {
      const results = await this.orchestrator.executeWorkflow({
        tasks,
        strategy: 'intelligent-distribution',
        maxConcurrency: this.options.maxWorkers === 'auto' ? undefined : this.options.maxWorkers
      });

      const allSuccessful = results.every(result => result.success);
      
      // Aggregate results
      results.forEach((result, index) => {
        const suite = suites[index];
        this.results.suites[suite.key] = {
          ...result,
          name: suite.name,
          duration: result.executionTime
        };
      });

      return allSuccessful;
    } catch (error) {
      console.error(chalk.red('❌ CC Orchestrator execution failed:', error.message));
      
      // Fallback to sequential execution
      console.log(chalk.yellow('🔄 Falling back to sequential execution...\n'));
      let overallSuccess = true;
      for (const suite of suites) {
        const success = await this.runTestSuite(suite);
        if (!success) overallSuccess = false;
      }
      return overallSuccess;
    }
  }

  /**
   * Run individual test suite
   */
  async runTestSuite(suite) {
    const spinner = ora(`Running ${suite.name}...`).start();
    const startTime = Date.now();

    try {
      const jestArgs = this.buildJestArgs(suite);
      const result = await this.executeJest(jestArgs, suite);
      
      const duration = Date.now() - startTime;
      const success = result.success;

      this.results.suites[suite.key] = {
        name: suite.name,
        success,
        duration,
        tests: result.numTotalTests || 0,
        passed: result.numPassedTests || 0,
        failed: result.numFailedTests || 0,
        skipped: result.numPendingTests || 0,
        coverage: result.coverageMap || null,
        output: result.output
      };

      // Update summary
      this.results.summary.totalTests += result.numTotalTests || 0;
      this.results.summary.passedTests += result.numPassedTests || 0;
      this.results.summary.failedTests += result.numFailedTests || 0;
      this.results.summary.skippedTests += result.numPendingTests || 0;

      if (success) {
        spinner.succeed(`${suite.name} - ${chalk.green('PASSED')} (${duration}ms)`);
      } else {
        spinner.fail(`${suite.name} - ${chalk.red('FAILED')} (${duration}ms)`);
        
        if (this.options.verbose && result.output) {
          console.log(chalk.gray(result.output));
        }
      }

      return success;
    } catch (error) {
      const duration = Date.now() - startTime;
      spinner.fail(`${suite.name} - ${chalk.red('ERROR')} (${duration}ms)`);
      
      this.results.suites[suite.key] = {
        name: suite.name,
        success: false,
        duration,
        error: error.message
      };

      console.error(chalk.red(`Error in ${suite.name}:`), error.message);
      return false;
    }
  }

  /**
   * Execute Jest with given arguments
   */
  executeJest(args, suite) {
    return new Promise((resolve) => {
      const jestProcess = spawn('npx', ['jest', ...args], {
        cwd: path.resolve(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          JEST_WORKER_ID: undefined // Let Jest manage workers
        }
      });

      let stdout = '';
      let stderr = '';

      jestProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      jestProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      jestProcess.on('close', (code) => {
        try {
          // Try to parse Jest output for detailed results
          const output = stdout + stderr;
          const result = this.parseJestOutput(output);
          
          resolve({
            success: code === 0,
            code,
            output,
            ...result
          });
        } catch (error) {
          resolve({
            success: false,
            code,
            output: stdout + stderr,
            error: error.message
          });
        }
      });

      // Handle timeouts
      const timeout = setTimeout(() => {
        jestProcess.kill('SIGTERM');
        resolve({
          success: false,
          code: -1,
          output: 'Test suite timed out',
          timeout: true
        });
      }, suite.timeout);

      jestProcess.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Parse Jest output to extract test statistics
   */
  parseJestOutput(output) {
    const result = {};

    // Extract test results
    const testResultMatch = output.match(/Tests:\s*(\d+)\s*failed,\s*(\d+)\s*passed,\s*(\d+)\s*total/);
    if (testResultMatch) {
      result.numFailedTests = parseInt(testResultMatch[1]);
      result.numPassedTests = parseInt(testResultMatch[2]);
      result.numTotalTests = parseInt(testResultMatch[3]);
      result.numPendingTests = 0; // Jest doesn't always report skipped in this format
    }

    // Extract timing
    const timeMatch = output.match(/Time:\s*([\d.]+)\s*s/);
    if (timeMatch) {
      result.executionTime = parseFloat(timeMatch[1]) * 1000;
    }

    // Extract coverage (simplified)
    if (output.includes('Coverage')) {
      result.hasCoverage = true;
    }

    return result;
  }

  /**
   * Build Jest command arguments
   */
  buildJestArgs(suite) {
    const args = [];

    // Test pattern
    args.push('--testPathPattern', suite.pattern);

    // Timeout
    args.push('--testTimeout', suite.timeout.toString());

    // Workers
    if (suite.parallel && this.options.maxWorkers !== 'auto') {
      args.push('--maxWorkers', this.options.maxWorkers.toString());
    } else if (!suite.parallel) {
      args.push('--maxWorkers', '1');
    }

    // Coverage
    if (this.options.coverage) {
      args.push('--coverage');
      args.push('--coverageDirectory', `coverage/${suite.key}`);
    }

    // Verbose
    if (this.options.verbose) {
      args.push('--verbose');
    }

    // Watch mode
    if (this.options.watch) {
      args.push('--watch');
    }

    // JSON output for parsing
    args.push('--json');

    // Other Jest options
    args.push('--passWithNoTests');
    args.push('--detectOpenHandles');
    args.push('--forceExit');

    return args;
  }

  /**
   * Determine which test suites to run
   */
  determineSuitesToRun() {
    const { suite } = this.options;
    
    if (suite === 'all') {
      return Object.entries(this.testSuites).map(([key, config]) => ({
        key,
        ...config
      })).sort((a, b) => a.priority - b.priority);
    }

    if (this.testSuites[suite]) {
      return [{ key: suite, ...this.testSuites[suite] }];
    }

    // Support comma-separated suite names
    const requestedSuites = suite.split(',').map(s => s.trim());
    const validSuites = requestedSuites
      .filter(s => this.testSuites[s])
      .map(s => ({ key: s, ...this.testSuites[s] }))
      .sort((a, b) => a.priority - b.priority);

    return validSuites;
  }

  /**
   * Setup tests (fixtures, mocks, etc.)
   */
  async setupTests() {
    const spinner = ora('Setting up test environment...').start();

    try {
      // Generate test fixtures if needed
      const fixturesPath = path.join(__dirname, '..', 'fixtures', 'generated');
      if (!fs.existsSync(fixturesPath) || !fs.readdirSync(fixturesPath).length) {
        const DataGenerator = require('../fixtures/data-generator');
        const generator = new DataGenerator();
        await generator.generateAll();
      }

      // Verify required files exist
      const requiredPaths = [
        path.join(__dirname, '..', 'src', 'config', 'jest.setup.ts'),
        path.join(__dirname, '..', 'fixtures', 'sample-ideas.ts'),
        path.join(__dirname, '..', 'mocks', 'jira-connector.mock.ts')
      ];

      for (const requiredPath of requiredPaths) {
        if (!fs.existsSync(requiredPath)) {
          throw new Error(`Required test file not found: ${requiredPath}`);
        }
      }

      spinner.succeed('Test environment setup complete');
    } catch (error) {
      spinner.fail('Test environment setup failed');
      throw error;
    }
  }

  /**
   * Generate test reports
   */
  async generateReports() {
    if (!this.options.coverage) return;

    const spinner = ora('Generating test reports...').start();

    try {
      // Merge coverage reports if multiple suites
      const coverageDir = path.join(__dirname, '..', 'coverage');
      
      if (fs.existsSync(coverageDir)) {
        // Generate combined HTML report
        await this.generateCombinedCoverageReport();
      }

      // Generate JSON report
      const reportPath = path.join(__dirname, '..', 'test-results.json');
      fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));

      spinner.succeed(`Test reports generated in ${coverageDir}`);
    } catch (error) {
      spinner.fail('Report generation failed');
      console.error(error.message);
    }
  }

  async generateCombinedCoverageReport() {
    return new Promise((resolve, reject) => {
      const nyc = spawn('npx', ['nyc', 'merge', 'coverage/*/coverage-final.json', 'coverage/merged.json'], {
        cwd: path.resolve(__dirname, '..')
      });

      nyc.on('close', (code) => {
        if (code === 0) {
          // Generate HTML report from merged coverage
          const htmlReport = spawn('npx', ['nyc', 'report', '--reporter', 'html'], {
            cwd: path.resolve(__dirname, '..')
          });

          htmlReport.on('close', (htmlCode) => {
            resolve(htmlCode === 0);
          });
        } else {
          resolve(false);
        }
      });
    });
  }

  /**
   * Display test results summary
   */
  displaySummary() {
    console.log(chalk.blue.bold('\n📊 Test Results Summary\n'));

    // Overall statistics
    const { summary } = this.results;
    const successRate = summary.totalTests > 0 
      ? Math.round((summary.passedTests / summary.totalTests) * 100) 
      : 0;

    console.log(`${chalk.cyan('Total Tests:')} ${summary.totalTests}`);
    console.log(`${chalk.green('Passed:')} ${summary.passedTests}`);
    console.log(`${chalk.red('Failed:')} ${summary.failedTests}`);
    console.log(`${chalk.yellow('Skipped:')} ${summary.skippedTests}`);
    console.log(`${chalk.blue('Success Rate:')} ${successRate}%`);
    console.log(`${chalk.magenta('Duration:')} ${Math.round(summary.duration / 1000)}s`);

    // Suite breakdown
    console.log(chalk.blue.bold('\n📋 Suite Breakdown\n'));

    Object.entries(this.results.suites).forEach(([key, suite]) => {
      const status = suite.success ? chalk.green('✅ PASS') : chalk.red('❌ FAIL');
      const duration = Math.round(suite.duration / 1000);
      const tests = suite.tests ? ` (${suite.tests} tests)` : '';
      
      console.log(`${status} ${suite.name} - ${duration}s${tests}`);
      
      if (!suite.success && suite.error) {
        console.log(`  ${chalk.red('Error:')} ${suite.error}`);
      }
    });

    // Final status
    const overallSuccess = Object.values(this.results.suites).every(suite => suite.success);
    console.log(overallSuccess 
      ? chalk.green.bold('\n🎉 All tests passed!')
      : chalk.red.bold('\n💥 Some tests failed!')
    );

    // Performance insights
    if (this.orchestrator) {
      console.log(chalk.blue.bold('\n⚡ Performance Insights\n'));
      console.log('CC Orchestrator was used for parallel execution');
      
      if (summary.duration < 60000) {
        console.log(chalk.green('🚀 Excellent performance: < 1 minute'));
      } else if (summary.duration < 300000) {
        console.log(chalk.yellow('⚠️ Moderate performance: 1-5 minutes'));
      } else {
        console.log(chalk.red('🐌 Slow performance: > 5 minutes'));
      }
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.orchestrator) {
      try {
        await this.orchestrator.cleanup();
      } catch (error) {
        console.warn(chalk.yellow('⚠️ Orchestrator cleanup warning:', error.message));
      }
    }
  }
}

// CLI Setup
const argv = yargs(hideBin(process.argv))
  .command('$0 [suite]', 'Run hierarchical agent system tests', (yargs) => {
    yargs
      .positional('suite', {
        describe: 'Test suite to run',
        choices: ['all', 'unit', 'integration', 'performance', 'e2e'],
        default: 'all'
      })
      .option('maxWorkers', {
        alias: 'w',
        type: 'number',
        describe: 'Maximum number of worker processes',
        default: 'auto'
      })
      .option('coverage', {
        alias: 'c',
        type: 'boolean',
        describe: 'Generate coverage report',
        default: true
      })
      .option('verbose', {
        alias: 'v',
        type: 'boolean',
        describe: 'Verbose output',
        default: false
      })
      .option('watch', {
        type: 'boolean',
        describe: 'Watch mode',
        default: false
      })
      .option('no-parallel', {
        type: 'boolean',
        describe: 'Disable parallel execution',
        default: false
      })
      .option('timeout', {
        alias: 't',
        type: 'number',
        describe: 'Test timeout in milliseconds',
        default: 300000
      })
      .option('retries', {
        alias: 'r',
        type: 'number',
        describe: 'Number of retries for failed tests',
        default: 0
      })
      .option('continue-on-failure', {
        type: 'boolean',
        describe: 'Continue running tests after failures',
        default: false
      });
  })
  .help()
  .alias('help', 'h')
  .version('1.0.0')
  .example('$0', 'Run all test suites')
  .example('$0 unit', 'Run only unit tests')
  .example('$0 unit,integration', 'Run unit and integration tests')
  .example('$0 --no-coverage --verbose', 'Run without coverage, with verbose output')
  .argv;

// Main execution
async function main() {
  try {
    const runner = new HierarchicalTestRunner({
      suite: argv.suite,
      maxWorkers: argv.maxWorkers,
      coverage: argv.coverage,
      verbose: argv.verbose,
      watch: argv.watch,
      parallel: !argv['no-parallel'],
      timeout: argv.timeout,
      retries: argv.retries,
      continueOnFailure: argv['continue-on-failure']
    });

    await runner.run();
  } catch (error) {
    console.error(chalk.red('💥 Test runner failed:'), error.message);
    
    if (argv.verbose) {
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = HierarchicalTestRunner;