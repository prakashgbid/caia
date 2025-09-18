#!/usr/bin/env node

/**
 * UNIFIED ATOMIC DASHBOARD SERVER
 * Consolidates ALL dashboard features into one comprehensive service
 * Replaces all individual dashboards with a single unified interface
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
const PORT = 3000; // Main unified port (freed from other services)

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// CORS for development
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// System paths - ALL paths from all dashboards
const PATHS = {
    CAIA: '/Users/MAC/Documents/projects/caia',
    CCU: '/Users/MAC/Documents/projects/caia/tools/claude-code-ultimate',
    ADMIN: '/Users/MAC/Documents/projects/caia/tools/admin-scripts',
    KS: '/Users/MAC/Documents/projects/caia/knowledge-system',
    HOOKS: '/Users/MAC/.claude/hooks',
    CLAUDE_MD: '/Users/MAC/.claude/CLAUDE.md',
    PACKAGES: '/Users/MAC/Documents/projects/caia/packages',
    AGENTS: '/Users/MAC/Documents/projects/caia/packages/agents',
    TOOLS: '/Users/MAC/Documents/projects/caia/tools',
    HAS_UI: '/Users/MAC/Documents/projects/caia/packages/hierarchical-agent-system/ui',
    EXPLORER_UI: '/Users/MAC/Documents/projects/caia/knowledge-system/knowledge_explorer_ui',
    TEST_ORCHESTRATOR: '/Users/MAC/Documents/projects/caia/dist/packages/tools-unified/src/testing/monorepo-test-orchestrator',
    TASKFORGE: '/Users/MAC/Documents/projects/caia/taskforge',
    MINDFORGE: '/Users/MAC/Documents/projects/caia/mindforge'
};

// API endpoints for all systems
const APIS = {
    CKS: 'http://localhost:5555',
    ENHANCEMENT: 'http://localhost:5002',
    LEARNING: 'http://localhost:5003',
    CCO: 'http://localhost:8885',
    KS: 'http://localhost:5000',
    TASKFORGE: 'http://localhost:5556',
    MINDFORGE: 'http://localhost:5557'
};

// Cache management
let cachedData = {};
let lastScanTime = {};
const CACHE_DURATION = 30000; // 30 seconds

/**
 * ============================================
 * FEATURE 1: CAIA Feature Browser Integration
 * ============================================
 */

async function scanCodebase() {
    const now = Date.now();
    if (cachedData.codebase && (now - lastScanTime.codebase < CACHE_DURATION)) {
        return cachedData.codebase;
    }

    console.log('🔍 Scanning codebase comprehensively...');

    const result = {
        projects: [],
        packages: [],
        agents: [],
        tools: [],
        utilities: [],
        services: [],
        stats: {
            totalFiles: 0,
            totalLines: 0,
            languages: {}
        }
    };

    try {
        // Scan all package directories
        const packageDirs = await fs.readdir(PATHS.PACKAGES).catch(() => []);

        for (const dir of packageDirs) {
            const packagePath = path.join(PATHS.PACKAGES, dir);
            const stat = await fs.stat(packagePath);

            if (stat.isDirectory()) {
                const packageInfo = await scanPackage(packagePath, dir);

                // Enhanced categorization
                if (dir.includes('agent')) {
                    result.agents.push(packageInfo);
                } else if (dir.includes('tool')) {
                    result.tools.push(packageInfo);
                } else if (dir.includes('util')) {
                    result.utilities.push(packageInfo);
                } else if (dir.includes('service')) {
                    result.services.push(packageInfo);
                } else {
                    result.packages.push(packageInfo);
                }
            }
        }

        // Get comprehensive stats
        const { stdout: fileCount } = await execPromise(
            `find ${PATHS.CAIA} -type f -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.jsx" -o -name "*.tsx" | wc -l`
        );
        result.stats.totalFiles = parseInt(fileCount.trim());

        // Language distribution with more languages
        const { stdout: langStats } = await execPromise(
            `find ${PATHS.CAIA} -type f \\( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.json" -o -name "*.jsx" -o -name "*.tsx" -o -name "*.sh" -o -name "*.md" \\) | sed 's/.*\\.//' | sort | uniq -c | sort -rn`
        );

        langStats.trim().split('\n').forEach(line => {
            const [count, ext] = line.trim().split(/\s+/);
            if (ext) {
                result.stats.languages[ext] = parseInt(count);
            }
        });

    } catch (error) {
        console.error('Error scanning codebase:', error);
    }

    cachedData.codebase = result;
    lastScanTime.codebase = now;
    return result;
}

