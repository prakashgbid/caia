#!/usr/bin/env node

/**
 * CLI for CAIA Monorepo Test Orchestrator
 */

import { Command } from 'commander';
import * as chalk from 'chalk';
import * as ora from 'ora';
import { MonorepoTestOrchestrator } from './index';
import { TerminalDashboard } from './dashboard/terminal-ui';
import { WebDashboard } from './dashboard/web-server';

const program = new Command();

program
  .name('caia-test-monorepo')
  .description('Parallel testing orchestrator for CAIA monorepo with live dashboard')
  .version('0.1.0');

program
  .command('run')
  .description('Run all tests in parallel with live dashboard')
  .option('-p, --parallel <number>', 'Max parallel workers (or "auto")', 'auto')
  .option('-c, --coverage <threshold>', 'Coverage threshold percentage', '95')
  .option('-b, --bail', 'Stop on first test failure')
  .option('-w, --watch', 'Watch mode for continuous testing')
  .option('-d, --dashboard <type>', 'Dashboard type: terminal, web, both, none', 'terminal')
  .option('--port <port>', 'Web dashboard port', '3000')
  .option('-v, --verbose', 'Verbose output')
  .option('--pattern <pattern>', 'Package discovery pattern', 'packages/**')
  .option('--exclude <patterns>', 'Exclude patterns (comma-separated)', '**/node_modules/**,**/dist/**')
  .option('--strategy <strategy>', 'Sharding strategy: size, complexity, dependencies, history', 'complexity')
  .option('--use-cco', 'Use CC Orchestrator if available', true)
  .option('--timeout <ms>', 'Test timeout in milliseconds', '300000')
  .action(async (options) => {
    const spinner = ora('Initializing test orchestrator...').start();
    
    try {
      // Parse options
      const config = {
        maxParallel: options.parallel === 'auto' ? 'auto' : parseInt(options.parallel),
        coverageThreshold: parseFloat(options.coverage),
        bail: options.bail,
        watch: options.watch,
        dashboard: options.dashboard !== 'none',
        dashboardPort: parseInt(options.port),
        verbose: options.verbose,
        pattern: options.pattern,
        exclude: options.exclude.split(','),
        shardStrategy: options.strategy,
        useCCO: options.useCco,
        timeout: parseInt(options.timeout)
      };
      
      // Create orchestrator
      const orchestrator = new MonorepoTestOrchestrator(config);
      
      // Set up dashboards based on type
      let terminalDashboard: TerminalDashboard | null = null;
      let webDashboard: WebDashboard | null = null;
      
      if (options.dashboard === 'terminal' || options.dashboard === 'both') {
        spinner.succeed('Starting terminal dashboard...');
        terminalDashboard = new TerminalDashboard(orchestrator);
      }
      
      if (options.dashboard === 'web' || options.dashboard === 'both') {
        spinner.succeed('Starting web dashboard...');
        webDashboard = new WebDashboard(orchestrator, {
          port: config.dashboardPort
        });
        await webDashboard.start();
        
        console.log(chalk.green(`\n🌐 Web dashboard available at http://localhost:${config.dashboardPort}\n`));
      }
      
      if (options.dashboard === 'none') {
        spinner.succeed('Running without dashboard');
        
        // Set up basic console logging
        orchestrator.on('test:complete', ({ package: pkg, result }) => {
          const icon = result.success ? '✅' : '❌';
          console.log(`${icon} ${pkg}: ${result.tests.passed}/${result.tests.total} passed`);
        });
        
        orchestrator.on('execution:complete', ({ results }) => {
          const passed = results.filter(r => r.success).length;
          const failed = results.filter(r => !r.success).length;
          
          console.log(chalk.bold('\n📊 Test Results:'));
          console.log(chalk.green(`✅ Passed: ${passed}`));
          console.log(chalk.red(`❌ Failed: ${failed}`));
        });
      }
      
      // Execute tests
      const results = await orchestrator.execute();
      
      // Clean up dashboards
      if (terminalDashboard) {
        terminalDashboard.cleanup();
      }
      
      if (webDashboard) {
        await webDashboard.stop();
      }
      
      // Exit with appropriate code
      const hasFailures = results.some(r => !r.success);
      process.exit(hasFailures ? 1 : 0);
      
    } catch (error) {
      spinner.fail('Test execution failed');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze test performance and patterns')
  .option('--days <days>', 'Days of history to analyze', '7')
  .option('-o, --output <file>', 'Output file for analysis')
  .action(async (options) => {
    const spinner = ora('Analyzing test patterns...').start();
    
    try {
      const orchestrator = new MonorepoTestOrchestrator();
      const packages = await orchestrator.discoverPackages();
      
      spinner.succeed(`Analyzed ${packages.length} packages`);
      
      // Analysis would go here
      console.log(chalk.bold('\n📊 Test Analysis:'));
      console.log(`Total packages: ${packages.length}`);
      console.log(`Packages with tests: ${packages.filter(p => p.hasTests).length}`);
      console.log(`Packages without tests: ${packages.filter(p => !p.hasTests).length}`);
      
      // Group by type
      const byType = packages.reduce((acc, pkg) => {
        acc[pkg.type] = (acc[pkg.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log('\nPackages by type:');
      Object.entries(byType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
      
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('dashboard')
  .description('Start dashboard without running tests')
  .option('-t, --type <type>', 'Dashboard type: terminal, web', 'web')
  .option('-p, --port <port>', 'Web dashboard port', '3000')
  .action(async (options) => {
    const spinner = ora('Starting dashboard...').start();
    
    try {
      const orchestrator = new MonorepoTestOrchestrator();
      
      if (options.type === 'terminal') {
        spinner.succeed('Terminal dashboard started');
        const dashboard = new TerminalDashboard(orchestrator);
        
        // Keep running until user quits
        process.on('SIGINT', () => {
          dashboard.cleanup();
          process.exit(0);
        });
        
      } else {
        const dashboard = new WebDashboard(orchestrator, {
          port: parseInt(options.port)
        });
        
        await dashboard.start();
        spinner.succeed(`Web dashboard started at http://localhost:${options.port}`);
        
        console.log(chalk.dim('\nPress Ctrl+C to stop\n'));
        
        // Keep running until user quits
        process.on('SIGINT', async () => {
          await dashboard.stop();
          process.exit(0);
        });
      }
      
    } catch (error) {
      spinner.fail('Dashboard failed to start');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('coverage')
  .description('Generate coverage report for all packages')
  .option('-f, --format <format>', 'Report format: html, lcov, json', 'html')
  .option('-o, --output <dir>', 'Output directory', 'coverage')
  .action(async (options) => {
    const spinner = ora('Generating coverage report...').start();
    
    try {
      const orchestrator = new MonorepoTestOrchestrator({
        dashboard: false,
        coverageThreshold: 0 // Don't fail on coverage
      });
      
      // Run tests with coverage
      const results = await orchestrator.execute();
      
      // Aggregate coverage
      const coverage = results
        .filter(r => r.coverage)
        .reduce((acc, r) => {
          acc.lines.push(r.coverage.lines);
          acc.branches.push(r.coverage.branches);
          acc.functions.push(r.coverage.functions);
          acc.statements.push(r.coverage.statements);
          return acc;
        }, {
          lines: [] as number[],
          branches: [] as number[],
          functions: [] as number[],
          statements: [] as number[]
        });
      
      const avg = (arr: number[]) => arr.length > 0 
        ? arr.reduce((a, b) => a + b, 0) / arr.length 
        : 0;
      
      spinner.succeed('Coverage report generated');
      
      console.log(chalk.bold('\n📊 Coverage Summary:'));
      console.log(`Lines:      ${avg(coverage.lines).toFixed(1)}%`);
      console.log(`Branches:   ${avg(coverage.branches).toFixed(1)}%`);
      console.log(`Functions:  ${avg(coverage.functions).toFixed(1)}%`);
      console.log(`Statements: ${avg(coverage.statements).toFixed(1)}%`);
      
    } catch (error) {
      spinner.fail('Coverage generation failed');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}