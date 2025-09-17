#!/usr/bin/env node

/**
 * CAIA Atomic Dashboard Server
 * Aggregates ALL system information at the atomic level
 */

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const axios = require('axios').default;
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3457; // Different port from main dashboard

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// CORS for development
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// System paths
const PATHS = {
    CAIA: '/Users/MAC/Documents/projects/caia',
    CCU: '/Users/MAC/Documents/projects/caia/tools/claude-code-ultimate',
    ADMIN: '/Users/MAC/Documents/projects/caia/tools/admin-scripts',
    KS: '/Users/MAC/Documents/projects/caia/knowledge-system',
    HOOKS: '/Users/MAC/.claude/hooks',
    CLAUDE_MD: '/Users/MAC/.claude/CLAUDE.md'
};

// API endpoints for various systems
const APIS = {
    CKS: 'http://localhost:5555',
    ENHANCEMENT: 'http://localhost:5002',
    LEARNING: 'http://localhost:5003',
    CCO: 'http://localhost:8885',
    KS: 'http://localhost:5000'
};

/**
 * Get comprehensive system status
 */
app.get('/api/systems', async (req, res) => {
    const systems = [];

    // Check each API
    for (const [name, url] of Object.entries(APIS)) {
        try {
            const response = await axios.get(`${url}/health`, { timeout: 1000 }).catch(() => null);
            systems.push({
                name,
                url,
                status: response ? 'active' : 'inactive',
                port: new URL(url).port,
                type: 'API'
            });
        } catch (e) {
            systems.push({
                name,
                url,
                status: 'inactive',
                port: new URL(url).port,
                type: 'API'
            });
        }
    }

    // Check for running services via ps
    try {
        const { stdout } = await execPromise('ps aux | grep -E "node|python" | grep -v grep');
        const processes = stdout.split('\n').filter(Boolean);

        // Add daemon/service status
        if (processes.some(p => p.includes('cc-orchestrator'))) {
            systems.push({
                name: 'CC Orchestrator Daemon',
                status: 'active',
                type: 'Daemon',
                path: `${PATHS.CAIA}/cc-orchestrator`
            });
        }
    } catch (e) {}

    res.json(systems);
});

/**
 * Get project tree with full details
 */
app.get('/api/projects', async (req, res) => {
    const projects = [];

    // Scan main projects
    const projectDirs = [
        { path: PATHS.CAIA, name: 'caia' },
        { path: PATHS.CCU, name: 'claude-code-ultimate' },
        { path: `${PATHS.CAIA}/packages`, name: 'packages' }
    ];

    for (const proj of projectDirs) {
        try {
            const items = await fs.readdir(proj.path);
            const stats = await Promise.all(
                items.map(async item => {
                    const itemPath = path.join(proj.path, item);
                    try {
                        const stat = await fs.stat(itemPath);
                        return {
                            name: item,
                            type: stat.isDirectory() ? 'dir' : 'file',
                            size: stat.size,
                            modified: stat.mtime
                        };
                    } catch (e) {
                        return null;
                    }
                })
            );

            projects.push({
                name: proj.name,
                path: proj.path,
                items: stats.filter(Boolean),
                count: stats.filter(Boolean).length
            });
        } catch (e) {}
    }

    res.json(projects);
});

/**
 * Get all AI agents with details
 */
app.get('/api/agents', async (req, res) => {
    const agents = [];
    const agentPaths = [
        `${PATHS.CAIA}/packages/agents`,
        `${PATHS.CAIA}/tools/agents`,
        '/Users/MAC/.claude/agents'
    ];

    for (const agentPath of agentPaths) {
        try {
            const items = await fs.readdir(agentPath);
            for (const item of items) {
                const agentDir = path.join(agentPath, item);
                const stat = await fs.stat(agentDir);

                if (stat.isDirectory()) {
                    // Try to read agent.json or package.json
                    let agentInfo = { name: item, path: agentDir };

                    try {
                        const configPath = path.join(agentDir, 'agent.json');
                        const config = await fs.readFile(configPath, 'utf8');
                        agentInfo = { ...agentInfo, ...JSON.parse(config) };
                    } catch (e) {
                        try {
                            const pkgPath = path.join(agentDir, 'package.json');
                            const pkg = await fs.readFile(pkgPath, 'utf8');
                            const pkgData = JSON.parse(pkg);
                            agentInfo.description = pkgData.description;
                        } catch (e) {}
                    }

                    agents.push(agentInfo);
                }
            }
        } catch (e) {}
    }

    res.json(agents);
});

