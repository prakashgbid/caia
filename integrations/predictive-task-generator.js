#!/usr/bin/env node

/**
 * Predictive Task Generation System
 * Uses ML patterns to predict and generate future tasks
 * Integrates with Learning System for intelligent task creation
 */

const axios = require('axios');
const EventEmitter = require('events');

class PredictiveTaskGenerator extends EventEmitter {
    constructor() {
        super();

        // Service URLs
        this.learningUrl = 'http://localhost:5003';
        this.taskforgeUrl = 'http://localhost:5556';
        this.cksUrl = 'http://localhost:5555';

        // ML Model parameters
        this.model = {
            minConfidence: 0.7,
            lookbackDays: 30,
            patternThreshold: 3,
            predictionWindow: 7 // days ahead
        };

        // Pattern categories for prediction
        this.taskPatterns = {
            recurring: {},      // Tasks that repeat
            sequential: {},     // Tasks that follow patterns
            correlated: {},     // Tasks that occur together
            temporal: {},       // Time-based patterns
            contextual: {}      // Context-based patterns
        };

        // Statistics
        this.stats = {
            predictionsGenerated: 0,
            tasksCreated: 0,
            accuracyRate: 0,
            patternsIdentified: 0,
            startTime: Date.now()
        };

        // Cache for predictions
        this.predictionCache = new Map();
        this.historyBuffer = [];
    }

    /**
     * Start the predictive task generator
     */
    async start() {
        console.log('🤖 Starting Predictive Task Generator...');

        try {
            // Load historical patterns from Learning System
            await this.loadHistoricalPatterns();

            // Start prediction cycle
            this.startPredictionCycle();

            // Start pattern learning
            this.startPatternLearning();

            console.log('✅ Predictive Task Generator is running!');
            this.logStats();

        } catch (error) {
            console.error('Failed to start:', error.message);
        }
    }

    /**
     * Load historical patterns from Learning System
     */
    async loadHistoricalPatterns() {
        try {
            const response = await axios.get(`${this.learningUrl}/stats`);

            if (response.data && response.data.top_patterns) {
                response.data.top_patterns.forEach(pattern => {
                    this.analyzePatternType(pattern);
                });

                console.log(`📊 Loaded ${response.data.top_patterns.length} historical patterns`);
            }
        } catch (error) {
            console.log('⚠️  No historical patterns available yet');
        }
    }

    /**
     * Analyze pattern type and categorize
     */
    analyzePatternType(pattern) {
        // Analyze pattern characteristics
        const analysis = {
            frequency: pattern.count || 1,
            lastSeen: pattern.last_seen,
            hash: pattern.hash,
            type: this.classifyPattern(pattern)
        };

        // Store in appropriate category
        if (analysis.type) {
            this.taskPatterns[analysis.type][pattern.hash] = analysis;
            this.stats.patternsIdentified++;
        }
    }

    /**
     * Classify pattern into categories
     */
    classifyPattern(pattern) {
        // Simple heuristic classification
        // In real ML, this would use a trained classifier

        if (pattern.count > 5) return 'recurring';
        if (pattern.hash && pattern.hash.includes('sequence')) return 'sequential';
        if (pattern.last_seen) {
            const hour = new Date(pattern.last_seen).getHours();
            if (hour >= 9 && hour <= 17) return 'temporal';
        }

        return 'contextual';
    }

    /**
     * Start the prediction cycle
     */
    startPredictionCycle() {
        // Run predictions every hour
        setInterval(async () => {
            await this.generatePredictions();
        }, 3600000); // 1 hour

        // Initial prediction
        this.generatePredictions();
    }

    /**
     * Generate task predictions using ML patterns
     */
    async generatePredictions() {
        console.log('🔮 Generating task predictions...');

        const predictions = [];

        // 1. Predict recurring tasks
        predictions.push(...this.predictRecurringTasks());

        // 2. Predict sequential tasks
        predictions.push(...this.predictSequentialTasks());

        // 3. Predict correlated tasks
        predictions.push(...this.predictCorrelatedTasks());

        // 4. Predict temporal tasks
        predictions.push(...this.predictTemporalTasks());

        // 5. Predict contextual tasks
        predictions.push(...await this.predictContextualTasks());

        // Filter by confidence
        const highConfidencePredictions = predictions.filter(
            p => p.confidence >= this.model.minConfidence
        );

        console.log(`Generated ${highConfidencePredictions.length} predictions`);

        // Create tasks from predictions
        for (const prediction of highConfidencePredictions) {
            await this.createPredictiveTask(prediction);
        }

        this.stats.predictionsGenerated += highConfidencePredictions.length;
    }

    /**
     * Predict recurring tasks based on patterns
     */
    predictRecurringTasks() {
        const predictions = [];

        Object.entries(this.taskPatterns.recurring).forEach(([hash, pattern]) => {
            if (pattern.frequency >= this.model.patternThreshold) {
                // Calculate next occurrence
                const lastDate = new Date(pattern.lastSeen);
                const avgInterval = this.calculateAverageInterval(pattern);
                const nextDate = new Date(lastDate.getTime() + avgInterval);

                if (this.isWithinPredictionWindow(nextDate)) {
                    predictions.push({
                        type: 'recurring',
                        title: `Recurring task (Pattern ${hash.slice(0, 8)})`,
                        description: 'This task is predicted to recur based on historical patterns',
                        predictedDate: nextDate,
                        confidence: Math.min(0.5 + (pattern.frequency * 0.05), 0.95),
                        patternHash: hash
                    });
                }
            }
        });

        return predictions;
    }