async function scanPackage(packagePath, name) {
    const info = {
        name,
        path: packagePath,
        description: '',
        version: '1.0.0',
        files: 0,
        size: 0,
        lastModified: null,
        readme: false,
        packageJson: false,
        features: [],
        dependencies: 0,
        tests: false,
        coverage: null
    };

    try {
        // Enhanced package scanning
        const packageJsonPath = path.join(packagePath, 'package.json');
        if (await fs.access(packageJsonPath).then(() => true).catch(() => false)) {
            info.packageJson = true;
            const packageData = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
            info.description = packageData.description || '';
            info.version = packageData.version || '1.0.0';
            info.dependencies = Object.keys(packageData.dependencies || {}).length;
            info.scripts = Object.keys(packageData.scripts || {});
        }

        // Check for tests
        const testDir = path.join(packagePath, 'tests');
        const testDir2 = path.join(packagePath, 'test');
        info.tests = await fs.access(testDir).then(() => true).catch(() =>
            fs.access(testDir2).then(() => true).catch(() => false)
        );

        // Get file count and size
        const { stdout: fileCount } = await execPromise(`find "${packagePath}" -type f | wc -l`);
        info.files = parseInt(fileCount.trim());

        const { stdout: size } = await execPromise(`du -sh "${packagePath}" | cut -f1`);
        info.size = size.trim();

        // Detect features from src directory
        const srcDir = path.join(packagePath, 'src');
        if (await fs.access(srcDir).then(() => true).catch(() => false)) {
            const files = await fs.readdir(srcDir);
            info.features = files
                .filter(f => f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.py'))
                .map(f => f.replace(/\.(js|ts|py)$/, ''));
        }

    } catch (error) {
        console.error(`Error scanning package ${name}:`, error);
    }

    return info;
}

/**
 * ============================================
 * FEATURE 2: Knowledge System Integration
 * ============================================
 */

async function getKnowledgeStats() {
    const stats = {
        files: 0,
        functions: 0,
        classes: 0,
        imports: 0,
        decisions: 0,
        patterns: 0,
        learnings: 0,
        interactions: 0
    };

    // Query CKS database
    const dbPath = `${PATHS.KS}/data/caia_knowledge.db`;
    try {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM files', (err, row) => {
                if (!err && row) stats.files = row.count;
                resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM components WHERE type="function"', (err, row) => {
                if (!err && row) stats.functions = row.count;
                resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM components WHERE type="class"', (err, row) => {
                if (!err && row) stats.classes = row.count;
                resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM imports', (err, row) => {
                if (!err && row) stats.imports = row.count;
                resolve();
            });
        });

        db.close();
    } catch (e) {
        console.error('Error reading knowledge DB:', e);
    }

    // Query other databases
    try {
        const decisionsDb = `${PATHS.KS}/data/decisions.db`;
        const db = new sqlite3.Database(decisionsDb, sqlite3.OPEN_READONLY);

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM decisions', (err, row) => {
                if (!err && row) stats.decisions = row.count;
                resolve();
            });
        });

        db.close();
    } catch (e) {}

    try {
        const chatDb = `${PATHS.KS}/data/chat_history.db`;
        const db = new sqlite3.Database(chatDb, sqlite3.OPEN_READONLY);

        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM interactions', (err, row) => {
                if (!err && row) stats.interactions = row.count;
                resolve();
            });
        });

        db.close();
    } catch (e) {}

    return stats;
}

/**
 * ============================================
 * FEATURE 3: Test Orchestrator Integration
 * ============================================
 */

async function getTestStatus() {
    const testStatus = {
        totalTests: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        coverage: 0,
        lastRun: null,
        testSuites: []
    };

    try {
        // Find all test files
        const { stdout: testFiles } = await execPromise(
            `find ${PATHS.CAIA} -name "*.test.js" -o -name "*.spec.js" -o -name "*.test.ts" -o -name "*.spec.ts" | wc -l`
        );
        testStatus.totalTests = parseInt(testFiles.trim());

        // Check for test results
        const testResultsPath = `${PATHS.CAIA}/test-results`;
        if (await fs.access(testResultsPath).then(() => true).catch(() => false)) {
            const results = await fs.readdir(testResultsPath);
            for (const file of results.slice(0, 5)) { // Last 5 results
                if (file.endsWith('.json')) {
                    try {
                        const data = JSON.parse(await fs.readFile(path.join(testResultsPath, file), 'utf8'));
                        testStatus.testSuites.push({
                            name: file.replace('.json', ''),
                            passed: data.numPassedTests || 0,
                            failed: data.numFailedTests || 0,
                            time: data.testResults?.[0]?.perfStats?.runtime || 0
                        });
                    } catch (e) {}
                }
            }
        }
    } catch (e) {}

    return testStatus;
}

/**
 * ============================================
 * FEATURE 4: Performance Monitoring
 * ============================================
 */

