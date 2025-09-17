#!/usr/bin/env node

/**
 * CC Orchestrator - Main Entry Point
 * Autonomous system for enhancing Claude Code interactions
 */

const PromptEnhancer = require('./prompt-enhancer');
const ConfigAutoUpdater = require('./config-updater');
const DuplicatePreventor = require('./duplicate-preventor');
const GapAnalysisEngine = require('./gap-analysis');
const ContextIntelligence = require('./context-intelligence');
const KnowledgeIntegrator = require('./knowledge-integrator');
const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');

class CCOrchestrator {
    constructor() {
        this.components = {
            promptEnhancer: new PromptEnhancer(),
            configUpdater: new ConfigAutoUpdater(),
            duplicatePreventor: new DuplicatePreventor(),
            gapAnalysis: new GapAnalysisEngine(),
            contextIntelligence: new ContextIntelligence(),
            knowledge: new KnowledgeIntegrator()
        };

        this.config = {
            orchestratorPath: path.join(__dirname, '..'),
            knowledgePath: '/Users/MAC/Documents/projects/caia/knowledge-system',
            claudePath: '/Users/MAC/.claude',
            projectPath: '/Users/MAC/Documents/projects',
            logLevel: 'info',
            autoUpdateInterval: 3600000, // 1 hour
            learningEnabled: true,
            duplicateCheckEnabled: true,
            contextEnhancementEnabled: true
        };

        this.stats = {
            promptsEnhanced: 0,
            duplicatesPrevented: 0,
            configsUpdated: 0,
            gapsIdentified: 0,
            learningCycles: 0
        };
    }

    async initialize() {
        console.log(chalk.cyan.bold('\n🚀 CC Orchestrator Initializing...\n'));

        try {
            // Initialize all components
            await this.initializeComponents();

            // Load existing knowledge
            await this.loadKnowledgeBase();

            // Set up hooks
            await this.setupHooks();

            // Start continuous improvement cycle
            this.startContinuousImprovement();

            console.log(chalk.green.bold('✅ CC Orchestrator Ready!\n'));
            this.printStatus();

        } catch (error) {
            console.error(chalk.red('❌ Initialization failed:'), error);
            process.exit(1);
        }
    }

    async initializeComponents() {
        const initTasks = [
            this.components.promptEnhancer.initialize(),
            this.components.configUpdater.initialize(),
            this.components.duplicatePreventor.initialize(),
            this.components.gapAnalysis.initialize(),
            this.components.contextIntelligence.initialize(),
            this.components.knowledge.initialize()
        ];

        await Promise.all(initTasks);
        console.log(chalk.gray('  ✓ All components initialized'));
    }

    async loadKnowledgeBase() {
        // Connect to existing knowledge databases
        const knowledge = await this.components.knowledge.loadDatabases({
            chatHistory: path.join(this.config.knowledgePath, 'data/chat_history.db'),
            patterns: path.join(this.config.knowledgePath, 'data/patterns.db'),
            decisions: '/Users/MAC/Documents/projects/caia/tools/admin-scripts/context/decisions.db',
            learning: path.join(this.config.knowledgePath, 'data/learning_interactions.db')
        });

        console.log(chalk.gray(`  ✓ Loaded ${knowledge.totalRecords} knowledge records`));
    }

    async setupHooks() {
        // Create enhanced hooks for CC interaction
        const hooksPath = path.join(this.config.claudePath, 'hooks');

        // Prompt enhancement hook
        const promptHook = `#!/bin/bash
# CC Orchestrator Prompt Enhancement Hook
# Auto-generated - Do not edit manually

PROMPT="$1"
ENHANCED=$(curl -s -X POST http://localhost:8885/enhance \\
    -H "Content-Type: application/json" \\
    -d "{\\"prompt\\": \\"$PROMPT\\"}" | jq -r '.enhanced')

if [ ! -z "$ENHANCED" ]; then
    echo "$ENHANCED"
else
    echo "$PROMPT"
fi
`;

        // Response analysis hook
        const responseHook = `#!/bin/bash
# CC Orchestrator Response Analysis Hook
# Auto-generated - Do not edit manually

RESPONSE="$1"
curl -s -X POST http://localhost:8885/analyze \\
    -H "Content-Type: application/json" \\
    -d "{\\"response\\": \\"$RESPONSE\\"}" > /dev/null 2>&1
`;

        await fs.writeFile(path.join(hooksPath, 'orchestrator-prompt.sh'), promptHook, { mode: 0o755 });
        await fs.writeFile(path.join(hooksPath, 'orchestrator-response.sh'), responseHook, { mode: 0o755 });

        console.log(chalk.gray('  ✓ Hooks configured'));
    }

