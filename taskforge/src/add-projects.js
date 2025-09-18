#!/usr/bin/env node

/**
 * Migration script to add project support to TaskForge
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { promisify } = require('util');

const DB_PATH = path.join(__dirname, '../data/taskforge.db');

async function addProjectSupport() {
    const db = new sqlite3.Database(DB_PATH);
    const run = promisify(db.run.bind(db));
    const get = promisify(db.get.bind(db));

    try {
        console.log('🔄 Adding project support to TaskForge...');

        // Create projects table
        await run(`
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                owner TEXT,
                status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'completed')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Projects table created');

        // Check if project_id column exists in tasks table
        const tableInfo = await promisify(db.all.bind(db))("PRAGMA table_info(tasks)");
        const hasProjectId = tableInfo.some(col => col.name === 'project_id');

        if (!hasProjectId) {
            // Add project_id column to tasks table
            await run(`ALTER TABLE tasks ADD COLUMN project_id TEXT`);
            console.log('✅ Added project_id to tasks table');
        }

        // Create default CAIA project
        const projectId = `project-${Date.now()}-caia`;
        await run(`
            INSERT OR IGNORE INTO projects (id, name, description, owner, status)
            VALUES (?, ?, ?, ?, ?)
        `, [
            projectId,
            'caia-project',
            'CAIA Dashboard and related infrastructure improvements',
            'CAIA Team',
            'active'
        ]);

        console.log('✅ Created caia-project');

        // Get the project ID (in case it already existed)
        const project = await get(`SELECT id FROM projects WHERE name = 'caia-project'`);

        // Update existing tasks with caia-dashboard label to belong to caia-project
        await run(`
            UPDATE tasks
            SET project_id = ?
            WHERE id IN (
                SELECT task_id FROM task_labels WHERE label = 'caia-dashboard'
            )
        `, [project.id]);

        console.log('✅ Migrated existing caia-dashboard tasks to caia-project');

        // Add project CRUD methods to database class
        console.log(`
📝 To use projects in your code, add these methods to database.js:

// Project methods
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
        `);

    } catch (error) {
        console.error('❌ Error adding project support:', error);
    } finally {
        db.close();
    }
}

// Run if executed directly
if (require.main === module) {
    addProjectSupport();
}

module.exports = { addProjectSupport };