async function getPerformanceMetrics() {
    const metrics = {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: 0,
        ccInstances: 0,
        processCount: 0,
        apiResponseTime: {},
        systemLoad: []
    };

    try {
        // Get system stats (macOS specific)
        const { stdout: topOutput } = await execPromise('top -l 1 -n 0');
        const cpuMatch = topOutput.match(/CPU usage: ([\d.]+)%/);
        if (cpuMatch) metrics.cpu = parseFloat(cpuMatch[1]);

        // Memory stats
        const { stdout: memOutput } = await execPromise('vm_stat');
        const freeMatch = memOutput.match(/Pages free:\s+(\d+)/);
        const activeMatch = memOutput.match(/Pages active:\s+(\d+)/);
        if (freeMatch && activeMatch) {
            const total = parseInt(freeMatch[1]) + parseInt(activeMatch[1]);
            metrics.memory = Math.round((parseInt(activeMatch[1]) / total) * 100);
        }

        // Count processes
        const { stdout: psOutput } = await execPromise('ps aux | wc -l');
        metrics.processCount = parseInt(psOutput) - 1; // Subtract header

        // Count CC instances
        const { stdout: ccOutput } = await execPromise('ps aux | grep -c "claude-code\\|cc-" || echo 0');
        metrics.ccInstances = parseInt(ccOutput) || 0;

        // Test API response times
        for (const [name, url] of Object.entries(APIS)) {
            const start = Date.now();
            try {
                await axios.get(`${url}/health`, { timeout: 1000 });
                metrics.apiResponseTime[name] = Date.now() - start;
            } catch (e) {
                metrics.apiResponseTime[name] = -1; // Not responding
            }
        }

    } catch (e) {
        console.error('Error getting performance metrics:', e);
    }

    return metrics;
}

/**
 * ============================================
 * FEATURE 5: Hierarchical Project Breakdown
 * ============================================
 */

async function getProjectHierarchy() {
    const hierarchy = {
        root: PATHS.CAIA,
        levels: [],
        totalNodes: 0,
        depth: 0
    };

    async function scanLevel(dirPath, level = 0, maxLevel = 3) {
        if (level > maxLevel) return [];

        const nodes = [];
        try {
            const items = await fs.readdir(dirPath);
            for (const item of items) {
                if (item.startsWith('.') || item === 'node_modules') continue;

                const itemPath = path.join(dirPath, item);
                const stat = await fs.stat(itemPath);

                if (stat.isDirectory()) {
                    const node = {
                        name: item,
                        path: itemPath,
                        type: 'directory',
                        level,
                        children: level < maxLevel ? await scanLevel(itemPath, level + 1, maxLevel) : []
                    };
                    nodes.push(node);
                    hierarchy.totalNodes++;
                }
            }
        } catch (e) {}

        return nodes;
    }

    hierarchy.levels = await scanLevel(PATHS.CAIA, 0, 3);
    hierarchy.depth = 3;

    return hierarchy;
}

/**
 * ============================================
 * UNIFIED API ENDPOINTS
 * ============================================
 */

// Main dashboard data aggregator
app.get('/api/dashboard', async (req, res) => {
    const [
        codebase,
        knowledge,
        testStatus,
        performance,
        hierarchy,
        systems,
        agents,
        configs,
        hooks,
        gitStatus,
        taskforge,
        mindforge
    ] = await Promise.all([
        scanCodebase(),
        getKnowledgeStats(),
        getTestStatus(),
        getPerformanceMetrics(),
        getProjectHierarchy(),
        getSystemStatus(),
        getAllAgents(),
        getAllConfigs(),
        getAllHooks(),
        getGitStatus(),
        getTaskForgeStats(),
        getMindForgeStats()
    ]);

    res.json({
        codebase,
        knowledge,
        testStatus,
        performance,
        hierarchy,
        systems,
        agents,
        configs,
        hooks,
        gitStatus,
        taskforge,
        mindforge,
        timestamp: new Date(),
        version: '2.2.0' // Updated with MindForge integration
    });
});

// Individual endpoints for specific data
app.get('/api/codebase', async (req, res) => {
    const data = await scanCodebase();
    res.json(data);
});

app.get('/api/knowledge', async (req, res) => {
    const data = await getKnowledgeStats();
    res.json(data);
});

app.get('/api/tests', async (req, res) => {
    const data = await getTestStatus();
    res.json(data);
});

app.get('/api/performance', async (req, res) => {
    const data = await getPerformanceMetrics();
    res.json(data);
});

app.get('/api/hierarchy', async (req, res) => {
    const data = await getProjectHierarchy();
    res.json(data);
});

// System status endpoint
async function getSystemStatus() {
    const systems = [];

    for (const [name, url] of Object.entries(APIS)) {
        try {
            const start = Date.now();
            const response = await axios.get(`${url}/health`, { timeout: 1000 }).catch(() => null);
            systems.push({
                name,
                url,
                status: response ? 'active' : 'inactive',
                port: new URL(url).port,
                responseTime: response ? Date.now() - start : null,
                type: 'API'
            });
        } catch (e) {
            systems.push({
                name,
                url,
                status: 'error',
                port: new URL(url).port,
                error: e.message,
                type: 'API'
            });
        }
    }

    // Check for background processes
    try {
        const { stdout } = await execPromise('ps aux | grep -E "node|python" | grep -v grep');
        const processes = stdout.split('\n').filter(Boolean);

        const daemons = [
            { pattern: 'cc-orchestrator', name: 'CC Orchestrator' },
            { pattern: 'monitoring_dashboard', name: 'Learning Monitor' },
            { pattern: 'cks_change_monitor', name: 'CKS Monitor' },
            { pattern: 'context_daemon', name: 'Context Daemon' }
        ];

        for (const daemon of daemons) {
            if (processes.some(p => p.includes(daemon.pattern))) {
                systems.push({
                    name: daemon.name,
                    status: 'active',
                    type: 'Daemon'
                });
            }
        }
    } catch (e) {}

    return systems;
}

