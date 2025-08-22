/**
 * Jira Admin Agent - Intelligent Jira Administration and Configuration
 * 
 * This agent handles all Jira administrative tasks including:
 * - Project configuration
 * - Issue type management
 * - Workflow configuration
 * - Permission management
 * - Automation setup
 * - Custom field creation
 */

import { logger } from '../utils/logger';

export interface JiraAdminConfig {
  host: string;
  email: string;
  apiToken: string;
  permissions?: string[];
}

export interface ProjectConfiguration {
  key: string;
  name: string;
  issueTypes?: string[];
  workflowScheme?: string;
  permissionScheme?: string;
  customFields?: CustomField[];
}

export interface CustomField {
  name: string;
  type: string;
  description?: string;
  options?: string[];
  required?: boolean;
}

export interface WorkflowConfiguration {
  name: string;
  steps: WorkflowStep[];
  transitions: WorkflowTransition[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  properties?: Record<string, any>;
}

export interface WorkflowTransition {
  id: string;
  name: string;
  from: string;
  to: string;
  conditions?: any[];
  validators?: any[];
  postFunctions?: any[];
}

export class JiraAdminAgent {
  private config: JiraAdminConfig;
  private capabilities: Set<string>;
  private permissionCache: Map<string, boolean>;

  constructor(config: JiraAdminConfig) {
    this.config = config;
    this.capabilities = new Set();
    this.permissionCache = new Map();
  }

  /**
   * Initialize the agent and check permissions
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Jira Admin Agent...');
    
    // Check current permissions
    await this.checkPermissions();
    
    // Validate admin capabilities
    await this.validateCapabilities();
    
    logger.info(`Jira Admin Agent initialized with ${this.capabilities.size} capabilities`);
  }

  /**
   * Check what permissions the agent has
   */
  private async checkPermissions(): Promise<void> {
    try {
      // GET /rest/api/3/mypermissions
      const permissions = await this.apiRequest('/rest/api/3/mypermissions');
      
      // Store available permissions
      if (permissions.permissions) {
        Object.entries(permissions.permissions).forEach(([key, value]: [string, any]) => {
          if (value.havePermission) {
            this.capabilities.add(key);
          }
        });
      }
    } catch (error) {
      logger.error('Failed to check permissions:', error);
    }
  }

  /**
   * Validate what the agent can actually do
   */
  private async validateCapabilities(): Promise<void> {
    const requiredPermissions = [
      'ADMINISTER_PROJECTS',
      'CREATE_ISSUES',
      'BROWSE_PROJECTS'
    ];

    const missingPermissions = requiredPermissions.filter(
      perm => !this.capabilities.has(perm)
    );

    if (missingPermissions.length > 0) {
      logger.warn(`Missing permissions: ${missingPermissions.join(', ')}`);
    }
  }

  /**
   * Configure a project with issue types, workflows, etc.
   */
  async configureProject(config: ProjectConfiguration): Promise<any> {
    logger.info(`Configuring project: ${config.key}`);

    const tasks = [];

    // Configure issue types
    if (config.issueTypes) {
      tasks.push(this.configureIssueTypes(config.key, config.issueTypes));
    }

    // Configure workflow
    if (config.workflowScheme) {
      tasks.push(this.assignWorkflowScheme(config.key, config.workflowScheme));
    }

    // Configure permissions
    if (config.permissionScheme) {
      tasks.push(this.assignPermissionScheme(config.key, config.permissionScheme));
    }

    // Create custom fields
    if (config.customFields) {
      tasks.push(this.createCustomFields(config.key, config.customFields));
    }

    const results = await Promise.all(tasks);
    return results;
  }