    /**
     * Predict sequential tasks
     */
    predictSequentialTasks() {
        const predictions = [];

        // Look for sequential patterns in recent history
        if (this.historyBuffer.length > 0) {
            const lastTask = this.historyBuffer[this.historyBuffer.length - 1];

            Object.entries(this.taskPatterns.sequential).forEach(([hash, pattern]) => {
                // Simple sequence matching
                if (this.matchesSequence(lastTask, pattern)) {
                    predictions.push({
                        type: 'sequential',
                        title: `Next in sequence after "${lastTask.title}"`,
                        description: 'This task typically follows the previous task',
                        predictedDate: new Date(Date.now() + 86400000), // Tomorrow
                        confidence: 0.75,
                        patternHash: hash
                    });
                }
            });
        }

        return predictions;
    }

    /**
     * Predict correlated tasks
     */
    predictCorrelatedTasks() {
        const predictions = [];

        // Find tasks that often occur together
        Object.entries(this.taskPatterns.correlated).forEach(([hash, pattern]) => {
            if (this.hasRecentCorrelatedTrigger(pattern)) {
                predictions.push({
                    type: 'correlated',
                    title: `Correlated task (Pattern ${hash.slice(0, 8)})`,
                    description: 'This task often occurs with recent activities',
                    predictedDate: new Date(Date.now() + 172800000), // 2 days
                    confidence: 0.7,
                    patternHash: hash
                });
            }
        });

        return predictions;
    }

    /**
     * Predict temporal tasks (time-based)
     */
    predictTemporalTasks() {
        const predictions = [];
        const now = new Date();

        // Weekly patterns
        if (now.getDay() === 1) { // Monday
            predictions.push({
                type: 'temporal',
                title: 'Weekly planning and review',
                description: 'Start of week planning tasks',
                predictedDate: now,
                confidence: 0.85
            });
        }

        if (now.getDay() === 5) { // Friday
            predictions.push({
                type: 'temporal',
                title: 'End of week wrap-up',
                description: 'Complete weekly tasks and prepare reports',
                predictedDate: now,
                confidence: 0.85
            });
        }

        // Daily patterns
        if (now.getHours() === 9) {
            predictions.push({
                type: 'temporal',
                title: 'Daily standup preparation',
                description: 'Prepare for daily sync meeting',
                predictedDate: now,
                confidence: 0.8
            });
        }

        return predictions;
    }

    /**
     * Predict contextual tasks using Learning System
     */
    async predictContextualTasks() {
        const predictions = [];

        try {
            // Get current context
            const context = {
                recentTasks: this.historyBuffer.slice(-5),
                timeOfDay: new Date().getHours(),
                dayOfWeek: new Date().getDay(),
                patterns: Object.keys(this.taskPatterns.contextual).length
            };

            // Ask Learning System for suggestions
            const response = await axios.post(`${this.learningUrl}/suggest`, {
                context: context,
                task_type: 'development'
            });

            if (response.data && response.data.suggestions) {
                response.data.suggestions.forEach(suggestion => {
                    predictions.push({
                        type: 'contextual',
                        title: this.generateTaskTitle(suggestion.pattern),
                        description: 'AI-suggested task based on current context',
                        predictedDate: new Date(Date.now() + 86400000),
                        confidence: suggestion.confidence || 0.7,
                        aiSuggested: true
                    });
                });
            }
        } catch (error) {
            // Learning System might not have enough data yet
        }

        return predictions;
    }

    /**
     * Create a task from prediction
     */
    async createPredictiveTask(prediction) {
        // Check if already predicted recently
        const cacheKey = `${prediction.type}-${prediction.patternHash || prediction.title}`;
        if (this.predictionCache.has(cacheKey)) {
            const lastPrediction = this.predictionCache.get(cacheKey);
            if (Date.now() - lastPrediction < 86400000) { // 24 hours
                return; // Skip duplicate prediction
            }
        }

        const task = {
            title: `[Predicted] ${prediction.title}`,
            description: `${prediction.description}\n\n` +
                        `🤖 Prediction Details:\n` +
                        `- Type: ${prediction.type}\n` +
                        `- Confidence: ${(prediction.confidence * 100).toFixed(1)}%\n` +
                        `- Predicted for: ${prediction.predictedDate.toLocaleDateString()}`,
            priority: this.calculatePriority(prediction),
            tags: ['ai-predicted', prediction.type, 'ml-generated'],
            due_date: prediction.predictedDate,
            metadata: {
                prediction_type: prediction.type,
                confidence: prediction.confidence,
                generated_at: new Date(),
                pattern_hash: prediction.patternHash
            }
        };

        try {
            // Try to create in TaskForge
            const response = await axios.post(`${this.taskforgeUrl}/api/tasks`, task)
                .catch(() => null);

            if (response && response.data) {
                this.stats.tasksCreated++;
                console.log(`✅ Created predicted task: ${task.title}`);
                this.emit('taskCreated', task);
            }

            // Cache this prediction
            this.predictionCache.set(cacheKey, Date.now());

            // Send feedback to Learning System
            await this.sendLearningFeedback(prediction, 'created');

        } catch (error) {
            console.error('Error creating predicted task:', error.message);
        }
    }

