/**
 * Jira Connector - Handles Jira integration and model execution
 */

import { logger } from '../utils/logger';
import { JiraConnectWrapper } from '../agents/JiraConnectWrapper';
import type { OptimizedPlan } from '../optimizer/ParallelizationOptimizer';

export interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
}

export interface JiraModel {
  project: string;
  structure: JiraStructureItem[];
  metadata: {
    totalItems: number;
    estimatedDuration: string;
    parallelizationLevels: number;
  };
}

export interface JiraStructureItem {
  type: 'project' | 'initiative' | 'feature' | 'story' | 'task';
  summary: string;
  description: string;
  level: number;
  dependencies: string[];
  jiraData: any;
  children?: JiraStructureItem[];
}

export interface ExecutionResult {
  success: boolean;
  createdItems: CreatedItem[];
  errors: ExecutionError[];
  timing: {
    startTime: Date;
    endTime: Date;
    duration: number;
  };
}

export interface CreatedItem {
  type: string;
  key: string;
  summary: string;
  level: number;
}

export interface ExecutionError {
  type: string;
  item: string;
  error: string;
  level: number;
}

export class JiraConnector {
  private jiraWrapper: JiraConnectWrapper;
  private config: JiraConfig;

  constructor(config: JiraConfig) {
    this.config = config;
    this.jiraWrapper = new JiraConnectWrapper(config);
  }

  async connect(): Promise<void> {
    logger.info('Connecting to Jira');
    await this.jiraWrapper.initialize();
    logger.info('Jira connection established');
  }

  async generateModel(optimizedPlan: OptimizedPlan): Promise<JiraModel> {
    logger.info('Generating Jira model from optimized plan');

    const projectKey = this.extractProjectKey(optimizedPlan.project.name);
    const structure: JiraStructureItem[] = [];

    // Project level
    structure.push({
      type: 'project',
      summary: `PROJECT: ${optimizedPlan.project.name}`,
      description: this.formatProjectDescription(optimizedPlan),
      level: 0,
      dependencies: [],
      jiraData: {
        project: projectKey,
        issueType: 'Epic',
        labels: ['PROJECT', 'PARAFORGE'],
        priority: 'Highest'
      }
    });

    // Generate structure for each level
    optimizedPlan.parallelization.execution.forEach(level => {
      if (level.level > 0) {
        level.items.forEach(item => {
          structure.push(this.createJiraStructureItem(item, level.level, projectKey, optimizedPlan));
        });
      }
    });

    const model: JiraModel = {
      project: projectKey,
      structure,
      metadata: {
        totalItems: structure.length,
        estimatedDuration: optimizedPlan.timeline.totalDuration,
        parallelizationLevels: optimizedPlan.parallelization.execution.length
      }
    };

    logger.info('Jira model generated', { 
      totalItems: model.metadata.totalItems,
      levels: model.metadata.parallelizationLevels
    });

    return model;
  }

  private createJiraStructureItem(
    item: any, 
    level: number, 
    projectKey: string, 
    plan: OptimizedPlan
  ): JiraStructureItem {
    const baseData = {
      project: projectKey,
      labels: this.getLabelsForType(item.type),
      priority: this.getPriorityForLevel(level)
    };

    switch (item.type) {
      case 'initiative':
        return {
          type: 'initiative',
          summary: `INITIATIVE: ${item.name}`,
          description: this.formatInitiativeDescription(item, plan),
          level,
          dependencies: item.dependencies,
          jiraData: {
            ...baseData,
            issueType: 'Epic',
            labels: [...baseData.labels, 'INITIATIVE']
          }
        };

      case 'feature':
        return {
          type: 'feature',
          summary: `FEATURE: ${item.name}`,
          description: this.formatFeatureDescription(item, plan),
          level,
          dependencies: item.dependencies,
          jiraData: {
            ...baseData,
            issueType: 'Epic',
            labels: [...baseData.labels, 'FEATURE']
          }
        };

      case 'story':
        return {
          type: 'story',
          summary: item.name,
          description: this.formatStoryDescription(item, plan),
          level,
          dependencies: item.dependencies,
          jiraData: {
            ...baseData,
            issueType: 'Story',
            storyPoints: item.storyPoints
          }
        };

      case 'task':
        return {
          type: 'task',
          summary: item.name,
          description: this.formatTaskDescription(item, plan),
          level,
          dependencies: item.dependencies,
          jiraData: {
            ...baseData,
            issueType: 'Task',
            timeEstimate: item.estimate
          }
        };

      default:
        throw new Error(`Unknown item type: ${item.type}`);
    }
  }

