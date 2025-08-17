"use strict";
/**
 * @autoforge/jira-connect
 * Enterprise-grade MCP-based Jira integration for parallel operations at scale
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JiraConnect = void 0;
const child_process_1 = require("child_process");
const eventemitter3_1 = require("eventemitter3");
const p_queue_1 = __importDefault(require("p-queue"));
const logger_1 = require("./logger");
/**
 * JiraConnect - MCP-based Jira client with enterprise features
 */
class JiraConnect extends eventemitter3_1.EventEmitter {
    config;
    mcpServer = null;
    isInitialized = false;
    queue;
    metrics;
    pendingRequests;
    requestIdCounter = 0;
    constructor(config) {
        super();
        this.config = {
            maxParallel: 50,
            retryAttempts: 3,
            timeout: 30000,
            rateLimitBuffer: 0.9,
            ...config
        };
        this.queue = new p_queue_1.default({
            concurrency: this.config.maxParallel,
            interval: 1000,
            intervalCap: 10
        });
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            rateLimitRemaining: 1000,
            connectionPoolSize: this.config.maxParallel || 50
        };
        this.pendingRequests = new Map();
    }
    /**
     * Initialize the MCP server
     */
    async initialize() {
        if (this.isInitialized)
            return;
        logger_1.logger.info('Initializing JiraConnect MCP server...');
        return new Promise((resolve, reject) => {
            // Start MCP server
            this.mcpServer = (0, child_process_1.spawn)('npx', ['@dsazz/mcp-jira'], {
                env: {
                    ...process.env,
                    JIRA_HOST_URL: this.config.host,
                    JIRA_USERNAME: this.config.email,
                    JIRA_API_TOKEN: this.config.apiToken,
                    NODE_ENV: 'production'
                },
                stdio: ['pipe', 'pipe', 'pipe']
            });
            // Handle MCP server output
            this.mcpServer.stdout?.on('data', (data) => {
                const lines = data.toString().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const response = JSON.parse(line);
                        this.handleMCPResponse(response);
                    }
                    catch (err) {
                        // Not JSON, likely server logs
                        if (process.env.DEBUG) {
                            console.log('[MCP]', line);
                        }
                    }
                }
            });
            this.mcpServer.stderr?.on('data', (data) => {
                logger_1.logger.error('MCP server error:', data.toString());
            });
            this.mcpServer.on('error', (error) => {
                logger_1.logger.error('Failed to start MCP server:', error);
                reject(error);
            });
            this.mcpServer.on('close', (code) => {
                logger_1.logger.info(`MCP server exited with code ${code}`);
                this.isInitialized = false;
                this.emit('disconnected', code);
            });
            // Wait for server to be ready
            setTimeout(() => {
                this.isInitialized = true;
                logger_1.logger.info('JiraConnect MCP server initialized');
                this.emit('connected');
                resolve();
            }, 2000);
        });
    }
    /**
     * Handle MCP response
     */
    handleMCPResponse(response) {
        const pending = this.pendingRequests.get(response.id);
        if (!pending)
            return;
        const responseTime = Date.now() - pending.startTime;
        this.updateMetrics(responseTime, !response.error);
        if (response.error) {
            pending.reject(new Error(response.error.message));
        }
        else {
            pending.resolve(response.result);
        }
        this.pendingRequests.delete(response.id);
    }
    /**
     * Update metrics
     */
    updateMetrics(responseTime, success) {
        this.metrics.totalRequests++;
        if (success) {
            this.metrics.successfulRequests++;
        }
        else {
            this.metrics.failedRequests++;
        }
        // Update average response time
        const oldAvg = this.metrics.averageResponseTime;
        const count = this.metrics.totalRequests;
        this.metrics.averageResponseTime = (oldAvg * (count - 1) + responseTime) / count;
    }
    /**
     * Send request to MCP server
     */
    async sendRequest(method, params) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        const id = ++this.requestIdCounter;
        const request = {
            jsonrpc: '2.0',
            method,
            params,
            id
        };
        return this.queue.add(async () => {
            return new Promise((resolve, reject) => {
                const startTime = Date.now();
                // Store pending request
                this.pendingRequests.set(id, { resolve, reject, startTime });
                // Set timeout
                const timeout = setTimeout(() => {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request timeout after ${this.config.timeout}ms`));
                }, this.config.timeout || 30000);
                // Send request
                this.mcpServer?.stdin?.write(JSON.stringify(request) + '\n');
                // Emit request event
                this.emit('request', { method, params, id });
                // Clear timeout on completion
                this.pendingRequests.get(id).resolve = (value) => {
                    clearTimeout(timeout);
                    resolve(value);
                };
                this.pendingRequests.get(id).reject = (error) => {
                    clearTimeout(timeout);
                    reject(error);
                };
            });
        });
    }
    /**
     * Create a Jira issue
     */
    async createIssue(issue) {
        logger_1.logger.info(`Creating issue: ${issue.summary}`);
        return this.sendRequest('create_issue', issue);
    }
    /**
     * Bulk create issues (optimized for parallel execution)
     */
    async bulkCreateIssues(issues) {
        logger_1.logger.info(`Bulk creating ${issues.length} issues...`);
        const promises = issues.map(issue => this.createIssue(issue));
        return Promise.all(promises);
    }
    /**
     * Update a Jira issue
     */
    async updateIssue(issueKey, data) {
        logger_1.logger.info(`Updating issue: ${issueKey}`);
        return this.sendRequest('update_issue', {
            issue_key: issueKey,
            fields: data
        });
    }
    /**
     * Search issues using JQL
     */
    async searchIssues(jql, fields, maxResults = 100) {
        logger_1.logger.info(`Searching: ${jql}`);
        return this.sendRequest('search_issues', {
            jql,
            fields,
            max_results: maxResults
        });
    }
    /**
     * Get issue details
     */
    async getIssue(issueKey, fields) {
        logger_1.logger.info(`Getting issue: ${issueKey}`);
        return this.sendRequest('get_issue', {
            issue_key: issueKey,
            fields
        });
    }
    /**
     * Delete an issue
     */
    async deleteIssue(issueKey) {
        logger_1.logger.info(`Deleting issue: ${issueKey}`);
        return this.sendRequest('delete_issue', {
            issue_key: issueKey
        });
    }
    /**
     * Create an epic
     */
    async createEpic(data) {
        return this.createIssue({
            ...data,
            issueType: 'Epic',
            epicName: data.epicName || data.summary
        });
    }
    /**
     * Add issues to epic
     */
    async addIssuesToEpic(epicKey, issueKeys) {
        const promises = issueKeys.map(issueKey => this.updateIssue(issueKey, { epicLink: epicKey }));
        return Promise.all(promises);
    }
    /**
     * Create subtask
     */
    async createSubtask(parentKey, data) {
        return this.createIssue({
            ...data,
            issueType: 'Sub-task',
            parent: { key: parentKey }
        });
    }
    /**
     * Link two issues
     */
    async linkIssues(inwardIssue, outwardIssue, linkType = 'Relates') {
        return this.sendRequest('link_issues', {
            inward_issue: inwardIssue,
            outward_issue: outwardIssue,
            link_type: linkType
        });
    }
    /**
     * Get project details
     */
    async getProject(projectKey) {
        logger_1.logger.info(`Getting project: ${projectKey}`);
        return this.sendRequest('get_project', {
            project_key: projectKey
        });
    }
    /**
     * List all projects
     */
    async listProjects() {
        logger_1.logger.info('Listing projects');
        return this.sendRequest('list_projects', {});
    }
    /**
     * Get metrics
     */
    getMetrics() {
        return { ...this.metrics };
    }
    /**
     * Shutdown gracefully
     */
    async shutdown() {
        if (this.mcpServer) {
            logger_1.logger.info('Shutting down JiraConnect MCP server...');
            this.mcpServer.kill();
            this.mcpServer = null;
            this.isInitialized = false;
            this.emit('shutdown');
        }
    }
}
exports.JiraConnect = JiraConnect;
// Export default instance for convenience
exports.default = JiraConnect;
//# sourceMappingURL=index.js.map