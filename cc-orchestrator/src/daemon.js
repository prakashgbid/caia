#!/usr/bin/env node

/**
 * CC Orchestrator Daemon
 * Runs continuously to monitor and enhance CC interactions
 */

const CCOrchestrator = require('./index');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const cron = require('node-cron');

class CCOrchestratorDaemon {
    constructor() {
        this.orchestrator = new CCOrchestrator();
        this.running = false;
        this.pidFile = path.join('/tmp', 'cc-orchestrator.pid');
        this.logFile = path.join(__dirname, '..', 'logs', 'daemon.log');
    }

    async start() {
        console.log(chalk.cyan.bold('🚀 Starting CC Orchestrator Daemon...'));

        // Check if already running
        if (await this.isRunning()) {
            console.log(chalk.yellow('⚠️  Daemon is already running'));
            process.exit(0);
        }

        // Create PID file
        await this.createPidFile();

        // Initialize orchestrator
        await this.orchestrator.initialize();

        // Start API server
        await this.orchestrator.startAPIServer();

        // Set up scheduled tasks
        this.setupScheduledTasks();

        // Set up signal handlers
        this.setupSignalHandlers();

        this.running = true;
        console.log(chalk.green.bold('✅ CC Orchestrator Daemon is running'));
        console.log(chalk.gray(`PID: ${process.pid}`));
        console.log(chalk.gray(`API: http://localhost:8885`));
        console.log(chalk.gray(`Logs: ${this.logFile}`));

        // Keep process alive
        setInterval(() => {
            if (this.running) {
                this.checkHealth();
            }
        }, 60000); // Check health every minute
    }

    async stop() {
        console.log(chalk.yellow('Stopping CC Orchestrator Daemon...'));
        this.running = false;

        // Remove PID file
        await fs.unlink(this.pidFile).catch(() => {});

        // Close orchestrator
        if (this.orchestrator.components.knowledge) {
            await this.orchestrator.components.knowledge.close();
        }

        console.log(chalk.green('✅ Daemon stopped'));
        process.exit(0);
    }

    async isRunning() {
        try {
            const pid = await fs.readFile(this.pidFile, 'utf-8');
            // Check if process is running
            process.kill(parseInt(pid), 0);
            return true;
        } catch {
            return false;
        }
    }

    async createPidFile() {
        await fs.writeFile(this.pidFile, process.pid.toString());
    }

    setupScheduledTasks() {
        // Run gap analysis every hour
        cron.schedule('0 * * * *', async () => {
            await this.log('Running scheduled gap analysis...');
            const gaps = await this.orchestrator.components.gapAnalysis.analyze();
            await this.log(`Identified ${gaps.length} gaps`);

            if (gaps.length > 0) {
                const improvements = await this.orchestrator.generateImprovements(gaps);
                await this.orchestrator.applyImprovements(improvements);
                await this.log(`Applied ${improvements.length} improvements`);
            }
        });

        // Apply learned rules every 6 hours
        cron.schedule('0 */6 * * *', async () => {
            await this.log('Applying learned rules...');
            await this.orchestrator.components.configUpdater.applyLearnedRules();
        });

        // Clean up old data every day
        cron.schedule('0 0 * * *', async () => {
            await this.log('Running daily cleanup...');
            await this.cleanupOldData();
        });

        // Generate status report every 4 hours
        cron.schedule('0 */4 * * *', async () => {
            await this.generateStatusReport();
        });
    }

    setupSignalHandlers() {
        process.on('SIGTERM', () => this.stop());
        process.on('SIGINT', () => this.stop());
        process.on('uncaughtException', async (error) => {
            await this.log(`Uncaught exception: ${error.message}`, 'error');
            console.error(error);
        });
        process.on('unhandledRejection', async (reason) => {
            await this.log(`Unhandled rejection: ${reason}`, 'error');
            console.error(reason);
        });
    }

