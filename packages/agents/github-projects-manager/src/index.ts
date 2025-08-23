import { EventEmitter } from 'events';
import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import PQueue from 'p-queue';

export interface GitHubProject {
  id: string;
  number: number;
  title: string;
  description?: string;
  state: 'OPEN' | 'CLOSED';
  url: string;
}

export interface ProjectColumn {
  id: string;
  name: string;
  purpose?: string;
  cards: ProjectCard[];
}

export interface ProjectCard {
  id: string;
  note?: string;
  contentUrl?: string;
  state: 'CONTENT_ONLY' | 'NOTE_ONLY' | 'REDACTED';
  column: string;
}

export interface Issue {
  id: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  milestone?: string;
  project?: string;
  complexity?: number;
  estimatedHours?: number;
}

export interface TaskAllocation {
  issueId: number;
  assignee: string;
  instanceId: string;
  priority: number;
  dependencies: number[];
  estimatedTime: number;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed';
}

export interface CCInstance {
  id: string;
  capacity: number;
  currentLoad: number;
  assignedTasks: number[];
  performance: number;
  specialization?: string[];
}

export class GitHubProjectsManager extends EventEmitter {
  private octokit: Octokit;
  private graphqlClient: typeof graphql;
  private queue: PQueue;
  private ccInstances: Map<string, CCInstance>;
  private taskAllocations: Map<number, TaskAllocation>;

  constructor(githubToken: string, options: { concurrency?: number } = {}) {
    super();
    this.octokit = new Octokit({ auth: githubToken });
    this.graphqlClient = graphql.defaults({
      headers: {
        authorization: `token ${githubToken}`,
      },
    });
    this.queue = new PQueue({ concurrency: options.concurrency || 5 });
    this.ccInstances = new Map();
    this.taskAllocations = new Map();
  }

  async createProject(
    owner: string,
    repo: string,
    name: string,
    description?: string
  ): Promise<GitHubProject> {
    this.emit('project:create:start', { owner, repo, name });

    const { repository } = await this.graphqlClient(`
      mutation($owner: String!, $repo: String!, $name: String!, $description: String) {
        createProjectV2(input: {
          ownerId: $ownerId,
          title: $name,
          repositoryId: $repositoryId
        }) {
          projectV2 {
            id
            number
            title
            url
          }
        }
      }
    `, {
      owner,
      repo,
      name,
      description
    });

    const project: GitHubProject = {
      id: repository.project.id,
      number: repository.project.number,
      title: repository.project.title,
      description,
      state: 'OPEN',
      url: repository.project.url
    };

    this.emit('project:create:complete', project);
    return project;
  }

  async setupProjectColumns(
    projectId: string,
    columns: string[] = ['Backlog', 'Ready', 'In Progress', 'Review', 'Done']
  ): Promise<ProjectColumn[]> {
    this.emit('columns:setup:start', { projectId, columns });

    const createdColumns: ProjectColumn[] = [];

    for (const columnName of columns) {
      const { addProjectV2ItemField } = await this.graphqlClient(`
        mutation($projectId: ID!, $name: String!) {
          addProjectV2ItemField(input: {
            projectId: $projectId,
            name: $name,
            dataType: SINGLE_SELECT
          }) {
            field {
              id
              name
            }
          }
        }
      `, {
        projectId,
        name: columnName
      });

      createdColumns.push({
        id: addProjectV2ItemField.field.id,
        name: columnName,
        purpose: this.getColumnPurpose(columnName),
        cards: []
      });
    }

    this.emit('columns:setup:complete', createdColumns);
    return createdColumns;
  }

  private getColumnPurpose(columnName: string): string {
    const purposes: Record<string, string> = {
      'Backlog': 'Unscheduled tasks waiting to be prioritized',
      'Ready': 'Tasks ready for development with all dependencies met',
      'In Progress': 'Tasks currently being worked on',
      'Review': 'Tasks in code review or testing',
      'Done': 'Completed tasks'
    };
    return purposes[columnName] || 'General purpose column';
  }

  async createIssueFromTask(
    owner: string,
    repo: string,
    task: any,
    projectId?: string
  ): Promise<Issue> {
    this.emit('issue:create:start', { owner, repo, task });

    const issueData = await this.octokit.issues.create({
      owner,
      repo,
      title: task.title,
      body: this.formatIssueBody(task),
      labels: task.labels || [],
      assignees: task.assignee ? [task.assignee] : []
    });

    const issue: Issue = {
      id: issueData.data.number,
      title: issueData.data.title,
      body: issueData.data.body || undefined,
      state: issueData.data.state as 'open' | 'closed',
      labels: issueData.data.labels.map((l: any) => typeof l === 'string' ? l : l.name),
      assignees: issueData.data.assignees?.map((a: any) => a.login) || [],
      complexity: task.complexity || this.estimateComplexity(task),
      estimatedHours: task.estimatedHours || this.estimateHours(task)
    };

    if (projectId) {
      await this.addIssueToProject(owner, repo, issue.id, projectId);
    }

    this.emit('issue:create:complete', issue);
    return issue;
  }