    startContinuousImprovement() {
        // Run gap analysis and auto-update periodically
        setInterval(async () => {
            console.log(chalk.blue('\n🔄 Running continuous improvement cycle...'));

            // Analyze gaps
            const gaps = await this.components.gapAnalysis.analyze();
            this.stats.gapsIdentified += gaps.length;

            // Generate and apply improvements
            if (gaps.length > 0) {
                const updates = await this.generateImprovements(gaps);
                await this.applyImprovements(updates);
            }

            this.stats.learningCycles++;
            console.log(chalk.green(`✓ Cycle complete. ${gaps.length} improvements applied.`));

        }, this.config.autoUpdateInterval);

        console.log(chalk.gray('  ✓ Continuous improvement started'));
    }

    async enhancePrompt(prompt, context = {}) {
        // Main prompt enhancement logic
        try {
            // Get current context
            const fullContext = await this.components.contextIntelligence.gatherContext(context);

            // Check for potential duplicates
            const duplicateCheck = await this.components.duplicatePreventor.check(prompt, fullContext);
            if (duplicateCheck.isDuplicate) {
                return {
                    enhanced: `[DUPLICATE DETECTED] Existing implementation found at: ${duplicateCheck.location}\n` +
                             `Use the existing code or enhance it instead.\n\n` +
                             `Original request: ${prompt}`,
                    prevented: true
                };
            }

            // Enhance the prompt
            const enhanced = await this.components.promptEnhancer.enhance(prompt, fullContext);

            // Add learned patterns and preferences
            const withPatterns = await this.addLearnedPatterns(enhanced, fullContext);

            this.stats.promptsEnhanced++;

            return {
                enhanced: withPatterns,
                context: fullContext,
                prevented: false
            };

        } catch (error) {
            console.error(chalk.red('Enhancement error:'), error);
            return { enhanced: prompt, error: error.message };
        }
    }

    async analyzeResponse(response, metadata = {}) {
        // Analyze CC's response for learning and improvement
        try {
            // Check if response creates duplicates
            const duplicateAnalysis = await this.components.duplicatePreventor.analyzeResponse(response);
            if (duplicateAnalysis.creatingDuplicate) {
                this.stats.duplicatesPrevented++;
                console.log(chalk.yellow('⚠️  Duplicate creation detected and prevented'));
            }

            // Extract patterns and insights
            const patterns = await this.components.knowledge.extractPatterns(response, metadata);

            // Identify any gaps or issues
            const issues = await this.components.gapAnalysis.analyzeResponse(response);

            // Update configurations if needed
            if (issues.length > 0) {
                await this.handleIssues(issues);
            }

            // Store for future learning
            await this.components.knowledge.storeInteraction(response, metadata, patterns);

            return {
                patterns: patterns.length,
                issues: issues.length,
                duplicatePrevented: duplicateAnalysis.creatingDuplicate
            };

        } catch (error) {
            console.error(chalk.red('Analysis error:'), error);
            return { error: error.message };
        }
    }

    async addLearnedPatterns(prompt, context) {
        // Add learned patterns and preferences to prompt
        const patterns = await this.components.knowledge.getRelevantPatterns(context);
        const preferences = await this.components.knowledge.getUserPreferences();

        let enhanced = prompt;

        // Add architectural patterns
        if (patterns.architectural && patterns.architectural.length > 0) {
            enhanced += '\n\nArchitectural Patterns to Follow:\n';
            patterns.architectural.forEach(p => {
                enhanced += `- ${p.pattern}: ${p.description}\n`;
            });
        }

        // Add code style preferences
        if (preferences.codeStyle) {
            enhanced += '\n\nCode Style Requirements:\n';
            Object.entries(preferences.codeStyle).forEach(([key, value]) => {
                enhanced += `- ${key}: ${value}\n`;
            });
        }

        // Add reusability checks
        enhanced += '\n\nMandatory Checks:\n';
        enhanced += '1. Check CKS for existing implementations before creating new code\n';
        enhanced += '2. Reuse existing components from the codebase\n';
        enhanced += '3. Follow established patterns in the project\n';
        enhanced += '4. Ensure no duplication of functionality\n';

        // Add specific context
        if (context.currentProject) {
            enhanced += `\nProject Context: Working on ${context.currentProject}\n`;
        }

        if (context.recentWork && context.recentWork.length > 0) {
            enhanced += `\nRecent Work:\n`;
            context.recentWork.slice(0, 3).forEach(work => {
                enhanced += `- ${work}\n`;
            });
        }

        return enhanced;
    }