    async checkHealth() {
        try {
            // Check if components are healthy
            const health = {
                promptEnhancer: !!this.orchestrator.components.promptEnhancer,
                configUpdater: !!this.orchestrator.components.configUpdater,
                duplicatePreventor: !!this.orchestrator.components.duplicatePreventor,
                gapAnalysis: !!this.orchestrator.components.gapAnalysis,
                contextIntelligence: !!this.orchestrator.components.contextIntelligence,
                knowledge: !!this.orchestrator.components.knowledge
            };

            const unhealthy = Object.entries(health).filter(([_, healthy]) => !healthy);

            if (unhealthy.length > 0) {
                await this.log(`Unhealthy components: ${unhealthy.map(([name]) => name).join(', ')}`, 'warning');

                // Try to reinitialize unhealthy components
                for (const [name] of unhealthy) {
                    try {
                        await this.orchestrator.components[name].initialize();
                        await this.log(`Reinitialized ${name}`, 'info');
                    } catch (error) {
                        await this.log(`Failed to reinitialize ${name}: ${error.message}`, 'error');
                    }
                }
            }
        } catch (error) {
            await this.log(`Health check error: ${error.message}`, 'error');
        }
    }

    async cleanupOldData() {
        // Clean up old logs and temporary data
        try {
            const logsDir = path.join(__dirname, '..', 'logs');
            const files = await fs.readdir(logsDir);

            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

            for (const file of files) {
                if (file.endsWith('.log') && file !== 'daemon.log') {
                    const filePath = path.join(logsDir, file);
                    const stats = await fs.stat(filePath);

                    if (stats.mtime.getTime() < thirtyDaysAgo) {
                        await fs.unlink(filePath);
                        await this.log(`Deleted old log file: ${file}`);
                    }
                }
            }
        } catch (error) {
            await this.log(`Cleanup error: ${error.message}`, 'error');
        }
    }

    async generateStatusReport() {
        try {
            const stats = this.orchestrator.stats;
            const configStats = await this.orchestrator.components.configUpdater.getUpdateStats();
            const gapSummary = await this.orchestrator.components.gapAnalysis.getGapSummary();
            const contextSummary = await this.orchestrator.components.contextIntelligence.getContextSummary();
            const knowledgeStats = await this.orchestrator.components.knowledge.getKnowledgeStats();

            const report = {
                timestamp: new Date().toISOString(),
                orchestratorStats: stats,
                configUpdates: configStats,
                gaps: gapSummary,
                context: contextSummary,
                knowledge: knowledgeStats
            };

            // Write report to file
            const reportPath = path.join(__dirname, '..', 'logs', `status-${Date.now()}.json`);
            await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

            await this.log(`Status report generated: ${reportPath}`);

            // Log summary
            await this.log(`
📊 Status Summary:
  • Prompts enhanced: ${stats.promptsEnhanced}
  • Duplicates prevented: ${stats.duplicatesPrevented}
  • Configs updated: ${stats.configsUpdated}
  • Gaps identified: ${stats.gapsIdentified}
  • Learning cycles: ${stats.learningCycles}
  • Total knowledge records: ${knowledgeStats.totalInteractions}
            `);
        } catch (error) {
            await this.log(`Failed to generate status report: ${error.message}`, 'error');
        }
    }

    async log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

        // Ensure logs directory exists
        await fs.mkdir(path.dirname(this.logFile), { recursive: true });

        // Append to log file
        await fs.appendFile(this.logFile, logEntry).catch(console.error);

        // Also log to console with appropriate color
        const colors = {
            info: 'gray',
            warning: 'yellow',
            error: 'red',
            success: 'green'
        };

        const color = colors[level] || 'white';
        console.log(chalk[color](`[${level.toUpperCase()}] ${message}`));
    }
}

// Command line interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];

    const daemon = new CCOrchestratorDaemon();

    switch (command) {
        case 'start':
            daemon.start();
            break;

        case 'stop':
            daemon.stop();
            break;

        case 'restart':
            daemon.stop().then(() => {
                setTimeout(() => daemon.start(), 2000);
            });
            break;

        case 'status':
            daemon.isRunning().then(running => {
                if (running) {
                    console.log(chalk.green('✅ CC Orchestrator Daemon is running'));
                } else {
                    console.log(chalk.red('❌ CC Orchestrator Daemon is not running'));
                }
                process.exit(0);
            });
            break;

        default:
            console.log(chalk.yellow('Usage: daemon.js [start|stop|restart|status]'));
            process.exit(1);
    }
}

module.exports = CCOrchestratorDaemon;