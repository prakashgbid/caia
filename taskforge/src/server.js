const express = require('express');
const cors = require('cors');
const path = require('path');
const TaskForgeDatabase = require('./database');
const TaskDecomposer = require('./decomposer');
const GitIntegration = require('./git-integration');

const app = express();
const PORT = 5556;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../ui')));

// Initialize components
let db;
let decomposer;
let gitIntegration;

async function initialize() {
    db = new TaskForgeDatabase();
    await db.initialize();
    decomposer = new TaskDecomposer(db);
    gitIntegration = new GitIntegration(db);

    console.log('✅ TaskForge initialized successfully');
}

/**
 * ============================================
 * PROJECT ENDPOINTS
 * ============================================
 */

// Get all projects
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await db.getAllProjects();
        res.json({
            success: true,
            projects,
            count: projects.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get projects',
            message: error.message
        });
    }
});

// Get single project
app.get('/api/projects/:id', async (req, res) => {
    try {
        const project = await db.getProject(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const tasks = await db.getProjectTasks(project.id);

        res.json({
            success: true,
            project,
            tasks,
            taskCount: tasks.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get project',
            message: error.message
        });
    }
});

// Create project
app.post('/api/projects', async (req, res) => {
    try {
        const projectId = await db.createProject(req.body);
        const project = await db.getProject(projectId);

        res.json({
            success: true,
            project,
            message: 'Project created successfully'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to create project',
            message: error.message
        });
    }
});

// Update project
app.put('/api/projects/:id', async (req, res) => {
    try {
        const project = await db.updateProject(req.params.id, req.body);

        res.json({
            success: true,
            project,
            message: 'Project updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to update project',
            message: error.message
        });
    }
});

/**
 * ============================================
 * API ENDPOINTS
 * ============================================
 */

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'TaskForge',
        version: '1.0.0',
        timestamp: new Date()
    });
});

// Decompose a task from natural language
app.post('/api/decompose', async (req, res) => {
    try {
        const { input, options = {} } = req.body;

        if (!input) {
            return res.status(400).json({ error: 'Input text is required' });
        }

        console.log(`📝 Decomposing: "${input}"`);

        // Perform decomposition
        const result = await decomposer.decompose(input, options);

        res.json({
            success: true,
            task: result,
            message: `Successfully decomposed into ${result.children ? result.children.length : 0} subtasks`
        });
    } catch (error) {
        console.error('Decomposition error:', error);
        res.status(500).json({
            error: 'Decomposition failed',
            message: error.message
        });
    }
});

// Get task hierarchy
app.get('/api/tasks/hierarchy', async (req, res) => {
    try {
        const { rootId } = req.query;
        const hierarchy = await db.getTaskHierarchy(rootId);

        res.json({
            success: true,
            hierarchy,
            count: hierarchy.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get hierarchy',
            message: error.message
        });
    }
});

// Get single task
app.get('/api/tasks/:id', async (req, res) => {
    try {
        const task = await db.getTask(req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        res.json({
            success: true,
            task
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get task',
            message: error.message
        });
    }
});

// Create task manually
app.post('/api/tasks', async (req, res) => {
    try {
        const taskId = await db.createTask(req.body);
        const task = await db.getTask(taskId);

        res.json({
            success: true,
            task,
            message: 'Task created successfully'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to create task',
            message: error.message
        });
    }
});

// Update task
app.put('/api/tasks/:id', async (req, res) => {
    try {
        const task = await db.updateTask(req.params.id, req.body);

        res.json({
            success: true,
            task,
            message: 'Task updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to update task',
            message: error.message
        });
    }
});

// Delete task
app.delete('/api/tasks/:id', async (req, res) => {
    try {
        await db.deleteTask(req.params.id);

        res.json({
            success: true,
            message: 'Task deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to delete task',
            message: error.message
        });
    }
});

// Add acceptance criteria
app.post('/api/tasks/:id/criteria', async (req, res) => {
    try {
        const criteriaId = await db.addAcceptanceCriteria(req.params.id, req.body);

        res.json({
            success: true,
            id: criteriaId,
            message: 'Acceptance criteria added'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to add criteria',
            message: error.message
        });
    }
});

// Add test case
app.post('/api/tasks/:id/tests', async (req, res) => {
    try {
        const testId = await db.addTestCase(req.params.id, req.body);

        res.json({
            success: true,
            id: testId,
            message: 'Test case added'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to add test case',
            message: error.message
        });
    }
});

// Add API specification
app.post('/api/tasks/:id/apis', async (req, res) => {
    try {
        const apiId = await db.addApiSpec(req.params.id, req.body);

        res.json({
            success: true,
            id: apiId,
            message: 'API specification added'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to add API spec',
            message: error.message
        });
    }
});

// Search tasks
app.get('/api/tasks/search', async (req, res) => {
    try {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({ error: 'Search query required' });
        }

        const tasks = await db.searchTasks(query);

        res.json({
            success: true,
            tasks,
            count: tasks.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Search failed',
            message: error.message
        });
    }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await db.getStatistics();

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get statistics',
            message: error.message
        });
    }
});

