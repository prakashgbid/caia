/**
 * Duplicate Preventor
 * Prevents CC from recreating existing functionality
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class DuplicatePreventor {
    constructor() {
        this.cksApiUrl = 'http://localhost:5555';
        this.projectRoot = '/Users/MAC/Documents/projects';
        this.knowledgeDb = null;
        this.codeIndex = new Map();
        this.functionSignatures = new Set();
        this.componentMap = new Map();
    }

    async initialize() {
        // Connect to knowledge database
        await this.connectDatabase();

        // Build code index
        await this.buildCodeIndex();

        // Load existing function signatures
        await this.loadFunctionSignatures();
    }

    async connectDatabase() {
        const dbPath = '/Users/MAC/Documents/projects/caia/knowledge-system/data/caia_knowledge.db';

        // Create database if it doesn't exist
        this.knowledgeDb = new sqlite3.Database(dbPath);

        // Create tables if they don't exist
        await this.createTables();
    }

    async createTables() {
        return new Promise((resolve, reject) => {
            this.knowledgeDb.run(`
                CREATE TABLE IF NOT EXISTS code_components (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    path TEXT NOT NULL,
                    signature TEXT,
                    description TEXT,
                    language TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(name, path)
                )
            `, (err) => {
                if (err) reject(err);
                else {
                    this.knowledgeDb.run(`
                        CREATE TABLE IF NOT EXISTS duplicate_preventions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            prompt TEXT NOT NULL,
                            existing_component TEXT NOT NULL,
                            prevention_reason TEXT,
                            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                }
            });
        });
    }

    async buildCodeIndex() {
        // Index major components in the codebase
        const componentsToIndex = [
            { path: '/Users/MAC/Documents/projects/caia/packages', type: 'package' },
            { path: '/Users/MAC/Documents/projects/caia/agents', type: 'agent' },
            { path: '/Users/MAC/Documents/projects/caia/tools', type: 'tool' },
            { path: '/Users/MAC/Documents/projects/caia/utils', type: 'utility' }
        ];

        for (const component of componentsToIndex) {
            await this.indexDirectory(component.path, component.type);
        }
    }

    async indexDirectory(dirPath, type) {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                    // Check if it's a component directory
                    const hasPackageJson = await fs.access(path.join(fullPath, 'package.json'))
                        .then(() => true)
                        .catch(() => false);

                    if (hasPackageJson) {
                        // Read package.json for component info
                        const packageJson = await fs.readFile(path.join(fullPath, 'package.json'), 'utf-8')
                            .then(JSON.parse)
                            .catch(() => ({}));

                        const componentInfo = {
                            name: packageJson.name || entry.name,
                            type: type,
                            path: fullPath,
                            description: packageJson.description || '',
                            main: packageJson.main || 'index.js'
                        };

                        this.componentMap.set(componentInfo.name, componentInfo);

                        // Store in database
                        await this.storeComponent(componentInfo);
                    }

                    // Recursively index subdirectories
                    await this.indexDirectory(fullPath, type);
                }
            }
        } catch (error) {
            console.error(`Error indexing ${dirPath}:`, error.message);
        }
    }

    async storeComponent(component) {
        return new Promise((resolve) => {
            this.knowledgeDb.run(`
                INSERT OR REPLACE INTO code_components (name, type, path, description, language)
                VALUES (?, ?, ?, ?, ?)
            `, [component.name, component.type, component.path, component.description, 'javascript'],
            (err) => {
                if (err) console.error('Error storing component:', err);
                resolve();
            });
        });
    }

    async loadFunctionSignatures() {
        // Load known function signatures from code
        return new Promise((resolve) => {
            this.knowledgeDb.all(`
                SELECT signature FROM code_components
                WHERE signature IS NOT NULL
            `, [], (err, rows) => {
                if (err) {
                    console.error('Error loading signatures:', err);
                    resolve();
                } else {
                    rows.forEach(row => {
                        this.functionSignatures.add(row.signature);
                    });
                    resolve();
                }
            });
        });
    }

    async check(prompt, context = {}) {
        // Check if the prompt would create duplicate functionality
        const intent = this.parseIntent(prompt);

        // Check multiple sources for duplicates
        const checks = await Promise.all([
            this.checkCKS(intent),
            this.checkComponentMap(intent),
            this.checkCodePatterns(intent),
            this.checkRecentCreations(intent)
        ]);

        // Combine results
        const duplicates = checks.filter(check => check.isDuplicate);

        if (duplicates.length > 0) {
            const primary = duplicates[0];

            // Log prevention
            await this.logPrevention(prompt, primary.location, primary.reason);

            return {
                isDuplicate: true,
                location: primary.location,
                reason: primary.reason,
                suggestions: primary.suggestions || []
            };
        }

        return { isDuplicate: false };
    }

    parseIntent(prompt) {
        const lower = prompt.toLowerCase();
        const intent = {
            action: '',
            target: '',
            type: '',
            keywords: []
        };

        // Parse action
        const actions = ['create', 'build', 'make', 'implement', 'add', 'write', 'generate'];
        for (const action of actions) {
            if (lower.includes(action)) {
                intent.action = action;
                break;
            }
        }

        // Parse target types
        const targets = {
            'component': ['component', 'module', 'widget'],
            'api': ['api', 'endpoint', 'route', 'controller'],
            'service': ['service', 'provider', 'handler'],
            'database': ['database', 'schema', 'model', 'table'],
            'auth': ['auth', 'authentication', 'login', 'signup'],
            'dashboard': ['dashboard', 'admin', 'panel', 'interface'],
            'test': ['test', 'testing', 'spec', 'suite']
        };

        for (const [type, keywords] of Object.entries(targets)) {
            for (const keyword of keywords) {
                if (lower.includes(keyword)) {
                    intent.type = type;
                    intent.keywords.push(keyword);
                    break;
                }
            }
        }

        // Extract potential component name
        const words = prompt.split(' ');
        for (let i = 0; i < words.length - 1; i++) {
            if (actions.includes(words[i].toLowerCase())) {
                intent.target = words[i + 1];
                if (words[i + 2] && !['a', 'an', 'the', 'for', 'with'].includes(words[i + 2].toLowerCase())) {
                    intent.target += ' ' + words[i + 2];
                }
                break;
            }
        }

        return intent;
    }

    async checkCKS(intent) {
        // Check CKS API for existing implementations
        try {
            const response = await fetch(`${this.cksApiUrl}/search/function?query=${encodeURIComponent(intent.target || intent.type)}`);

            if (response.ok) {
                const data = await response.json();
                if (data && data.results && data.results.length > 0) {
                    const match = data.results[0];
                    return {
                        isDuplicate: true,
                        location: match.path || match.file,
                        reason: `Similar implementation found in CKS: ${match.name}`,
                        suggestions: ['Enhance existing implementation', 'Extend functionality', 'Refactor if needed']
                    };
                }
            }
        } catch (error) {
            // CKS might not be running, continue with other checks
        }

        return { isDuplicate: false };
    }

    async checkComponentMap(intent) {
        // Check indexed components
        for (const [name, component] of this.componentMap) {
            const nameMatch = this.calculateSimilarity(intent.target, name) > 0.7;
            const descMatch = component.description &&
                            this.calculateSimilarity(intent.target, component.description) > 0.5;

            if (nameMatch || descMatch || (intent.type && component.type === intent.type)) {
                // Check if it's really a match by looking at the component
                const isRealMatch = await this.verifyComponentMatch(component, intent);

                if (isRealMatch) {
                    return {
                        isDuplicate: true,
                        location: component.path,
                        reason: `Existing ${component.type} found: ${name}`,
                        suggestions: [
                            `Use existing component at ${component.path}`,
                            'Extend or enhance if needed',
                            'Create wrapper or adapter if required'
                        ]
                    };
                }
            }
        }

        return { isDuplicate: false };
    }

    async checkCodePatterns(intent) {
        // Check for common patterns that already exist
        const commonPatterns = {
            'auth': '/Users/MAC/Documents/projects/caia/packages/auth',
            'dashboard': '/Users/MAC/Documents/projects/caia/dashboard',
            'api': '/Users/MAC/Documents/projects/caia/packages/api',
            'database': '/Users/MAC/Documents/projects/caia/utils/database',
            'testing': '/Users/MAC/Documents/projects/caia/packages/agents/ui-testing-agent'
        };

        for (const [pattern, location] of Object.entries(commonPatterns)) {
            if (intent.type === pattern || intent.keywords.includes(pattern)) {
                // Verify the location exists
                const exists = await fs.access(location).then(() => true).catch(() => false);

                if (exists) {
                    return {
                        isDuplicate: true,
                        location: location,
                        reason: `${pattern} system already exists`,
                        suggestions: [
                            `Use existing ${pattern} at ${location}`,
                            'Extend with new features if needed',
                            'Check documentation for usage'
                        ]
                    };
                }
            }
        }

        return { isDuplicate: false };
    }

    async checkRecentCreations(intent) {
        // Check recently created components to prevent immediate duplicates
        return new Promise((resolve) => {
            const hourAgo = new Date(Date.now() - 3600000).toISOString();

            this.knowledgeDb.all(`
                SELECT name, path, type FROM code_components
                WHERE created_at > ?
                ORDER BY created_at DESC
                LIMIT 10
            `, [hourAgo], (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    resolve({ isDuplicate: false });
                    return;
                }

                for (const row of rows) {
                    const similarity = this.calculateSimilarity(intent.target, row.name);
                    if (similarity > 0.8) {
                        resolve({
                            isDuplicate: true,
                            location: row.path,
                            reason: `Recently created: ${row.name} (${row.type})`,
                            suggestions: ['Component was just created', 'Use the recent implementation']
                        });
                        return;
                    }
                }

                resolve({ isDuplicate: false });
            });
        });
    }

    async verifyComponentMatch(component, intent) {
        // Verify if a component actually matches the intent
        try {
            // Check if main file exists
            const mainFile = path.join(component.path, component.main || 'index.js');
            const exists = await fs.access(mainFile).then(() => true).catch(() => false);

            if (!exists) return false;

            // Read first few lines to check if it matches intent
            const content = await fs.readFile(mainFile, 'utf-8');
            const lines = content.split('\n').slice(0, 50).join('\n').toLowerCase();

            // Check for relevant keywords
            const relevantKeywords = intent.keywords.concat([intent.type, intent.target]).filter(Boolean);
            let matches = 0;

            for (const keyword of relevantKeywords) {
                if (lines.includes(keyword.toLowerCase())) {
                    matches++;
                }
            }

            return matches >= Math.min(2, relevantKeywords.length * 0.5);
        } catch (error) {
            return false;
        }
    }

    calculateSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;

        const s1 = str1.toLowerCase();
        const s2 = str2.toLowerCase();

        // Simple similarity calculation
        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;

        if (longer.length === 0) return 1.0;

        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    levenshteinDistance(s1, s2) {
        const matrix = [];

        for (let i = 0; i <= s2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= s1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= s2.length; i++) {
            for (let j = 1; j <= s1.length; j++) {
                if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[s2.length][s1.length];
    }

    async analyzeResponse(response) {
        // Analyze CC's response to check if it's creating duplicates
        const lower = response.toLowerCase();

        // Check for creation indicators
        const creationIndicators = [
            'creating new',
            'implementing',
            'building',
            'i\'ll create',
            'let me create',
            'i\'ll build',
            'let me implement'
        ];

        let isCreating = false;
        let whatCreating = '';

        for (const indicator of creationIndicators) {
            if (lower.includes(indicator)) {
                isCreating = true;
                // Extract what's being created
                const index = lower.indexOf(indicator);
                const after = lower.substring(index + indicator.length, index + indicator.length + 50);
                whatCreating = after.split(/[.,\n]/)[0].trim();
                break;
            }
        }

        if (isCreating && whatCreating) {
            // Check if what's being created already exists
            const duplicateCheck = await this.check(whatCreating);

            if (duplicateCheck.isDuplicate) {
                return {
                    creatingDuplicate: true,
                    what: whatCreating,
                    existingLocation: duplicateCheck.location,
                    reason: duplicateCheck.reason
                };
            }
        }

        return { creatingDuplicate: false };
    }

    async logPrevention(prompt, location, reason) {
        return new Promise((resolve) => {
            this.knowledgeDb.run(`
                INSERT INTO duplicate_preventions (prompt, existing_component, prevention_reason)
                VALUES (?, ?, ?)
            `, [prompt.substring(0, 500), location, reason],
            (err) => {
                if (err) console.error('Error logging prevention:', err);
                resolve();
            });
        });
    }

    async getPreventionStats() {
        return new Promise((resolve, reject) => {
            this.knowledgeDb.all(`
                SELECT COUNT(*) as total,
                       COUNT(DISTINCT existing_component) as unique_components
                FROM duplicate_preventions
                WHERE timestamp > datetime('now', '-7 days')
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0] || { total: 0, unique_components: 0 });
            });
        });
    }
}

module.exports = DuplicatePreventor;