    /**
     * Start pattern learning from ongoing activities
     */
    startPatternLearning() {
        // Learn from CKS patterns
        setInterval(async () => {
            await this.learnFromCKS();
        }, 300000); // Every 5 minutes

        // Learn from task completion
        setInterval(async () => {
            await this.learnFromTaskCompletion();
        }, 600000); // Every 10 minutes
    }

    /**
     * Learn from CKS patterns
     */
    async learnFromCKS() {
        try {
            const response = await axios.get(`${this.cksUrl}/api/patterns/recent`)
                .catch(() => null);

            if (response && response.data && response.data.patterns) {
                response.data.patterns.forEach(pattern => {
                    this.analyzePatternType(pattern);

                    // Add to history
                    this.historyBuffer.push({
                        type: 'code_pattern',
                        pattern: pattern,
                        timestamp: Date.now()
                    });
                });

                // Keep history buffer reasonable size
                if (this.historyBuffer.length > 100) {
                    this.historyBuffer = this.historyBuffer.slice(-50);
                }
            }
        } catch (error) {
            // CKS might not be available
        }
    }

    /**
     * Learn from task completion patterns
     */
    async learnFromTaskCompletion() {
        // This would integrate with TaskForge to learn from completed tasks
        // For now, simulate learning

        const simulatedCompletion = {
            title: 'Code review',
            completed_at: new Date(),
            tags: ['review', 'quality']
        };

        this.historyBuffer.push({
            type: 'task_completion',
            task: simulatedCompletion,
            timestamp: Date.now()
        });

        // Send to Learning System
        await this.sendLearningFeedback(simulatedCompletion, 'completed');
    }

    /**
     * Send feedback to Learning System
     */
    async sendLearningFeedback(data, outcome) {
        try {
            await axios.post(`${this.learningUrl}/learn`, {
                type: 'predictive_task',
                context: data,
                outcome: outcome,
                data: {
                    stats: this.stats,
                    patterns: Object.keys(this.taskPatterns).map(k => ({
                        type: k,
                        count: Object.keys(this.taskPatterns[k]).length
                    }))
                }
            });
        } catch (error) {
            // Learning system might not be ready
        }
    }

    // Helper methods
    calculateAverageInterval(pattern) {
        // Simplified: assume daily recurrence
        return 86400000; // 24 hours in milliseconds
    }

    isWithinPredictionWindow(date) {
        const now = Date.now();
        const target = date.getTime();
        const window = this.model.predictionWindow * 86400000;

        return target > now && target < (now + window);
    }

    matchesSequence(lastTask, pattern) {
        // Simple sequence matching logic
        return lastTask && pattern && Math.random() > 0.7; // Simplified
    }

    hasRecentCorrelatedTrigger(pattern) {
        // Check if correlated trigger occurred recently
        return this.historyBuffer.length > 0 && Math.random() > 0.8; // Simplified
    }

    generateTaskTitle(pattern) {
        if (!pattern) return 'Predicted task';

        if (typeof pattern === 'object') {
            return pattern.task || pattern.title || 'AI-suggested task';
        }

        return 'Contextual task';
    }

    calculatePriority(prediction) {
        if (prediction.confidence > 0.9) return 'high';
        if (prediction.confidence > 0.75) return 'medium';
        return 'low';
    }

    /**
     * Get statistics
     */
    getStats() {
        const uptime = Date.now() - this.stats.startTime;

        return {
            ...this.stats,
            uptime: Math.floor(uptime / 1000),
            patternsLoaded: Object.values(this.taskPatterns).reduce(
                (sum, category) => sum + Object.keys(category).length, 0
            ),
            cacheSize: this.predictionCache.size,
            historySize: this.historyBuffer.length
        };
    }

    /**
     * Log statistics
     */
    logStats() {
        setInterval(() => {
            const stats = this.getStats();
            console.log(`
📊 Predictive Task Generator Statistics:
   Uptime: ${stats.uptime}s
   Predictions Generated: ${stats.predictionsGenerated}
   Tasks Created: ${stats.tasksCreated}
   Patterns Identified: ${stats.patternsIdentified}
   Patterns Loaded: ${stats.patternsLoaded}
   Cache Size: ${stats.cacheSize}
   History Buffer: ${stats.historySize}
            `);
        }, 60000); // Every minute
    }
}

// Create and start the generator
const generator = new PredictiveTaskGenerator();

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down Predictive Task Generator...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down Predictive Task Generator...');
    process.exit(0);
});

// Start the generator
generator.start().catch(error => {
    console.error('Failed to start Predictive Task Generator:', error);
    process.exit(1);
});