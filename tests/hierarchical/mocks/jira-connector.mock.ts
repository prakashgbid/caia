import { jest } from '@jest/globals';

/**
 * Mock JIRA Connector for testing
 */
export class MockJiraConnector {
  private issueCounter = 0;
  private createdIssues: any[] = [];
  private projectCounter = 0;
  private failureRate = 0;
  private latency = 0;

  constructor(options: {
    failureRate?: number;
    latency?: number;
  } = {}) {
    this.failureRate = options.failureRate || 0;
    this.latency = options.latency || 0;
  }

  /**
   * Mock create issue method
   */
  async createIssue(issueData: {
    summary: string;
    description?: string;
    issueType: string;
    project: string;
    priority?: string;
    parentKey?: string;
    assignee?: string;
    components?: string[];
    labels?: string[];
    customFields?: Record<string, any>;
  }) {
    // Simulate latency
    if (this.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latency));
    }

    // Simulate failure rate
    if (Math.random() < this.failureRate) {
      throw new Error(`JIRA API Error: Failed to create issue "${issueData.summary}"`);
    }

    this.issueCounter++;
    
    const issue = {
      key: `${issueData.project}-${this.issueCounter}`,
      id: this.issueCounter.toString(),
      summary: issueData.summary,
      description: issueData.description || '',
      issueType: issueData.issueType,
      project: issueData.project,
      status: 'To Do',
      priority: issueData.priority || 'Medium',
      parentKey: issueData.parentKey,
      assignee: issueData.assignee,
      components: issueData.components || [],
      labels: issueData.labels || [],
      customFields: issueData.customFields || {},
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      reporter: 'test-user',
      url: `https://test-jira.atlassian.net/browse/${issueData.project}-${this.issueCounter}`
    };

    this.createdIssues.push(issue);
    return issue;
  }

  /**
   * Mock update issue method
   */
  async updateIssue(issueKey: string, updateData: any) {
    if (this.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latency));
    }

    if (Math.random() < this.failureRate) {
      throw new Error(`JIRA API Error: Failed to update issue "${issueKey}"`);
    }

    const issue = this.createdIssues.find(i => i.key === issueKey);
    if (!issue) {
      throw new Error(`Issue ${issueKey} not found`);
    }

    Object.assign(issue, updateData, { updated: new Date().toISOString() });
    return issue;
  }

  /**
   * Mock get issue method
   */
  async getIssue(issueKey: string) {
    if (this.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latency));
    }

    if (Math.random() < this.failureRate) {
      throw new Error(`JIRA API Error: Failed to get issue "${issueKey}"`);
    }

    const issue = this.createdIssues.find(i => i.key === issueKey);
    if (!issue) {
      throw new Error(`Issue ${issueKey} not found`);
    }

    return issue;
  }

  /**
   * Mock search issues method
   */
  async searchIssues(jql: string, options: {
    startAt?: number;
    maxResults?: number;
    fields?: string[];
  } = {}) {
    if (this.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latency));
    }

    if (Math.random() < this.failureRate) {
      throw new Error(`JIRA API Error: Failed to search issues with JQL "${jql}"`);
    }

    const { startAt = 0, maxResults = 50 } = options;
    const allIssues = this.createdIssues;
    const filteredIssues = allIssues.slice(startAt, startAt + maxResults);

    return {
      issues: filteredIssues,
      total: allIssues.length,
      startAt,
      maxResults,
      isLast: startAt + maxResults >= allIssues.length
    };
  }

  /**
   * Mock create project method
   */
  async createProject(projectData: {
    key: string;
    name: string;
    projectTypeKey: string;
    lead: string;
    description?: string;
  }) {
    if (this.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latency));
    }

    if (Math.random() < this.failureRate) {
      throw new Error(`JIRA API Error: Failed to create project "${projectData.name}"`);
    }

    this.projectCounter++;
    
    const project = {
      id: this.projectCounter.toString(),
      key: projectData.key,
      name: projectData.name,
      projectTypeKey: projectData.projectTypeKey,
      lead: projectData.lead,
      description: projectData.description || '',
      url: `https://test-jira.atlassian.net/projects/${projectData.key}`
    };

    return project;
  }

  /**
   * Mock batch create issues method
   */
  async batchCreateIssues(issues: any[]) {
    if (this.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latency * issues.length));
    }

    const results = [];
    const errors = [];

    for (const issueData of issues) {
      try {
        if (Math.random() < this.failureRate) {
          errors.push({
            issueData,
            error: `Failed to create issue: ${issueData.summary}`
          });
        } else {
          const issue = await this.createIssue(issueData);
          results.push(issue);
        }
      } catch (error) {
        errors.push({
          issueData,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      success: results,
      errors,
      successCount: results.length,
      errorCount: errors.length
    };
  }

  /**
   * Mock add comment method
   */
  async addComment(issueKey: string, comment: string) {
    if (this.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latency));
    }

    if (Math.random() < this.failureRate) {
      throw new Error(`JIRA API Error: Failed to add comment to issue "${issueKey}"`);
    }

    const issue = this.createdIssues.find(i => i.key === issueKey);
    if (!issue) {
      throw new Error(`Issue ${issueKey} not found`);
    }

    const commentObj = {
      id: Date.now().toString(),
      body: comment,
      author: 'test-user',
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };

    if (!issue.comments) {
      issue.comments = [];
    }
    issue.comments.push(commentObj);

    return commentObj;
  }

  /**
   * Mock transition issue method
   */
  async transitionIssue(issueKey: string, transitionId: string) {
    if (this.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latency));
    }

    if (Math.random() < this.failureRate) {
      throw new Error(`JIRA API Error: Failed to transition issue "${issueKey}"`);
    }

    const issue = this.createdIssues.find(i => i.key === issueKey);
    if (!issue) {
      throw new Error(`Issue ${issueKey} not found`);
    }

    const transitions = {
      '21': 'In Progress',
      '31': 'Done',
      '41': 'Reopened'
    };

    issue.status = transitions[transitionId as keyof typeof transitions] || 'Unknown';
    issue.updated = new Date().toISOString();

    return issue;
  }

  // Test utilities
  getCreatedIssues() {
    return [...this.createdIssues];
  }

  getIssueCount() {
    return this.issueCounter;
  }

  clearIssues() {
    this.createdIssues = [];
    this.issueCounter = 0;
    this.projectCounter = 0;
  }

  setFailureRate(rate: number) {
    this.failureRate = Math.max(0, Math.min(1, rate));
  }

  setLatency(latencyMs: number) {
    this.latency = Math.max(0, latencyMs);
  }

  // Simulate rate limiting
  simulateRateLimit() {
    throw new Error('JIRA API Error: Rate limit exceeded. Please try again later.');
  }

  // Simulate network error
  simulateNetworkError() {
    throw new Error('Network Error: Unable to connect to JIRA API');
  }
}