  /**
   * Configure issue types for a project
   */
  async configureIssueTypes(projectKey: string, issueTypes: string[]): Promise<any> {
    logger.info(`Configuring issue types for ${projectKey}: ${issueTypes.join(', ')}`);

    try {
      // Get current project configuration
      const project = await this.apiRequest(`/rest/api/3/project/${projectKey}`);
      
      // Get available issue types
      const allIssueTypes = await this.apiRequest('/rest/api/3/issuetype');
      
      // Map requested types to IDs
      const typeIds = issueTypes.map(typeName => {
        const type = allIssueTypes.find((t: any) => 
          t.name.toLowerCase() === typeName.toLowerCase()
        );
        return type?.id;
      }).filter(Boolean);

      // Update project issue type scheme
      // Note: This might require Jira Admin permissions
      const result = await this.apiRequest(
        `/rest/api/3/project/${projectKey}/issueTypes`,
        'PUT',
        { issueTypeIds: typeIds }
      );

      return result;
    } catch (error) {
      logger.error(`Failed to configure issue types: ${error}`);
      throw error;
    }
  }

  /**
   * Create a workflow configuration
   */
  async createWorkflow(workflow: WorkflowConfiguration): Promise<any> {
    logger.info(`Creating workflow: ${workflow.name}`);

    // Note: Creating workflows via API is complex and might require
    // using the older SOAP API or Jira Admin endpoints
    
    try {
      // This is a simplified example - actual implementation would be more complex
      const result = await this.apiRequest(
        '/rest/api/3/workflow',
        'POST',
        workflow
      );
      return result;
    } catch (error) {
      logger.error(`Failed to create workflow: ${error}`);
      throw error;
    }
  }

  /**
   * Create custom fields for a project
   */
  async createCustomFields(projectKey: string, fields: CustomField[]): Promise<any[]> {
    logger.info(`Creating ${fields.length} custom fields for ${projectKey}`);

    const results = [];
    
    for (const field of fields) {
      try {
        const result = await this.apiRequest(
          '/rest/api/3/field',
          'POST',
          {
            name: field.name,
            description: field.description,
            type: field.type,
            searcherKey: `com.atlassian.jira.plugin.system.customfieldtypes:${field.type}searcher`
          }
        );
        results.push(result);
      } catch (error) {
        logger.error(`Failed to create field ${field.name}: ${error}`);
        results.push({ error: error.message, field: field.name });
      }
    }

    return results;
  }

  /**
   * Set up automation rules
   */
  async createAutomationRule(projectKey: string, rule: any): Promise<any> {
    logger.info(`Creating automation rule for ${projectKey}`);

    try {
      // Jira Automation API endpoint
      const result = await this.apiRequest(
        `/rest/automation/1.0/project/${projectKey}/rule`,
        'POST',
        rule
      );
      return result;
    } catch (error) {
      logger.error(`Failed to create automation rule: ${error}`);
      throw error;
    }
  }

  /**
   * Enable specific issue types for a project
   */
  async enableIssueTypesForProject(projectKey: string, issueTypeNames: string[]): Promise<any> {
    logger.info(`Enabling issue types for ${projectKey}: ${issueTypeNames.join(', ')}`);

    try {
      // Step 1: Get all issue types
      const allIssueTypes = await this.apiRequest('/rest/api/3/issuetype');
      
      // Step 2: Get project details
      const project = await this.apiRequest(`/rest/api/3/project/${projectKey}`);
      
      // Step 3: Find the issue type scheme
      // Note: This requires admin permissions
      const issueTypeScheme = await this.apiRequest(
        `/rest/api/3/issuetypescheme/project?projectId=${project.id}`
      );

      // Step 4: Update the scheme with new issue types
      const typeIds = issueTypeNames.map(name => {
        const type = allIssueTypes.find((t: any) => 
          t.name.toLowerCase() === name.toLowerCase()
        );
        return type?.id;
      }).filter(Boolean);

      // Step 5: Update project configuration
      const result = await this.updateProjectIssueTypes(project.id, typeIds);
      
      return result;
    } catch (error) {
      logger.error(`Failed to enable issue types: ${error}`);
      throw error;
    }
  }

