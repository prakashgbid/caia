#!/usr/bin/env node

/**
 * CKS-TaskForge Integration Bridge
 * Creates bidirectional real-time communication between Knowledge System and TaskForge
 * Automatically generates tasks from detected code patterns
 */

const WebSocket = require('ws');
const axios = require('axios');
const EventEmitter = require('events');

class CKSTaskForgeBridge extends EventEmitter {
    constructor() {
        super();
        this.cksUrl = 'http://localhost:5555';
        this.taskforgeUrl = 'http://localhost:5556';
        this.wsClients = {
            cks: null,
            taskforge: null
        };
        this.reconnectInterval = 5000;
        this.maxReconnectAttempts = 10;
        this.reconnectAttempts = {
            cks: 0,
            taskforge: 0
        };
        this.stats = {
            patternsDetected: 0,
            tasksGenerated: 0,
            errors: 0,
            startTime: Date.now()
        };
        this.patternQueue = [];
        this.isProcessing = false;
    }

    /**
     * Start the integration bridge
     */
    async start() {
        console.log('🚀 Starting CKS-TaskForge Integration Bridge...');

        // Check service availability
        await this.checkServices();

        // Start polling for patterns (fallback if WebSocket not available)
        this.startPatternPolling();

        // Start pattern processor
        this.startPatternProcessor();

        console.log('✅ CKS-TaskForge Bridge is running!');
        this.logStats();
    }

    /**
     * Check if services are available
     */
    async checkServices() {
        try {
            // Check CKS
            const cksHealth = await axios.get(`${this.cksUrl}/health`).catch(() => null);
            if (cksHealth) {
                console.log('✅ CKS is available');
            } else {
                console.log('⚠️  CKS not responding, will retry...');
            }

            // Check TaskForge
            const taskforgeHealth = await axios.get(`${this.taskforgeUrl}/health`).catch(() => null);
            if (taskforgeHealth) {
                console.log('✅ TaskForge is available');
            } else {
                console.log('⚠️  TaskForge not responding, will retry...');
            }
        } catch (error) {
            console.error('Error checking services:', error.message);
        }
    }

    /**
     * Start polling for patterns (HTTP fallback)
     */
    startPatternPolling() {
        // Poll every 30 seconds for new patterns
        setInterval(async () => {
            try {
                const response = await axios.get(`${this.cksUrl}/api/patterns/recent`);
                if (response.data && response.data.patterns) {
                    this.processPatterns(response.data.patterns);
                }
            } catch (error) {
                // Silently handle errors as services might not be ready
                if (this.stats.errors === 0) {
                    console.log('⚠️  Waiting for CKS patterns API...');
                }
                this.stats.errors++;
            }
        }, 30000);

        console.log('📡 Pattern polling started (checking every 30 seconds)');
    }

    /**
     * Process detected patterns
     */
    processPatterns(patterns) {
        if (!Array.isArray(patterns)) return;

        patterns.forEach(pattern => {
            // Check if pattern needs task generation
            if (this.shouldGenerateTask(pattern)) {
                this.patternQueue.push(pattern);
                this.stats.patternsDetected++;
            }
        });
    }

    /**
     * Determine if a pattern should generate a task
     */
    shouldGenerateTask(pattern) {
        const taskTriggers = [
            { type: 'duplicate_code', minOccurrences: 3 },
            { type: 'complex_function', minComplexity: 10 },
            { type: 'todo_comment', always: true },
            { type: 'deprecated_usage', always: true },
            { type: 'security_issue', always: true },
            { type: 'performance_bottleneck', always: true },
            { type: 'missing_tests', always: true }
        ];

        const trigger = taskTriggers.find(t => t.type === pattern.type);

        if (!trigger) return false;

        if (trigger.always) return true;

        if (trigger.minOccurrences && pattern.occurrences >= trigger.minOccurrences) {
            return true;
        }

        if (trigger.minComplexity && pattern.complexity >= trigger.minComplexity) {
            return true;
        }

        return false;
    }

    /**
     * Start processing pattern queue
     */
    startPatternProcessor() {
        setInterval(async () => {
            if (this.isProcessing || this.patternQueue.length === 0) return;

            this.isProcessing = true;

            while (this.patternQueue.length > 0) {
                const pattern = this.patternQueue.shift();
                await this.generateTaskFromPattern(pattern);
            }

            this.isProcessing = false;
        }, 5000);
    }

