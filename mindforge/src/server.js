const express = require('express');
const cors = require('cors');
const path = require('path');
const MindForgeDatabase = require('./database');
const AIAnalyzer = require('./ai-analyzer');
const CronAnalyzer = require('./cron-analyzer');

const app = express();
const PORT = 5557;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
// Removed static UI - MindForge is now API-only, integrated into unified dashboard

// Initialize components
let db;
let analyzer;
let cronAnalyzer;

async function initialize() {
    db = new MindForgeDatabase();
    await db.initialize();

    analyzer = new AIAnalyzer();
    await analyzer.initialize();

    cronAnalyzer = new CronAnalyzer();
    await cronAnalyzer.initialize();
    cronAnalyzer.setupJobs();
    cronAnalyzer.start();

    console.log('✅ MindForge initialized successfully');
}

/**
 * ============================================
 * TODO ENDPOINTS
 * ============================================
 */

// Get todos
app.get('/api/todos', async (req, res) => {
    try {
        const { category, status } = req.query;
        const todos = await db.getTodos({ category, status });

        res.json({
            success: true,
            todos,
            count: todos.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get todos',
            message: error.message
        });
    }
});

// Create todo
app.post('/api/todos', async (req, res) => {
    try {
        const todoId = await db.createTodo({
            ...req.body,
            source: 'manual'
        });

        res.json({
            success: true,
            id: todoId,
            message: 'Todo created successfully'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to create todo',
            message: error.message
        });
    }
});

// Update todo
app.put('/api/todos/:id', async (req, res) => {
    try {
        await db.updateTodo(req.params.id, req.body);

        res.json({
            success: true,
            message: 'Todo updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to update todo',
            message: error.message
        });
    }
});

/**
 * ============================================
 * SUGGESTION ENDPOINTS
 * ============================================
 */

// Get suggestions
app.get('/api/suggestions', async (req, res) => {
    try {
        const { target, status } = req.query;
        const suggestions = await db.getSuggestions({ target, status });

        res.json({
            success: true,
            suggestions,
            count: suggestions.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get suggestions',
            message: error.message
        });
    }
});

// Update suggestion status
app.put('/api/suggestions/:id', async (req, res) => {
    try {
        await db.updateSuggestion(req.params.id, req.body);

        res.json({
            success: true,
            message: 'Suggestion updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to update suggestion',
            message: error.message
        });
    }
});

// Generate suggestions manually
app.post('/api/suggestions/generate', async (req, res) => {
    try {
        const count = await analyzer.generateIntelligentSuggestions();

        res.json({
            success: true,
            count,
            message: `Generated ${count} new suggestions`
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to generate suggestions',
            message: error.message
        });
    }
});

/**
 * ============================================
 * INSIGHT ENDPOINTS
 * ============================================
 */

// Get insights
app.get('/api/insights', async (req, res) => {
    try {
        const insights = await db.getInsights();

        res.json({
            success: true,
            insights,
            count: insights.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get insights',
            message: error.message
        });
    }
});

/**
 * ============================================
 * CONVERSATION ENDPOINTS
 * ============================================
 */

// Add conversation (webhook from Claude Code)
app.post('/api/conversations', async (req, res) => {
    try {
        const convId = await db.addConversation(req.body);

        // Trigger immediate analysis
        setImmediate(async () => {
            try {
                await analyzer.analyzeConversations();
            } catch (error) {
                console.error('Error analyzing conversation:', error);
            }
        });

        res.json({
            success: true,
            id: convId,
            message: 'Conversation added'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to add conversation',
            message: error.message
        });
    }
});

/**
 * ============================================
 * PROGRESS ENDPOINTS
 * ============================================
 */

// Get progress metrics
app.get('/api/progress/:project', async (req, res) => {
    try {
        const { metric } = req.query;
        const progress = await db.getProgress(req.params.project, metric);

        res.json({
            success: true,
            progress,
            count: progress.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get progress',
            message: error.message
        });
    }
});

/**
 * ============================================
 * STATISTICS & HEALTH
 * ============================================
 */

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

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'MindForge',
        version: '1.0.0',
        timestamp: new Date(),
        cron: cronAnalyzer ? 'running' : 'stopped'
    });
});

/**
 * ============================================
 * ANALYSIS ENDPOINTS
 * ============================================
 */

// Trigger conversation analysis
app.post('/api/analyze/conversations', async (req, res) => {
    try {
        const count = await analyzer.analyzeConversations();

        res.json({
            success: true,
            count,
            message: `Analyzed ${count} conversations`
        });
    } catch (error) {
        res.status(500).json({
            error: 'Analysis failed',
            message: error.message
        });
    }
});

// Trigger insight generation
app.post('/api/analyze/insights', async (req, res) => {
    try {
        const count = await analyzer.generateInsights();

        res.json({
            success: true,
            count,
            message: `Generated ${count} insights`
        });
    } catch (error) {
        res.status(500).json({
            error: 'Insight generation failed',
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
        service: 'MindForge',
        version: '1.0.0',
        description: 'AI-Powered Todo & Suggestion System',
        endpoints: {
            todos: [
                'GET /api/todos - Get todos',
                'POST /api/todos - Create todo',
                'PUT /api/todos/:id - Update todo'
            ],
            suggestions: [
                'GET /api/suggestions - Get suggestions',
                'PUT /api/suggestions/:id - Update suggestion',
                'POST /api/suggestions/generate - Generate suggestions'
            ],
            insights: [
                'GET /api/insights - Get insights'
            ],
            conversations: [
                'POST /api/conversations - Add conversation'
            ],
            progress: [
                'GET /api/progress/:project - Get progress metrics'
            ],
            analysis: [
                'POST /api/analyze/conversations - Analyze conversations',
                'POST /api/analyze/insights - Generate insights'
            ],
            stats: [
                'GET /api/stats - Get statistics',
                'GET /api/health - Health check'
            ]
        }
    });
});

// Start server
async function start() {
    await initialize();

    app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║               🧠 MINDFORGE SERVER STARTED!                 ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║     Dashboard:  http://localhost:${PORT}/                      ║
║     API Docs:   http://localhost:${PORT}/api                   ║
║                                                            ║
║     Features:                                              ║
║     ✅ Conversation Analysis & Todo Extraction            ║
║     ✅ AI-Powered Suggestion Generation                   ║
║     ✅ Pattern Recognition & Insights                     ║
║     ✅ Progress Tracking for CAIA & CCU                   ║
║     ✅ Background Cron Analysis                           ║
║     ✅ CKS & CLS Integration                              ║
║                                                            ║
║     Cron Schedule:                                         ║
║     📅 Every 5 mins: Analyze conversations                ║
║     📅 Every 30 mins: Generate suggestions                ║
║     📅 Every hour: Generate insights                      ║
║     📅 Every 6 hours: Comprehensive analysis              ║
║                                                            ║
║     Status: Ready to forge ideas into insights!            ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
        `);
    });
}

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down MindForge...');
    if (cronAnalyzer) cronAnalyzer.stop();
    if (db) db.close();
    process.exit(0);
});

// Export for testing
module.exports = { app, initialize };

// Start if run directly
if (require.main === module) {
    start().catch(console.error);
}