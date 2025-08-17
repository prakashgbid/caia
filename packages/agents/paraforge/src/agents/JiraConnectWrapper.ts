/**
 * JiraConnectWrapper - TypeScript wrapper for jira-connect agent
 * 
 * This wrapper provides a TypeScript interface to the MCP-based
 * jira-connect agent, ensuring type safety and consistency across ParaForge.
 */

import { logger } from '../utils/logger';
import { JiraConnect } from '../../agents/jira-connect';

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
}

export interface JiraSearchResult {
  issues: any[];
  total: number;
  maxResults: number;
}

export interface JiraProject {
  key: string;
  name: string;
  description?: string;
  issueTypes?: any[];
}

/**
 * Wrapper class for jira-connect agent
 * Uses the local MCP-based agent for all operations
 */
export class JiraConnectWrapper {
  private jiraConnect: JiraConnect;
  
  constructor(config?: any) {
    // Use local jira-connect agent from agents folder
    this.jiraConnect = new JiraConnect(config || {
      host: process.env.JIRA_HOST_URL || 'https://roulettecommunity.atlassian.net',
      email: process.env.JIRA_EMAIL || 'prakashmailid@gmail.com',
      apiToken: process.env.JIRA_API_TOKEN
    });
  }
  
  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    await this.jiraConnect.initialize();
  }

  /**
   * Execute jira-connect agent command
   */
  private async executeAgent(method: string, params: any): Promise<any> {
    try {
      // Map method names to agent functions
      switch (method) {
        case 'createIssue':
          return await this.jiraConnect.createIssue(params);
        case 'updateIssue':
          return await this.jiraConnect.updateIssue(params.issueKey, params.data);
        case 'getIssue':
          return await this.jiraConnect.getIssue(params.issueKey, params.fields);
        case 'searchIssues':
          return await this.jiraConnect.searchIssues(params.jql, params.fields, params.maxResults);
        case 'deleteIssue':
          return await this.jiraConnect.deleteIssue(params.issueKey);
        case 'bulkCreateIssues':
          return await this.jiraConnect.bulkCreateIssues(params.issues);
        case 'createEpic':
          return await this.jiraConnect.createEpic(params);
        case 'addIssuesToEpic':
          return await this.jiraConnect.addIssuesToEpic(params.epicKey, params.issueKeys);
        case 'createSubtask':
          return await this.jiraConnect.createSubtask(params.parentKey, params.data);
        case 'getProject':
          return await this.jiraConnect.getProject(params.projectKey);
        case 'listProjects':
          return await this.jiraConnect.listProjects();
        case 'linkIssues':
          return await this.jiraConnect.linkIssues(params.inwardIssue, params.outwardIssue, params.linkType);
        default:
          throw new Error(`Unknown method: ${method}`);
      }
    } catch (error) {
      logger.error(`JiraConnect error in ${method}:`, error);
      throw error;
    }
  }

  /**
   * Create a Jira issue
   */
  async createIssue(issue: JiraIssue): Promise<any> {
    logger.info(`Creating issue: ${issue.summary}`);
    return this.executeAgent('createIssue', issue);
  }

  /**
   * Create PROJECT epic
   */
  async createProjectEpic(data: {
    project: string;
    summary: string;
    description: string;
    labels?: string[];
  }): Promise<any> {
    logger.info(`Creating PROJECT epic: ${data.summary}`);
    return this.executeAgent('createEpic', {
      ...data,
      labels: ['PROJECT', ...(data.labels || [])]
    });
  }

  /**
   * Create INITIATIVE epic
   */
  async createInitiativeEpic(data: {
    project: string;
    summary: string;
    description: string;
    parentKey?: string;
    labels?: string[];
  }): Promise<any> {
    logger.info(`Creating INITIATIVE epic: ${data.summary}`);
    const epic = await this.executeAgent('createEpic', {
      ...data,
      labels: ['INITIATIVE', ...(data.labels || [])]
    });
    
    // Link to parent PROJECT if provided
    if (data.parentKey) {
      await this.linkIssues(epic.key, data.parentKey, 'is child of');
    }
    
    return epic;
  }

  /**
   * Create FEATURE epic
   */
  async createFeatureEpic(data: {
    project: string;
    summary: string;
    description: string;
    parentKey?: string;
    labels?: string[];
  }): Promise<any> {
    logger.info(`Creating FEATURE epic: ${data.summary}`);
    const epic = await this.executeAgent('createEpic', {
      ...data,
      labels: ['FEATURE', ...(data.labels || [])]
    });
    
    // Link to parent INITIATIVE if provided
    if (data.parentKey) {
      await this.linkIssues(epic.key, data.parentKey, 'is child of');
    }
    
    return epic;
  }

  /**
   * Create user story
   */
  async createStory(data: {
    project: string;
    summary: string;
    description: string;
    epicKey?: string;
    acceptanceCriteria?: string[];
    storyPoints?: number;
  }): Promise<any> {
    logger.info(`Creating story: ${data.summary}`);
    
    const storyDescription = this.formatStoryDescription(
      data.description,
      data.acceptanceCriteria
    );
    
    const story = await this.executeAgent('createIssue', {
      project: data.project,
      issueType: 'Story',
      summary: data.summary,
      description: storyDescription,
      storyPoints: data.storyPoints
    });
    
    // Add to epic if provided
    if (data.epicKey) {
      await this.addIssuesToEpic(data.epicKey, [story.key]);
    }
    
    return story;
  }

  /**
   * Create task
   */
  async createTask(data: {
    project: string;
    summary: string;
    description: string;
    parentKey?: string;
    todos?: string[];
    estimate?: string;
  }): Promise<any> {
    logger.info(`Creating task: ${data.summary}`);
    
    const taskDescription = this.formatTaskDescription(
      data.description,
      data.todos
    );
    
    return this.executeAgent('createIssue', {
      project: data.project,
      issueType: 'Task',
      summary: data.summary,
      description: taskDescription,
      parent: data.parentKey ? { key: data.parentKey } : undefined,
      timeEstimate: data.estimate
    });
  }

  /**
   * Bulk create issues (optimized for ParaForge scale)
   */
  async bulkCreateIssues(issues: JiraIssue[]): Promise<any[]> {
    logger.info(`Bulk creating ${issues.length} issues via jira-connect...`);
    return this.executeAgent('bulkCreateIssues', { issues });
  }

  /**
   * Search issues using JQL
   */
  async searchIssues(jql: string, fields?: string[], maxResults = 100): Promise<JiraSearchResult> {
    logger.info(`Searching: ${jql}`);
    return this.executeAgent('searchIssues', { jql, fields, maxResults });
  }

  /**
   * Get issue details
   */
  async getIssue(issueKey: string, fields?: string[]): Promise<any> {
    logger.info(`Getting issue: ${issueKey}`);
    return this.executeAgent('getIssue', { issueKey, fields });
  }

  /**
   * Update issue
   */
  async updateIssue(issueKey: string, data: any): Promise<any> {
    logger.info(`Updating issue: ${issueKey}`);
    return this.executeAgent('updateIssue', { issueKey, data });
  }

  /**
   * Delete issue
   */
  async deleteIssue(issueKey: string): Promise<any> {
    logger.info(`Deleting issue: ${issueKey}`);
    return this.executeAgent('deleteIssue', { issueKey });
  }

  /**
   * Add issues to epic
   */
  async addIssuesToEpic(epicKey: string, issueKeys: string[]): Promise<any> {
    logger.info(`Adding ${issueKeys.length} issues to epic ${epicKey}`);
    return this.executeAgent('addIssuesToEpic', { epicKey, issueKeys });
  }

  /**
   * Link two issues
   */
  async linkIssues(inwardIssue: string, outwardIssue: string, linkType: string): Promise<any> {
    logger.info(`Linking ${inwardIssue} to ${outwardIssue} (${linkType})`);
    return this.executeAgent('linkIssues', { inwardIssue, outwardIssue, linkType });
  }

  /**
   * Get project details
   */
  async getProject(projectKey: string): Promise<JiraProject> {
    logger.info(`Getting project: ${projectKey}`);
    return this.executeAgent('getProject', { projectKey });
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<JiraProject[]> {
    logger.info('Listing all projects');
    return this.executeAgent('listProjects', {});
  }

  /**
   * Delete all issues in project (for cleanup)
   */
  async deleteAllProjectIssues(projectKey: string): Promise<number> {
    logger.info(`Deleting all issues in project ${projectKey}`);
    
    // Search for all issues
    const result = await this.searchIssues(
      `project = ${projectKey}`,
      ['key', 'summary'],
      1000
    );
    
    if (result.issues.length === 0) {
      logger.info('No issues to delete');
      return 0;
    }
    
    logger.info(`Found ${result.issues.length} issues to delete`);
    
    // Delete in parallel batches
    const batchSize = 10;
    let deleted = 0;
    
    for (let i = 0; i < result.issues.length; i += batchSize) {
      const batch = result.issues.slice(i, i + batchSize);
      const promises = batch.map(issue => this.deleteIssue(issue.key));
      await Promise.all(promises);
      deleted += batch.length;
      logger.info(`Deleted ${deleted}/${result.issues.length} issues`);
    }
    
    return deleted;
  }

  /**
   * Format story description with acceptance criteria
   */
  private formatStoryDescription(description: string, acceptanceCriteria?: string[]): string {
    let formatted = description;
    
    if (acceptanceCriteria && acceptanceCriteria.length > 0) {
      formatted += '\n\n## Acceptance Criteria\n';
      acceptanceCriteria.forEach((criteria, index) => {
        formatted += `${index + 1}. ${criteria}\n`;
      });
    }
    
    return formatted;
  }

  /**
   * Format task description with TO-DOs
   */
  private formatTaskDescription(description: string, todos?: string[]): string {
    let formatted = description;
    
    if (todos && todos.length > 0) {
      formatted += '\n\n## TO-DO List\n';
      todos.forEach(todo => {
        formatted += `- [ ] ${todo}\n`;
      });
    }
    
    return formatted;
  }
}

// Export singleton instance
export const jiraConnect = new JiraConnectWrapper();

// Export class for testing
export default JiraConnectWrapper;