  async execute(jiraModel: JiraModel): Promise<ExecutionResult> {
    logger.info('Executing Jira model', { totalItems: jiraModel.metadata.totalItems });
    
    const startTime = new Date();
    const createdItems: CreatedItem[] = [];
    const errors: ExecutionError[] = [];

    try {
      // Execute level by level to respect dependencies
      const levelGroups = this.groupByLevel(jiraModel.structure);
      
      for (const [level, items] of levelGroups) {
        logger.info(`Executing level ${level} with ${items.length} items`);
        
        if (level === 0) {
          // Sequential execution for project level
          await this.executeSequential(items, createdItems, errors);
        } else {
          // Parallel execution for other levels
          await this.executeParallel(items, createdItems, errors);
        }
      }

      const endTime = new Date();
      const result: ExecutionResult = {
        success: errors.length === 0,
        createdItems,
        errors,
        timing: {
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime()
        }
      };

      logger.info('Jira model execution completed', {
        success: result.success,
        created: createdItems.length,
        errors: errors.length,
        duration: `${result.timing.duration}ms`
      });

      return result;

    } catch (error) {
      logger.error('Jira execution failed', error);
      const endTime = new Date();
      
      return {
        success: false,
        createdItems,
        errors: [{
          type: 'execution',
          item: 'overall',
          error: error instanceof Error ? error.message : String(error),
          level: -1
        }],
        timing: {
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime()
        }
      };
    }
  }

  private groupByLevel(structure: JiraStructureItem[]): Map<number, JiraStructureItem[]> {
    const groups = new Map<number, JiraStructureItem[]>();
    
    structure.forEach(item => {
      if (!groups.has(item.level)) {
        groups.set(item.level, []);
      }
      groups.get(item.level)!.push(item);
    });

    return groups;
  }

  private async executeSequential(
    items: JiraStructureItem[], 
    createdItems: CreatedItem[], 
    errors: ExecutionError[]
  ): Promise<void> {
    for (const item of items) {
      try {
        const result = await this.createJiraItem(item);
        createdItems.push({
          type: item.type,
          key: result.key,
          summary: item.summary,
          level: item.level
        });
      } catch (error) {
        errors.push({
          type: item.type,
          item: item.summary,
          error: error instanceof Error ? error.message : String(error),
          level: item.level
        });
      }
    }
  }

  private async executeParallel(
    items: JiraStructureItem[], 
    createdItems: CreatedItem[], 
    errors: ExecutionError[]
  ): Promise<void> {
    const promises = items.map(async (item) => {
      try {
        const result = await this.createJiraItem(item);
        return {
          success: true,
          item: {
            type: item.type,
            key: result.key,
            summary: item.summary,
            level: item.level
          }
        };
      } catch (error) {
        return {
          success: false,
          error: {
            type: item.type,
            item: item.summary,
            error: error instanceof Error ? error.message : String(error),
            level: item.level
          }
        };
      }
    });

    const results = await Promise.all(promises);
    
    results.forEach(result => {
      if (result.success && 'item' in result) {
        createdItems.push(result.item);
      } else if (!result.success && 'error' in result) {
        errors.push(result.error);
      }
    });
  }