/**
 * Get CC configurations
 */
app.get('/api/configs', async (req, res) => {
    const configs = {};

    // Read CLAUDE.md
    try {
        const claudeMd = await fs.readFile(PATHS.CLAUDE_MD, 'utf8');

        // Extract environment variables
        const envVars = claudeMd.match(/export\s+(\w+)=(.+)/g);
        if (envVars) {
            configs.environment = envVars.map(v => {
                const [, name, value] = v.match(/export\s+(\w+)=(.+)/);
                return { name, value: value.replace(/["']/g, '') };
            });
        }

        // Extract rules
        const rules = [];
        if (claudeMd.includes('MANDATORY')) {
            rules.push({ name: 'CKS Integration', enforced: true });
        }
        if (claudeMd.includes('PARALLEL-FIRST')) {
            rules.push({ name: 'Parallel Execution', enforced: true });
        }
        configs.rules = rules;
    } catch (e) {}

    // Read CCU configurations
    try {
        const matrixFile = `${PATHS.CCU}/ENHANCEMENT_MATRIX.md`;
        const matrix = await fs.readFile(matrixFile, 'utf8');
        const items = matrix.match(/\d+\.\s+.+/g);
        configs.enhancements = items ? items.length : 0;
    } catch (e) {}

    res.json(configs);
});

/**
 * Get hooks and automation
 */
app.get('/api/hooks', async (req, res) => {
    const hooks = [];

    try {
        const hookFiles = await fs.readdir(PATHS.HOOKS);
        for (const file of hookFiles) {
            if (file.endsWith('.sh') || file.endsWith('.py')) {
                const filePath = path.join(PATHS.HOOKS, file);
                const stat = await fs.stat(filePath);

                // Determine trigger type from filename
                let trigger = 'Unknown';
                if (file.includes('session-start')) trigger = 'Session Start';
                else if (file.includes('prompt')) trigger = 'Pre-Prompt';
                else if (file.includes('pre-write')) trigger = 'Pre-Write';
                else if (file.includes('commit')) trigger = 'Pre-Commit';
                else if (file.includes('post')) trigger = 'Post-Action';

                hooks.push({
                    name: file,
                    trigger,
                    active: stat.mode & parseInt('111', 8) ? true : false,
                    path: filePath,
                    modified: stat.mtime
                });
            }
        }
    } catch (e) {}

    res.json(hooks);
});

/**
 * Get Knowledge System statistics
 */
app.get('/api/knowledge', async (req, res) => {
    const stats = {
        files: 0,
        functions: 0,
        classes: 0,
        imports: 0,
        decisions: 0
    };

    // Query CKS database
    const dbPath = `${PATHS.KS}/data/caia_knowledge.db`;
    try {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM files', (err, row) => {
                if (!err) stats.files = row.count;
                resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM components WHERE type="function"', (err, row) => {
                if (!err) stats.functions = row.count;
                resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM components WHERE type="class"', (err, row) => {
                if (!err) stats.classes = row.count;
                resolve();
            });
        });

        db.close();
    } catch (e) {}

    // Query decisions database
    try {
        const decisionsDb = `${PATHS.KS}/data/decisions.db`;
        const db = new sqlite3.Database(decisionsDb, sqlite3.OPEN_READONLY);

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM decisions', (err, row) => {
                if (!err) stats.decisions = row.count;
                resolve();
            });
        });

        db.close();
    } catch (e) {}

    res.json(stats);
});

/**
 * Get performance metrics
 */
app.get('/api/performance', async (req, res) => {
    const metrics = {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: 0,
        ccInstances: 0
    };

    try {
        // Get system stats
        const { stdout: topOutput } = await execPromise('top -l 1 -n 0');
        const cpuMatch = topOutput.match(/CPU usage: ([\d.]+)%/);
        if (cpuMatch) metrics.cpu = parseFloat(cpuMatch[1]);

        const { stdout: memOutput } = await execPromise('vm_stat');
        const freeMatch = memOutput.match(/Pages free:\s+(\d+)/);
        const activeMatch = memOutput.match(/Pages active:\s+(\d+)/);
        if (freeMatch && activeMatch) {
            const total = parseInt(freeMatch[1]) + parseInt(activeMatch[1]);
            metrics.memory = Math.round((parseInt(activeMatch[1]) / total) * 100);
        }

        // Count CC instances
        const { stdout: psOutput } = await execPromise('ps aux | grep -c "claude-code\\|cc-"');
        metrics.ccInstances = parseInt(psOutput) || 0;
    } catch (e) {}

    res.json(metrics);
});

