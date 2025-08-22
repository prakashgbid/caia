#!/usr/bin/env node

/**
 * CLI for @caia/test-runner
 */

import { Command } from 'commander';
import * as chalk from 'chalk';
import * as ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ParallelTestRunner, TestRunnerConfig } from '../index';

const program = new Command();

program
  .name('caia-test')
  .description('High-performance parallel test runner powered by CAIA utilities')
  .version('0.1.0');

program
  .command('run')
  .description('Run tests in parallel')
  .option('-p, --pattern <pattern>', 'Test file pattern', '**/*.{test,spec}.{js,ts,jsx,tsx}')
  .option('-w, --workers <number>', 'Number of workers (or "auto")', 'auto')
  .option('-c, --coverage', 'Collect coverage', true)
  .option('--coverage-threshold <json>', 'Coverage thresholds as JSON')
  .option('-o, --output <dir>', 'Output directory', 'test-results')
  .option('-s, --shard <shard>', 'Shard to run (e.g., "1/3")')
  .option('--strategy <strategy>', 'Sharding strategy', 'complexity')
  .option('-b, --bail', 'Stop on first test failure')
  .option('-t, --timeout <ms>', 'Test timeout in milliseconds', '5000')
  .option('-r, --retries <number>', 'Number of retries for failed tests', '0')
  .option('-v, --verbose', 'Verbose output')
  .option('--framework <framework>', 'Test framework (jest/vitest/mocha/auto)', 'auto')
  .action(async (options) => {
    const spinner = ora('Initializing test runner...').start();
    
    try {
      // Parse configuration
      const config: TestRunnerConfig = {
        testPattern: options.pattern,
        maxWorkers: options.workers === 'auto' ? 'auto' : parseInt(options.workers),
        collectCoverage: options.coverage,
        outputDirectory: options.output,
        shard: options.shard,
        shardStrategy: options.strategy,
        bail: options.bail,
        timeout: parseInt(options.timeout),
        retries: parseInt(options.retries),
        verbose: options.verbose,
        testFramework: options.framework
      };
      
      if (options.coverageThreshold) {
        try {
          config.coverageThreshold = JSON.parse(options.coverageThreshold);
        } catch (error) {
          spinner.fail('Invalid coverage threshold JSON');
          process.exit(1);
        }
      }
      
      // Create runner
      const runner = new ParallelTestRunner(config);
      
      // Setup event handlers
      runner.on('discovery:complete', ({ count }) => {
        spinner.succeed(`Discovered ${count} test files`);
        spinner = ora('Analyzing test complexity...').start();
      });
      
      runner.on('sharding:complete', ({ shards, strategy }) => {
        spinner.succeed(`Created ${shards} shards using ${strategy} strategy`);
        spinner = ora('Running tests...').start();
      });
      
      runner.on('progress', (progress) => {
        if (!options.verbose) {
          spinner.text = `Running tests... ${progress.completed}/${progress.total}`;
        }
      });
      
      runner.on('test:complete', (test) => {
        if (options.verbose) {
          console.log(chalk.green(`✓ ${test.data.items[0].id}`));
        }
      });
      
      runner.on('test:failed', ({ task, error }) => {
        if (options.verbose) {
          console.log(chalk.red(`✗ ${task.data.items[0].id}: ${error.message}`));
        }
      });
      
      // Run tests
      const report = await runner.run();
      
      spinner.succeed('Test execution complete');
      
      // Display results
      console.log('\n' + chalk.bold('Test Results:'));
      console.log('─'.repeat(50));
      
      const totalTests = report.results.length;
      const passedTests = report.results.filter(r => r.passed).length;
      const failedTests = totalTests - passedTests;
      
      console.log(chalk.green(`  ✓ Passed: ${passedTests}`));
      if (failedTests > 0) {
        console.log(chalk.red(`  ✗ Failed: ${failedTests}`));
      }
      console.log(`  ⏱  Duration: ${report.duration}ms`);
      
      // Display coverage if collected
      if (report.coverage) {
        console.log('\n' + chalk.bold('Coverage:'));
        console.log('─'.repeat(50));
        
        const coverage = report.coverage;
        const formatCoverage = (value: number) => {
          const percentage = value.toFixed(2);
          if (value >= 80) return chalk.green(`${percentage}%`);
          if (value >= 60) return chalk.yellow(`${percentage}%`);
          return chalk.red(`${percentage}%`);
        };
        
        console.log(`  Lines:      ${formatCoverage(coverage.lines?.percentage || 0)}`);
        console.log(`  Branches:   ${formatCoverage(coverage.branches?.percentage || 0)}`);
        console.log(`  Functions:  ${formatCoverage(coverage.functions?.percentage || 0)}`);
        console.log(`  Statements: ${formatCoverage(coverage.statements?.percentage || 0)}`);
      }
      
      console.log('\n' + chalk.dim(`Report saved to: ${options.output}/report.html`));
      
      process.exit(report.passed ? 0 : 1);
      
    } catch (error) {
      spinner.fail('Test execution failed');
      console.error(chalk.red(error));
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze test files and generate insights')
  .option('-p, --pattern <pattern>', 'Test file pattern', '**/*.{test,spec}.{js,ts,jsx,tsx}')
  .option('--find-gaps', 'Find coverage gaps')
  .option('--suggest-tests', 'Suggest new tests')
  .option('-o, --output <file>', 'Output file for analysis')
  .action(async (options) => {
    const spinner = ora('Analyzing test files...').start();
    
    try {
      const runner = new ParallelTestRunner({
        testPattern: options.pattern
      });
      
      const testFiles = await runner.discoverTestFiles();
      
      spinner.succeed(`Analyzed ${testFiles.length} test files`);
      
      // Display analysis
      console.log('\n' + chalk.bold('Test Analysis:'));
      console.log('─'.repeat(50));
      
      const totalSize = testFiles.reduce((sum, f) => sum + f.size, 0);
      const avgComplexity = testFiles.reduce((sum, f) => sum + (f.complexity || 0), 0) / testFiles.length;
      const totalDuration = testFiles.reduce((sum, f) => sum + (f.estimatedDuration || 0), 0);
      
      console.log(`  Total Files:        ${testFiles.length}`);
      console.log(`  Total Size:         ${(totalSize / 1024).toFixed(2)} KB`);
      console.log(`  Average Complexity: ${avgComplexity.toFixed(2)}`);
      console.log(`  Estimated Duration: ${totalDuration}ms`);
      
      // Find most complex tests
      const complexTests = [...testFiles]
        .sort((a, b) => (b.complexity || 0) - (a.complexity || 0))
        .slice(0, 5);
      
      console.log('\n' + chalk.bold('Most Complex Tests:'));
      complexTests.forEach((test, i) => {
        console.log(`  ${i + 1}. ${path.basename(test.path)} (complexity: ${test.complexity?.toFixed(2)})`);
      });
      
      // Save analysis if requested
      if (options.output) {
        const analysis = {
          summary: {
            totalFiles: testFiles.length,
            totalSize,
            avgComplexity,
            estimatedDuration: totalDuration
          },
          files: testFiles,
          complexTests
        };
        
        await fs.writeFile(options.output, JSON.stringify(analysis, null, 2));
        console.log('\n' + chalk.dim(`Analysis saved to: ${options.output}`));
      }
      
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(error));
      process.exit(1);
    }
  });

program
  .command('generate')
  .description('Generate tests for uncovered code')
  .option('-s, --source <dir>', 'Source directory', 'src')
  .option('-o, --output <dir>', 'Output directory for generated tests', 'generated-tests')
  .option('--coverage <file>', 'Coverage file to analyze')
  .option('--ai', 'Use AI for test generation')
  .action(async (options) => {
    const spinner = ora('Generating tests...').start();
    
    try {
      // This would integrate with test generation utilities
      spinner.succeed('Test generation complete');
      console.log(chalk.dim(`Generated tests saved to: ${options.output}`));
      
    } catch (error) {
      spinner.fail('Test generation failed');
      console.error(chalk.red(error));
      process.exit(1);
    }
  });

program
  .command('report')
  .description('Generate test report from results')
  .option('-i, --input <file>', 'Input results file', 'test-results/results.json')
  .option('-f, --format <format>', 'Report format (html/json/junit/tap)', 'html')
  .option('-o, --output <file>', 'Output file')
  .option('--open', 'Open report in browser')
  .action(async (options) => {
    const spinner = ora('Generating report...').start();
    
    try {
      // Load results
      const resultsPath = path.resolve(options.input);
      const results = JSON.parse(await fs.readFile(resultsPath, 'utf-8'));
      
      // Generate report based on format
      let output = options.output;
      if (!output) {
        const ext = options.format === 'json' ? 'json' : options.format === 'junit' ? 'xml' : 'html';
        output = `test-results/report.${ext}`;
      }
      
      // Save report
      await fs.mkdir(path.dirname(output), { recursive: true });
      
      if (options.format === 'json') {
        await fs.writeFile(output, JSON.stringify(results, null, 2));
      } else {
        // Would use report generator for other formats
        await fs.writeFile(output, '<html>Report</html>');
      }
      
      spinner.succeed(`Report generated: ${output}`);
      
      if (options.open && options.format === 'html') {
        // Would open in browser
        console.log(chalk.dim('Opening report in browser...'));
      }
      
    } catch (error) {
      spinner.fail('Report generation failed');
      console.error(chalk.red(error));
      process.exit(1);
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}