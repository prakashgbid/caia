/**
 * Knowledge Integrator
 * Integrates with existing knowledge databases
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class KnowledgeIntegrator {
    constructor() {
        this.databases = {};
        this.totalRecords = 0;
        this.patterns = [];
        this.preferences = {};
    }

    async initialize() {
        // Initialize connections to knowledge databases
        await this.connectDatabases();
    }

    async connectDatabases() {
        // Connect to all knowledge databases
        const dbPaths = {
            chatHistory: '/Users/MAC/Documents/projects/caia/knowledge-system/data/chat_history.db',
            patterns: '/Users/MAC/Documents/projects/caia/knowledge-system/data/patterns.db',
            decisions: '/Users/MAC/Documents/projects/caia/tools/admin-scripts/context/decisions.db',
            learning: '/Users/MAC/Documents/projects/caia/knowledge-system/data/learning_interactions.db'
        };

        for (const [name, dbPath] of Object.entries(dbPaths)) {
            try {
                this.databases[name] = new sqlite3.Database(dbPath);
            } catch (error) {
                console.error(`Failed to connect to ${name} database:`, error.message);
            }
        }
    }

    async loadDatabases(paths = {}) {
        // Load specific database paths if provided
        for (const [name, dbPath] of Object.entries(paths)) {
            try {
                this.databases[name] = new sqlite3.Database(dbPath);
            } catch (error) {
                console.error(`Failed to load ${name} database:`, error.message);
            }
        }

        // Count total records
        await this.countTotalRecords();

        return { totalRecords: this.totalRecords };
    }

    async countTotalRecords() {
        let total = 0;

        for (const [name, db] of Object.entries(this.databases)) {
            if (db) {
                const count = await this.getRecordCount(db);
                total += count;
            }
        }

        this.totalRecords = total;
    }

    async getRecordCount(db) {
        return new Promise((resolve) => {
            db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
                if (err || !tables) {
                    resolve(0);
                    return;
                }

                let totalCount = 0;
                let processed = 0;

                if (tables.length === 0) {
                    resolve(0);
                    return;
                }

                tables.forEach(table => {
                    if (!table.name.startsWith('sqlite_')) {
                        db.get(`SELECT COUNT(*) as count FROM ${table.name}`, [], (err, row) => {
                            if (!err && row) {
                                totalCount += row.count;
                            }
                            processed++;
                            if (processed === tables.length) {
                                resolve(totalCount);
                            }
                        });
                    } else {
                        processed++;
                        if (processed === tables.length) {
                            resolve(totalCount);
                        }
                    }
                });
            });
        });
    }

    async getRelevantPatterns(context) {
        // Get patterns relevant to the current context
        const patterns = {
            architectural: [],
            behavioral: [],
            code: []
        };

        if (this.databases.patterns) {
            // Get behavioral patterns
            const behavioralPatterns = await new Promise((resolve) => {
                this.databases.patterns.all(`
                    SELECT pattern_type, pattern_data, confidence
                    FROM behavior_patterns
                    WHERE confidence > 0.5
                    ORDER BY confidence DESC
                    LIMIT 10
                `, [], (err, rows) => {
                    if (err) resolve([]);
                    else resolve(rows || []);
                });
            });

            behavioralPatterns.forEach(row => {
                patterns.behavioral.push({
                    pattern: row.pattern_type,
                    description: row.pattern_data,
                    confidence: row.confidence
                });
            });

            // Get code patterns
            const codePatterns = await new Promise((resolve) => {
                this.databases.patterns.all(`
                    SELECT pattern_name, pattern_code, usage_count
                    FROM code_patterns
                    WHERE usage_count > 0
                    ORDER BY usage_count DESC
                    LIMIT 10
                `, [], (err, rows) => {
                    if (err) resolve([]);
                    else resolve(rows || []);
                });
            });

            codePatterns.forEach(row => {
                patterns.code.push({
                    name: row.pattern_name,
                    code: row.pattern_code,
                    usage: row.usage_count
                });
            });
        }

        // Add architectural patterns based on context
        if (context.currentProject === 'caia') {
            patterns.architectural.push({
                pattern: 'Modular Architecture',
                description: 'Separate packages for agents, tools, utils'
            });
            patterns.architectural.push({
                pattern: 'Knowledge-Driven',
                description: 'Use CKS for all knowledge queries'
            });
        }

        return patterns;
    }

    async getUserPreferences() {
        // Get user preferences from interaction history
        const preferences = {
            codeStyle: {},
            workflow: {},
            tools: {}
        };

        if (this.databases.chatHistory) {
            // Analyze recent interactions for preferences
            const recentInteractions = await new Promise((resolve) => {
                this.databases.chatHistory.all(`
                    SELECT content
                    FROM chat_interactions
                    WHERE role = 'user'
                    ORDER BY timestamp DESC
                    LIMIT 100
                `, [], (err, rows) => {
                    if (err) resolve([]);
                    else resolve(rows || []);
                });
            });

            // Extract preferences from interactions
            const keywords = {
                typescript: 0,
                javascript: 0,
                react: 0,
                node: 0,
                test: 0,
                docker: 0
            };

            recentInteractions.forEach(row => {
                const lower = row.content.toLowerCase();
                Object.keys(keywords).forEach(keyword => {
                    if (lower.includes(keyword)) {
                        keywords[keyword]++;
                    }
                });
            });

            // Set preferences based on frequency
            if (keywords.typescript > keywords.javascript) {
                preferences.codeStyle.language = 'TypeScript';
            }
            if (keywords.react > 5) {
                preferences.codeStyle.framework = 'React';
            }
            if (keywords.test > 3) {
                preferences.workflow.testing = 'important';
            }
        }

        // Add known preferences
        preferences.workflow.noCoding = true; // User mentioned CC does all coding
        preferences.workflow.autonomous = true;
        preferences.tools.primaryIDE = 'CC';

        return preferences;
    }

    async extractPatterns(response, metadata) {
        // Extract patterns from CC's response
        const patterns = [];
        const lower = response.toLowerCase();

        // Extract creation patterns
        if (lower.includes('creating') || lower.includes('implementing')) {
            patterns.push({
                type: 'creation',
                action: 'creating',
                timestamp: new Date()
            });
        }

        // Extract error patterns
        if (lower.includes('error') || lower.includes('failed')) {
            patterns.push({
                type: 'error',
                description: response.substring(
                    Math.max(0, lower.indexOf('error') - 50),
                    Math.min(response.length, lower.indexOf('error') + 100)
                ),
                timestamp: new Date()
            });
        }

        // Extract success patterns
        if (lower.includes('success') || lower.includes('completed')) {
            patterns.push({
                type: 'success',
                timestamp: new Date()
            });
        }

        return patterns;
    }

    async storeInteraction(response, metadata, patterns) {
        // Store interaction in learning database
        if (this.databases.learning) {
            return new Promise((resolve) => {
                this.databases.learning.run(`
                    INSERT INTO interactions (session_id, user_input, assistant_response, metadata, timestamp)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    metadata.session_id || 'default',
                    metadata.user_input || '',
                    response.substring(0, 1000), // Limit response size
                    JSON.stringify(metadata),
                    new Date().toISOString()
                ], (err) => {
                    if (err) console.error('Error storing interaction:', err);
                    resolve();
                });
            });
        }
    }

    async getRelatedInteractions(query, limit = 5) {
        // Find related past interactions
        if (this.databases.chatHistory) {
            return new Promise((resolve) => {
                this.databases.chatHistory.all(`
                    SELECT content, timestamp
                    FROM chat_interactions
                    WHERE content LIKE ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                `, [`%${query}%`, limit], (err, rows) => {
                    if (err) resolve([]);
                    else resolve(rows || []);
                });
            });
        }
        return [];
    }

    async getLearningInsights() {
        // Get learning insights from the knowledge base
        if (this.databases.chatHistory) {
            return new Promise((resolve) => {
                this.databases.chatHistory.all(`
                    SELECT insight_type, insight_data, confidence
                    FROM learning_insights
                    WHERE applied = 0 AND confidence > 0.6
                    ORDER BY confidence DESC
                    LIMIT 10
                `, [], (err, rows) => {
                    if (err) {
                        // Table might not exist
                        resolve([]);
                    } else {
                        resolve(rows || []);
                    }
                });
            });
        }
        return [];
    }

    async applyLearningInsight(insightId) {
        // Mark a learning insight as applied
        if (this.databases.chatHistory) {
            return new Promise((resolve) => {
                this.databases.chatHistory.run(`
                    UPDATE learning_insights
                    SET applied = 1, applied_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [insightId], (err) => {
                    if (err) console.error('Error applying insight:', err);
                    resolve();
                });
            });
        }
    }

    async getKnowledgeStats() {
        // Get statistics about the knowledge base
        const stats = {
            totalInteractions: 0,
            totalPatterns: 0,
            totalInsights: 0,
            totalDecisions: 0
        };

        // Count chat interactions
        if (this.databases.chatHistory) {
            const chatCount = await new Promise((resolve) => {
                this.databases.chatHistory.get(
                    "SELECT COUNT(*) as count FROM chat_interactions",
                    [],
                    (err, row) => resolve(row?.count || 0)
                );
            });
            stats.totalInteractions = chatCount;
        }

        // Count patterns
        if (this.databases.patterns) {
            const patternCount = await new Promise((resolve) => {
                this.databases.patterns.get(
                    "SELECT COUNT(*) as count FROM behavior_patterns",
                    [],
                    (err, row) => resolve(row?.count || 0)
                );
            });
            stats.totalPatterns = patternCount;
        }

        return stats;
    }

    async searchKnowledge(query) {
        // Search across all knowledge databases
        const results = {
            interactions: [],
            patterns: [],
            insights: []
        };

        // Search chat history
        if (this.databases.chatHistory) {
            const interactions = await this.getRelatedInteractions(query, 3);
            results.interactions = interactions;
        }

        // Search patterns
        if (this.databases.patterns) {
            const patterns = await new Promise((resolve) => {
                this.databases.patterns.all(`
                    SELECT pattern_type, pattern_data
                    FROM behavior_patterns
                    WHERE pattern_data LIKE ?
                    LIMIT 3
                `, [`%${query}%`], (err, rows) => {
                    if (err) resolve([]);
                    else resolve(rows || []);
                });
            });
            results.patterns = patterns;
        }

        return results;
    }

    async close() {
        // Close all database connections
        for (const db of Object.values(this.databases)) {
            if (db) {
                db.close();
            }
        }
    }
}

module.exports = KnowledgeIntegrator;