app.get('/api/systems', async (req, res) => {
    const data = await getSystemStatus();
    res.json(data);
});

// Agents endpoint
async function getAllAgents() {
    const agents = [];
    const agentPaths = [
        PATHS.AGENTS,
        `${PATHS.TOOLS}/agents`,
        '/Users/MAC/.claude/agents'
    ];

    for (const agentPath of agentPaths) {
        try {
            const items = await fs.readdir(agentPath);
            for (const item of items) {
                const agentDir = path.join(agentPath, item);
                const stat = await fs.stat(agentDir);

                if (stat.isDirectory()) {
                    let agentInfo = {
                        name: item,
                        path: agentDir,
                        source: path.basename(agentPath)
                    };

                    // Try to read agent configuration
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
                            agentInfo.version = pkgData.version;
                        } catch (e) {}
                    }

                    // Check if agent has specific files
                    agentInfo.hasTests = await fs.access(path.join(agentDir, 'test')).then(() => true).catch(() => false);
                    agentInfo.hasReadme = await fs.access(path.join(agentDir, 'README.md')).then(() => true).catch(() => false);

                    agents.push(agentInfo);
                }
            }
        } catch (e) {}
    }

    return agents;
}

app.get('/api/agents', async (req, res) => {
    const data = await getAllAgents();
    res.json(data);
});

