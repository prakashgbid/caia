/**
 * Prompt Enhancer
 * Transforms user prompts into comprehensive CC instructions
 */

const sqlite3 = require('sqlite3').verbose();
const natural = require('natural');
const path = require('path');
const fs = require('fs').promises;

class PromptEnhancer {
    constructor() {
        this.tokenizer = new natural.WordTokenizer();
        this.tfidf = new natural.TfIdf();
        this.classifier = new natural.BayesClassifier();

        this.db = null;
        this.patterns = [];
        this.templates = {};
        this.contextCache = new Map();
    }

    async initialize() {
        // Connect to knowledge database
        await this.connectDatabase();

        // Load enhancement patterns
        await this.loadPatterns();

        // Train classifier on past interactions
        await this.trainClassifier();
    }

    async connectDatabase() {
        const dbPath = '/Users/MAC/Documents/projects/caia/knowledge-system/data/chat_history.db';
        this.db = new sqlite3.Database(dbPath);
    }

    async loadPatterns() {
        // Load successful interaction patterns
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT prompt, response, rating
                FROM chat_interactions
                WHERE rating > 3 OR rating IS NULL
                ORDER BY timestamp DESC
                LIMIT 1000
            `, [], (err, rows) => {
                if (err) {
                    // If rating column doesn't exist, just get interactions
                    this.db.all(`
                        SELECT content as prompt, role
                        FROM chat_interactions
                        ORDER BY timestamp DESC
                        LIMIT 1000
                    `, [], (err2, rows2) => {
                        if (err2) reject(err2);
                        else {
                            this.patterns = rows2 || [];
                            resolve();
                        }
                    });
                } else {
                    this.patterns = rows || [];
                    resolve();
                }
            });
        });
    }

    async trainClassifier() {
        // Train on common prompt types
        const promptTypes = {
            'creation': ['create', 'build', 'make', 'implement', 'add', 'develop', 'design'],
            'modification': ['update', 'change', 'modify', 'edit', 'refactor', 'improve', 'enhance'],
            'debugging': ['fix', 'debug', 'solve', 'error', 'issue', 'problem', 'broken'],
            'analysis': ['analyze', 'check', 'review', 'audit', 'inspect', 'examine', 'evaluate'],
            'documentation': ['document', 'explain', 'describe', 'comment', 'readme', 'docs'],
            'testing': ['test', 'validate', 'verify', 'check', 'ensure', 'confirm'],
            'optimization': ['optimize', 'improve', 'speed', 'performance', 'efficient', 'faster']
        };

        for (const [type, keywords] of Object.entries(promptTypes)) {
            keywords.forEach(keyword => {
                this.classifier.addDocument(keyword, type);
            });
        }

        this.classifier.train();
    }

    async enhance(prompt, context = {}) {
        try {
            // 1. Classify the prompt type
            const promptType = this.classifier.classify(prompt);

            // 2. Extract key entities
            const entities = this.extractEntities(prompt);

            // 3. Find similar past prompts
            const similarPrompts = await this.findSimilarPrompts(prompt);

            // 4. Build enhanced prompt
            let enhanced = this.buildEnhancedPrompt(prompt, promptType, entities, context);

            // 5. Add relevant context from past interactions
            enhanced = await this.addHistoricalContext(enhanced, similarPrompts);

            // 6. Add project-specific requirements
            enhanced = await this.addProjectRequirements(enhanced, context);

            // 7. Add quality checks
            enhanced = this.addQualityChecks(enhanced, promptType);

            return enhanced;
        } catch (error) {
            console.error('Enhancement error:', error);
            return prompt; // Return original if enhancement fails
        }
    }

    extractEntities(prompt) {
        const tokens = this.tokenizer.tokenize(prompt.toLowerCase());
        const entities = {
            components: [],
            actions: [],
            technologies: [],
            files: []
        };

        // Common component names
        const componentKeywords = ['component', 'module', 'service', 'system', 'feature', 'function', 'api', 'endpoint'];
        const techKeywords = ['react', 'node', 'typescript', 'javascript', 'python', 'docker', 'database', 'api'];
        const actionKeywords = ['create', 'update', 'delete', 'fix', 'test', 'build', 'implement'];

        tokens.forEach((token, index) => {
            if (componentKeywords.includes(token)) {
                if (tokens[index + 1]) entities.components.push(tokens[index + 1]);
            }
            if (techKeywords.includes(token)) {
                entities.technologies.push(token);
            }
            if (actionKeywords.includes(token)) {
                entities.actions.push(token);
            }
            if (token.includes('.') && token.split('.').length === 2) {
                entities.files.push(token);
            }
        });

        return entities;
    }

    async findSimilarPrompts(prompt) {
        // Use TF-IDF to find similar prompts
        this.tfidf.addDocument(prompt);

        const similar = [];
        const promptTokens = this.tokenizer.tokenize(prompt.toLowerCase());

        return new Promise((resolve) => {
            if (this.patterns.length === 0) {
                resolve([]);
                return;
            }

            // Find patterns with similar tokens
            this.patterns.forEach(pattern => {
                if (pattern.prompt || pattern.content) {
                    const patternText = pattern.prompt || pattern.content;
                    const patternTokens = this.tokenizer.tokenize(patternText.toLowerCase());

                    // Calculate similarity
                    const intersection = promptTokens.filter(t => patternTokens.includes(t));
                    const similarity = intersection.length / Math.max(promptTokens.length, patternTokens.length);

                    if (similarity > 0.3) {
                        similar.push({
                            prompt: patternText,
                            similarity: similarity
                        });
                    }
                }
            });

            // Sort by similarity and return top 5
            similar.sort((a, b) => b.similarity - a.similarity);
            resolve(similar.slice(0, 5));
        });
    }

    buildEnhancedPrompt(original, type, entities, context) {
        let enhanced = `${original}\n\n`;

        // Add type-specific instructions
        enhanced += `📋 Task Type: ${type}\n\n`;

        switch (type) {
            case 'creation':
                enhanced += this.getCreationTemplate(entities);
                break;
            case 'modification':
                enhanced += this.getModificationTemplate(entities);
                break;
            case 'debugging':
                enhanced += this.getDebuggingTemplate(entities);
                break;
            case 'analysis':
                enhanced += this.getAnalysisTemplate(entities);
                break;
            case 'testing':
                enhanced += this.getTestingTemplate(entities);
                break;
            case 'optimization':
                enhanced += this.getOptimizationTemplate(entities);
                break;
            default:
                enhanced += this.getGenericTemplate(entities);
        }

        // Add context information
        if (context.currentProject) {
            enhanced += `\n📁 Current Project: ${context.currentProject}\n`;
        }

        if (context.recentFiles && context.recentFiles.length > 0) {
            enhanced += `\n📝 Recently Modified Files:\n`;
            context.recentFiles.slice(0, 5).forEach(file => {
                enhanced += `  - ${file}\n`;
            });
        }

        return enhanced;
    }

    getCreationTemplate(entities) {
        return `
🎯 Creation Requirements:
1. Check CKS for existing implementations before creating new code
2. Reuse existing components and patterns
3. Follow project architecture and conventions
4. Implement with TypeScript (if applicable)
5. Include error handling and validation
6. Add appropriate logging
7. Create necessary tests

${entities.components.length > 0 ? `Components to create: ${entities.components.join(', ')}\n` : ''}
${entities.technologies.length > 0 ? `Technologies to use: ${entities.technologies.join(', ')}\n` : ''}

⚠️ IMPORTANT: Do not recreate existing functionality. Query CKS first.
`;
    }

    getModificationTemplate(entities) {
        return `
🔧 Modification Guidelines:
1. Understand existing implementation first
2. Maintain backward compatibility
3. Update related tests
4. Update documentation if needed
5. Preserve existing functionality
6. Follow existing code style

${entities.files.length > 0 ? `Files to modify: ${entities.files.join(', ')}\n` : ''}

⚠️ IMPORTANT: Read existing code before modifying.
`;
    }

    getDebuggingTemplate(entities) {
        return `
🐛 Debugging Process:
1. Identify the root cause
2. Check recent changes that might have caused the issue
3. Look for similar past issues in the knowledge base
4. Test the fix thoroughly
5. Add tests to prevent regression
6. Document the fix

Investigation areas:
- Error logs and stack traces
- Recent code changes
- Dependencies and versions
- Environment configuration

⚠️ IMPORTANT: Don't just fix symptoms, address root causes.
`;
    }

    getAnalysisTemplate(entities) {
        return `
🔍 Analysis Approach:
1. Gather comprehensive data
2. Identify patterns and trends
3. Compare with best practices
4. Highlight potential issues
5. Suggest improvements
6. Provide actionable recommendations

Focus areas:
- Code quality and maintainability
- Performance bottlenecks
- Security vulnerabilities
- Architectural decisions

⚠️ IMPORTANT: Provide specific, actionable insights.
`;
    }

    getTestingTemplate(entities) {
        return `
✅ Testing Requirements:
1. Write comprehensive test cases
2. Include edge cases
3. Test error scenarios
4. Verify performance
5. Check accessibility (if UI)
6. Validate security

Test types to include:
- Unit tests
- Integration tests
- End-to-end tests (if applicable)
- Performance tests

⚠️ IMPORTANT: Ensure high test coverage and quality.
`;
    }

    getOptimizationTemplate(entities) {
        return `
⚡ Optimization Strategy:
1. Profile and measure current performance
2. Identify bottlenecks
3. Apply targeted optimizations
4. Measure improvements
5. Document changes
6. Ensure no functionality is broken

Optimization areas:
- Algorithm efficiency
- Database queries
- Caching strategies
- Resource usage
- Bundle size (if frontend)

⚠️ IMPORTANT: Measure before and after. Don't optimize prematurely.
`;
    }

    getGenericTemplate(entities) {
        return `
📌 General Requirements:
1. Follow project conventions
2. Ensure code quality
3. Add appropriate documentation
4. Consider edge cases
5. Implement error handling
6. Test your implementation

⚠️ IMPORTANT: Check for existing implementations first.
`;
    }

    async addHistoricalContext(enhanced, similarPrompts) {
        if (similarPrompts.length > 0) {
            enhanced += `\n📚 Similar Past Requests:\n`;
            similarPrompts.slice(0, 3).forEach((similar, index) => {
                enhanced += `${index + 1}. "${similar.prompt.substring(0, 100)}..."\n`;
                enhanced += `   Similarity: ${(similar.similarity * 100).toFixed(1)}%\n`;
            });
            enhanced += `\nConsider approaches used in these similar cases.\n`;
        }
        return enhanced;
    }

    async addProjectRequirements(enhanced, context) {
        // Add project-specific requirements
        if (context.projectPath) {
            try {
                // Check for project configuration
                const configPath = path.join(context.projectPath, 'CLAUDE.md');
                const config = await fs.readFile(configPath, 'utf-8').catch(() => null);

                if (config) {
                    enhanced += `\n📖 Project-Specific Requirements:\n`;
                    // Extract key requirements from CLAUDE.md
                    const lines = config.split('\n');
                    const requirements = lines
                        .filter(line => line.startsWith('- ') || line.startsWith('* '))
                        .slice(0, 5);

                    requirements.forEach(req => {
                        enhanced += `  ${req}\n`;
                    });
                }
            } catch (error) {
                // Ignore if no project config
            }
        }

        return enhanced;
    }

    addQualityChecks(enhanced, promptType) {
        enhanced += `\n✨ Quality Checklist:\n`;
        enhanced += `[ ] No duplicate code created\n`;
        enhanced += `[ ] Follows project patterns\n`;
        enhanced += `[ ] Error handling implemented\n`;
        enhanced += `[ ] Code is tested\n`;
        enhanced += `[ ] Documentation updated\n`;

        if (promptType === 'creation') {
            enhanced += `[ ] Checked CKS for existing implementations\n`;
        }

        return enhanced;
    }
}

module.exports = PromptEnhancer;