/**
 * Pre-configured mock instances for different test scenarios
 */
export const mockJiraInstances = {
  // Reliable instance with no failures
  reliable: () => new MockJiraConnector({ failureRate: 0, latency: 50 }),
  
  // Slow instance with high latency
  slow: () => new MockJiraConnector({ failureRate: 0, latency: 2000 }),
  
  // Unreliable instance with failures
  unreliable: () => new MockJiraConnector({ failureRate: 0.3, latency: 100 }),
  
  // Fast instance for performance tests
  fast: () => new MockJiraConnector({ failureRate: 0, latency: 10 }),
  
  // Very unreliable for error testing
  veryUnreliable: () => new MockJiraConnector({ failureRate: 0.7, latency: 500 })
};

/**
 * Jest mock factory for JIRA connector
 */
export const createJiraMock = (scenario: keyof typeof mockJiraInstances = 'reliable') => {
  const instance = mockJiraInstances[scenario]();
  
  return {
    createIssue: jest.fn().mockImplementation(instance.createIssue.bind(instance)),
    updateIssue: jest.fn().mockImplementation(instance.updateIssue.bind(instance)),
    getIssue: jest.fn().mockImplementation(instance.getIssue.bind(instance)),
    searchIssues: jest.fn().mockImplementation(instance.searchIssues.bind(instance)),
    createProject: jest.fn().mockImplementation(instance.createProject.bind(instance)),
    batchCreateIssues: jest.fn().mockImplementation(instance.batchCreateIssues.bind(instance)),
    addComment: jest.fn().mockImplementation(instance.addComment.bind(instance)),
    transitionIssue: jest.fn().mockImplementation(instance.transitionIssue.bind(instance)),
    
    // Test utilities
    _getCreatedIssues: instance.getCreatedIssues.bind(instance),
    _getIssueCount: instance.getIssueCount.bind(instance),
    _clearIssues: instance.clearIssues.bind(instance),
    _setFailureRate: instance.setFailureRate.bind(instance),
    _setLatency: instance.setLatency.bind(instance),
    _instance: instance
  };
};

/**
 * Sample JIRA responses for testing
 */
export const sampleJiraResponses = {
  issue: {
    key: 'TEST-123',
    id: '123',
    summary: 'Sample Issue',
    description: 'This is a sample issue for testing',
    issueType: 'Story',
    project: 'TEST',
    status: 'To Do',
    priority: 'Medium',
    created: '2024-01-01T00:00:00.000Z',
    updated: '2024-01-01T00:00:00.000Z',
    reporter: 'test-user'
  },
  
  searchResults: {
    issues: [],
    total: 0,
    startAt: 0,
    maxResults: 50,
    isLast: true
  },
  
  project: {
    id: '1',
    key: 'TEST',
    name: 'Test Project',
    projectTypeKey: 'software',
    lead: 'test-user'
  }
};

export default MockJiraConnector;