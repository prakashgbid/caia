/**
 * @autoforge/jira-connect
 * Enterprise-grade MCP-based Jira integration for parallel operations at scale
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'eventemitter3';
import PQueue from 'p-queue';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';

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
  parent?: { key: string };
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

interface MCPRequest {
  jsonrpc: '2.0';
  method: string;
  params: any;
  id: number | string;
}

interface MCPResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number | string;
}

/**
 * JiraConnect - MCP-based Jira client with enterprise features
 */
export class JiraConnect extends EventEmitter {
  private config: JiraConnectConfig;
  private mcpServer: ChildProcess | null = null;
  private isInitialized = false;
  private queue: PQueue;
  private metrics: JiraMetrics;
  private pendingRequests: Map<number | string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    startTime: number;
  }>;
  private requestIdCounter = 0;

  constructor(config: JiraConnectConfig) {
    super();
    
    this.config = {
      maxParallel: 50,
      retryAttempts: 3,
      timeout: 30000,
      rateLimitBuffer: 0.9,
      ...config
    };

    this.queue = new PQueue({ 
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
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info('Initializing JiraConnect MCP server...');
    
    return new Promise((resolve, reject) => {
      // Start MCP server
      this.mcpServer = spawn('npx', ['@dsazz/mcp-jira'], {
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
            const response: MCPResponse = JSON.parse(line);
            this.handleMCPResponse(response);
          } catch (err) {
            // Not JSON, likely server logs
            if (process.env.DEBUG) {
              console.log('[MCP]', line);
            }
          }
        }
      });

      this.mcpServer.stderr?.on('data', (data) => {
        logger.error('MCP server error:', data.toString());
      });

      this.mcpServer.on('error', (error) => {
        logger.error('Failed to start MCP server:', error);
        reject(error);
      });

      this.mcpServer.on('close', (code) => {
        logger.info(`MCP server exited with code ${code}`);
        this.isInitialized = false;
        this.emit('disconnected', code);
      });

      // Wait for server to be ready
      setTimeout(() => {
        this.isInitialized = true;
        logger.info('JiraConnect MCP server initialized');
        this.emit('connected');
        resolve();
      }, 2000);
    });
  }

  /**
   * Handle MCP response
   */
  private handleMCPResponse(response: MCPResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    const responseTime = Date.now() - pending.startTime;
    this.updateMetrics(responseTime, !response.error);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }

    this.pendingRequests.delete(response.id);
  }

  /**
   * Update metrics
   */
  private updateMetrics(responseTime: number, success: boolean): void {
    this.metrics.totalRequests++;
    
    if (success) {
      this.metrics.successfulRequests++;
    } else {
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
  private async sendRequest(method: string, params: any): Promise<any> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const id = ++this.requestIdCounter;
    const request: MCPRequest = {
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
        this.pendingRequests.get(id)!.resolve = (value) => {
          clearTimeout(timeout);
          resolve(value);
        };
        
        this.pendingRequests.get(id)!.reject = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
      });
    });
  }

  /**
   * Create a Jira issue
   */
  async createIssue(issue: JiraIssue): Promise<any> {
    logger.info(`Creating issue: ${issue.summary}`);
    return this.sendRequest('create_issue', issue);
  }

  /**
   * Bulk create issues (optimized for parallel execution)
   */
  async bulkCreateIssues(issues: JiraIssue[]): Promise<any[]> {
    logger.info(`Bulk creating ${issues.length} issues...`);
    
    const promises = issues.map(issue => this.createIssue(issue));
    return Promise.all(promises);
  }

  /**
   * Update a Jira issue
   */
  async updateIssue(issueKey: string, data: any): Promise<any> {
    logger.info(`Updating issue: ${issueKey}`);
    return this.sendRequest('update_issue', {
      issue_key: issueKey,
      fields: data
    });
  }

  /**
   * Search issues using JQL
   */
  async searchIssues(
    jql: string,
    fields?: string[],
    maxResults = 100
  ): Promise<JiraSearchResult> {
    logger.info(`Searching: ${jql}`);
    return this.sendRequest('search_issues', {
      jql,
      fields,
      max_results: maxResults
    });
  }

  /**
   * Get issue details
   */
  async getIssue(issueKey: string, fields?: string[]): Promise<any> {
    logger.info(`Getting issue: ${issueKey}`);
    return this.sendRequest('get_issue', {
      issue_key: issueKey,
      fields
    });
  }

  /**
   * Delete an issue
   */
  async deleteIssue(issueKey: string): Promise<any> {
    logger.info(`Deleting issue: ${issueKey}`);
    return this.sendRequest('delete_issue', {
      issue_key: issueKey
    });
  }

  /**
   * Create an epic
   */
  async createEpic(data: JiraIssue): Promise<any> {
    return this.createIssue({
      ...data,
      issueType: 'Epic',
      epicName: data.epicName || data.summary
    });
  }

  /**
   * Add issues to epic
   */
  async addIssuesToEpic(epicKey: string, issueKeys: string[]): Promise<any> {
    const promises = issueKeys.map(issueKey =>
      this.updateIssue(issueKey, { epicLink: epicKey })
    );
    return Promise.all(promises);
  }

  /**
   * Create subtask
   */
  async createSubtask(parentKey: string, data: JiraIssue): Promise<any> {
    return this.createIssue({
      ...data,
      issueType: 'Sub-task',
      parent: { key: parentKey }
    });
  }

  /**
   * Link two issues
   */
  async linkIssues(
    inwardIssue: string,
    outwardIssue: string,
    linkType = 'Relates'
  ): Promise<any> {
    return this.sendRequest('link_issues', {
      inward_issue: inwardIssue,
      outward_issue: outwardIssue,
      link_type: linkType
    });
  }

  /**
   * Get project details
   */
  async getProject(projectKey: string): Promise<any> {
    logger.info(`Getting project: ${projectKey}`);
    return this.sendRequest('get_project', {
      project_key: projectKey
    });
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<any[]> {
    logger.info('Listing projects');
    return this.sendRequest('list_projects', {});
  }

  /**
   * Get metrics
   */
  getMetrics(): JiraMetrics {
    return { ...this.metrics };
  }

  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    if (this.mcpServer) {
      logger.info('Shutting down JiraConnect MCP server...');
      this.mcpServer.kill();
      this.mcpServer = null;
      this.isInitialized = false;
      this.emit('shutdown');
    }
  }
}

// Export default instance for convenience
export default JiraConnect;