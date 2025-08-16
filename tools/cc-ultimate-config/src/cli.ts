#!/usr/bin/env node

/**
 * CC Ultimate Config (CCU) CLI
 * Main entry point for the configuration optimization tool
 */

import { Command } from 'commander';
import { ConfigUpdateCommand } from './commands/config-update';
import { ConfigVersionManager } from './versioning/ConfigVersionManager';
import { RollbackManager } from './rollback/RollbackManager';
import { Logger } from './utils/logger';
import * as path from 'path';

const program = new Command();
const logger = new Logger('CCU-CLI');
const configPath = path.join(__dirname, '../configs/ultimate-config.yaml');

program
  .name('ccu')
  .description('CC Ultimate Config - Automated Claude Code optimization')
  .version('1.0.0');

// Config update command
program
  .command('update')
  .description('Research and apply latest CC optimizations')
  .option('-a, --auto', 'Automatically apply high-confidence updates')
  .option('-s, --source <source>', 'Check specific source only')
  .option('-d, --dry-run', 'Simulate update without applying changes')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      const command = new ConfigUpdateCommand();
      await command.execute(options);
    } catch (error) {
      logger.error('Update command failed', error);
      process.exit(1);
    }
  });

// Version management commands
const versionCmd = program
  .command('version')
  .description('Configuration version management');

versionCmd
  .command('list')
  .description('List configuration versions')
  .option('-l, --limit <number>', 'Limit number of versions', '10')
  .action(async (options) => {
    try {
      const versionManager = new ConfigVersionManager(configPath);
      await versionManager.initialize();
      
      const versions = await versionManager.getVersionHistory(parseInt(options.limit));
      
      console.log('\n📋 Configuration Version History');
      console.log('='.repeat(50));
      
      for (const version of versions) {
        console.log(`\n📦 ${version.version} (${version.timestamp.toISOString()})`);
        console.log(`   ${version.description}`);
        console.log(`   Changes: ${version.changes.length}, Tags: [${version.tags.join(', ')}]`);
      }
      
    } catch (error) {
      logger.error('Version list failed', error);
      process.exit(1);
    }
  });

versionCmd
  .command('tag <version> <tags...>')
  .description('Tag a version')
  .action(async (version, tags) => {
    try {
      const versionManager = new ConfigVersionManager(configPath);
      await versionManager.initialize();
      
      const success = await versionManager.tagVersion(version, tags);
      
      if (success) {
        console.log(`✅ Tagged version ${version} with: ${tags.join(', ')}`);
      } else {
        console.log(`❌ Failed to tag version ${version}`);
        process.exit(1);
      }
      
    } catch (error) {
      logger.error('Version tagging failed', error);
      process.exit(1);
    }
  });

versionCmd
  .command('export <version> <file>')
  .description('Export version to file')
  .action(async (version, file) => {
    try {
      const versionManager = new ConfigVersionManager(configPath);
      await versionManager.initialize();
      
      const success = await versionManager.exportVersion(version, file);
      
      if (success) {
        console.log(`✅ Exported version ${version} to ${file}`);
      } else {
        console.log(`❌ Failed to export version ${version}`);
        process.exit(1);
      }
      
    } catch (error) {
      logger.error('Version export failed', error);
      process.exit(1);
    }
  });

// Rollback commands
const rollbackCmd = program
  .command('rollback')
  .description('Configuration rollback management');

rollbackCmd
  .command('plan <version>')
  .description('Create rollback plan to specific version')
  .option('-r, --reason <reason>', 'Reason for rollback', 'Manual rollback')
  .action(async (version, options) => {
    try {
      const rollbackManager = new RollbackManager(configPath);
      await rollbackManager.initialize();
      
      const plan = await rollbackManager.createRollbackPlan(version, options.reason);
      
      console.log('\n🎯 Rollback Plan Created');
      console.log('='.repeat(30));
      console.log(`Plan ID: ${plan.id}`);
      console.log(`From: ${plan.fromVersion} → To: ${plan.toVersion}`);
      console.log(`Risk Level: ${plan.riskLevel.toUpperCase()}`);
      console.log(`Estimated Duration: ${Math.round(plan.estimatedDuration / 1000)}s`);
      console.log(`Affected Configs: ${plan.affectedConfigs.length}`);
      
      console.log('\n📋 Pre-conditions:');
      for (const condition of plan.preConditions) {
        console.log(`  • ${condition}`);
      }
      
      console.log('\n🔧 Steps:');
      for (const step of plan.steps) {
        console.log(`  ${step.id}: ${step.description} (${Math.round(step.expectedDuration / 1000)}s)`);
      }
      
      console.log(`\n💡 To execute: ccu rollback execute ${plan.id}`);
      
    } catch (error) {
      logger.error('Rollback planning failed', error);
      process.exit(1);
    }
  });