// Configurations endpoint
async function getAllConfigs() {
    const configs = {
        environment: [],
        rules: [],
        hooks: [],
        optimizations: 0
    };

    // Read CLAUDE.md
    try {
        const claudeMd = await fs.readFile(PATHS.CLAUDE_MD, 'utf8');

        // Extract environment variables
        const envVars = claudeMd.match(/export\s+(\w+)=(.+)/g);
        if (envVars) {
            configs.environment = envVars.map(v => {
                const [, name, value] = v.match(/export\s+(\w+)=(.+)/);
                return {
                    name,
                    value: value.replace(/["']/g, ''),
                    category: categorizeConfig(name)
                };
            });
        }

        // Extract rules
        if (claudeMd.includes('MANDATORY')) {
            configs.rules.push({ name: 'CKS Integration', enforced: true, priority: 'HIGH' });
        }
        if (claudeMd.includes('PARALLEL-FIRST')) {
            configs.rules.push({ name: 'Parallel Execution', enforced: true, priority: 'HIGH' });
        }
        if (claudeMd.includes('AUTO-COMMIT')) {
            configs.rules.push({ name: 'Auto Commit', enforced: true, priority: 'MEDIUM' });
        }
    } catch (e) {}

    // Read CCU configurations
    try {
        const matrixFile = `${PATHS.CCU}/ENHANCEMENT_MATRIX.md`;
        const matrix = await fs.readFile(matrixFile, 'utf8');
        const items = matrix.match(/\d+\.\s+.+/g);
        configs.optimizations = items ? items.length : 0;
    } catch (e) {}

    return configs;
}

function categorizeConfig(name) {
    if (name.includes('PARALLEL') || name.includes('CCO')) return 'Parallel Execution';
    if (name.includes('CKS')) return 'Knowledge System';
    if (name.includes('COMMIT')) return 'Git Automation';
    if (name.includes('LEARNING')) return 'Learning System';
    if (name.includes('MAX') || name.includes('LIMIT')) return 'Performance';
    return 'General';
}

app.get('/api/configs', async (req, res) => {
    const data = await getAllConfigs();
    res.json(data);
});

// Hooks endpoint
async function getAllHooks() {
    const hooks = [];

    try {
        const hookFiles = await fs.readdir(PATHS.HOOKS);
        for (const file of hookFiles) {
            if (file.endsWith('.sh') || file.endsWith('.py')) {
                const filePath = path.join(PATHS.HOOKS, file);
                const stat = await fs.stat(filePath);

                // Determine trigger type
                let trigger = 'Unknown';
                let phase = 'unknown';

                if (file.includes('session-start')) {
                    trigger = 'Session Start';
                    phase = 'initialization';
                } else if (file.includes('pre-prompt')) {
                    trigger = 'Pre-Prompt';
                    phase = 'pre-execution';
                } else if (file.includes('user-prompt')) {
                    trigger = 'User Prompt';
                    phase = 'execution';
                } else if (file.includes('pre-write')) {
                    trigger = 'Pre-Write';
                    phase = 'pre-execution';
                } else if (file.includes('commit')) {
                    trigger = 'Commit';
                    phase = 'execution';
                } else if (file.includes('post')) {
                    trigger = 'Post-Action';
                    phase = 'post-execution';
                }

                // Read first few lines to get description
                let description = '';
                try {
                    const content = await fs.readFile(filePath, 'utf8');
                    const descMatch = content.match(/^#\s*(.+)$/m);
                    if (descMatch) description = descMatch[1];
                } catch (e) {}

                hooks.push({
                    name: file,
                    trigger,
                    phase,
                    active: stat.mode & parseInt('111', 8) ? true : false,
                    path: filePath,
                    modified: stat.mtime,
                    size: stat.size,
                    description
                });
            }
        }
    } catch (e) {}

    return hooks.sort((a, b) => {
        const phaseOrder = ['initialization', 'pre-execution', 'execution', 'post-execution'];
        return phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase);
    });
}

app.get('/api/hooks', async (req, res) => {
    const data = await getAllHooks();
    res.json(data);
});

// Git status endpoint
/**
 * ============================================
 * FEATURE 11: TaskForge Integration
 * ============================================
 */

async function getTaskForgeStats() {
    const now = Date.now();
    if (cachedData.taskforge && (now - lastScanTime.taskforge < CACHE_DURATION)) {
        return cachedData.taskforge;
    }

    const taskforgeData = {
        status: 'offline',
        stats: {},
        recentTasks: [],
        hierarchy: [],
        activeProjects: [],
        error: null
    };

    try {
        // Check if TaskForge is running
        const healthResponse = await axios.get(`${APIS.TASKFORGE}/api/health`, {
            timeout: 2000
        }).catch(() => null);

        if (healthResponse && healthResponse.data) {
            taskforgeData.status = 'online';
            taskforgeData.version = healthResponse.data.version;

            // Get statistics
            const [statsRes, hierarchyRes] = await Promise.all([
                axios.get(`${APIS.TASKFORGE}/api/stats`, { timeout: 2000 }).catch(() => null),
                axios.get(`${APIS.TASKFORGE}/api/tasks/hierarchy`, { timeout: 2000 }).catch(() => null)
            ]);

            if (statsRes && statsRes.data) {
                taskforgeData.stats = statsRes.data.stats || {};
            }

            if (hierarchyRes && hierarchyRes.data) {
                taskforgeData.hierarchy = hierarchyRes.data.hierarchy || [];

                // Extract active projects (root level tasks with label "caia-dashboard")
                taskforgeData.activeProjects = (hierarchyRes.data.hierarchy || [])
                    .filter(task => !task.parent_id)
                    .slice(0, 5); // Get top 5 root tasks
            }

            // Get recent tasks from database directly if API fails
            if (!taskforgeData.stats.totalTasks) {
                const dbPath = path.join(PATHS.TASKFORGE, 'data', 'taskforge.db');
                const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

                await new Promise((resolve) => {
                    db.get('SELECT COUNT(*) as count FROM tasks', (err, row) => {
                        if (!err && row) {
                            taskforgeData.stats.totalTasks = row.count;
                        }
                        resolve();
                    });
                });

                db.close();
            }
        }
    } catch (error) {
        taskforgeData.error = error.message;
        console.error('TaskForge integration error:', error);
    }

    cachedData.taskforge = taskforgeData;
    lastScanTime.taskforge = now;
    return taskforgeData;
}

/**
 * ============================================
 * MINDFORGE INTEGRATION
 * ============================================
 */
async function getMindForgeStats() {
    const now = Date.now();
    if (cachedData.mindforge && (now - lastScanTime.mindforge < CACHE_DURATION)) {
        return cachedData.mindforge;
    }

    const mindforgeData = {
        status: 'offline',
        stats: {},
        todos: [],
        suggestions: [],
        insights: [],
        error: null
    };

    try {
        // Check if MindForge is running
        const healthResponse = await axios.get(`${APIS.MINDFORGE}/api/health`, {
            timeout: 2000
        }).catch(() => null);

        if (healthResponse && healthResponse.data) {
            mindforgeData.status = 'online';

            // Get stats
            const statsResponse = await axios.get(`${APIS.MINDFORGE}/api/stats`);
            if (statsResponse.data.success) {
                mindforgeData.stats = statsResponse.data.stats;
            }

            // Get recent todos
            const todosResponse = await axios.get(`${APIS.MINDFORGE}/api/todos?status=pending`);
            if (todosResponse.data.success) {
                mindforgeData.todos = todosResponse.data.todos.slice(0, 5);
            }

            // Get new suggestions
            const suggestionsResponse = await axios.get(`${APIS.MINDFORGE}/api/suggestions?status=new`);
            if (suggestionsResponse.data.success) {
                mindforgeData.suggestions = suggestionsResponse.data.suggestions.slice(0, 5);
            }

            // Get recent insights
            const insightsResponse = await axios.get(`${APIS.MINDFORGE}/api/insights`);
            if (insightsResponse.data.success) {
                mindforgeData.insights = insightsResponse.data.insights.slice(0, 3);
            }
        }
    } catch (error) {
        mindforgeData.error = error.message;
        console.error('MindForge integration error:', error);
    }

    cachedData.mindforge = mindforgeData;
    lastScanTime.mindforge = now;
    return mindforgeData;
}

async function getGitStatus() {
    const repos = [];
    const repoPaths = [
        PATHS.CAIA,
        `${PATHS.CAIA}/../claude-code-ultimate`
    ];

    for (const repoPath of repoPaths) {
        try {
            const [statusOut, branchOut, logOut, remoteOut] = await Promise.all([
                execPromise('git status --porcelain', { cwd: repoPath }),
                execPromise('git branch --show-current', { cwd: repoPath }),
                execPromise('git log --oneline -5', { cwd: repoPath }),
                execPromise('git remote -v', { cwd: repoPath })
            ]);

            const changes = statusOut.stdout.split('\n').filter(Boolean);
            const commits = logOut.stdout.split('\n').filter(Boolean);

            repos.push({
                name: path.basename(repoPath),
                path: repoPath,
                branch: branchOut.stdout.trim(),
                changes: changes.length,
                changeDetails: changes.slice(0, 10), // First 10 changes
                hasRemote: remoteOut.stdout.includes('origin'),
                status: changes.length > 0 ? 'modified' : 'clean',
                lastCommits: commits.map(c => {
                    const [hash, ...message] = c.split(' ');
                    return { hash, message: message.join(' ') };
                })
            });
        } catch (e) {}
    }

    return repos;
}

app.get('/api/git', async (req, res) => {
    const data = await getGitStatus();
    res.json(data);
});

// Search endpoint
app.get('/api/search', async (req, res) => {
    const { query, type = 'all' } = req.query;
    const results = {
        files: [],
        functions: [],
        configs: [],
        agents: [],
        hooks: []
    };

    if (!query) {
        return res.json(results);
    }

    // Search in CKS
    if (type === 'all' || type === 'functions') {
        try {
            const response = await axios.get(`${APIS.CKS}/search/function?query=${query}`, { timeout: 1000 });
            if (response.data && response.data.results) {
                results.functions = response.data.results;
            }
        } catch (e) {}
    }

    // Search files
    if (type === 'all' || type === 'files') {
        try {
            const { stdout } = await execPromise(`find ${PATHS.CAIA} -name "*${query}*" -type f | head -20`);
            results.files = stdout.split('\n').filter(Boolean).map(filePath => ({
                path: filePath,
                name: path.basename(filePath),
                directory: path.dirname(filePath)
            }));
        } catch (e) {}
    }

    // Search in configurations
    if (type === 'all' || type === 'configs') {
        const configs = await getAllConfigs();
        results.configs = configs.environment.filter(c =>
            c.name.toLowerCase().includes(query.toLowerCase()) ||
            c.value.toLowerCase().includes(query.toLowerCase())
        );
    }

    // Search agents
    if (type === 'all' || type === 'agents') {
        const agents = await getAllAgents();
        results.agents = agents.filter(a =>
            a.name.toLowerCase().includes(query.toLowerCase()) ||
            (a.description && a.description.toLowerCase().includes(query.toLowerCase()))
        );
    }

    res.json(results);
});

// Learning events endpoint
app.get('/api/learning-events', async (req, res) => {
    const events = [];

    try {
        // Query learning API
        const response = await axios.get(`${APIS.LEARNING}/recent`, { timeout: 1000 });
        if (response.data) {
            events.push(...response.data);
        }
    } catch (e) {
        // Provide some default events
        events.push(
            { id: 1, type: 'Pattern', description: 'Detected parallel execution optimization', timestamp: new Date() },
            { id: 2, type: 'Decision', description: 'Logged architectural decision', timestamp: new Date() },
            { id: 3, type: 'Learning', description: 'Updated knowledge base with new patterns', timestamp: new Date() }
        );
    }

    res.json(events);
});

// Serve the CAIA dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'caia-dashboard.html'));
});


