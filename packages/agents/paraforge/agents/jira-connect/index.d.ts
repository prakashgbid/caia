/**
 * @autoforge/jira-connect
 * Enterprise-grade MCP-based Jira integration for parallel operations at scale
 */
import { EventEmitter } from 'eventemitter3';
export interface JiraConnectConfig {
    host: string;
    email: string;
    apiToken: string;
    maxParallel?: number;
    retryAttempts?: number;
    timeout?: number;
    rateLimitBuffer?: number;
}
export interface JiraIssue {
    project: string;
    issueType: string;
    summary: string;
    description?: string;
    labels?: string[];
    epicName?: string;
    priority?: string;
    assignee?: string;
    components?: string[];
    fixVersions?: string[];
    parent?: {
        key: string;
    };
    [key: string]: any;
}
export interface JiraSearchResult {
    issues: any[];
    total: number;
    maxResults: number;
}
export interface JiraMetrics {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    rateLimitRemaining: number;
    connectionPoolSize: number;
}
/**
 * JiraConnect - MCP-based Jira client with enterprise features
 */
export declare class JiraConnect extends EventEmitter {
    private config;
    private mcpServer;
    private isInitialized;
    private queue;
    private metrics;
    private pendingRequests;
    private requestIdCounter;
    constructor(config: JiraConnectConfig);
    /**
     * Initialize the MCP server
     */
    initialize(): Promise<void>;
    /**
     * Handle MCP response
     */
    private handleMCPResponse;
    /**
     * Update metrics
     */
    private updateMetrics;
    /**
     * Send request to MCP server
     */
    private sendRequest;
    /**
     * Create a Jira issue
     */
    createIssue(issue: JiraIssue): Promise<any>;
    /**
     * Bulk create issues (optimized for parallel execution)
     */
    bulkCreateIssues(issues: JiraIssue[]): Promise<any[]>;
    /**
     * Update a Jira issue
     */
    updateIssue(issueKey: string, data: any): Promise<any>;
    /**
     * Search issues using JQL
     */
    searchIssues(jql: string, fields?: string[], maxResults?: number): Promise<JiraSearchResult>;
    /**
     * Get issue details
     */
    getIssue(issueKey: string, fields?: string[]): Promise<any>;
    /**
     * Delete an issue
     */
    deleteIssue(issueKey: string): Promise<any>;
    /**
     * Create an epic
     */
    createEpic(data: JiraIssue): Promise<any>;
    /**
     * Add issues to epic
     */
    addIssuesToEpic(epicKey: string, issueKeys: string[]): Promise<any>;
    /**
     * Create subtask
     */
    createSubtask(parentKey: string, data: JiraIssue): Promise<any>;
    /**
     * Link two issues
     */
    linkIssues(inwardIssue: string, outwardIssue: string, linkType?: string): Promise<any>;
    /**
     * Get project details
     */
    getProject(projectKey: string): Promise<any>;
    /**
     * List all projects
     */
    listProjects(): Promise<any[]>;
    /**
     * Get metrics
     */
    getMetrics(): JiraMetrics;
    /**
     * Shutdown gracefully
     */
    shutdown(): Promise<void>;
}
export default JiraConnect;
//# sourceMappingURL=index.d.ts.map