    async generateImprovements(gaps) {
        // Generate specific improvements based on identified gaps
        const improvements = [];

        for (const gap of gaps) {
            switch (gap.type) {
                case 'repeated_error':
                    improvements.push({
                        type: 'config_update',
                        target: 'CLAUDE.md',
                        action: 'add_rule',
                        content: `# Error Prevention: ${gap.error}\n${gap.solution}`
                    });
                    break;

                case 'missing_context':
                    improvements.push({
                        type: 'hook_update',
                        target: 'context-loader',
                        action: 'add_context',
                        content: gap.requiredContext
                    });
                    break;

                case 'duplicate_pattern':
                    improvements.push({
                        type: 'config_update',
                        target: 'duplicate-check',
                        action: 'strengthen',
                        content: gap.pattern
                    });
                    break;

                case 'inefficient_workflow':
                    improvements.push({
                        type: 'automation',
                        target: gap.workflow,
                        action: 'optimize',
                        content: gap.optimization
                    });
                    break;
            }
        }

        return improvements;
    }

    async applyImprovements(improvements) {
        // Apply the generated improvements
        for (const improvement of improvements) {
            try {
                await this.components.configUpdater.apply(improvement);
                this.stats.configsUpdated++;
                console.log(chalk.green(`  ✓ Applied: ${improvement.type} - ${improvement.target}`));
            } catch (error) {
                console.error(chalk.red(`  ✗ Failed to apply ${improvement.type}:`), error.message);
            }
        }
    }

    async handleIssues(issues) {
        // Handle identified issues immediately
        for (const issue of issues) {
            if (issue.severity === 'critical') {
                // Apply immediate fix
                const fix = await this.generateQuickFix(issue);
                await this.components.configUpdater.applyImmediate(fix);
                console.log(chalk.yellow(`⚡ Applied immediate fix for: ${issue.description}`));
            } else {
                // Queue for next improvement cycle
                await this.components.gapAnalysis.queueForAnalysis(issue);
            }
        }
    }

    async generateQuickFix(issue) {
        // Generate immediate fixes for critical issues
        return {
            type: 'immediate',
            target: issue.component,
            action: issue.suggestedAction,
            content: issue.fix,
            priority: 'critical'
        };
    }

    printStatus() {
        console.log(chalk.cyan('\n📊 Orchestrator Status:'));
        console.log(chalk.gray('  Components:'));
        Object.entries(this.components).forEach(([name, component]) => {
            console.log(chalk.gray(`    • ${name}: `) + chalk.green('active'));
        });
        console.log(chalk.gray('\n  Configuration:'));
        console.log(chalk.gray(`    • Auto-update: Every ${this.config.autoUpdateInterval / 60000} minutes`));
        console.log(chalk.gray(`    • Learning: ${this.config.learningEnabled ? 'enabled' : 'disabled'}`));
        console.log(chalk.gray(`    • Duplicate prevention: ${this.config.duplicateCheckEnabled ? 'enabled' : 'disabled'}`));
        console.log(chalk.gray(`    • Context enhancement: ${this.config.contextEnhancementEnabled ? 'enabled' : 'disabled'}`));
    }

    async startAPIServer() {
        // Start HTTP API for hook integration
        const http = require('http');
        const server = http.createServer(async (req, res) => {
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);

                        if (req.url === '/enhance') {
                            const result = await this.enhancePrompt(data.prompt, data.context || {});
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(result));
                        } else if (req.url === '/analyze') {
                            const result = await this.analyzeResponse(data.response, data.metadata || {});
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(result));
                        } else if (req.url === '/status') {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(this.stats));
                        }
                    } catch (error) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: error.message }));
                    }
                });
            }
        });

        server.listen(8885, () => {
            console.log(chalk.green('\n🌐 API Server running on http://localhost:8885'));
        });
    }
}

// Main execution
if (require.main === module) {
    const orchestrator = new CCOrchestrator();

    orchestrator.initialize()
        .then(() => orchestrator.startAPIServer())
        .catch(error => {
            console.error(chalk.red('Fatal error:'), error);
            process.exit(1);
        });
}

module.exports = CCOrchestrator;