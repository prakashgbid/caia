/**
 * Context Intelligence Layer
 * Gathers and provides comprehensive context for CC interactions
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class ContextIntelligence {
    constructor() {
        this.projectsPath = '/Users/MAC/Documents/projects';
        this.currentContext = {};
        this.contextCache = new Map();
        this.cacheTimeout = 300000; // 5 minutes
        this.contextSources = {
            projectStructure: true,
            recentChanges: true,
            dependencies: true,
            userPatterns: true,
            activeTask: true,
            sessionHistory: true
        };
    }

    async initialize() {
        // Load initial context
        await this.loadBaseContext();
    }

    async loadBaseContext() {
        // Load base context that doesn't change frequently
        this.currentContext.systemInfo = {
            platform: process.platform,
            nodeVersion: process.version,
            timestamp: new Date().toISOString()
        };

        // Load user preferences if they exist
        this.currentContext.userPreferences = await this.loadUserPreferences();
    }

    async loadUserPreferences() {
        // Load from CLAUDE.md or user config
        try {
            const claudeMd = await fs.readFile('/Users/MAC/.claude/CLAUDE.md', 'utf-8');

            // Extract preferences from CLAUDE.md
            const preferences = {
                noCoding: true, // User explicitly mentioned CC does all coding
                language: 'typescript',
                framework: 'react',
                testingFramework: 'jest',
                packageManager: 'npm'
            };

            // Parse specific preferences from content
            if (claudeMd.includes('TypeScript')) preferences.language = 'typescript';
            if (claudeMd.includes('pnpm')) preferences.packageManager = 'pnpm';

            return preferences;
        } catch {
            return {
                noCoding: true,
                language: 'javascript',
                framework: 'node',
                testingFramework: 'jest',
                packageManager: 'npm'
            };
        }
    }

    async gatherContext(additionalContext = {}) {
        // Gather comprehensive context for the current situation
        const context = {
            ...this.currentContext,
            ...additionalContext,
            timestamp: new Date().toISOString()
        };

        // Identify current project
        const currentProject = await this.identifyCurrentProject();
        if (currentProject) {
            context.currentProject = currentProject.name;
            context.projectPath = currentProject.path;

            // Gather project-specific context
            if (this.contextSources.projectStructure) {
                context.projectStructure = await this.getProjectStructure(currentProject.path);
            }

            if (this.contextSources.recentChanges) {
                context.recentChanges = await this.getRecentChanges(currentProject.path);
            }

            if (this.contextSources.dependencies) {
                context.dependencies = await this.getProjectDependencies(currentProject.path);
            }
        }

        // Get recent work context
        if (this.contextSources.sessionHistory) {
            context.recentWork = await this.getRecentWork();
        }

        // Get active tasks
        if (this.contextSources.activeTask) {
            context.activeTasks = await this.getActiveTasks();
        }

        // Get user patterns
        if (this.contextSources.userPatterns) {
            context.userPatterns = await this.getUserPatterns();
        }

        // Get available components
        context.availableComponents = await this.getAvailableComponents();

        return context;
    }

    async identifyCurrentProject() {
        // Try to identify which project we're working on
        try {
            // Check current working directory
            const { stdout: cwd } = await execPromise('pwd');
            const cwdPath = cwd.trim();

            // Check if we're in a project directory
            if (cwdPath.includes('/projects/')) {
                const projectMatch = cwdPath.match(/\/projects\/([^\/]+)/);
                if (projectMatch) {
                    const projectName = projectMatch[1];
                    return {
                        name: projectName,
                        path: cwdPath.includes('/caia') ?
                              '/Users/MAC/Documents/projects/caia' :
                              path.join(this.projectsPath, projectName)
                    };
                }
            }

            // Default to CAIA project
            return {
                name: 'caia',
                path: '/Users/MAC/Documents/projects/caia'
            };
        } catch {
            return {
                name: 'caia',
                path: '/Users/MAC/Documents/projects/caia'
            };
        }
    }

    async getProjectStructure(projectPath) {
        // Get cached structure if available
        const cacheKey = `structure_${projectPath}`;
        if (this.contextCache.has(cacheKey)) {
            const cached = this.contextCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }

        try {
            // Get directory structure (limited depth)
            const { stdout } = await execPromise(`find "${projectPath}" -maxdepth 3 -type d -name node_modules -prune -o -type d -print | head -50`);

            const structure = {
                directories: stdout.trim().split('\n').filter(d => d && !d.includes('node_modules')),
                mainFolders: []
            };

            // Identify main folders
            const mainDirs = ['packages', 'src', 'lib', 'agents', 'tools', 'utils', 'components'];
            for (const dir of mainDirs) {
                const dirPath = path.join(projectPath, dir);
                const exists = await fs.access(dirPath).then(() => true).catch(() => false);
                if (exists) {
                    structure.mainFolders.push(dir);
                }
            }

            // Cache the structure
            this.contextCache.set(cacheKey, {
                data: structure,
                timestamp: Date.now()
            });

            return structure;
        } catch {
            return { directories: [], mainFolders: [] };
        }
    }

    async getRecentChanges(projectPath) {
        try {
            // Get recent git changes
            const { stdout } = await execPromise(`cd "${projectPath}" && git log --oneline -10 2>/dev/null || echo "No git history"`);

            if (stdout.includes('No git history')) {
                return [];
            }

            const changes = stdout.trim().split('\n').map(line => {
                const [hash, ...messageParts] = line.split(' ');
                return {
                    hash: hash,
                    message: messageParts.join(' ')
                };
            });

            // Also get uncommitted changes
            const { stdout: status } = await execPromise(`cd "${projectPath}" && git status --short 2>/dev/null || echo ""`);
            if (status.trim()) {
                changes.unshift({
                    hash: 'uncommitted',
                    message: `Uncommitted changes: ${status.trim().split('\n').length} files`
                });
            }

            return changes.slice(0, 5);
        } catch {
            return [];
        }
    }

    async getProjectDependencies(projectPath) {
        try {
            const packageJsonPath = path.join(projectPath, 'package.json');
            const packageJson = await fs.readFile(packageJsonPath, 'utf-8').then(JSON.parse).catch(() => ({}));

            return {
                dependencies: Object.keys(packageJson.dependencies || {}),
                devDependencies: Object.keys(packageJson.devDependencies || {}),
                scripts: Object.keys(packageJson.scripts || {})
            };
        } catch {
            return { dependencies: [], devDependencies: [], scripts: [] };
        }
    }

    async getRecentWork() {
        // Get recently modified files
        try {
            const { stdout } = await execPromise(`find /Users/MAC/Documents/projects -type f -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" -mtime -1 | grep -v node_modules | head -10`);

            const files = stdout.trim().split('\n').filter(f => f);
            return files.map(file => {
                const relativePath = file.replace('/Users/MAC/Documents/projects/', '');
                return relativePath;
            });
        } catch {
            return [];
        }
    }

    async getActiveTasks() {
        // Check for active tasks (could integrate with task management systems)
        const tasks = [];

        // Check for TODO comments in recent files
        try {
            const { stdout } = await execPromise(`grep -r "TODO\\|FIXME" /Users/MAC/Documents/projects/caia --include="*.js" --include="*.ts" | head -5`);

            if (stdout) {
                const todos = stdout.trim().split('\n').map(line => {
                    const parts = line.split(':');
                    return {
                        file: parts[0]?.replace('/Users/MAC/Documents/projects/', ''),
                        task: parts.slice(1).join(':').trim()
                    };
                });
                tasks.push(...todos);
            }
        } catch {
            // Ignore grep errors
        }

        return tasks;
    }

    async getUserPatterns() {
        // Get user behavior patterns from knowledge base
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('/Users/MAC/Documents/projects/caia/knowledge-system/data/patterns.db');

        return new Promise((resolve) => {
            db.all(`
                SELECT category, pattern, value
                FROM user_behavior
                ORDER BY timestamp DESC
                LIMIT 10
            `, [], (err, rows) => {
                db.close();
                if (err) {
                    resolve([]);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    async getAvailableComponents() {
        // List available components that can be reused
        const components = {
            agents: [],
            tools: [],
            utils: [],
            packages: []
        };

        const componentPaths = {
            agents: '/Users/MAC/Documents/projects/caia/packages/agents',
            tools: '/Users/MAC/Documents/projects/caia/tools',
            utils: '/Users/MAC/Documents/projects/caia/utils',
            packages: '/Users/MAC/Documents/projects/caia/packages'
        };

        for (const [type, dirPath] of Object.entries(componentPaths)) {
            try {
                const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);

                for (const entry of entries) {
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        components[type].push(entry.name);
                    }
                }
            } catch {
                // Directory might not exist
            }
        }

        return components;
    }

    async enhancePromptWithContext(prompt, context) {
        // Add context information to the prompt
        let enhanced = prompt;

        // Add project context
        if (context.currentProject) {
            enhanced = `[Project: ${context.currentProject}]\n${enhanced}`;
        }

        // Add available components reminder
        if (context.availableComponents) {
            const componentList = [];
            for (const [type, items] of Object.entries(context.availableComponents)) {
                if (items.length > 0) {
                    componentList.push(`${type}: ${items.slice(0, 3).join(', ')}${items.length > 3 ? '...' : ''}`);
                }
            }
            if (componentList.length > 0) {
                enhanced += `\n\nAvailable components to reuse:\n${componentList.join('\n')}`;
            }
        }

        // Add recent work context
        if (context.recentWork && context.recentWork.length > 0) {
            enhanced += `\n\nRecent work:\n`;
            context.recentWork.slice(0, 3).forEach(file => {
                enhanced += `- ${file}\n`;
            });
        }

        // Add user preferences
        if (context.userPreferences) {
            enhanced += `\n\nUser preferences:\n`;
            if (context.userPreferences.noCoding) {
                enhanced += `- User does not code; CC handles all implementation\n`;
            }
            enhanced += `- Language: ${context.userPreferences.language}\n`;
            enhanced += `- Package manager: ${context.userPreferences.packageManager}\n`;
        }

        return enhanced;
    }

    async updateContext(updates) {
        // Update the current context with new information
        Object.assign(this.currentContext, updates);
    }

    async clearCache() {
        // Clear the context cache
        this.contextCache.clear();
    }

    async getContextSummary() {
        // Get a summary of the current context
        const context = await this.gatherContext();

        return {
            project: context.currentProject || 'Unknown',
            recentFiles: context.recentWork?.length || 0,
            availableComponents: Object.values(context.availableComponents || {})
                .reduce((sum, arr) => sum + arr.length, 0),
            activeTasks: context.activeTasks?.length || 0,
            userPatterns: context.userPatterns?.length || 0
        };
    }
}

module.exports = ContextIntelligence;