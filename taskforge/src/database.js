const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const path = require('path');

class TaskForgeDatabase {
    constructor(dbPath = path.join(__dirname, '../data/taskforge.db')) {
        this.dbPath = dbPath;
        this.db = null;
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) return reject(err);

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
        // Main tasks table with comprehensive fields
        await this.run(`
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                level TEXT CHECK(level IN ('initiative', 'epic', 'feature', 'story', 'task', 'subtask', 'microtask')),
                parent_id TEXT,
                path TEXT,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'assigned', 'in_progress', 'review', 'completed', 'blocked')),
                priority TEXT DEFAULT 'P2' CHECK(priority IN ('P0', 'P1', 'P2', 'P3')),
                complexity TEXT CHECK(complexity IN ('trivial', 'simple', 'medium', 'complex', 'epic')),
                estimated_hours REAL DEFAULT 0,
                actual_hours REAL DEFAULT 0,
                assigned_to TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        `);

        // Acceptance criteria table
        await this.run(`
            CREATE TABLE IF NOT EXISTS acceptance_criteria (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                given_statement TEXT,
                when_statement TEXT,
                then_statement TEXT,
                priority TEXT CHECK(priority IN ('must', 'should', 'could')),
                testable INTEGER DEFAULT 1,
                completed INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        `);

        // API specifications table
        await this.run(`
            CREATE TABLE IF NOT EXISTS api_specs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                method TEXT CHECK(method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')),
                status TEXT CHECK(status IN ('new', 'existing', 'modify')),
                cks_reference TEXT,
                request_schema TEXT,
                response_schema TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        `);

        // Test cases table
        await this.run(`
            CREATE TABLE IF NOT EXISTS test_cases (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                type TEXT CHECK(type IN ('unit', 'integration', 'e2e')),
                description TEXT,
                steps TEXT,
                expected_result TEXT,
                edge_cases TEXT,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'passed', 'failed', 'skipped')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                executed_at DATETIME,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        `);

        // Git commits table
        await this.run(`
            CREATE TABLE IF NOT EXISTS commits (
                hash TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                message TEXT,
                author TEXT,
                timestamp DATETIME,
                files_changed TEXT,
                additions INTEGER DEFAULT 0,
                deletions INTEGER DEFAULT 0,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        `);

        // Task history/audit table
        await this.run(`
            CREATE TABLE IF NOT EXISTS task_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                event TEXT NOT NULL,
                actor TEXT,
                changes TEXT,
                reason TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        `);

        // Task dependencies table
        await this.run(`
            CREATE TABLE IF NOT EXISTS task_dependencies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                depends_on_id TEXT NOT NULL,
                type TEXT DEFAULT 'blocks' CHECK(type IN ('blocks', 'relates', 'duplicates')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (depends_on_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        `);

        // Labels table
        await this.run(`
            CREATE TABLE IF NOT EXISTS task_labels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                label TEXT NOT NULL,
                color TEXT DEFAULT '#808080',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        `);

        // Create indexes for performance
        await this.run('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_tasks_level ON tasks(level)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_commits_task ON commits(task_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_history_task ON task_history(task_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_criteria_task ON acceptance_criteria(task_id)');