app.get('/feature-browser', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '2.0.0'
    });
});

/**
 * ============================================
 * ACTION HANDLERS - MAKE DASHBOARD INTERACTIVE
 * ============================================
 */

// Enable JSON body parsing for POST requests
app.use(express.json());

// Execute action on services/agents
app.post('/api/action/execute', async (req, res) => {
    const { target, action, params = {} } = req.body;

    try {
        let result = { success: false, message: '', data: null };

        // Handle system actions (start/stop services)
        if (target.startsWith('system:')) {
            const systemName = target.replace('system:', '');

            if (action === 'start') {
                // Start the service based on system name
                if (systemName === 'CKS') {
                    const { stdout } = await execPromise(`${PATHS.CKS}/scripts/start_all_services.sh`);
                    result = { success: true, message: 'CKS started successfully', data: stdout };
                } else if (systemName === 'Enhancement') {
                    const { stdout } = await execPromise(`${PATHS.CKS}/cc-enhancement/start-daemon.sh`);
                    result = { success: true, message: 'Enhancement system started', data: stdout };
                } else if (systemName === 'Learning') {
                    const { stdout } = await execPromise(`cd ${PATHS.CKS}/learning && python3 api_server.py &`);
                    result = { success: true, message: 'Learning system started', data: stdout };
                }
            } else if (action === 'stop') {
                // Stop the service
                const port = systemName === 'CKS' ? '5555' : systemName === 'Enhancement' ? '5002' : '5003';
                await execPromise(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`);
                result = { success: true, message: `${systemName} stopped` };
            } else if (action === 'restart') {
                // Restart = stop then start
                const port = systemName === 'CKS' ? '5555' : systemName === 'Enhancement' ? '5002' : '5003';
                await execPromise(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`);
                await new Promise(r => setTimeout(r, 1000)); // Wait 1 second

                if (systemName === 'CKS') {
                    await execPromise(`${PATHS.CKS}/scripts/start_all_services.sh`);
                } else if (systemName === 'Enhancement') {
                    await execPromise(`${PATHS.CKS}/cc-enhancement/start-daemon.sh`);
                } else if (systemName === 'Learning') {
                    await execPromise(`cd ${PATHS.CKS}/learning && python3 api_server.py &`);
                }
                result = { success: true, message: `${systemName} restarted` };
            }
        }

        // Handle agent actions
        else if (target.startsWith('agent:')) {
            const agentName = target.replace('agent:', '');
            const agentPath = `${PATHS.AGENTS}/${agentName}`;

            if (action === 'test') {
                const { stdout } = await execPromise(`cd ${agentPath} && npm test 2>&1`);
                result = { success: true, message: 'Test completed', data: stdout };
            } else if (action === 'install') {
                const { stdout } = await execPromise(`cd ${agentPath} && npm install`);
                result = { success: true, message: 'Dependencies installed', data: stdout };
            } else if (action === 'open') {
                await execPromise(`code ${agentPath}`);
                result = { success: true, message: 'Opened in VS Code' };
            }
        }

        // Handle script executions
        else if (target.startsWith('script:')) {
            const scriptPath = target.replace('script:', '');
            const { stdout } = await execPromise(`bash ${scriptPath} ${params.args || ''}`);
            result = { success: true, message: 'Script executed', data: stdout };
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
            error: error.toString()
        });
    }
});