  private formatIssueBody(task: any): string {
    return `## Description
${task.description || 'No description provided'}

## Technical Details
${task.technicalDetails?.map((d: string) => `- ${d}`).join('\n') || 'No technical details'}

## Acceptance Criteria
${task.acceptanceCriteria?.map((c: string) => `- [ ] ${c}`).join('\n') || 'No acceptance criteria'}

## Estimated Hours
${task.estimatedHours || 'Not estimated'}

## Complexity
${task.complexity || 'Not assessed'}

## Dependencies
${task.dependencies?.map((d: string) => `- ${d}`).join('\n') || 'None'}

---
*Created by CAIA Autonomous Pipeline*`;
  }

  private estimateComplexity(task: any): number {
    if (task.complexity === 'simple') return 1;
    if (task.complexity === 'medium') return 3;
    if (task.complexity === 'complex') return 8;
    
    const factors = [
      task.dependencies?.length || 0,
      task.technicalDetails?.length || 0,
      task.acceptanceCriteria?.length || 0
    ];
    
    const totalFactors = factors.reduce((a, b) => a + b, 0);
    if (totalFactors < 5) return 1;
    if (totalFactors < 10) return 3;
    return 8;
  }

  private estimateHours(task: any): number {
    const complexity = this.estimateComplexity(task);
    const baseHours = complexity * 2;
    const dependencyHours = (task.dependencies?.length || 0) * 0.5;
    return baseHours + dependencyHours;
  }

