const natural = require('natural');
const axios = require('axios');
const MindForgeDatabase = require('./database');

class AIAnalyzer {
    constructor() {
        this.db = null;
        this.tokenizer = new natural.WordTokenizer();
        this.sentiment = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');

        // Keywords for different categories
        this.keywords = {
            caia: ['caia', 'dashboard', 'knowledge', 'cks', 'cls', 'agent', 'system', 'integration'],
            ccu: ['ccu', 'claude-code', 'ultimate', 'configuration', 'optimization', 'performance'],
            todo: ['todo', 'need', 'should', 'must', 'want', 'implement', 'create', 'build', 'fix', 'update'],
            idea: ['idea', 'suggest', 'vision', 'plan', 'could', 'maybe', 'what if', 'imagine'],
            architecture: ['architecture', 'design', 'structure', 'pattern', 'framework', 'scalable']
        };

        // Priority indicators
        this.priorityIndicators = {
            P0: ['critical', 'urgent', 'immediately', 'asap', 'blocking', 'broken'],
            P1: ['important', 'soon', 'priority', 'need', 'required'],
            P2: ['should', 'would be nice', 'consider', 'plan'],
            P3: ['maybe', 'someday', 'future', 'nice to have']
        };
    }

    async initialize() {
        this.db = new MindForgeDatabase();
        await this.db.initialize();
    }

    /**
     * Analyze conversations and extract todos, ideas, and suggestions
     */
    async analyzeConversations() {
        const conversations = await this.db.getUnanalyzedConversations();
        console.log(`🔍 Analyzing ${conversations.length} unanalyzed conversations...`);

        for (const conv of conversations) {
            try {
                // Extract todos from user messages
                const todos = this.extractTodos(conv.user_message);
                for (const todo of todos) {
                    await this.db.createTodo({
                        ...todo,
                        conversation_id: conv.id,
                        source: 'conversation'
                    });
                }

                // Extract ideas and suggestions
                const ideas = this.extractIdeas(conv.user_message);
                for (const idea of ideas) {
                    await this.generateSuggestion(idea, conv.id);
                }

                // Mark as analyzed
                await this.db.markConversationAnalyzed(conv.id);
            } catch (error) {
                console.error(`Error analyzing conversation ${conv.id}:`, error);
            }
        }

        return conversations.length;
    }

    /**
     * Extract todos from text
     */
    extractTodos(text) {
        const todos = [];
        const sentences = text.split(/[.!?]+/);

        for (const sentence of sentences) {
            const tokens = this.tokenizer.tokenize(sentence.toLowerCase());

            // Check if sentence contains todo indicators
            const hasTodoKeyword = this.keywords.todo.some(keyword =>
                tokens.includes(keyword) || sentence.toLowerCase().includes(keyword)
            );

            if (hasTodoKeyword) {
                const category = this.detectCategory(sentence);
                const priority = this.detectPriority(sentence);

                todos.push({
                    title: this.generateTitle(sentence),
                    description: sentence.trim(),
                    category: category,
                    priority: priority,
                    tags: this.extractTags(sentence).join(',')
                });
            }
        }

        return todos;
    }

    /**
     * Extract ideas from text
     */
    extractIdeas(text) {
        const ideas = [];
        const sentences = text.split(/[.!?]+/);

        for (const sentence of sentences) {
            const tokens = this.tokenizer.tokenize(sentence.toLowerCase());

            // Check if sentence contains idea indicators
            const hasIdeaKeyword = this.keywords.idea.some(keyword =>
                tokens.includes(keyword) || sentence.toLowerCase().includes(keyword)
            );

            if (hasIdeaKeyword) {
                ideas.push({
                    text: sentence.trim(),
                    category: this.detectCategory(sentence),
                    confidence: this.calculateConfidence(sentence)
                });
            }
        }

        return ideas;
    }

    /**
     * Generate AI suggestion based on extracted idea
     */
    async generateSuggestion(idea, conversationId) {
        // Query CKS for related implementations
        const relatedCode = await this.queryCKS(idea.text);

        // Generate suggestion
        const suggestion = {
            title: this.generateTitle(idea.text),
            description: idea.text,
            category: this.detectSuggestionCategory(idea.text),
            target: this.detectTarget(idea.text),
            rationale: this.generateRationale(idea),
            implementation_notes: this.generateImplementationNotes(idea, relatedCode),
            priority: this.calculatePriority(idea),
            confidence: idea.confidence,
            tags: this.extractTags(idea.text).join(',')
        };

        await this.db.createSuggestion(suggestion);
    }

