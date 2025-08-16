#!/usr/bin/env node

/**
 * Daily CC Configuration Update Script
 * 
 * This script runs automatically to research and apply new CC optimizations.
 * Designed to be run via cron job or scheduled task.
 * 
 * Usage:
 *   node admin/daily-update.js [--dry-run] [--force] [--verbose]
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const cron = require('node-cron');

// Configuration
const CONFIG = {
  // Schedule: Every day at 2 AM
  cronSchedule: '0 2 * * *',
  
  // Paths
  logDir: path.join(__dirname, '../logs'),
  reportsDir: path.join(__dirname, '../reports'),
  configUpdateCommand: path.join(__dirname, '../dist/commands/config-update.js'),
  
  // Safety settings
  maxAutoUpdates: 5,        // Max auto-applied updates per day
  minConfidence: 0.8,       // Minimum confidence for auto-apply
  backupRetention: 30,      // Days to keep backups
  
  // Notification settings (for future implementation)
  notifications: {
    email: process.env.CCU_NOTIFICATION_EMAIL,
    slack: process.env.CCU_SLACK_WEBHOOK,
    discord: process.env.CCU_DISCORD_WEBHOOK
  }
};

class DailyUpdateManager {
  constructor() {
    this.logFile = path.join(CONFIG.logDir, `daily-update-${this.getDateString()}.log`);
    this.startTime = Date.now();
  }

  /**
   * Main execution function
   */
  async run(options = {}) {
    try {
      await this.log('🌅 Starting daily CC configuration update');
      await this.ensureDirectories();

      // Create configuration backup
      await this.createBackup();

      // Run configuration update with appropriate options
      const updateOptions = this.buildUpdateOptions(options);
      const result = await this.runConfigUpdate(updateOptions);

      // Process results
      await this.processResults(result);

      // Cleanup old files
      await this.cleanup();

      // Send notifications if configured
      await this.sendNotifications(result);

      const duration = Date.now() - this.startTime;
      await this.log(`✅ Daily update completed successfully in ${duration}ms`);

      return result;

    } catch (error) {
      await this.logError('❌ Daily update failed', error);
      await this.sendErrorNotification(error);
      throw error;
    }
  }

  /**
   * Schedule automatic daily updates
   */
  scheduleDaily() {
    this.log('📅 Scheduling daily updates');
    
    cron.schedule(CONFIG.cronSchedule, async () => {
      await this.log('⏰ Scheduled daily update triggered');
      
      try {
        await this.run({ auto: true });
      } catch (error) {
        await this.logError('Scheduled update failed', error);
      }
    }, {
      scheduled: true,
      timezone: process.env.TZ || 'UTC'
    });

    this.log(`✅ Daily updates scheduled for: ${CONFIG.cronSchedule}`);
  }

  /**
   * Build update command options
   */
  buildUpdateOptions(userOptions) {
    const options = {
      auto: userOptions.auto || false,
      dryRun: userOptions.dryRun || false,
      verbose: userOptions.verbose || false,
      maxUpdates: CONFIG.maxAutoUpdates,
      minConfidence: CONFIG.minConfidence
    };

    // In auto mode, be more conservative
    if (options.auto) {
      options.minConfidence = Math.max(options.minConfidence, 0.9);
      options.maxUpdates = Math.min(options.maxUpdates, 3);
    }

    return options;
  }

  /**
   * Run the config-update command
   */
  async runConfigUpdate(options) {
    await this.log('🔍 Running configuration update scan');

    const args = [];
    
    if (options.auto) args.push('--auto');
    if (options.dryRun) args.push('--dry-run');
    if (options.verbose) args.push('--verbose');

    return new Promise((resolve, reject) => {
      const child = spawn('node', [CONFIG.configUpdateCommand, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CCU_AUTO_MODE: options.auto ? 'true' : 'false',
          CCU_MAX_UPDATES: String(options.maxUpdates),
          CCU_MIN_CONFIDENCE: String(options.minConfidence)
        }
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            stdout,
            stderr,
            exitCode: code
          });
        } else {
          reject(new Error(`Config update failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Process update results
   */
  async processResults(result) {
    await this.log('📊 Processing update results');

    try {
      // Parse output for statistics
      const stats = this.parseUpdateStats(result.stdout);
      
      await this.log(`Found ${stats.discoveries} discoveries`);
      await this.log(`Applied ${stats.applied} optimizations`);
      await this.log(`${stats.errors} errors, ${stats.warnings} warnings`);

      // Log detailed results
      if (result.stdout) {
        await this.log('--- Update Output ---');
        await this.log(result.stdout);
      }

      if (result.stderr) {
        await this.log('--- Update Errors ---');
        await this.log(result.stderr);
      }

      return stats;

    } catch (error) {
      await this.logError('Failed to process results', error);
      return { discoveries: 0, applied: 0, errors: 1, warnings: 0 };
    }
  }

  /**
   * Parse statistics from update output
   */
  parseUpdateStats(output) {
    const stats = {
      discoveries: 0,
      applied: 0,
      errors: 0,
      warnings: 0
    };

    try {
      // Look for patterns in output
      const discoveryMatch = output.match(/Found (\d+) potential updates/);
      if (discoveryMatch) {
        stats.discoveries = parseInt(discoveryMatch[1]);
      }

      const appliedMatch = output.match(/Applied (\d+) configurations?/);
      if (appliedMatch) {
        stats.applied = parseInt(appliedMatch[1]);
      }

      const errorMatches = output.match(/ERROR/g);
      if (errorMatches) {
        stats.errors = errorMatches.length;
      }

      const warningMatches = output.match(/WARN/g);
      if (warningMatches) {
        stats.warnings = warningMatches.length;
      }

    } catch (error) {
      // Ignore parsing errors
    }

    return stats;
  }

  /**
   * Create configuration backup
   */
  async createBackup() {
    try {
      await this.log('💾 Creating configuration backup');

      const configPath = path.join(__dirname, '../configs/ultimate-config.yaml');
      const backupDir = path.join(__dirname, '../backups');
      const backupFile = path.join(backupDir, `config-backup-${this.getDateString()}.yaml`);

      await fs.mkdir(backupDir, { recursive: true });

      // Check if config exists
      try {
        await fs.access(configPath);
        await fs.copyFile(configPath, backupFile);
        await this.log(`Backup created: ${backupFile}`);
      } catch (error) {
        await this.log('No existing configuration to backup');
      }

    } catch (error) {
      await this.logError('Failed to create backup', error);
      throw error;
    }
  }

  /**
   * Cleanup old files
   */
  async cleanup() {
    try {
      await this.log('🧹 Cleaning up old files');

      // Clean old backups
      await this.cleanupDirectory(
        path.join(__dirname, '../backups'),
        CONFIG.backupRetention
      );

      // Clean old logs
      await this.cleanupDirectory(
        CONFIG.logDir,
        CONFIG.backupRetention
      );

      // Clean old reports
      await this.cleanupDirectory(
        CONFIG.reportsDir,
        CONFIG.backupRetention
      );

    } catch (error) {
      await this.logError('Cleanup failed', error);
      // Don't throw - cleanup failure shouldn't stop the process
    }
  }

  /**
   * Cleanup old files in directory
   */
  async cleanupDirectory(dirPath, retentionDays) {
    try {
      const files = await fs.readdir(dirPath);
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          await this.log(`Deleted old file: ${file}`);
        }
      }

    } catch (error) {
      // Ignore cleanup errors for individual directories
    }
  }

  /**
   * Send success notifications
   */
  async sendNotifications(result) {
    if (!this.hasNotificationConfig()) {
      return;
    }

    try {
      await this.log('📧 Sending notifications');

      const stats = this.parseUpdateStats(result.stdout);
      const message = this.buildNotificationMessage(stats);

      // Send to configured channels
      if (CONFIG.notifications.email) {
        await this.sendEmailNotification(message);
      }

      if (CONFIG.notifications.slack) {
        await this.sendSlackNotification(message);
      }

      if (CONFIG.notifications.discord) {
        await this.sendDiscordNotification(message);
      }

    } catch (error) {
      await this.logError('Failed to send notifications', error);
      // Don't throw - notification failure shouldn't stop the process
    }
  }

  /**
   * Send error notifications
   */
  async sendErrorNotification(error) {
    if (!this.hasNotificationConfig()) {
      return;
    }

    try {
      const message = `🚨 CC Ultimate Config Daily Update Failed\n\nError: ${error.message}\n\nTime: ${new Date().toISOString()}`;

      if (CONFIG.notifications.slack) {
        await this.sendSlackNotification(message);
      }

      if (CONFIG.notifications.discord) {
        await this.sendDiscordNotification(message);
      }

    } catch (notificationError) {
      await this.logError('Failed to send error notification', notificationError);
    }
  }

  /**
   * Build notification message
   */
  buildNotificationMessage(stats) {
    const duration = Date.now() - this.startTime;
    
    return `
🔧 CC Ultimate Config Daily Update Complete

📊 Results:
• Discoveries: ${stats.discoveries}
• Applied: ${stats.applied}
• Errors: ${stats.errors}
• Warnings: ${stats.warnings}

⏱️ Duration: ${Math.round(duration / 1000)}s
📅 Time: ${new Date().toISOString()}

${stats.applied > 0 ? '✅ New optimizations applied!' : '📋 No new optimizations today'}
    `.trim();
  }

  /**
   * Check if notification configuration exists
   */
  hasNotificationConfig() {
    return CONFIG.notifications.email || 
           CONFIG.notifications.slack || 
           CONFIG.notifications.discord;
  }

  /**
   * Send Slack notification (placeholder)
   */
  async sendSlackNotification(message) {
    // Implementation would use Slack webhook
    await this.log('Slack notification sent');
  }

  /**
   * Send Discord notification (placeholder)
   */
  async sendDiscordNotification(message) {
    // Implementation would use Discord webhook
    await this.log('Discord notification sent');
  }

  /**
   * Send email notification (placeholder)
   */
  async sendEmailNotification(message) {
    // Implementation would use email service
    await this.log('Email notification sent');
  }

  /**
   * Ensure required directories exist
   */
  async ensureDirectories() {
    const directories = [
      CONFIG.logDir,
      CONFIG.reportsDir,
      path.join(__dirname, '../backups')
    ];

    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Log message to file and console
   */
  async log(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}`;
    
    console.log(logLine);
    
    try {
      await fs.appendFile(this.logFile, logLine + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * Log error message
   */
  async logError(message, error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    
    await this.log(`ERROR: ${message}: ${errorMessage}`);
    
    if (stack) {
      await this.log(`Stack trace: ${stack}`);
    }
  }

  /**
   * Get date string for file naming
   */
  getDateString() {
    return new Date().toISOString().split('T')[0];
  }
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    auto: args.includes('--auto'),
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
    force: args.includes('--force'),
    schedule: args.includes('--schedule')
  };

  const manager = new DailyUpdateManager();

  if (options.schedule) {
    // Run in scheduling mode
    console.log('🕐 Starting daily update scheduler');
    manager.scheduleDaily();
    
    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down scheduler');
      process.exit(0);
    });
    
  } else {
    // Run once
    manager.run(options)
      .then((result) => {
        process.exit(0);
      })
      .catch((error) => {
        console.error('Daily update failed:', error);
        process.exit(1);
      });
  }
}

module.exports = DailyUpdateManager;