/**
 * Get learning events
 */
app.get('/api/learning-events', async (req, res) => {
    const events = [];

    try {
        // Query learning API if available
        const response = await axios.get(`${APIS.LEARNING}/recent`, { timeout: 1000 });
        if (response.data) {
            events.push(...response.data);
        }
    } catch (e) {
        // Fallback to mock data
        events.push(
            { id: 1, type: 'Pattern', description: 'Detected parallel execution pattern', time: new Date() },
            { id: 2, type: 'Decision', description: 'Logged architectural decision', time: new Date() },
            { id: 3, type: 'Learning', description: 'Updated knowledge base', time: new Date() }
        );
    }

    res.json(events);
});

/**
 * Get repository status
 */
app.get('/api/git-status', async (req, res) => {
    const repos = [];
    const repoPaths = [
        PATHS.CAIA,
        `${PATHS.CAIA}/../claude-code-ultimate`
    ];

    for (const repoPath of repoPaths) {
        try {
            const { stdout: statusOut } = await execPromise('git status --porcelain', { cwd: repoPath });
            const { stdout: branchOut } = await execPromise('git branch --show-current', { cwd: repoPath });
            const { stdout: remoteOut } = await execPromise('git remote -v', { cwd: repoPath });

            const changes = statusOut.split('\n').filter(Boolean).length;

            repos.push({
                name: path.basename(repoPath),
                path: repoPath,
                branch: branchOut.trim(),
                changes,
                hasRemote: remoteOut.includes('origin'),
                status: changes > 0 ? 'modified' : 'clean'
            });
        } catch (e) {}
    }

    res.json(repos);
});

/**
 * Search across all systems
 */
app.get('/api/search', async (req, res) => {
    const { query } = req.query;
    const results = {
        files: [],
        functions: [],
        configs: [],
        agents: []
    };

    if (!query) {
        return res.json(results);
    }

    // Search CKS
    try {
        const response = await axios.get(`${APIS.CKS}/search/function?query=${query}`, { timeout: 1000 });
        if (response.data && response.data.results) {
            results.functions = response.data.results;
        }
    } catch (e) {}

    // Search file system
    try {
        const { stdout } = await execPromise(`find ${PATHS.CAIA} -name "*${query}*" -type f | head -20`);
        results.files = stdout.split('\n').filter(Boolean).map(path => ({
            path,
            name: path.split('/').pop()
        }));
    } catch (e) {}

    res.json(results);
});

/**
 * Aggregate all data for dashboard
 */
app.get('/api/dashboard-data', async (req, res) => {
    const [
        systems,
        projects,
        agents,
        configs,
        hooks,
        knowledge,
        performance,
        gitStatus
    ] = await Promise.all([
        axios.get(`http://localhost:${PORT}/api/systems`).then(r => r.data).catch(() => []),
        axios.get(`http://localhost:${PORT}/api/projects`).then(r => r.data).catch(() => []),
        axios.get(`http://localhost:${PORT}/api/agents`).then(r => r.data).catch(() => []),
        axios.get(`http://localhost:${PORT}/api/configs`).then(r => r.data).catch(() => {}),
        axios.get(`http://localhost:${PORT}/api/hooks`).then(r => r.data).catch(() => []),
        axios.get(`http://localhost:${PORT}/api/knowledge`).then(r => r.data).catch(() => {}),
        axios.get(`http://localhost:${PORT}/api/performance`).then(r => r.data).catch(() => {}),
        axios.get(`http://localhost:${PORT}/api/git-status`).then(r => r.data).catch(() => [])
    ]);

    res.json({
        systems,
        projects,
        agents,
        configs,
        hooks,
        knowledge,
        performance,
        gitStatus,
        timestamp: new Date()
    });
});

// Serve the dashboard HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'atomic-dashboard.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║     🚀 CAIA Atomic Dashboard Server Started!               ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║     Dashboard:  http://localhost:${PORT}/                    ║
║     API:        http://localhost:${PORT}/api/dashboard-data  ║
║                                                            ║
║     Features:                                              ║
║     • Real-time system monitoring                          ║
║     • Complete project inventory                           ║
║     • AI agent management                                  ║
║     • CC configuration tracking                            ║
║     • Hook & automation status                             ║
║     • Knowledge system insights                            ║
║     • Performance metrics                                  ║
║     • Git repository status                                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down dashboard server...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\nShutting down dashboard server...');
    process.exit(0);
});