    /**
     * Generate intelligent suggestions based on current system state
     */
    async generateIntelligentSuggestions() {
        console.log('🧠 Generating intelligent suggestions...');

        // Analyze current system state
        const systemAnalysis = await this.analyzeSystemState();

        // Generate architecture suggestions
        const archSuggestions = await this.generateArchitectureSuggestions(systemAnalysis);

        // Generate optimization suggestions
        const optSuggestions = await this.generateOptimizationSuggestions(systemAnalysis);

        // Generate feature suggestions
        const featureSuggestions = await this.generateFeatureSuggestions(systemAnalysis);

        const allSuggestions = [...archSuggestions, ...optSuggestions, ...featureSuggestions];

        for (const suggestion of allSuggestions) {
            await this.db.createSuggestion(suggestion);
        }

        return allSuggestions.length;
    }

    /**
     * Analyze current system state by querying various APIs
     */
    async analyzeSystemState() {
        const state = {
            cks: {},
            enhancement: {},
            learning: {},
            performance: {}
        };

        try {
            // Query CKS
            const cksResponse = await axios.get('http://localhost:5555/api/stats').catch(() => null);
            if (cksResponse) state.cks = cksResponse.data;

            // Query Enhancement API
            const enhanceResponse = await axios.get('http://localhost:5002/api/status').catch(() => null);
            if (enhanceResponse) state.enhancement = enhanceResponse.data;

            // Query Learning API
            const learningResponse = await axios.get('http://localhost:5003/api/stats').catch(() => null);
            if (learningResponse) state.learning = learningResponse.data;

            // Get TaskForge stats
            const taskforgeResponse = await axios.get('http://localhost:5556/api/stats').catch(() => null);
            if (taskforgeResponse) state.taskforge = taskforgeResponse.data;

        } catch (error) {
            console.error('Error analyzing system state:', error);
        }

        return state;
    }

    /**
     * Generate architecture suggestions
     */
    async generateArchitectureSuggestions(systemState) {
        const suggestions = [];

        // Check for missing integrations
        if (!systemState.cks?.integrated_with_taskforge) {
            suggestions.push({
                title: 'Integrate CKS with TaskForge',
                description: 'Create bidirectional integration between Knowledge System and TaskForge for automatic task generation from code patterns',
                category: 'integration',
                target: 'caia',
                rationale: 'This would enable automatic task creation when code patterns are detected',
                implementation_notes: 'Use WebSocket for real-time sync between systems',
                priority: 0.8,
                confidence: 0.9,
                tags: 'integration,cks,taskforge'
            });
        }

        // Check for scalability improvements
        if (systemState.cks?.total_files > 1000) {
            suggestions.push({
                title: 'Implement CKS Sharding',
                description: 'Implement database sharding for CKS to handle large codebases more efficiently',
                category: 'architecture',
                target: 'caia',
                rationale: 'Current file count indicates need for better scaling',
                implementation_notes: 'Consider SQLite sharding or migration to PostgreSQL',
                priority: 0.7,
                confidence: 0.8,
                tags: 'scalability,performance,database'
            });
        }

        return suggestions;
    }

    /**
     * Generate optimization suggestions
     */
    async generateOptimizationSuggestions(systemState) {
        const suggestions = [];

        // Check for caching opportunities
        if (!systemState.enhancement?.caching_enabled) {
            suggestions.push({
                title: 'Enable Redis Caching for Enhancement API',
                description: 'Implement Redis caching layer for Enhancement API to improve response times',
                category: 'optimization',
                target: 'ccu',
                rationale: 'Caching would significantly improve API response times',
                implementation_notes: 'Use Redis with 5-minute TTL for frequently accessed data',
                priority: 0.75,
                confidence: 0.85,
                tags: 'performance,caching,optimization'
            });
        }

        return suggestions;
    }

    /**
     * Generate feature suggestions
     */
    async generateFeatureSuggestions(systemState) {
        const suggestions = [];

        // Suggest voice interface
        suggestions.push({
            title: 'Add Voice Command Interface',
            description: 'Implement voice commands for hands-free coding assistance',
            category: 'feature',
            target: 'ccu',
            rationale: 'Voice commands would improve accessibility and developer experience',
            implementation_notes: 'Use Web Speech API or integrate with native OS voice services',
            priority: 0.6,
            confidence: 0.7,
            tags: 'ux,accessibility,feature'
        });

        // Suggest predictive task generation
        suggestions.push({
            title: 'Implement Predictive Task Generation',
            description: 'Use ML to predict next likely tasks based on current development patterns',
            category: 'feature',
            target: 'caia',
            rationale: 'Predictive tasks would streamline development workflow',
            implementation_notes: 'Train model on task completion patterns',
            priority: 0.65,
            confidence: 0.75,
            tags: 'ml,automation,productivity'
        });

        return suggestions;
    }