  async addIssueToProject(
    owner: string,
    repo: string,
    issueNumber: number,
    projectId: string
  ): Promise<void> {
    const issue = await this.octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber
    });

    await this.graphqlClient(`
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2Item(input: {
          projectId: $projectId,
          contentId: $contentId
        }) {
          item {
            id
          }
        }
      }
    `, {
      projectId,
      contentId: issue.data.node_id
    });
  }

  async moveCardToColumn(
    projectId: string,
    cardId: string,
    columnId: string
  ): Promise<void> {
    await this.graphqlClient(`
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $value }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `, {
      projectId,
      itemId: cardId,
      fieldId: columnId,
      value: columnId
    });
  }

  registerCCInstance(instance: CCInstance): void {
    this.ccInstances.set(instance.id, instance);
    this.emit('instance:registered', instance);
  }

  unregisterCCInstance(instanceId: string): void {
    const instance = this.ccInstances.get(instanceId);
    if (instance) {
      instance.assignedTasks.forEach(taskId => {
        const allocation = this.taskAllocations.get(taskId);
        if (allocation) {
          allocation.status = 'pending';
          allocation.instanceId = '';
        }
      });
      this.ccInstances.delete(instanceId);
      this.emit('instance:unregistered', instanceId);
    }
  }

  async allocateTasks(issues: Issue[]): Promise<TaskAllocation[]> {
    this.emit('allocation:start', { issueCount: issues.length });

    const allocations: TaskAllocation[] = [];
    const sortedIssues = this.sortIssuesByPriority(issues);

    for (const issue of sortedIssues) {
      const bestInstance = this.findBestInstance(issue);
      
      if (bestInstance) {
        const allocation: TaskAllocation = {
          issueId: issue.id,
          assignee: `cc-${bestInstance.id}`,
          instanceId: bestInstance.id,
          priority: this.calculatePriority(issue),
          dependencies: this.extractDependencies(issue),
          estimatedTime: issue.estimatedHours || 1,
          status: 'assigned'
        };

        bestInstance.currentLoad += allocation.estimatedTime;
        bestInstance.assignedTasks.push(issue.id);
        
        this.taskAllocations.set(issue.id, allocation);
        allocations.push(allocation);
        
        this.emit('task:allocated', allocation);
      } else {
        const pendingAllocation: TaskAllocation = {
          issueId: issue.id,
          assignee: '',
          instanceId: '',
          priority: this.calculatePriority(issue),
          dependencies: this.extractDependencies(issue),
          estimatedTime: issue.estimatedHours || 1,
          status: 'pending'
        };
        
        this.taskAllocations.set(issue.id, pendingAllocation);
        allocations.push(pendingAllocation);
        
        this.emit('task:pending', pendingAllocation);
      }
    }

    this.emit('allocation:complete', allocations);
    return allocations;
  }

  private sortIssuesByPriority(issues: Issue[]): Issue[] {
    return [...issues].sort((a, b) => {
      const priorityA = this.calculatePriority(a);
      const priorityB = this.calculatePriority(b);
      return priorityB - priorityA;
    });
  }

  private calculatePriority(issue: Issue): number {
    let priority = 50;
    
    if (issue.labels.includes('critical')) priority += 40;
    else if (issue.labels.includes('high')) priority += 20;
    else if (issue.labels.includes('low')) priority -= 20;
    
    if (issue.labels.includes('blocker')) priority += 30;
    if (issue.milestone) priority += 10;
    
    priority -= (issue.complexity || 1) * 2;
    
    return Math.max(0, Math.min(100, priority));
  }

  private extractDependencies(issue: Issue): number[] {
    const dependencies: number[] = [];
    const bodyText = issue.body || '';
    
    const depMatches = bodyText.match(/#(\d+)/g);
    if (depMatches) {
      depMatches.forEach(match => {
        const id = parseInt(match.substring(1));
        if (id !== issue.id) {
          dependencies.push(id);
        }
      });
    }
    
    return dependencies;
  }

  private findBestInstance(issue: Issue): CCInstance | null {
    let bestInstance: CCInstance | null = null;
    let bestScore = -1;

    for (const instance of this.ccInstances.values()) {
      if (instance.currentLoad >= instance.capacity) continue;
      
      const availableCapacity = instance.capacity - instance.currentLoad;
      if (availableCapacity < (issue.estimatedHours || 1)) continue;
      
      let score = availableCapacity * 10;
      score += instance.performance * 5;
      
      if (instance.specialization) {
        const matchingSpecs = instance.specialization.filter(spec =>
          issue.labels.includes(spec)
        );
        score += matchingSpecs.length * 20;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestInstance = instance;
      }
    }

    return bestInstance;
  }

  async updateTaskStatus(
    issueId: number,
    status: 'pending' | 'assigned' | 'in_progress' | 'completed'
  ): Promise<void> {
    const allocation = this.taskAllocations.get(issueId);
    if (allocation) {
      allocation.status = status;
      this.emit('task:status:updated', { issueId, status });
      
      if (status === 'completed') {
        const instance = this.ccInstances.get(allocation.instanceId);
        if (instance) {
          instance.currentLoad -= allocation.estimatedTime;
          instance.assignedTasks = instance.assignedTasks.filter(id => id !== issueId);
        }
      }
    }
  }

  async getProjectMetrics(projectId: string): Promise<any> {
    const { projectV2 } = await this.graphqlClient(`
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              totalCount
              nodes {
                id
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                    }
                  }
                }
                content {
                  ... on Issue {
                    state
                    createdAt
                    closedAt
                  }
                }
              }
            }
          }
        }
      }
    `, { projectId });

    const metrics = {
      totalItems: projectV2.items.totalCount,
      byColumn: {} as Record<string, number>,
      completionRate: 0,
      averageTimeToComplete: 0,
      activeItems: 0
    };

    let completedCount = 0;
    let totalTime = 0;

    projectV2.items.nodes.forEach((item: any) => {
      const columnName = item.fieldValues.nodes[0]?.name || 'No Column';
      metrics.byColumn[columnName] = (metrics.byColumn[columnName] || 0) + 1;
      
      if (item.content?.state === 'closed') {
        completedCount++;
        if (item.content.createdAt && item.content.closedAt) {
          const created = new Date(item.content.createdAt).getTime();
          const closed = new Date(item.content.closedAt).getTime();
          totalTime += closed - created;
        }
      } else if (item.content?.state === 'open') {
        metrics.activeItems++;
      }
    });

    metrics.completionRate = metrics.totalItems > 0 
      ? (completedCount / metrics.totalItems) * 100 
      : 0;
    
    metrics.averageTimeToComplete = completedCount > 0 
      ? totalTime / completedCount / (1000 * 60 * 60 * 24)
      : 0;

    return metrics;
  }

  async syncWithGitHub(owner: string, repo: string): Promise<void> {
    this.emit('sync:start', { owner, repo });

    const issues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
      owner,
      repo,
      state: 'open',
      per_page: 100
    });

    const mappedIssues: Issue[] = issues.map(issue => ({
      id: issue.number,
      title: issue.title,
      body: issue.body || undefined,
      state: issue.state as 'open' | 'closed',
      labels: issue.labels.map((l: any) => typeof l === 'string' ? l : l.name),
      assignees: issue.assignees?.map((a: any) => a.login) || [],
      milestone: issue.milestone?.title,
      complexity: this.estimateComplexity({ body: issue.body }),
      estimatedHours: this.estimateHours({ body: issue.body })
    }));

    await this.allocateTasks(mappedIssues);
    
    this.emit('sync:complete', { issueCount: mappedIssues.length });
  }

  getInstanceStatus(): any {
    const status = {
      totalInstances: this.ccInstances.size,
      instances: [] as any[],
      totalCapacity: 0,
      totalLoad: 0,
      utilizationRate: 0
    };

    for (const instance of this.ccInstances.values()) {
      status.instances.push({
        id: instance.id,
        capacity: instance.capacity,
        currentLoad: instance.currentLoad,
        assignedTasks: instance.assignedTasks.length,
        utilization: (instance.currentLoad / instance.capacity) * 100,
        performance: instance.performance
      });
      status.totalCapacity += instance.capacity;
      status.totalLoad += instance.currentLoad;
    }

    status.utilizationRate = status.totalCapacity > 0 
      ? (status.totalLoad / status.totalCapacity) * 100 
      : 0;

    return status;
  }

  getAllocationStatus(): any {
    const status = {
      totalTasks: this.taskAllocations.size,
      pending: 0,
      assigned: 0,
      inProgress: 0,
      completed: 0,
      allocations: [] as any[]
    };

    for (const allocation of this.taskAllocations.values()) {
      status[allocation.status]++;
      status.allocations.push(allocation);
    }

    return status;
  }
}