/**
 * ============================================
 * GIT INTEGRATION ENDPOINTS
 * ============================================
 */

// Sync commits with tasks
app.post('/api/git/sync', async (req, res) => {
    try {
        const { since } = req.body;
        const count = await gitIntegration.syncCommits(since);

        res.json({
            success: true,
            commits_synced: count,
            message: `Synced ${count} commits`
        });
    } catch (error) {
        res.status(500).json({
            error: 'Git sync failed',
            message: error.message
        });
    }
});

// Create commit for task
app.post('/api/git/commit/:taskId', async (req, res) => {
    try {
        const { message } = req.body;
        const result = await gitIntegration.createCommit(req.params.taskId, message);

        res.json({
            success: true,
            result,
            message: result ? 'Commit created' : 'No changes to commit'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Commit failed',
            message: error.message
        });
    }
});

// Create branch for task
app.post('/api/git/branch/:taskId', async (req, res) => {
    try {
        const branch = await gitIntegration.createBranch(req.params.taskId);

        res.json({
            success: true,
            branch,
            message: `Branch created: ${branch}`
        });
    } catch (error) {
        res.status(500).json({
            error: 'Branch creation failed',
            message: error.message
        });
    }
});

// Generate release notes
app.get('/api/git/release-notes', async (req, res) => {
    try {
        const { since = '1 week ago' } = req.query;
        const notes = await gitIntegration.generateReleaseNotes(since);

        res.json({
            success: true,
            notes,
            message: 'Release notes generated'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Release notes generation failed',
            message: error.message
        });
    }
});

/**
 * ============================================
 * EXPORT ENDPOINTS
 * ============================================
 */

// Export to Jira format
app.post('/api/export/jira', async (req, res) => {
    try {
        const { taskId } = req.body;
        const task = await db.getTask(taskId);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Convert to Jira format
        const jiraIssue = {
            fields: {
                project: { key: 'TASKFORGE' },
                summary: task.title,
                description: task.description,
                issuetype: { name: task.level === 'bug' ? 'Bug' : task.level === 'story' ? 'Story' : 'Task' },
                priority: { name: task.priority === 'P0' ? 'Highest' : task.priority === 'P1' ? 'High' : 'Medium' },
                timetracking: {
                    originalEstimate: `${task.estimated_hours}h`
                },
                labels: task.labels ? task.labels.map(l => l.label) : []
            }
        };

        // Add acceptance criteria as description
        if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
            jiraIssue.fields.description += '\n\n*Acceptance Criteria:*\n';
            for (const ac of task.acceptance_criteria) {
                jiraIssue.fields.description += `- Given ${ac.given_statement}, When ${ac.when_statement}, Then ${ac.then_statement}\n`;
            }
        }

        res.json({
            success: true,
            jira: jiraIssue,
            message: 'Exported to Jira format'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Export failed',
            message: error.message
        });
    }
});