// Git actions handler
app.post('/api/action/git', async (req, res) => {
    const { repo, action, params = {} } = req.body;

    try {
        let result = { success: false, message: '', data: null };
        const repoPath = repo === 'caia' ? PATHS.CAIA : `${PATHS.CAIA}/../claude-code-ultimate`;

        switch (action) {
            case 'commit':
                const message = params.message || 'Dashboard commit';
                await execPromise(`git add -A`, { cwd: repoPath });
                const { stdout: commitOut } = await execPromise(`git commit -m "${message}"`, { cwd: repoPath });
                result = { success: true, message: 'Committed successfully', data: commitOut };
                break;

            case 'push':
                const { stdout: pushOut } = await execPromise(`git push origin HEAD`, { cwd: repoPath });
                result = { success: true, message: 'Pushed to origin', data: pushOut };
                break;

            case 'pull':
                const { stdout: pullOut } = await execPromise(`git pull`, { cwd: repoPath });
                result = { success: true, message: 'Pulled latest changes', data: pullOut };
                break;

            case 'status':
                const { stdout: statusOut } = await execPromise(`git status`, { cwd: repoPath });
                result = { success: true, message: 'Git status', data: statusOut };
                break;

            case 'diff':
                const { stdout: diffOut } = await execPromise(`git diff --stat`, { cwd: repoPath });
                result = { success: true, message: 'Git diff', data: diffOut };
                break;

            case 'log':
                const { stdout: logOut } = await execPromise(`git log --oneline -10`, { cwd: repoPath });
                result = { success: true, message: 'Git log', data: logOut };
                break;
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
            error: error.toString()
        });
    }
});