  /**
   * Create project hierarchy templates
   */
  async createProjectTemplate(template: any): Promise<any> {
    logger.info('Creating project template');

    // This would create a reusable template for projects
    // Including issue types, workflows, screens, etc.
    
    const components = [];

    // Create workflow
    if (template.workflow) {
      components.push(this.createWorkflow(template.workflow));
    }

    // Create screens
    if (template.screens) {
      components.push(this.createScreens(template.screens));
    }

    // Create permission scheme
    if (template.permissions) {
      components.push(this.createPermissionScheme(template.permissions));
    }

    const results = await Promise.all(components);
    return results;
  }

  /**
   * Helper methods
   */
  
  private async assignWorkflowScheme(projectKey: string, schemeId: string): Promise<any> {
    // Implementation for assigning workflow scheme
    return this.apiRequest(
      `/rest/api/3/project/${projectKey}/workflowscheme`,
      'PUT',
      { schemeId }
    );
  }

  private async assignPermissionScheme(projectKey: string, schemeId: string): Promise<any> {
    // Implementation for assigning permission scheme
    return this.apiRequest(
      `/rest/api/3/project/${projectKey}/permissionscheme`,
      'PUT',
      { schemeId }
    );
  }

  private async updateProjectIssueTypes(projectId: string, issueTypeIds: string[]): Promise<any> {
    // Implementation for updating project issue types
    return this.apiRequest(
      `/rest/api/3/project/${projectId}/issueTypes`,
      'PUT',
      { issueTypeIds }
    );
  }

  private async createScreens(screens: any[]): Promise<any> {
    // Implementation for creating screens
    const results = [];
    for (const screen of screens) {
      results.push(await this.apiRequest('/rest/api/3/screen', 'POST', screen));
    }
    return results;
  }

  private async createPermissionScheme(permissions: any): Promise<any> {
    // Implementation for creating permission scheme
    return this.apiRequest('/rest/api/3/permissionscheme', 'POST', permissions);
  }

  /**
   * Make API request to Jira
   */
  private async apiRequest(path: string, method: string = 'GET', data?: any): Promise<any> {
    // This would be implemented with actual HTTP client
    // Using axios, fetch, or https module
    
    const options = {
      method,
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: data ? JSON.stringify(data) : undefined
    };

    // Placeholder for actual implementation
    logger.debug(`API Request: ${method} ${path}`);
    
    // Would return actual API response
    return { success: true, path, method };
  }

  /**
   * Analyze current project configuration
   */
  async analyzeProjectConfiguration(projectKey: string): Promise<any> {
    logger.info(`Analyzing configuration for project: ${projectKey}`);

    const analysis = {
      project: await this.apiRequest(`/rest/api/3/project/${projectKey}`),
      issueTypes: [],
      workflow: null,
      permissions: null,
      customFields: [],
      automation: [],
      recommendations: []
    };

    // Get issue types
    analysis.issueTypes = analysis.project.issueTypes || [];

    // Check for missing recommended issue types
    const recommendedTypes = ['Epic', 'Story', 'Task', 'Bug', 'Sub-task'];
    const currentTypes = analysis.issueTypes.map((t: any) => t.name);
    const missingTypes = recommendedTypes.filter(t => !currentTypes.includes(t));

    if (missingTypes.length > 0) {
      analysis.recommendations.push({
        type: 'ADD_ISSUE_TYPES',
        description: `Add missing issue types: ${missingTypes.join(', ')}`,
        priority: 'HIGH'
      });
    }

    // Check for hierarchy support
    const hasEpic = currentTypes.includes('Epic');
    const hasStory = currentTypes.includes('Story');
    const hasSubtask = currentTypes.includes('Sub-task');

    if (!hasEpic || !hasStory) {
      analysis.recommendations.push({
        type: 'ENABLE_HIERARCHY',
        description: 'Enable Epic and Story types for proper hierarchy',
        priority: 'CRITICAL'
      });
    }

    return analysis;
  }
}

/**
 * Export a factory function for creating the agent
 */
export function createJiraAdminAgent(config: JiraAdminConfig): JiraAdminAgent {
  return new JiraAdminAgent(config);
}