const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { promisify } = require('util');

class MindForgeDatabase {
    constructor() {
        this.dbPath = path.join(__dirname, '../data/mindforge.db');
    }

    initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Promisify database methods
                this.run = promisify(this.db.run.bind(this.db));
                this.get = promisify(this.db.get.bind(this.db));
                this.all = promisify(this.db.all.bind(this.db));

                // Create schema
                await this.createSchema();
                resolve();
            });
        });
    }

    async createSchema() {
        // Conversations table - tracks all CC conversations
        await this.run(`
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                user_message TEXT,
                assistant_response TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                analyzed INTEGER DEFAULT 0,
                source TEXT DEFAULT 'claude-code'
            )
        `);

        // Todos table - extracted and manual todos
        await this.run(`
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                category TEXT CHECK(category IN ('caia', 'ccu', 'general')),
                priority TEXT DEFAULT 'P2' CHECK(priority IN ('P0', 'P1', 'P2', 'P3')),
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
                source TEXT CHECK(source IN ('conversation', 'manual', 'ai_suggestion')),
                conversation_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                tags TEXT,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            )
        `);

        // Suggestions table - AI-generated suggestions
        await this.run(`
            CREATE TABLE IF NOT EXISTS suggestions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                category TEXT CHECK(category IN ('architecture', 'feature', 'optimization', 'refactor', 'integration')),
                target TEXT CHECK(target IN ('caia', 'ccu', 'both')),
                rationale TEXT,
                implementation_notes TEXT,
                priority REAL DEFAULT 0.5,
                confidence REAL DEFAULT 0.5,
                status TEXT DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'accepted', 'rejected', 'implemented')),
                generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                reviewed_at DATETIME,
                tags TEXT
            )
        `);

        // Insights table - derived patterns and insights
        await this.run(`
            CREATE TABLE IF NOT EXISTS insights (
                id TEXT PRIMARY KEY,
                type TEXT CHECK(type IN ('pattern', 'trend', 'recommendation', 'warning')),
                title TEXT,
                content TEXT,
                evidence TEXT,
                confidence REAL DEFAULT 0.5,
                impact TEXT CHECK(impact IN ('high', 'medium', 'low')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Progress tracking table
        await this.run(`
            CREATE TABLE IF NOT EXISTS progress (
                id TEXT PRIMARY KEY,
                project TEXT CHECK(project IN ('caia', 'ccu')),
                metric TEXT,
                value REAL,
                unit TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indices
        await this.run('CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_todos_category ON todos(category)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_suggestions_target ON suggestions(target)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_conversations_analyzed ON conversations(analyzed)');
    }

    // Conversation methods
    async addConversation(data) {
        const id = 'conv-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        await this.run(
            `INSERT INTO conversations (id, session_id, user_message, assistant_response, source)
             VALUES (?, ?, ?, ?, ?)`,
            [id, data.session_id, data.user_message, data.assistant_response, data.source || 'claude-code']
        );
        return id;
    }

    async getUnanalyzedConversations() {
        return await this.all('SELECT * FROM conversations WHERE analyzed = 0 ORDER BY timestamp DESC LIMIT 100');
    }

    async markConversationAnalyzed(id) {
        await this.run('UPDATE conversations SET analyzed = 1 WHERE id = ?', [id]);
    }

    // Todo methods
    async createTodo(data) {
        const id = 'todo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        await this.run(
            `INSERT INTO todos (id, title, description, category, priority, source, conversation_id, tags)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, data.title, data.description, data.category, data.priority || 'P2',
             data.source, data.conversation_id, data.tags]
        );
        return id;
    }

    async getTodos(filter = {}) {
        let query = 'SELECT * FROM todos WHERE 1=1';
        const params = [];

        if (filter.category) {
            query += ' AND category = ?';
            params.push(filter.category);
        }

        if (filter.status) {
            query += ' AND status = ?';
            params.push(filter.status);
        }

        query += ' ORDER BY priority ASC, created_at DESC';
        return await this.all(query, params);
    }

    async updateTodo(id, updates) {
        const fields = Object.keys(updates).filter(k => k !== 'id');
        const values = fields.map(k => updates[k]);
        values.push(id);

        const setClause = fields.map(f => `${f} = ?`).join(', ');
        await this.run(
            `UPDATE todos SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            values
        );
    }

    // Suggestion methods
    async createSuggestion(data) {
        const id = 'sug-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        await this.run(
            `INSERT INTO suggestions (id, title, description, category, target, rationale,
             implementation_notes, priority, confidence, tags)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, data.title, data.description, data.category, data.target, data.rationale,
             data.implementation_notes, data.priority || 0.5, data.confidence || 0.5, data.tags]
        );
        return id;
    }

    async getSuggestions(filter = {}) {
        let query = 'SELECT * FROM suggestions WHERE 1=1';
        const params = [];

        if (filter.target) {
            query += ' AND (target = ? OR target = "both")';
            params.push(filter.target);
        }

        if (filter.status) {
            query += ' AND status = ?';
            params.push(filter.status);
        }

        query += ' ORDER BY priority DESC, confidence DESC, generated_at DESC';
        return await this.all(query, params);
    }

    async updateSuggestion(id, updates) {
        const fields = Object.keys(updates).filter(k => k !== 'id');
        const values = fields.map(k => updates[k]);
        values.push(id);

        const setClause = fields.map(f => `${f} = ?`).join(', ');

        if (updates.status === 'reviewed') {
            await this.run(
                `UPDATE suggestions SET ${setClause}, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                values
            );
        } else {
            await this.run(
                `UPDATE suggestions SET ${setClause} WHERE id = ?`,
                values
            );
        }
    }

    // Insight methods
    async createInsight(data) {
        const id = 'ins-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        await this.run(
            `INSERT INTO insights (id, type, title, content, evidence, confidence, impact)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, data.type, data.title, data.content, data.evidence,
             data.confidence || 0.5, data.impact || 'medium']
        );
        return id;
    }

    async getInsights(limit = 10) {
        return await this.all(
            'SELECT * FROM insights ORDER BY created_at DESC LIMIT ?',
            [limit]
        );
    }

    // Progress methods
    async trackProgress(project, metric, value, unit) {
        const id = 'prog-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        await this.run(
            'INSERT INTO progress (id, project, metric, value, unit) VALUES (?, ?, ?, ?, ?)',
            [id, project, metric, value, unit]
        );
        return id;
    }

    async getProgress(project, metric = null) {
        if (metric) {
            return await this.all(
                'SELECT * FROM progress WHERE project = ? AND metric = ? ORDER BY timestamp DESC LIMIT 100',
                [project, metric]
            );
        }
        return await this.all(
            'SELECT * FROM progress WHERE project = ? ORDER BY timestamp DESC LIMIT 100',
            [project]
        );
    }

    // Statistics
    async getStatistics() {
        const stats = await this.get(`
            SELECT
                (SELECT COUNT(*) FROM todos WHERE status != 'completed') as pending_todos,
                (SELECT COUNT(*) FROM todos WHERE status = 'completed') as completed_todos,
                (SELECT COUNT(*) FROM suggestions WHERE status = 'new') as new_suggestions,
                (SELECT COUNT(*) FROM insights) as total_insights,
                (SELECT COUNT(*) FROM conversations) as total_conversations
        `);

        return stats;
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = MindForgeDatabase;