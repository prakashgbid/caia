/**
 * Config Auto-Updater
 * Automatically updates CC configurations based on learned patterns
 */

const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

class ConfigAutoUpdater {
    constructor() {
        this.claudePath = '/Users/MAC/.claude';
        this.claudeMdPath = path.join(this.claudePath, 'CLAUDE.md');
        this.hooksPath = path.join(this.claudePath, 'hooks');
        this.projectsPath = '/Users/MAC/Documents/projects';

        this.db = null;
        this.updateHistory = [];
        this.pendingUpdates = [];
    }

    async initialize() {
        // Create database for tracking updates
        await this.setupDatabase();

        // Load update history
        await this.loadUpdateHistory();

        // Ensure config files exist
        await this.ensureConfigFiles();
    }

    async setupDatabase() {
        const dbPath = path.join('/Users/MAC/Documents/projects/caia/cc-orchestrator/data', 'config_updates.db');

        // Ensure data directory exists
        await fs.mkdir(path.dirname(dbPath), { recursive: true });

        this.db = new sqlite3.Database(dbPath);

        return new Promise((resolve, reject) => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS config_updates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    update_type TEXT NOT NULL,
                    target_file TEXT NOT NULL,
                    content_added TEXT,
                    reason TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    success BOOLEAN DEFAULT 1
                )
            `, (err) => {
                if (err) reject(err);
                else {
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS learned_rules (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            rule_type TEXT NOT NULL,
                            rule_content TEXT NOT NULL,
                            confidence REAL DEFAULT 0.5,
                            times_applied INTEGER DEFAULT 0,
                            last_applied TIMESTAMP,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                }
            });
        });
    }

    async loadUpdateHistory() {
        return new Promise((resolve) => {
            this.db.all(`
                SELECT * FROM config_updates
                ORDER BY timestamp DESC
                LIMIT 100
            `, [], (err, rows) => {
                if (err) {
                    console.error('Error loading update history:', err);
                    resolve();
                } else {
                    this.updateHistory = rows || [];
                    resolve();
                }
            });
        });
    }

    async ensureConfigFiles() {
        // Ensure CLAUDE.md exists
        try {
            await fs.access(this.claudeMdPath);
        } catch {
            // Create default CLAUDE.md if it doesn't exist
            await this.createDefaultClaudeMd();
        }
    }

    async createDefaultClaudeMd() {
        const defaultContent = `# CLAUDE.md - CC Orchestrator Enhanced Configuration

## Auto-Generated Rules

This file is automatically updated by the CC Orchestrator based on learned patterns.

## Core Principles

1. **Always check for duplicates** - Never recreate existing functionality
2. **Follow project patterns** - Maintain consistency across the codebase
3. **Reuse components** - Leverage existing implementations
4. **Context awareness** - Consider project context in all decisions

## Learned Patterns

<!-- Patterns will be added here automatically -->

## Error Prevention Rules

<!-- Rules to prevent common errors will be added here -->

## Optimization Guidelines

<!-- Performance and efficiency rules will be added here -->

---
*Last updated: ${new Date().toISOString()}*
`;

        await fs.writeFile(this.claudeMdPath, defaultContent);
    }

    async apply(improvement) {
        try {
            switch (improvement.type) {
                case 'config_update':
                    await this.updateConfig(improvement);
                    break;
                case 'hook_update':
                    await this.updateHook(improvement);
                    break;
                case 'rule_addition':
                    await this.addRule(improvement);
                    break;
                case 'automation':
                    await this.createAutomation(improvement);
                    break;
                case 'immediate':
                    await this.applyImmediate(improvement);
                    break;
                default:
                    console.error(`Unknown improvement type: ${improvement.type}`);
            }

            // Log the update
            await this.logUpdate(improvement);

            return true;
        } catch (error) {
            console.error(`Failed to apply improvement: ${error.message}`);
            await this.logUpdate(improvement, false, error.message);
            return false;
        }
    }

    async updateConfig(improvement) {
        const targetPath = improvement.target === 'CLAUDE.md' ?
            this.claudeMdPath :
            path.join(this.projectsPath, improvement.target);

        // Read current content
        let content = await fs.readFile(targetPath, 'utf-8').catch(() => '');

        // Determine where to add the new content
        if (improvement.action === 'add_rule') {
            content = await this.addRuleToConfig(content, improvement.content);
        } else if (improvement.action === 'update_section') {
            content = await this.updateConfigSection(content, improvement.content, improvement.section);
        } else {
            // Append to end
            content += `\n\n${improvement.content}\n`;
        }

        // Write updated content
        await fs.writeFile(targetPath, content);
    }

    async addRuleToConfig(content, rule) {
        // Find the appropriate section to add the rule
        const sections = {
            'Error Prevention': /## Error Prevention Rules?\n/i,
            'Duplicate': /## Duplicate Prevention?\n/i,
            'Pattern': /## Learned Patterns?\n/i,
            'Optimization': /## Optimization Guidelines?\n/i
        };

        // Determine which section based on rule content
        let section = 'Learned Patterns';
        if (rule.includes('error') || rule.includes('Error')) {
            section = 'Error Prevention';
        } else if (rule.includes('duplicate') || rule.includes('Duplicate')) {
            section = 'Duplicate';
        } else if (rule.includes('optimiz') || rule.includes('performance')) {
            section = 'Optimization';
        }

        const sectionRegex = sections[section] || sections['Pattern'];

        if (sectionRegex.test(content)) {
            // Add to existing section
            const lines = content.split('\n');
            const sectionIndex = lines.findIndex(line => sectionRegex.test(line + '\n'));

            if (sectionIndex !== -1) {
                // Find where section ends (next ## or end of file)
                let endIndex = lines.findIndex((line, i) => i > sectionIndex && line.startsWith('##'));
                if (endIndex === -1) endIndex = lines.length;

                // Insert rule before section end
                const timestamp = new Date().toISOString().split('T')[0];
                const ruleEntry = `\n### [${timestamp}] ${rule}\n`;

                lines.splice(endIndex, 0, ruleEntry);
                content = lines.join('\n');
            }
        } else {
            // Add new section
            const sectionContent = `\n## ${section}\n\n### [${new Date().toISOString().split('T')[0]}] ${rule}\n`;
            content += sectionContent;
        }

        return content;
    }

    async updateConfigSection(content, update, section) {
        // Update a specific section of the config
        const sectionRegex = new RegExp(`## ${section}.*?\n(.*?)(?=##|$)`, 's');

        if (sectionRegex.test(content)) {
            content = content.replace(sectionRegex, (match, sectionContent) => {
                return `## ${section}\n${sectionContent}\n${update}\n`;
            });
        } else {
            // Add new section
            content += `\n## ${section}\n\n${update}\n`;
        }

        return content;
    }

    async updateHook(improvement) {
        const hookPath = path.join(this.hooksPath, `${improvement.target}.sh`);

        // Read existing hook or create new
        let hookContent = await fs.readFile(hookPath, 'utf-8').catch(() => '#!/bin/bash\n\n');

        // Add new functionality
        if (improvement.action === 'add_context') {
            hookContent += `\n# Added by CC Orchestrator: ${new Date().toISOString()}\n`;
            hookContent += improvement.content + '\n';
        } else if (improvement.action === 'replace') {
            hookContent = improvement.content;
        }

        // Make sure hook is executable
        await fs.writeFile(hookPath, hookContent, { mode: 0o755 });
    }

    async addRule(improvement) {
        // Add a learned rule to the database
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO learned_rules (rule_type, rule_content, confidence)
                VALUES (?, ?, ?)
            `, [improvement.ruleType || 'general', improvement.content, improvement.confidence || 0.7],
            (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async createAutomation(improvement) {
        // Create an automation script
        const automationPath = path.join(this.claudePath, 'automations', `${improvement.target}.sh`);

        // Ensure automations directory exists
        await fs.mkdir(path.dirname(automationPath), { recursive: true });

        const scriptContent = `#!/bin/bash
# CC Orchestrator Automation
# Created: ${new Date().toISOString()}
# Purpose: ${improvement.description || improvement.target}

${improvement.content}
`;

        await fs.writeFile(automationPath, scriptContent, { mode: 0o755 });
    }

    async applyImmediate(improvement) {
        // Apply critical fixes immediately
        if (improvement.target === 'CLAUDE.md') {
            // Prepend critical rule to CLAUDE.md
            const content = await fs.readFile(this.claudeMdPath, 'utf-8');
            const updated = `# ⚠️ CRITICAL UPDATE: ${new Date().toISOString()}\n\n${improvement.content}\n\n---\n\n${content}`;
            await fs.writeFile(this.claudeMdPath, updated);
        } else {
            // Apply the improvement based on its action
            await this.apply({
                ...improvement,
                type: improvement.originalType || 'config_update'
            });
        }
    }

    async logUpdate(improvement, success = true, error = null) {
        return new Promise((resolve) => {
            this.db.run(`
                INSERT INTO config_updates (update_type, target_file, content_added, reason, success)
                VALUES (?, ?, ?, ?, ?)
            `, [
                improvement.type,
                improvement.target,
                improvement.content ? improvement.content.substring(0, 500) : null,
                improvement.reason || error,
                success ? 1 : 0
            ], (err) => {
                if (err) console.error('Error logging update:', err);
                resolve();
            });
        });
    }

    async getLearnedRules(minConfidence = 0.5) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT * FROM learned_rules
                WHERE confidence >= ?
                ORDER BY confidence DESC, times_applied DESC
            `, [minConfidence], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async applyLearnedRules() {
        // Apply high-confidence learned rules
        const rules = await this.getLearnedRules(0.8);

        for (const rule of rules) {
            if (!rule.last_applied || new Date(rule.last_applied) < new Date(Date.now() - 86400000)) {
                // Apply rule if not applied in last 24 hours
                await this.apply({
                    type: 'config_update',
                    target: 'CLAUDE.md',
                    action: 'add_rule',
                    content: rule.rule_content,
                    reason: `Learned rule with ${(rule.confidence * 100).toFixed(0)}% confidence`
                });

                // Update last applied
                this.db.run(`
                    UPDATE learned_rules
                    SET last_applied = CURRENT_TIMESTAMP, times_applied = times_applied + 1
                    WHERE id = ?
                `, [rule.id]);
            }
        }
    }

    async updateFromPattern(pattern, confidence = 0.6) {
        // Create update from detected pattern
        const improvement = {
            type: 'config_update',
            target: 'CLAUDE.md',
            action: 'add_rule',
            content: `Pattern detected: ${pattern.description}\n- Recommendation: ${pattern.recommendation}`,
            reason: `Pattern observed ${pattern.frequency} times with ${(confidence * 100).toFixed(0)}% confidence`
        };

        await this.apply(improvement);
    }

    async getUpdateStats() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT
                    COUNT(*) as total_updates,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
                    COUNT(DISTINCT target_file) as files_updated,
                    COUNT(DISTINCT update_type) as update_types
                FROM config_updates
                WHERE timestamp > datetime('now', '-30 days')
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0] || {});
            });
        });
    }
}

module.exports = ConfigAutoUpdater;