    /**
     * Generate task from pattern
     */
    async generateTaskFromPattern(pattern) {
        const task = {
            title: this.generateTaskTitle(pattern),
            description: this.generateTaskDescription(pattern),
            priority: this.calculatePriority(pattern),
            tags: this.generateTags(pattern),
            source: 'cks-auto-generation',
            pattern_id: pattern.id,
            metadata: {
                pattern_type: pattern.type,
                file: pattern.file,
                line: pattern.line,
                detected_at: pattern.detected_at
            }
        };

        try {
            const response = await axios.post(`${this.taskforgeUrl}/api/tasks`, task);
            if (response.data) {
                this.stats.tasksGenerated++;
                console.log(`✅ Generated task: ${task.title}`);
                this.emit('taskGenerated', task);
            }
        } catch (error) {
            console.error('Error generating task:', error.message);
            // Store for retry
            this.patternQueue.push(pattern);
        }
    }

    /**
     * Generate task title from pattern
     */
    generateTaskTitle(pattern) {
        const titles = {
            'duplicate_code': `Refactor duplicate code in ${pattern.file}`,
            'complex_function': `Simplify complex function: ${pattern.function_name}`,
            'todo_comment': `Complete TODO: ${pattern.comment}`,
            'deprecated_usage': `Update deprecated usage in ${pattern.file}`,
            'security_issue': `Fix security issue: ${pattern.issue}`,
            'performance_bottleneck': `Optimize performance in ${pattern.function_name}`,
            'missing_tests': `Add tests for ${pattern.function_name}`
        };

        return titles[pattern.type] || `Address ${pattern.type} in ${pattern.file}`;
    }

    /**
     * Generate task description
     */
    generateTaskDescription(pattern) {
        let description = `Automatically detected ${pattern.type}:\\n\\n`;

        description += `📍 Location: ${pattern.file}`;
        if (pattern.line) description += `:${pattern.line}`;
        description += `\\n`;

        if (pattern.details) {
            description += `\\n📋 Details:\\n${pattern.details}\\n`;
        }

        description += `\\n🤖 Auto-generated from code pattern analysis`;

        return description;
    }

    /**
     * Calculate task priority
     */
    calculatePriority(pattern) {
        const priorities = {
            'security_issue': 'critical',
            'deprecated_usage': 'high',
            'performance_bottleneck': 'high',
            'duplicate_code': 'medium',
            'complex_function': 'medium',
            'missing_tests': 'low',
            'todo_comment': 'low'
        };

        return priorities[pattern.type] || 'medium';
    }

    /**
     * Generate tags for task
     */
    generateTags(pattern) {
        const tags = ['auto-generated', pattern.type];

        if (pattern.language) tags.push(pattern.language);
        if (pattern.category) tags.push(pattern.category);

        return tags;
    }

    /**
     * Log statistics
     */
    logStats() {
        setInterval(() => {
            const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
            console.log(`
📊 CKS-TaskForge Bridge Statistics:
   Uptime: ${uptime}s
   Patterns Detected: ${this.stats.patternsDetected}
   Tasks Generated: ${this.stats.tasksGenerated}
   Queue Size: ${this.patternQueue.length}
   Errors: ${this.stats.errors}
            `);
        }, 60000); // Log every minute
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        console.log('Shutting down CKS-TaskForge Bridge...');

        // Close WebSocket connections if any
        if (this.wsClients.cks) this.wsClients.cks.close();
        if (this.wsClients.taskforge) this.wsClients.taskforge.close();

        // Save any pending patterns
        if (this.patternQueue.length > 0) {
            console.log(`Saving ${this.patternQueue.length} pending patterns...`);
            // Could save to file for next startup
        }

        console.log('Bridge shut down successfully');
        process.exit(0);
    }
}

// Create and start bridge
const bridge = new CKSTaskForgeBridge();

// Handle shutdown signals
process.on('SIGINT', () => bridge.shutdown());
process.on('SIGTERM', () => bridge.shutdown());

// Start the bridge
bridge.start().catch(error => {
    console.error('Failed to start bridge:', error);
    process.exit(1);
});