    /**
     * Generate insights from patterns
     */
    async generateInsights() {
        console.log('💡 Generating insights...');

        const insights = [];

        // Analyze todo completion patterns
        const todoStats = await this.db.get(`
            SELECT
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                AVG(CASE WHEN status = 'completed'
                    THEN julianday(completed_at) - julianday(created_at)
                END) as avg_completion_days
            FROM todos
        `);

        if (todoStats.avg_completion_days) {
            insights.push({
                type: 'pattern',
                title: 'Todo Completion Pattern',
                content: `Average todo completion time is ${Math.round(todoStats.avg_completion_days)} days`,
                evidence: JSON.stringify(todoStats),
                confidence: 0.9,
                impact: 'medium'
            });
        }

        // Analyze suggestion acceptance rate
        const suggestionStats = await this.db.get(`
            SELECT
                COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
                COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
                COUNT(*) as total
            FROM suggestions
        `);

        if (suggestionStats.total > 10) {
            const acceptanceRate = suggestionStats.accepted / suggestionStats.total;
            insights.push({
                type: 'trend',
                title: 'Suggestion Acceptance Trend',
                content: `${Math.round(acceptanceRate * 100)}% of AI suggestions are accepted`,
                evidence: JSON.stringify(suggestionStats),
                confidence: 0.85,
                impact: acceptanceRate > 0.7 ? 'high' : 'medium'
            });
        }

        for (const insight of insights) {
            await this.db.createInsight(insight);
        }

        return insights.length;
    }

    // Helper methods
    detectCategory(text) {
        const lower = text.toLowerCase();
        if (this.keywords.caia.some(k => lower.includes(k))) return 'caia';
        if (this.keywords.ccu.some(k => lower.includes(k))) return 'ccu';
        return 'general';
    }

    detectTarget(text) {
        const lower = text.toLowerCase();
        const hasCaia = this.keywords.caia.some(k => lower.includes(k));
        const hasCcu = this.keywords.ccu.some(k => lower.includes(k));

        if (hasCaia && hasCcu) return 'both';
        if (hasCaia) return 'caia';
        if (hasCcu) return 'ccu';
        return 'both';
    }

    detectPriority(text) {
        const lower = text.toLowerCase();
        for (const [priority, indicators] of Object.entries(this.priorityIndicators)) {
            if (indicators.some(ind => lower.includes(ind))) {
                return priority;
            }
        }
        return 'P2';
    }

    detectSuggestionCategory(text) {
        const lower = text.toLowerCase();
        if (this.keywords.architecture.some(k => lower.includes(k))) return 'architecture';
        if (lower.includes('optimize') || lower.includes('performance')) return 'optimization';
        if (lower.includes('refactor')) return 'refactor';
        if (lower.includes('integrate')) return 'integration';
        return 'feature';
    }

    generateTitle(text) {
        // Extract first 50 chars or first sentence
        const title = text.split(/[.!?]/)[0].substring(0, 50);
        return title.trim();
    }

    extractTags(text) {
        const tags = [];
        const lower = text.toLowerCase();

        // Extract technology tags
        const techs = ['react', 'node', 'python', 'typescript', 'javascript', 'sql', 'api', 'ui', 'backend', 'frontend'];
        techs.forEach(tech => {
            if (lower.includes(tech)) tags.push(tech);
        });

        return tags;
    }

    calculateConfidence(text) {
        // Simple confidence based on clarity indicators
        const clearIndicators = ['definitely', 'must', 'critical', 'essential'];
        const unclearIndicators = ['maybe', 'possibly', 'might', 'could'];

        const lower = text.toLowerCase();
        let confidence = 0.5;

        clearIndicators.forEach(ind => {
            if (lower.includes(ind)) confidence += 0.1;
        });

        unclearIndicators.forEach(ind => {
            if (lower.includes(ind)) confidence -= 0.1;
        });

        return Math.max(0.1, Math.min(1.0, confidence));
    }

    calculatePriority(idea) {
        // Calculate priority based on multiple factors
        let priority = 0.5;

        // Adjust based on confidence
        priority += (idea.confidence - 0.5) * 0.3;

        // Adjust based on category
        if (idea.category === 'caia' || idea.category === 'ccu') {
            priority += 0.1;
        }

        return Math.max(0.1, Math.min(1.0, priority));
    }

    generateRationale(idea) {
        return `This suggestion is based on conversation context indicating ${idea.category} improvements with ${Math.round(idea.confidence * 100)}% confidence`;
    }

    generateImplementationNotes(idea, relatedCode) {
        let notes = 'Consider the following implementation approach:\n';

        if (relatedCode && relatedCode.length > 0) {
            notes += `- Similar implementations found in: ${relatedCode.join(', ')}\n`;
        }

        notes += '- Start with minimal viable implementation\n';
        notes += '- Add comprehensive testing\n';
        notes += '- Document changes in CLAUDE.md';

        return notes;
    }

    async queryCKS(text) {
        try {
            const response = await axios.get('http://localhost:5555/search/function', {
                params: { query: text.substring(0, 50) }
            });

            if (response.data && response.data.results) {
                return response.data.results.slice(0, 3).map(r => r.file);
            }
        } catch (error) {
            // CKS might not be running
        }

        return [];
    }
}

module.exports = AIAnalyzer;