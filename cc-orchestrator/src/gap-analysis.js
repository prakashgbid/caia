/**
 * Gap Analysis Engine
 * Identifies gaps and improvements in CC's behavior
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');

class GapAnalysisEngine {
    constructor() {
        this.db = null;
        this.analysisQueue = [];
        this.patterns = {
            errors: new Map(),
            inefficiencies: new Map(),
            missingContext: new Map(),
            duplicates: new Map()
        };
        this.thresholds = {
            errorRepetition: 3,        // Same error 3 times = gap
            inefficiencyScore: 0.6,    // Efficiency below 60% = gap
            contextMissRate: 0.3,      // Missing context 30% of time = gap
            duplicateAttempts: 2       // 2 duplicate attempts = gap
        };
    }

    async initialize() {
        await this.setupDatabase();
        await this.loadHistoricalPatterns();
    }

    async setupDatabase() {
        const dbPath = path.join('/Users/MAC/Documents/projects/caia/cc-orchestrator/data', 'gap_analysis.db');

        await fs.mkdir(path.dirname(dbPath), { recursive: true });
        this.db = new sqlite3.Database(dbPath);

        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS identified_gaps (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        gap_type TEXT NOT NULL,
                        description TEXT NOT NULL,
                        severity TEXT DEFAULT 'medium',
                        frequency INTEGER DEFAULT 1,
                        proposed_solution TEXT,
                        applied BOOLEAN DEFAULT 0,
                        identified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        resolved_at TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                });

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS interaction_analysis (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT,
                        interaction_type TEXT,
                        success BOOLEAN,
                        error_message TEXT,
                        context_completeness REAL,
                        duplicate_attempted BOOLEAN DEFAULT 0,
                        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                });

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS efficiency_metrics (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        task_type TEXT,
                        expected_time INTEGER,
                        actual_time INTEGER,
                        lines_of_code INTEGER,
                        reuse_percentage REAL,
                        quality_score REAL,
                        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    async loadHistoricalPatterns() {
        // Load patterns from interaction history
        return new Promise((resolve) => {
            this.db.all(`
                SELECT gap_type, description, frequency
                FROM identified_gaps
                WHERE applied = 0 AND identified_at > datetime('now', '-7 days')
            `, [], (err, rows) => {
                if (err) {
                    console.error('Error loading patterns:', err);
                    resolve();
                } else {
                    rows.forEach(row => {
                        if (row.gap_type === 'repeated_error') {
                            this.patterns.errors.set(row.description, row.frequency);
                        } else if (row.gap_type === 'inefficient_workflow') {
                            this.patterns.inefficiencies.set(row.description, row.frequency);
                        }
                    });
                    resolve();
                }
            });
        });
    }

    async analyze() {
        // Main analysis function
        const gaps = [];

        // Analyze different aspects
        const analyses = await Promise.all([
            this.analyzeErrors(),
            this.analyzeEfficiency(),
            this.analyzeContext(),
            this.analyzeDuplicates(),
            this.analyzePatterns()
        ]);

        // Combine all identified gaps
        analyses.forEach(analysis => {
            gaps.push(...analysis);
        });

        // Store gaps in database
        for (const gap of gaps) {
            await this.storeGap(gap);
        }

        return gaps;
    }

    async analyzeErrors() {
        // Analyze recurring errors
        const gaps = [];

        return new Promise((resolve) => {
            this.db.all(`
                SELECT error_message, COUNT(*) as count
                FROM interaction_analysis
                WHERE success = 0 AND error_message IS NOT NULL
                AND timestamp > datetime('now', '-24 hours')
                GROUP BY error_message
                HAVING count >= ?
            `, [this.thresholds.errorRepetition], (err, rows) => {
                if (err) {
                    console.error('Error analyzing errors:', err);
                    resolve([]);
                } else {
                    rows.forEach(row => {
                        gaps.push({
                            type: 'repeated_error',
                            error: row.error_message,
                            frequency: row.count,
                            severity: row.count >= 5 ? 'high' : 'medium',
                            solution: this.generateErrorSolution(row.error_message)
                        });
                    });
                    resolve(gaps);
                }
            });
        });
    }

    async analyzeEfficiency() {
        // Analyze workflow efficiency
        const gaps = [];

        return new Promise((resolve) => {
            this.db.all(`
                SELECT task_type,
                       AVG(actual_time) as avg_actual,
                       AVG(expected_time) as avg_expected,
                       AVG(reuse_percentage) as avg_reuse,
                       COUNT(*) as task_count
                FROM efficiency_metrics
                WHERE timestamp > datetime('now', '-24 hours')
                GROUP BY task_type
            `, [], (err, rows) => {
                if (err) {
                    console.error('Error analyzing efficiency:', err);
                    resolve([]);
                } else {
                    rows.forEach(row => {
                        const efficiencyScore = row.avg_expected / row.avg_actual;

                        if (efficiencyScore < this.thresholds.inefficiencyScore) {
                            gaps.push({
                                type: 'inefficient_workflow',
                                workflow: row.task_type,
                                currentEfficiency: efficiencyScore,
                                reuseRate: row.avg_reuse,
                                severity: efficiencyScore < 0.3 ? 'high' : 'medium',
                                optimization: this.generateOptimization(row)
                            });
                        }

                        if (row.avg_reuse < 0.3) {
                            gaps.push({
                                type: 'low_reuse',
                                workflow: row.task_type,
                                reuseRate: row.avg_reuse,
                                severity: 'medium',
                                solution: 'Increase component reuse and check CKS more frequently'
                            });
                        }
                    });
                    resolve(gaps);
                }
            });
        });
    }

    async analyzeContext() {
        // Analyze context completeness
        const gaps = [];

        return new Promise((resolve) => {
            this.db.all(`
                SELECT AVG(context_completeness) as avg_completeness,
                       COUNT(*) as total,
                       SUM(CASE WHEN context_completeness < 0.5 THEN 1 ELSE 0 END) as incomplete_count
                FROM interaction_analysis
                WHERE timestamp > datetime('now', '-24 hours')
            `, [], (err, rows) => {
                if (err) {
                    console.error('Error analyzing context:', err);
                    resolve([]);
                } else {
                    const row = rows[0];
                    if (row && row.total > 0) {
                        const missRate = row.incomplete_count / row.total;

                        if (missRate > this.thresholds.contextMissRate) {
                            gaps.push({
                                type: 'missing_context',
                                missRate: missRate,
                                avgCompleteness: row.avg_completeness,
                                severity: missRate > 0.5 ? 'high' : 'medium',
                                requiredContext: this.identifyMissingContext()
                            });
                        }
                    }
                    resolve(gaps);
                }
            });
        });
    }

    async analyzeDuplicates() {
        // Analyze duplicate creation attempts
        const gaps = [];

        return new Promise((resolve) => {
            this.db.all(`
                SELECT COUNT(*) as duplicate_attempts
                FROM interaction_analysis
                WHERE duplicate_attempted = 1
                AND timestamp > datetime('now', '-24 hours')
            `, [], (err, rows) => {
                if (err) {
                    console.error('Error analyzing duplicates:', err);
                    resolve([]);
                } else {
                    const count = rows[0]?.duplicate_attempts || 0;

                    if (count >= this.thresholds.duplicateAttempts) {
                        gaps.push({
                            type: 'duplicate_pattern',
                            attempts: count,
                            severity: count >= 5 ? 'critical' : 'high',
                            pattern: 'CC repeatedly attempts to create duplicates',
                            solution: 'Strengthen duplicate prevention hooks and CKS integration'
                        });
                    }
                    resolve(gaps);
                }
            });
        });
    }

    async analyzePatterns() {
        // Analyze behavioral patterns
        const gaps = [];

        // Check for patterns in the queue
        const patternGroups = this.groupQueuePatterns();

        for (const [pattern, occurrences] of patternGroups) {
            if (occurrences >= 3) {
                gaps.push({
                    type: 'behavior_pattern',
                    pattern: pattern,
                    occurrences: occurrences,
                    severity: 'low',
                    recommendation: `Automate or optimize this recurring pattern: ${pattern}`
                });
            }
        }

        return gaps;
    }

    groupQueuePatterns() {
        // Group similar items in the analysis queue
        const groups = new Map();

        this.analysisQueue.forEach(item => {
            const key = `${item.type}_${item.category}`;
            groups.set(key, (groups.get(key) || 0) + 1);
        });

        return groups;
    }

    generateErrorSolution(errorMessage) {
        // Generate solution based on error type
        const errorLower = errorMessage.toLowerCase();

        if (errorLower.includes('duplicate')) {
            return 'Enhance duplicate detection before code generation';
        } else if (errorLower.includes('undefined') || errorLower.includes('null')) {
            return 'Add null checks and validation';
        } else if (errorLower.includes('import') || errorLower.includes('module')) {
            return 'Verify module paths and dependencies';
        } else if (errorLower.includes('type') || errorLower.includes('typescript')) {
            return 'Add type definitions and improve TypeScript configuration';
        } else if (errorLower.includes('permission') || errorLower.includes('access')) {
            return 'Check file permissions and access rights';
        } else {
            return 'Add error handling and validation for this scenario';
        }
    }

    generateOptimization(metrics) {
        // Generate optimization based on metrics
        const optimizations = [];

        if (metrics.avg_reuse < 0.3) {
            optimizations.push('Increase component reuse');
        }
        if (metrics.avg_actual > metrics.avg_expected * 2) {
            optimizations.push('Streamline workflow steps');
        }
        if (metrics.task_count > 10) {
            optimizations.push('Create automation for this frequent task');
        }

        return optimizations.join(', ') || 'Analyze workflow for improvement opportunities';
    }

    identifyMissingContext() {
        // Identify what context is commonly missing
        const commonMissing = [
            'Current project structure',
            'Recent changes and commits',
            'Available components and modules',
            'Project dependencies',
            'User preferences and patterns'
        ];

        // In a real implementation, this would analyze actual missing context
        return commonMissing;
    }

    async analyzeResponse(response) {
        // Analyze a CC response for issues
        const issues = [];
        const lower = response.toLowerCase();

        // Check for common issues
        if (lower.includes('error') || lower.includes('failed')) {
            issues.push({
                type: 'error_in_response',
                description: 'Response contains error indicators',
                severity: 'medium',
                suggestedAction: 'analyze_error',
                fix: 'Add error prevention rule'
            });
        }

        if (lower.includes('creating new') && lower.includes('component')) {
            // Log potential duplicate attempt
            await this.logInteraction({
                interaction_type: 'creation',
                duplicate_attempted: true,
                context_completeness: 0.5
            });
        }

        if (lower.includes('i\'m not sure') || lower.includes('i don\'t have')) {
            issues.push({
                type: 'missing_information',
                description: 'CC lacks necessary information',
                severity: 'low',
                suggestedAction: 'enhance_context',
                fix: 'Provide more context in prompts'
            });
        }

        return issues;
    }

    async queueForAnalysis(item) {
        // Queue an item for later analysis
        this.analysisQueue.push({
            ...item,
            timestamp: new Date()
        });

        // Process queue if it gets large
        if (this.analysisQueue.length >= 50) {
            await this.processQueue();
        }
    }

    async processQueue() {
        // Process the analysis queue
        const items = [...this.analysisQueue];
        this.analysisQueue = [];

        // Group by type and analyze
        const typeGroups = {};
        items.forEach(item => {
            if (!typeGroups[item.type]) {
                typeGroups[item.type] = [];
            }
            typeGroups[item.type].push(item);
        });

        // Process each group
        for (const [type, typeItems] of Object.entries(typeGroups)) {
            if (typeItems.length >= 3) {
                // Pattern detected
                await this.storeGap({
                    type: 'pattern',
                    description: `Recurring ${type}: ${typeItems.length} occurrences`,
                    severity: typeItems.length >= 10 ? 'high' : 'medium',
                    solution: `Automate handling of ${type}`
                });
            }
        }
    }

    async storeGap(gap) {
        return new Promise((resolve) => {
            this.db.run(`
                INSERT INTO identified_gaps (gap_type, description, severity, frequency, proposed_solution)
                VALUES (?, ?, ?, ?, ?)
            `, [
                gap.type,
                gap.description || JSON.stringify(gap),
                gap.severity || 'medium',
                gap.frequency || 1,
                gap.solution || gap.optimization || gap.recommendation || ''
            ], (err) => {
                if (err) console.error('Error storing gap:', err);
                resolve();
            });
        });
    }

    async logInteraction(interaction) {
        return new Promise((resolve) => {
            this.db.run(`
                INSERT INTO interaction_analysis (session_id, interaction_type, success, error_message, context_completeness, duplicate_attempted)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                interaction.session_id || 'default',
                interaction.interaction_type || 'general',
                interaction.success !== false,
                interaction.error_message || null,
                interaction.context_completeness || 1.0,
                interaction.duplicate_attempted || false
            ], (err) => {
                if (err) console.error('Error logging interaction:', err);
                resolve();
            });
        });
    }

    async logEfficiency(metrics) {
        return new Promise((resolve) => {
            this.db.run(`
                INSERT INTO efficiency_metrics (task_type, expected_time, actual_time, lines_of_code, reuse_percentage, quality_score)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                metrics.task_type,
                metrics.expected_time || 60,
                metrics.actual_time || 60,
                metrics.lines_of_code || 0,
                metrics.reuse_percentage || 0,
                metrics.quality_score || 0.5
            ], (err) => {
                if (err) console.error('Error logging efficiency:', err);
                resolve();
            });
        });
    }

    async getGapSummary() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT gap_type, COUNT(*) as count, MAX(severity) as max_severity
                FROM identified_gaps
                WHERE applied = 0
                GROUP BY gap_type
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }
}

module.exports = GapAnalysisEngine;