// Export to GitHub Issues format
app.post('/api/export/github', async (req, res) => {
    try {
        const { taskId } = req.body;
        const task = await db.getTask(taskId);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const githubIssue = {
            title: task.title,
            body: task.description,
            labels: task.labels ? task.labels.map(l => l.label) : [],
            milestone: task.parent_id
        };

        // Add checklist for acceptance criteria
        if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
            githubIssue.body += '\n\n## Acceptance Criteria\n';
            for (const ac of task.acceptance_criteria) {
                githubIssue.body += `- [ ] Given ${ac.given_statement}, When ${ac.when_statement}, Then ${ac.then_statement}\n`;
            }
        }

        // Add test cases
        if (task.test_cases && task.test_cases.length > 0) {
            githubIssue.body += '\n\n## Test Cases\n';
            for (const tc of task.test_cases) {
                githubIssue.body += `- [ ] ${tc.description}\n`;
            }
        }

        res.json({
            success: true,
            github: githubIssue,
            message: 'Exported to GitHub format'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Export failed',
            message: error.message
        });
    }
});

/**
 * ============================================
 * INTEGRATION ENDPOINTS
 * ============================================
 */

// Integrate with CC Orchestrator
app.post('/api/integrate/cco', async (req, res) => {
    try {
        const { taskId } = req.body;
        const task = await db.getTask(taskId);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Get all leaf tasks (tasks without children)
        const leafTasks = [];
        const collectLeafTasks = (t) => {
            if (!t.children || t.children.length === 0) {
                leafTasks.push(t);
            } else {
                for (const child of t.children) {
                    collectLeafTasks(child);
                }
            }
        };
        collectLeafTasks(task);

        // Prepare tasks for CCO
        const ccoTasks = leafTasks.map(t => ({
            id: t.id,
            description: t.title,
            priority: t.priority,
            estimatedTime: t.estimated_hours * 60 // Convert to minutes
        }));

        res.json({
            success: true,
            cco_tasks: ccoTasks,
            count: ccoTasks.length,
            message: `Prepared ${ccoTasks.length} tasks for CC Orchestrator`
        });
    } catch (error) {
        res.status(500).json({
            error: 'CCO integration failed',
            message: error.message
        });
    }
});

// Check CKS for existing implementations
app.post('/api/integrate/cks', async (req, res) => {
    try {
        const { taskId } = req.body;

        await decomposer.checkExistingImplementations(taskId);
        const task = await db.getTask(taskId);

        res.json({
            success: true,
            task,
            message: 'CKS check completed'
        });
    } catch (error) {
        res.status(500).json({
            error: 'CKS integration failed',
            message: error.message
        });
    }
});

/**
 * ============================================
 * UI ROUTES
 * ============================================
 */

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../ui/index.html'));
});

app.get('/api', (req, res) => {
    res.json({
        service: 'TaskForge',
        version: '1.0.0',
        endpoints: [
            'POST /api/decompose - Decompose natural language into tasks',
            'GET /api/tasks/hierarchy - Get task hierarchy',
            'GET /api/tasks/:id - Get single task',
            'POST /api/tasks - Create task',
            'PUT /api/tasks/:id - Update task',
            'DELETE /api/tasks/:id - Delete task',
            'POST /api/git/sync - Sync git commits',
            'POST /api/git/commit/:taskId - Create commit for task',
            'POST /api/export/jira - Export to Jira',
            'POST /api/export/github - Export to GitHub',
            'POST /api/integrate/cco - Integrate with CC Orchestrator',
            'POST /api/integrate/cks - Check CKS for existing code'
        ]
    });
});

// Start server
async function start() {
    await initialize();

    app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║               🚀 TASKFORGE SERVER STARTED!                 ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║     Dashboard:  http://localhost:${PORT}/                      ║
║     API Docs:   http://localhost:${PORT}/api                   ║
║                                                            ║
║     Features:                                              ║
║     ✅ Natural Language Task Decomposition                ║
║     ✅ Automatic Hierarchy Generation                     ║
║     ✅ Acceptance Criteria & Test Cases                   ║
║     ✅ API Specification Detection                        ║
║     ✅ Git Commit Tracking                                ║
║     ✅ CKS Integration                                    ║
║     ✅ CC Orchestrator Integration                        ║
║     ✅ Jira/GitHub Export                                 ║
║                                                            ║
║     Status: Ready for decomposition!                       ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
        `);
    });
}

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down TaskForge...');
    if (db) db.close();
    process.exit(0);
});

// Export for testing
module.exports = { app, initialize };

// Start if run directly
if (require.main === module) {
    start().catch(console.error);
}