        // Create trigger to update updated_at
        await this.run(`
            CREATE TRIGGER IF NOT EXISTS update_task_timestamp
            AFTER UPDATE ON tasks
            FOR EACH ROW
            BEGIN
                UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END
        `);
    }

    // CRUD Operations
    async createTask(taskData) {
        const id = taskData.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const sql = `
            INSERT INTO tasks (id, title, description, level, parent_id, path, status, priority, complexity, estimated_hours, assigned_to)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await this.run(sql, [
            id,
            taskData.title,
            taskData.description,
            taskData.level,
            taskData.parent_id,
            taskData.path,
            taskData.status || 'pending',
            taskData.priority || 'P2',
            taskData.complexity,
            taskData.estimated_hours || 0,
            taskData.assigned_to
        ]);

        // Add to history
        await this.addHistory(id, 'created', 'system', null, 'Task created');

        return id;
    }

    async getTask(taskId) {
        const task = await this.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        if (!task) return null;

        // Get related data
        task.acceptance_criteria = await this.all('SELECT * FROM acceptance_criteria WHERE task_id = ?', [taskId]);
        task.api_specs = await this.all('SELECT * FROM api_specs WHERE task_id = ?', [taskId]);
        task.test_cases = await this.all('SELECT * FROM test_cases WHERE task_id = ?', [taskId]);
        task.commits = await this.all('SELECT * FROM commits WHERE task_id = ?', [taskId]);
        task.history = await this.all('SELECT * FROM task_history WHERE task_id = ? ORDER BY timestamp DESC', [taskId]);
        task.dependencies = await this.all('SELECT * FROM task_dependencies WHERE task_id = ?', [taskId]);
        task.labels = await this.all('SELECT label, color FROM task_labels WHERE task_id = ?', [taskId]);
        task.children = await this.all('SELECT id, title, level, status FROM tasks WHERE parent_id = ?', [taskId]);

        return task;
    }

    async updateTask(taskId, updates) {
        const currentTask = await this.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        if (!currentTask) throw new Error('Task not found');

        const fields = [];
        const values = [];
        const changes = {};

        for (const [key, value] of Object.entries(updates)) {
            if (currentTask[key] !== value && key !== 'id') {
                fields.push(`${key} = ?`);
                values.push(value);
                changes[key] = { old: currentTask[key], new: value };
            }
        }

        if (fields.length > 0) {
            values.push(taskId);
            await this.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
            await this.addHistory(taskId, 'updated', 'system', JSON.stringify(changes), 'Task updated');
        }

        return this.getTask(taskId);
    }

    async deleteTask(taskId) {
        // Delete cascades to all related tables due to foreign key constraints
        await this.run('DELETE FROM tasks WHERE id = ?', [taskId]);
    }

    async addAcceptanceCriteria(taskId, criteria) {
        const id = `ac-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        await this.run(`
            INSERT INTO acceptance_criteria (id, task_id, given_statement, when_statement, then_statement, priority, testable)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [id, taskId, criteria.given, criteria.when, criteria.then, criteria.priority || 'should', criteria.testable !== false ? 1 : 0]);

        return id;
    }

    async addApiSpec(taskId, spec) {
        const id = `api-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        await this.run(`
            INSERT INTO api_specs (id, task_id, endpoint, method, status, cks_reference, request_schema, response_schema)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, taskId, spec.endpoint, spec.method, spec.status,
            spec.cks_reference, JSON.stringify(spec.request_schema), JSON.stringify(spec.response_schema)
        ]);

        return id;
    }

    async addTestCase(taskId, testCase) {
        const id = `tc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        await this.run(`
            INSERT INTO test_cases (id, task_id, type, description, steps, expected_result, edge_cases)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            id, taskId, testCase.type, testCase.description,
            JSON.stringify(testCase.steps), testCase.expected_result, JSON.stringify(testCase.edge_cases)
        ]);

        return id;
    }

    async linkCommit(taskId, commit) {
        await this.run(`
            INSERT OR REPLACE INTO commits (hash, task_id, message, author, timestamp, files_changed, additions, deletions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            commit.hash, taskId, commit.message, commit.author,
            commit.timestamp, JSON.stringify(commit.files_changed), commit.additions, commit.deletions
        ]);
    }

    async addHistory(taskId, event, actor, changes, reason) {
        await this.run(`
            INSERT INTO task_history (task_id, event, actor, changes, reason)
            VALUES (?, ?, ?, ?, ?)
        `, [taskId, event, actor, changes, reason]);
    }

    async addDependency(taskId, dependsOnId, type = 'blocks') {
        await this.run(`
            INSERT INTO task_dependencies (task_id, depends_on_id, type)
            VALUES (?, ?, ?)
        `, [taskId, dependsOnId, type]);
    }

    async addLabel(taskId, label, color = '#808080') {
        await this.run(`
            INSERT INTO task_labels (task_id, label, color)
            VALUES (?, ?, ?)
        `, [taskId, label, color]);
    }

    // Query methods
    async getTaskHierarchy(rootId = null) {
        const buildTree = async (parentId = null, level = 0) => {
            const tasks = await this.all(
                'SELECT * FROM tasks WHERE ' + (parentId ? 'parent_id = ?' : 'parent_id IS NULL'),
                parentId ? [parentId] : []
            );

            const result = [];
            for (const task of tasks) {
                const node = { ...task, level, children: [] };
                if (level < 7) { // Max depth protection
                    node.children = await buildTree(task.id, level + 1);
                }
                result.push(node);
            }
            return result;
        };

        if (rootId) {
            const root = await this.getTask(rootId);
            if (root) {
                root.children = await buildTree(rootId, 1);
                return [root];
            }
        }

        return await buildTree(null, 0);
    }

    async getTasksByStatus(status) {
        return await this.all('SELECT * FROM tasks WHERE status = ?', [status]);
    }

    async getTasksByAssignee(assignee) {
        return await this.all('SELECT * FROM tasks WHERE assigned_to = ?', [assignee]);
    }

    async searchTasks(query) {
        return await this.all(`
            SELECT * FROM tasks
            WHERE title LIKE ? OR description LIKE ?
            ORDER BY created_at DESC
            LIMIT 50
        `, [`%${query}%`, `%${query}%`]);
    }

    /**
     * ============================================
     * PROJECT METHODS
     * ============================================
     */

    async createProject(data) {
        const id = 'project-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        await this.run(
            'INSERT INTO projects (id, name, description, owner) VALUES (?, ?, ?, ?)',
            [id, data.name, data.description, data.owner]
        );
        return id;
    }

    async getProject(id) {
        return await this.get('SELECT * FROM projects WHERE id = ?', [id]);
    }

    async getProjectByName(name) {
        return await this.get('SELECT * FROM projects WHERE name = ?', [name]);
    }

    async getAllProjects() {
        return await this.all('SELECT * FROM projects ORDER BY created_at DESC');
    }

    async getProjectTasks(projectId) {
        return await this.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC', [projectId]);
    }

    async updateProject(id, updates) {
        const fields = Object.keys(updates).filter(k => k !== 'id');
        const values = fields.map(k => updates[k]);
        values.push(id);

        const setClause = fields.map(f => `${f} = ?`).join(', ');
        await this.run(
            `UPDATE projects SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            values
        );
        return await this.getProject(id);
    }

    async getStatistics() {
        const stats = await this.get(`
            SELECT
                COUNT(*) as total_tasks,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
                COUNT(CASE WHEN status = 'blocked' THEN 1 END) as blocked,
                AVG(actual_hours) as avg_actual_hours,
                AVG(estimated_hours) as avg_estimated_hours
            FROM tasks
        `);

        const byLevel = await this.all(`
            SELECT level, COUNT(*) as count
            FROM tasks
            GROUP BY level
        `);

        const byPriority = await this.all(`
            SELECT priority, COUNT(*) as count
            FROM tasks
            GROUP BY priority
        `);

        return { ...stats, by_level: byLevel, by_priority: byPriority };
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = TaskForgeDatabase;