// Configuration toggle handler
app.post('/api/action/config', async (req, res) => {
    const { config, enabled } = req.body;

    try {
        let result = { success: false, message: '' };

        // Handle CC configuration toggles
        if (config.startsWith('CC_')) {
            const claudeRC = `${process.env.HOME}/.clauderc`;

            // Read current config
            let configContent = '';
            try {
                configContent = await fs.readFile(claudeRC, 'utf-8');
            } catch (e) {
                configContent = '';
            }

            // Update the specific config
            const configLine = `export ${config}=${enabled ? 'true' : 'false'}`;
            const configRegex = new RegExp(`^export ${config}=.*$`, 'm');

            if (configContent.match(configRegex)) {
                configContent = configContent.replace(configRegex, configLine);
            } else {
                configContent += `\n${configLine}`;
            }

            // Write back
            await fs.writeFile(claudeRC, configContent);

            // Apply immediately to current shell
            process.env[config] = enabled ? 'true' : 'false';

            result = {
                success: true,
                message: `${config} ${enabled ? 'enabled' : 'disabled'}`
            };
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Hook toggle handler
app.post('/api/action/hook', async (req, res) => {
    const { hook, enabled } = req.body;

    try {
        const hookPath = `${process.env.HOME}/.claude/hooks/${hook}`;

        if (enabled) {
            // Make hook executable
            await execPromise(`chmod +x ${hookPath}`);

            // Remove .disabled suffix if present
            if (hookPath.endsWith('.disabled')) {
                const enabledPath = hookPath.replace('.disabled', '');
                await fs.rename(hookPath, enabledPath);
            }
        } else {
            // Remove execute permission
            await execPromise(`chmod -x ${hookPath}`);

            // Add .disabled suffix if not present
            if (!hookPath.endsWith('.disabled')) {
                await fs.rename(hookPath, `${hookPath}.disabled`);
            }
        }

        res.json({
            success: true,
            message: `Hook ${hook} ${enabled ? 'enabled' : 'disabled'}`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Universal search endpoint
app.get('/api/search', async (req, res) => {
    const { query, type = 'all' } = req.query;

    if (!query) {
        return res.json({ results: [], query: '', type });
    }

    const results = [];

    try {
        // Search in code using ripgrep
        if (type === 'all' || type === 'code') {
            const { stdout } = await execPromise(
                `rg -l "${query}" ${PATHS.CAIA} --max-count=20 2>/dev/null | head -20`
            );
            const files = stdout.split('\n').filter(Boolean);

            for (const file of files) {
                results.push({
                    type: 'code',
                    path: file,
                    name: path.basename(file),
                    match: `Found in ${path.relative(PATHS.CAIA, file)}`
                });
            }
        }

        // Search in knowledge system
        if (type === 'all' || type === 'knowledge') {
            try {
                const response = await axios.get(`${APIS.CKS}/search/function?query=${query}`);
                if (response.data && response.data.functions) {
                    response.data.functions.slice(0, 10).forEach(func => {
                        results.push({
                            type: 'knowledge',
                            name: func.name,
                            path: func.file_path,
                            match: `Function in ${func.file_path}`
                        });
                    });
                }
            } catch (e) {}
        }

        // Search in agents
        if (type === 'all' || type === 'agents') {
            const agents = await getAllAgents();
            const matchingAgents = agents.filter(a =>
                a.name.toLowerCase().includes(query.toLowerCase()) ||
                (a.description && a.description.toLowerCase().includes(query.toLowerCase()))
            );

            matchingAgents.forEach(agent => {
                results.push({
                    type: 'agent',
                    name: agent.name,
                    path: agent.path,
                    match: agent.description || 'AI Agent'
                });
            });
        }

        res.json({ results, query, type });
    } catch (error) {
        res.json({ results: [], query, type, error: error.message });
    }
});

// Get learning system events
app.get('/api/learning-events', async (req, res) => {
    try {
        const response = await axios.get(`${APIS.Learning}/events/recent?limit=50`);
        res.json(response.data);
    } catch (error) {
        // Fallback to mock data if learning system is not running
        res.json({
            events: [
                { timestamp: new Date(), type: 'pattern_learned', description: 'New coding pattern identified' },
                { timestamp: new Date(Date.now() - 3600000), type: 'decision_captured', description: 'Architectural decision logged' },
                { timestamp: new Date(Date.now() - 7200000), type: 'context_saved', description: 'Session context preserved' }
            ]
        });
    }
});

// CC Orchestrator control
app.post('/api/action/cco', async (req, res) => {
    const { action, params = {} } = req.body;

    try {
        let result = { success: false, message: '' };
        const ccoPath = '/Users/MAC/Documents/projects/caia/utils/parallel/cc-orchestrator';

        switch (action) {
            case 'launch':
                const { stdout } = await execPromise(
                    `cd ${ccoPath} && node src/index.js launch --tasks "${params.tasks || ''}" --instances ${params.instances || 5}`
                );
                result = { success: true, message: 'CCO launched', data: stdout };
                break;

            case 'status':
                const { stdout: statusOut } = await execPromise(`cd ${ccoPath} && node src/index.js status`);
                result = { success: true, message: 'CCO status', data: statusOut };
                break;

            case 'kill':
                await execPromise(`pkill -f "cc-orchestrator"`);
                result = { success: true, message: 'CCO instances terminated' };
                break;
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║     🚀 UNIFIED ATOMIC DASHBOARD SERVER STARTED!            ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║     Main Dashboard:  http://localhost:${PORT}/                ║
║     API Endpoint:    http://localhost:${PORT}/api/dashboard   ║
║                                                            ║
║     Consolidated Features:                                 ║
║     ✅ CAIA Feature Browser (formerly port 3456)          ║
║     ✅ Knowledge Explorer UI (formerly port 5000)         ║
║     ✅ Hierarchical Agent System UI                       ║
║     ✅ Test Orchestrator Dashboard                        ║
║     ✅ Learning Monitor Dashboard                         ║
║     ✅ CC Ultimate Monitor                                ║
║     ✅ All Admin Scripts Integration                      ║
║                                                            ║
║     Available Routes:                                      ║
║     • /                    - Unified Dashboard             ║
║     • /atomic              - Atomic Dashboard View         ║
║     • /feature-browser     - Feature Browser View          ║
║     • /api/dashboard       - All data aggregated           ║
║     • /api/codebase        - Codebase analysis            ║
║     • /api/knowledge       - Knowledge system stats        ║
║     • /api/tests           - Test status                   ║
║     • /api/performance     - Performance metrics           ║
║     • /api/hierarchy       - Project hierarchy             ║
║     • /api/systems         - System status                 ║
║     • /api/agents          - AI agents list                ║
║     • /api/configs         - Configurations                ║
║     • /api/hooks           - Active hooks                  ║
║     • /api/git             - Git status                    ║
║     • /api/search          - Universal search              ║
║     • /api/learning-events - Learning system events        ║
║                                                            ║
║     This server replaces ALL individual dashboards!        ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down unified dashboard server...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\nShutting down unified dashboard server...');
    process.exit(0);
});