  private async createJiraItem(item: JiraStructureItem): Promise<any> {
    const { jiraData } = item;
    
    switch (item.type) {
      case 'project':
      case 'initiative':
      case 'feature':
        return await this.jiraWrapper.createIssue({
          ...jiraData,
          summary: item.summary,
          description: item.description
        });

      case 'story':
        return await this.jiraWrapper.createStory({
          project: jiraData.project,
          summary: item.summary,
          description: item.description,
          storyPoints: jiraData.storyPoints
        });

      case 'task':
        return await this.jiraWrapper.createTask({
          project: jiraData.project,
          summary: item.summary,
          description: item.description,
          estimate: jiraData.timeEstimate
        });

      default:
        throw new Error(`Unknown item type: ${item.type}`);
    }
  }

  private extractProjectKey(projectName: string): string {
    // Generate project key from name (simple approach)
    return projectName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, 10) || 'PROJ';
  }

  private formatProjectDescription(plan: OptimizedPlan): string {
    return `
# ${plan.project.name}

${plan.project.description}

## Architecture
- Approach: ${plan.architecture.approach}
- Technologies: ${plan.architecture.technologies.join(', ')}

## Timeline
- Duration: ${plan.timeline.totalDuration}
- Methodology: ${plan.team.methodology}

## Team
- Size: ${plan.team.size} members
- Roles: ${plan.team.roles.join(', ')}

## Parallelization Strategy
- Strategy: ${plan.parallelization.strategy}
- Batch Size: ${plan.parallelization.batchSize}
- Total Story Points: ${plan.structure.totalStoryPoints}

*Generated by ParaForge AI System*
`;
  }

  private formatInitiativeDescription(item: any, plan: OptimizedPlan): string {
    return `
# ${item.name}

Initiative for ${plan.project.name}

## Dependencies
${item.dependencies.map((dep: string) => `- ${dep}`).join('\n')}

## Parallel Execution
- Level: ${item.level || 'N/A'}
- Story Points: ${item.storyPoints || 'N/A'}

*Generated by ParaForge AI System*
`;
  }

  private formatFeatureDescription(item: any, plan: OptimizedPlan): string {
    return `
# ${item.name}

Feature within ${plan.project.name}

## Dependencies
${item.dependencies.map((dep: string) => `- ${dep}`).join('\n')}

## Details
- Story Points: ${item.storyPoints || 'N/A'}
- Execution Level: ${item.level || 'N/A'}

*Generated by ParaForge AI System*
`;
  }

  private formatStoryDescription(item: any, plan: OptimizedPlan): string {
    return `
# ${item.name}

User story for ${plan.project.name}

## Dependencies
${item.dependencies.map((dep: string) => `- ${dep}`).join('\n')}

## Story Points
${item.storyPoints || 'TBD'}

*Generated by ParaForge AI System*
`;
  }

  private formatTaskDescription(item: any, plan: OptimizedPlan): string {
    return `
# ${item.name}

Task for ${plan.project.name}

## Dependencies
${item.dependencies.map((dep: string) => `- ${dep}`).join('\n')}

## Estimate
${item.estimate || 'TBD'}

*Generated by ParaForge AI System*
`;
  }

  private getLabelsForType(type: string): string[] {
    const baseLabels = ['PARAFORGE', 'AI_GENERATED'];
    
    switch (type) {
      case 'project': return [...baseLabels, 'PROJECT'];
      case 'initiative': return [...baseLabels, 'INITIATIVE'];
      case 'feature': return [...baseLabels, 'FEATURE'];
      case 'story': return [...baseLabels, 'STORY'];
      case 'task': return [...baseLabels, 'TASK'];
      default: return baseLabels;
    }
  }

  private getPriorityForLevel(level: number): string {
    switch (level) {
      case 0: return 'Highest';
      case 1: return 'High';
      case 2: return 'Medium';
      case 3: return 'Low';
      default: return 'Lowest';
    }
  }
}