rollbackCmd
  .command('execute <planId>')
  .description('Execute rollback plan')
  .option('-f, --force', 'Force execution without pre-condition checks')
  .action(async (planId, options) => {
    try {
      const rollbackManager = new RollbackManager(configPath);
      await rollbackManager.initialize();
      
      console.log(`\n🚀 Executing rollback plan: ${planId}`);
      
      const result = await rollbackManager.executeRollback(planId, options.force);
      
      console.log('\n📊 Rollback Results');
      console.log('='.repeat(30));
      console.log(`Success: ${result.success ? '✅' : '❌'}`);
      console.log(`Duration: ${Math.round(result.duration / 1000)}s`);
      console.log(`Completed Steps: ${result.completedSteps.length}`);
      
      if (result.failedStep) {
        console.log(`Failed Step: ${result.failedStep}`);
        console.log(`Error: ${result.error}`);
      }
      
      if (!result.success) {
        process.exit(1);
      }
      
    } catch (error) {
      logger.error('Rollback execution failed', error);
      process.exit(1);
    }
  });

rollbackCmd
  .command('quick')
  .description('Quick rollback to previous version')
  .option('-r, --reason <reason>', 'Reason for rollback', 'Quick rollback')
  .action(async (options) => {
    try {
      const rollbackManager = new RollbackManager(configPath);
      await rollbackManager.initialize();
      
      console.log('\n⚡ Executing quick rollback...');
      
      const result = await rollbackManager.quickRollback(options.reason);
      
      console.log('\n📊 Quick Rollback Results');
      console.log('='.repeat(30));
      console.log(`Success: ${result.success ? '✅' : '❌'}`);
      console.log(`Duration: ${Math.round(result.duration / 1000)}s`);
      
      if (!result.success) {
        console.log(`Error: ${result.error}`);
        process.exit(1);
      }
      
    } catch (error) {
      logger.error('Quick rollback failed', error);
      process.exit(1);
    }
  });

rollbackCmd
  .command('emergency <version>')
  .description('Emergency rollback with minimal safety checks')
  .action(async (version) => {
    try {
      const rollbackManager = new RollbackManager(configPath);
      await rollbackManager.initialize();
      
      console.log(`\n🚨 EMERGENCY ROLLBACK to ${version}`);
      console.log('⚠️  This bypasses safety checks!');
      
      const result = await rollbackManager.emergencyRollback(version);
      
      console.log('\n📊 Emergency Rollback Results');
      console.log('='.repeat(30));
      console.log(`Success: ${result.success ? '✅' : '❌'}`);
      
      if (!result.success) {
        console.log(`Error: ${result.error}`);
        process.exit(1);
      }
      
    } catch (error) {
      logger.error('Emergency rollback failed', error);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show current configuration status')
  .action(async () => {
    try {
      const versionManager = new ConfigVersionManager(configPath);
      await versionManager.initialize();
      
      const currentVersion = versionManager.getCurrentVersion();
      const recentVersions = await versionManager.getVersionHistory(3);
      
      console.log('\n🔧 CC Ultimate Config Status');
      console.log('='.repeat(40));
      console.log(`Current Version: ${currentVersion || 'Unknown'}`);
      console.log(`Total Optimizations: 82+`);
      
      if (recentVersions.length > 0) {
        console.log('\n📈 Recent Versions:');
        for (const version of recentVersions) {
          const isCurrent = version.version === currentVersion;
          const indicator = isCurrent ? '→' : ' ';
          console.log(`${indicator} ${version.version} - ${version.description} (${version.timestamp.toLocaleDateString()})`);
        }
      }
      
      console.log('\n💡 Available Commands:');
      console.log('  ccu update               - Research and apply new optimizations');
      console.log('  ccu version list         - View version history');
      console.log('  ccu rollback quick       - Quick rollback to previous version');
      console.log('  ccu rollback plan <ver>  - Plan rollback to specific version');
      
    } catch (error) {
      logger.error('Status command failed', error);
      process.exit(1);
    }
  });

// Daily command
program
  .command('daily')
  .description('Run daily automation script')
  .option('-a, --auto', 'Auto-apply mode')
  .option('-d, --dry-run', 'Dry run mode')
  .option('-s, --schedule', 'Start scheduler daemon')
  .action(async (options) => {
    try {
      const DailyUpdateManager = require('../admin/daily-update.js');
      const manager = new DailyUpdateManager();
      
      if (options.schedule) {
        console.log('🕐 Starting daily update scheduler...');
        manager.scheduleDaily();
      } else {
        console.log('🌅 Running daily update...');
        await manager.run({
          auto: options.auto,
          dryRun: options.dryRun
        });
      }
      
    } catch (error) {
      logger.error('Daily command failed', error);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}