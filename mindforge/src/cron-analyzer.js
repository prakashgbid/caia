#!/usr/bin/env node

const cron = require('node-cron');
const AIAnalyzer = require('./ai-analyzer');

class CronAnalyzer {
    constructor() {
        this.analyzer = new AIAnalyzer();
        this.jobs = [];
    }

    async initialize() {
        await this.analyzer.initialize();
        console.log('✅ MindForge Cron Analyzer initialized');
    }

    /**
     * Setup all cron jobs
     */
    setupJobs() {
        // Every 5 minutes - analyze recent conversations
        this.jobs.push(
            cron.schedule('*/5 * * * *', async () => {
                console.log('🔄 Running conversation analysis...');
                try {
                    const count = await this.analyzer.analyzeConversations();
                    if (count > 0) {
                        console.log(`✅ Analyzed ${count} conversations`);
                    }
                } catch (error) {
                    console.error('Error in conversation analysis:', error);
                }
            }, { scheduled: false })
        );

        // Every 30 minutes - generate intelligent suggestions
        this.jobs.push(
            cron.schedule('*/30 * * * *', async () => {
                console.log('🧠 Generating intelligent suggestions...');
                try {
                    const count = await this.analyzer.generateIntelligentSuggestions();
                    console.log(`✅ Generated ${count} new suggestions`);
                } catch (error) {
                    console.error('Error generating suggestions:', error);
                }
            }, { scheduled: false })
        );

        // Every hour - generate insights
        this.jobs.push(
            cron.schedule('0 * * * *', async () => {
                console.log('💡 Generating insights...');
                try {
                    const count = await this.analyzer.generateInsights();
                    console.log(`✅ Generated ${count} new insights`);
                } catch (error) {
                    console.error('Error generating insights:', error);
                }
            }, { scheduled: false })
        );

        // Every 6 hours - comprehensive system analysis
        this.jobs.push(
            cron.schedule('0 */6 * * *', async () => {
                console.log('🔬 Running comprehensive system analysis...');
                try {
                    await this.runComprehensiveAnalysis();
                    console.log('✅ Comprehensive analysis completed');
                } catch (error) {
                    console.error('Error in comprehensive analysis:', error);
                }
            }, { scheduled: false })
        );

        console.log(`✅ Configured ${this.jobs.length} cron jobs`);
    }

    /**
     * Start all cron jobs
     */
    start() {
        this.jobs.forEach(job => job.start());
        console.log('🚀 MindForge Cron Analyzer started');
        console.log('📅 Schedule:');
        console.log('  - Every 5 mins: Analyze conversations');
        console.log('  - Every 30 mins: Generate suggestions');
        console.log('  - Every hour: Generate insights');
        console.log('  - Every 6 hours: Comprehensive analysis');

        // Run initial analysis
        this.runInitialAnalysis();
    }

    /**
     * Stop all cron jobs
     */
    stop() {
        this.jobs.forEach(job => job.stop());
        console.log('🛑 MindForge Cron Analyzer stopped');
    }

    /**
     * Run initial analysis on startup
     */
    async runInitialAnalysis() {
        console.log('🚀 Running initial analysis...');
        try {
            await this.analyzer.analyzeConversations();
            await this.analyzer.generateIntelligentSuggestions();
            await this.analyzer.generateInsights();
            console.log('✅ Initial analysis completed');
        } catch (error) {
            console.error('Error in initial analysis:', error);
        }
    }

    /**
     * Run comprehensive system analysis
     */
    async runComprehensiveAnalysis() {
        const systemState = await this.analyzer.analyzeSystemState();

        // Track progress metrics
        const db = this.analyzer.db;

        // CAIA progress
        if (systemState.cks) {
            await db.trackProgress('caia', 'knowledge_items',
                systemState.cks.total_functions || 0, 'functions');
            await db.trackProgress('caia', 'files_indexed',
                systemState.cks.total_files || 0, 'files');
        }

        // CCU progress
        if (systemState.enhancement) {
            await db.trackProgress('ccu', 'optimizations_active',
                systemState.enhancement.active_optimizations || 0, 'count');
        }

        // Generate comprehensive report
        const stats = await db.getStatistics();
        console.log('📊 System Statistics:');
        console.log(`  - Pending Todos: ${stats.pending_todos}`);
        console.log(`  - Completed Todos: ${stats.completed_todos}`);
        console.log(`  - New Suggestions: ${stats.new_suggestions}`);
        console.log(`  - Total Insights: ${stats.total_insights}`);
        console.log(`  - Total Conversations: ${stats.total_conversations}`);
    }
}

// Run if executed directly
if (require.main === module) {
    const cronAnalyzer = new CronAnalyzer();

    cronAnalyzer.initialize().then(() => {
        cronAnalyzer.setupJobs();
        cronAnalyzer.start();

        // Keep process running
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down cron analyzer...');
            cronAnalyzer.stop();
            process.exit(0);
        });
    });
}

module.exports = CronAnalyzer;