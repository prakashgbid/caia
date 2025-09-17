const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = 3456;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CORS for development
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Cache for scanned data
let cachedData = null;
let lastScanTime = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Function to scan the codebase
async function scanCodebase() {
    const now = Date.now();
    if (cachedData && (now - lastScanTime < CACHE_DURATION)) {
        return cachedData;
    }

    console.log('🔍 Scanning codebase...');

    const baseDir = '/Users/MAC/Documents/projects/caia';
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
        // Scan packages directory
        const packagesDir = path.join(baseDir, 'packages');
        const packageDirs = await fs.readdir(packagesDir).catch(() => []);

        for (const dir of packageDirs) {
            const packagePath = path.join(packagesDir, dir);
            const stat = await fs.stat(packagePath);

            if (stat.isDirectory()) {
                const packageInfo = await scanPackage(packagePath, dir);

                // Categorize based on directory name
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

        // Scan specific directories
        const agentsDir = path.join(baseDir, 'packages/agents');
        if (await fs.access(agentsDir).then(() => true).catch(() => false)) {
            const agents = await scanDirectory(agentsDir, 'agent');
            result.agents.push(...agents);
        }

        const toolsDir = path.join(baseDir, 'tools');
        if (await fs.access(toolsDir).then(() => true).catch(() => false)) {
            const tools = await scanDirectory(toolsDir, 'tool');
            result.tools.push(...tools);
        }

        // Scan for utilities in various locations
        const utilDirs = [
            'utils',
            'utilities',
            'lib',
            'helpers'
        ];

        for (const utilDir of utilDirs) {
            const fullPath = path.join(baseDir, utilDir);
            if (await fs.access(fullPath).then(() => true).catch(() => false)) {
                const utils = await scanDirectory(fullPath, 'utility');
                result.utilities.push(...utils);
            }
        }

        // Get overall stats
        const { stdout: fileCount } = await execPromise(
            `find ${baseDir} -type f -name "*.js" -o -name "*.ts" -o -name "*.py" | wc -l`
        );
        result.stats.totalFiles = parseInt(fileCount.trim());

        // Get language distribution
        const { stdout: langStats } = await execPromise(
            `find ${baseDir} -type f \\( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.json" \\) | sed 's/.*\\.//' | sort | uniq -c | sort -rn`
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

    cachedData = result;
    lastScanTime = now;
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
        features: []
    };

    try {
        // Check for package.json
        const packageJsonPath = path.join(packagePath, 'package.json');
        if (await fs.access(packageJsonPath).then(() => true).catch(() => false)) {
            info.packageJson = true;
            const packageData = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
            info.description = packageData.description || '';
            info.version = packageData.version || '1.0.0';
            info.dependencies = Object.keys(packageData.dependencies || {}).length;
        }

        // Check for README
        const readmePath = path.join(packagePath, 'README.md');
        if (await fs.access(readmePath).then(() => true).catch(() => false)) {
            info.readme = true;
        }

        // Count files
        const { stdout: fileCount } = await execPromise(
            `find "${packagePath}" -type f | wc -l`
        );
        info.files = parseInt(fileCount.trim());

        // Get size
        const { stdout: size } = await execPromise(
            `du -sh "${packagePath}" | cut -f1`
        );
        info.size = size.trim();

        // Get last modified
        const { stdout: lastMod } = await execPromise(
            `find "${packagePath}" -type f -exec stat -f "%m" {} \\; | sort -rn | head -1`
        );
        if (lastMod.trim()) {
            info.lastModified = new Date(parseInt(lastMod.trim()) * 1000).toISOString();
        }

        // Detect features
        const srcDir = path.join(packagePath, 'src');
        if (await fs.access(srcDir).then(() => true).catch(() => false)) {
            const files = await fs.readdir(srcDir);
            info.features = files
                .filter(f => f.endsWith('.js') || f.endsWith('.ts'))
                .map(f => f.replace(/\.(js|ts)$/, ''));
        }

    } catch (error) {
        console.error(`Error scanning package ${name}:`, error);
    }

    return info;
}

async function scanDirectory(dirPath, type) {
    const items = [];

    try {
        const entries = await fs.readdir(dirPath);

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry);
            const stat = await fs.stat(fullPath);

            if (stat.isDirectory()) {
                const info = await scanPackage(fullPath, entry);
                info.type = type;
                items.push(info);
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${dirPath}:`, error);
    }

    return items;
}

// API Endpoints
app.get('/api/scan', async (req, res) => {
    try {
        const data = await scanCodebase();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/refresh', async (req, res) => {
    cachedData = null;
    const data = await scanCodebase();
    res.json(data);
});

app.get('/api/details/:type/:name', async (req, res) => {
    const { type, name } = req.params;
    const baseDir = '/Users/MAC/Documents/projects/caia';

    try {
        let dirPath;
        switch(type) {
            case 'agent':
                dirPath = path.join(baseDir, 'packages/agents', name);
                break;
            case 'tool':
                dirPath = path.join(baseDir, 'tools', name);
                break;
            case 'package':
                dirPath = path.join(baseDir, 'packages', name);
                break;
            default:
                dirPath = path.join(baseDir, type, name);
        }

        const details = await scanPackage(dirPath, name);

        // Get file tree
        const { stdout: tree } = await execPromise(
            `tree -L 3 -I "node_modules|dist|build" "${dirPath}" | head -50`
        ).catch(() => ({ stdout: 'Tree not available' }));

        details.fileTree = tree;

        res.json(details);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        port: PORT
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║          🚀 CAIA Feature Browser Dashboard                ║
║                                                            ║
║  Server running at: http://localhost:${PORT}              ║
║                                                            ║
║  Endpoints:                                                ║
║  • Dashboard: http://localhost:${PORT}                    ║
║  • API Scan: http://localhost:${PORT}/api/scan            ║
║  • Refresh: http://localhost:${PORT}/api/refresh          ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);

    // Initial scan
    scanCodebase().then(() => {
        console.log('✅ Initial scan complete');
    });
});