import { EventEmitter } from 'events';
import { Octokit } from '@octokit/rest';
import natural from 'natural';
import nlp from 'compromise';

export interface TaskHierarchy {
  epic: Epic;
  stories: Story[];
  tasks: Task[];
  subtasks: SubTask[];
}

export interface Epic {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  labels: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedStories: number;
  businessValue: number;
}

export interface Story {
  epicId?: string;
  title: string;
  userStory: string;
  acceptanceCriteria: string[];
  labels: string[];
  priority: 'high' | 'medium' | 'low';
  estimatedTasks: number;
  storyPoints: number;
  dependencies: string[];
}

export interface Task {
  storyId?: string;
  title: string;
  description: string;
  technicalDetails: string[];
  estimatedHours: number;
  complexity: 'simple' | 'medium' | 'complex';
  assignee?: string;
  labels: string[];
  dependencies: string[];
}

export interface SubTask {
  taskId?: string;
  title: string;
  description: string;
  checklistItems: string[];
  estimatedMinutes: number;
  isBlocking: boolean;
}

export interface DecompositionOptions {
  maxDepth?: number;
  autoEstimate?: boolean;
  includeTechnicalDetails?: boolean;
  generateAcceptanceCriteria?: boolean;
  analyzeComplexity?: boolean;
  identifyDependencies?: boolean;
  suggestLabels?: boolean;
}

export class TaskDecomposer extends EventEmitter {
  private octokit?: Octokit;
  private tokenizer: any;
  private tfidf: any;
  private sentimentAnalyzer: any;

  constructor(githubToken?: string) {
    super();
    if (githubToken) {
      this.octokit = new Octokit({ auth: githubToken });
    }
    this.initializeNLP();
  }

  private initializeNLP(): void {
    this.tokenizer = new natural.WordTokenizer();
    this.tfidf = new natural.TfIdf();
    this.sentimentAnalyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
  }

  async decompose(
    idea: string,
    context?: string,
    options: DecompositionOptions = {}
  ): Promise<TaskHierarchy> {
    this.emit('decomposition:start', { idea, context, options });

    const epic = await this.createEpic(idea, context, options);
    const stories = await this.createStories(epic, context, options);
    const tasks = await this.createTasks(stories, context, options);
    const subtasks = await this.createSubTasks(tasks, options);

    const hierarchy: TaskHierarchy = {
      epic,
      stories,
      tasks,
      subtasks
    };

    this.emit('decomposition:complete', hierarchy);
    return hierarchy;
  }

  private async createEpic(
    idea: string,
    context?: string,
    options: DecompositionOptions = {}
  ): Promise<Epic> {
    const doc = nlp(idea);
    const nouns = doc.nouns().out('array');
    const verbs = doc.verbs().out('array');
    
    const title = this.generateEpicTitle(idea, nouns, verbs);
    const description = this.generateEpicDescription(idea, context);
    const acceptanceCriteria = options.generateAcceptanceCriteria 
      ? this.generateAcceptanceCriteria(idea, 'epic')
      : [];
    const labels = options.suggestLabels
      ? this.suggestLabels(idea, 'epic')
      : [];
    const priority = this.analyzePriority(idea);
    const businessValue = this.calculateBusinessValue(idea, context);

    return {
      title,
      description,
      acceptanceCriteria,
      labels,
      priority,
      estimatedStories: this.estimateStoryCount(idea),
      businessValue
    };
  }

  private async createStories(
    epic: Epic,
    context?: string,
    options: DecompositionOptions = {}
  ): Promise<Story[]> {
    const storyCount = epic.estimatedStories || 3;
    const stories: Story[] = [];
    
    const aspects = this.identifyAspects(epic.description);
    
    for (let i = 0; i < Math.min(storyCount, aspects.length); i++) {
      const aspect = aspects[i];
      const story: Story = {
        title: `User ${aspect.action} for ${aspect.feature}`,
        userStory: this.generateUserStory(aspect, epic),
        acceptanceCriteria: options.generateAcceptanceCriteria
          ? this.generateAcceptanceCriteria(aspect.description, 'story')
          : [],
        labels: options.suggestLabels
          ? this.suggestLabels(aspect.description, 'story')
          : [],
        priority: this.analyzePriority(aspect.description),
        estimatedTasks: this.estimateTaskCount(aspect.description),
        storyPoints: this.estimateStoryPoints(aspect.description),
        dependencies: options.identifyDependencies
          ? this.identifyDependencies(aspect.description, aspects, i)
          : []
      };
      stories.push(story);
    }

    return stories;
  }

  private async createTasks(
    stories: Story[],
    context?: string,
    options: DecompositionOptions = {}
  ): Promise<Task[]> {
    const tasks: Task[] = [];
    
    for (const story of stories) {
      const taskCount = story.estimatedTasks || 2;
      const storyTasks = this.decomposeStoryIntoTasks(story, taskCount, options);
      tasks.push(...storyTasks);
    }

    return tasks;
  }

  private async createSubTasks(
    tasks: Task[],
    options: DecompositionOptions = {}
  ): Promise<SubTask[]> {
    const subtasks: SubTask[] = [];
    
    for (const task of tasks) {
      if (task.complexity === 'complex' || task.estimatedHours > 4) {
        const taskSubtasks = this.decomposeTaskIntoSubtasks(task);
        subtasks.push(...taskSubtasks);
      }
    }

    return subtasks;
  }

  private generateEpicTitle(idea: string, nouns: string[], verbs: string[]): string {
    const mainVerb = verbs[0] || 'Implement';
    const mainNoun = nouns[0] || 'Feature';
    return `${mainVerb} ${mainNoun} System`;
  }

  private generateEpicDescription(idea: string, context?: string): string {
    let description = `This epic encompasses the implementation of: ${idea}.`;
    if (context) {
      description += ` Context: ${context}`;
    }
    return description;
  }

  private generateAcceptanceCriteria(text: string, level: string): string[] {
    const criteria: string[] = [];
    const doc = nlp(text);
    
    const actions = doc.verbs().out('array');
    const objects = doc.nouns().out('array');
    
    if (level === 'epic') {
      criteria.push(`System successfully implements ${objects[0] || 'feature'}`);
      criteria.push('All integration tests pass');
      criteria.push('Documentation is complete');
      criteria.push('Performance metrics meet requirements');
    } else if (level === 'story') {
      criteria.push(`User can ${actions[0] || 'interact with'} ${objects[0] || 'feature'}`);
      criteria.push('Feature works across all supported browsers');
      criteria.push('Error handling is implemented');
      criteria.push('Unit tests achieve 95% coverage');
    }
    
    return criteria;
  }

  private suggestLabels(text: string, level: string): string[] {
    const labels: string[] = [];
    const doc = nlp(text);
    
    if (doc.has('api')) labels.push('api');
    if (doc.has('ui') || doc.has('interface')) labels.push('frontend');
    if (doc.has('database') || doc.has('data')) labels.push('backend');
    if (doc.has('test')) labels.push('testing');
    if (doc.has('performance')) labels.push('performance');
    if (doc.has('security')) labels.push('security');
    
    if (level === 'epic') labels.push('epic');
    if (level === 'story') labels.push('story');
    
    return labels;
  }

  private analyzePriority(text: string): any {
    const urgentKeywords = ['urgent', 'critical', 'immediately', 'asap', 'blocker'];
    const highKeywords = ['important', 'needed', 'required', 'must'];
    const lowKeywords = ['nice to have', 'optional', 'future', 'eventually'];
    
    const lowerText = text.toLowerCase();
    
    if (urgentKeywords.some(k => lowerText.includes(k))) return 'critical';
    if (highKeywords.some(k => lowerText.includes(k))) return 'high';
    if (lowKeywords.some(k => lowerText.includes(k))) return 'low';
    
    return 'medium';
  }

  private calculateBusinessValue(idea: string, context?: string): number {
    let value = 50;
    
    const impactKeywords = ['revenue', 'customer', 'user experience', 'efficiency', 'cost'];
    const fullText = `${idea} ${context || ''}`.toLowerCase();
    
    for (const keyword of impactKeywords) {
      if (fullText.includes(keyword)) value += 10;
    }
    
    const sentiment = this.sentimentAnalyzer.getSentiment(this.tokenizer.tokenize(idea));
    value += Math.round(sentiment * 10);
    
    return Math.max(0, Math.min(100, value));
  }

  private estimateStoryCount(text: string): number {
    const words = text.split(' ').length;
    if (words < 20) return 2;
    if (words < 50) return 3;
    if (words < 100) return 5;
    return 8;
  }

  private estimateTaskCount(text: string): number {
    const words = text.split(' ').length;
    if (words < 10) return 2;
    if (words < 30) return 3;
    return 5;
  }

  private estimateStoryPoints(text: string): number {
    const complexity = this.analyzeComplexity(text);
    if (complexity === 'simple') return 1;
    if (complexity === 'medium') return 3;
    return 8;
  }

  private analyzeComplexity(text: string): 'simple' | 'medium' | 'complex' {
    const complexKeywords = ['integrate', 'migrate', 'refactor', 'optimize', 'architect'];
    const simpleKeywords = ['add', 'update', 'fix', 'change', 'modify'];
    
    const lowerText = text.toLowerCase();
    
    if (complexKeywords.some(k => lowerText.includes(k))) return 'complex';
    if (simpleKeywords.some(k => lowerText.includes(k))) return 'simple';
    
    return 'medium';
  }

  private identifyAspects(description: string): any[] {
    const doc = nlp(description);
    const sentences = doc.sentences().out('array');
    
    return sentences.slice(0, 5).map(sentence => {
      const sentDoc = nlp(sentence);
      const verbs = sentDoc.verbs().out('array');
      const nouns = sentDoc.nouns().out('array');
      
      return {
        description: sentence,
        action: verbs[0] || 'implement',
        feature: nouns[0] || 'component',
        complexity: this.analyzeComplexity(sentence)
      };
    });
  }

  private generateUserStory(aspect: any, epic: Epic): string {
    return `As a user, I want to ${aspect.action} ${aspect.feature} so that I can achieve the goals outlined in ${epic.title}`;
  }

  private identifyDependencies(text: string, allAspects: any[], currentIndex: number): string[] {
    const dependencies: string[] = [];
    const doc = nlp(text);
    
    for (let i = 0; i < currentIndex; i++) {
      const prevAspect = allAspects[i];
      if (doc.has(prevAspect.feature)) {
        dependencies.push(`Story ${i + 1}: ${prevAspect.feature}`);
      }
    }
    
    return dependencies;
  }

  private decomposeStoryIntoTasks(story: Story, taskCount: number, options: DecompositionOptions): Task[] {
    const tasks: Task[] = [];
    const taskTypes = ['Implementation', 'Testing', 'Documentation', 'Integration', 'Validation'];
    
    for (let i = 0; i < Math.min(taskCount, taskTypes.length); i++) {
      const taskType = taskTypes[i];
      const task: Task = {
        title: `${taskType} for ${story.title}`,
        description: `${taskType} tasks required for: ${story.userStory}`,
        technicalDetails: options.includeTechnicalDetails
          ? this.generateTechnicalDetails(taskType, story)
          : [],
        estimatedHours: this.estimateTaskHours(taskType, story.storyPoints),
        complexity: this.analyzeTaskComplexity(taskType, story),
        labels: [...story.labels, taskType.toLowerCase()],
        dependencies: i > 0 ? [`${taskTypes[0]} for ${story.title}`] : []
      };
      tasks.push(task);
    }
    
    return tasks;
  }

  private decomposeTaskIntoSubtasks(task: Task): SubTask[] {
    const subtasks: SubTask[] = [];
    const subtaskTypes = ['Setup', 'Core Implementation', 'Edge Cases', 'Cleanup'];
    
    for (const type of subtaskTypes) {
      const subtask: SubTask = {
        title: `${type} - ${task.title}`,
        description: `${type} activities for ${task.title}`,
        checklistItems: this.generateChecklistItems(type, task),
        estimatedMinutes: Math.round((task.estimatedHours * 60) / subtaskTypes.length),
        isBlocking: type === 'Setup' || type === 'Core Implementation'
      };
      subtasks.push(subtask);
    }
    
    return subtasks;
  }

  private generateTechnicalDetails(taskType: string, story: Story): string[] {
    const details: string[] = [];
    
    switch (taskType) {
      case 'Implementation':
        details.push('Create necessary interfaces and types');
        details.push('Implement core business logic');
        details.push('Add error handling');
        break;
      case 'Testing':
        details.push('Write unit tests with 95% coverage');
        details.push('Create integration tests');
        details.push('Add edge case tests');
        break;
      case 'Documentation':
        details.push('Write inline code documentation');
        details.push('Update API documentation');
        details.push('Create usage examples');
        break;
      case 'Integration':
        details.push('Integrate with existing systems');
        details.push('Configure CI/CD pipelines');
        details.push('Set up monitoring');
        break;
      case 'Validation':
        details.push('Perform code review');
        details.push('Validate against acceptance criteria');
        details.push('Performance testing');
        break;
    }
    
    return details;
  }

  private estimateTaskHours(taskType: string, storyPoints: number): number {
    const baseHours: Record<string, number> = {
      'Implementation': 4,
      'Testing': 2,
      'Documentation': 1,
      'Integration': 3,
      'Validation': 1
    };
    
    return (baseHours[taskType] || 2) * (storyPoints / 3);
  }

  private analyzeTaskComplexity(taskType: string, story: Story): 'simple' | 'medium' | 'complex' {
    if (story.storyPoints >= 8) return 'complex';
    if (story.storyPoints >= 3) return 'medium';
    return 'simple';
  }

  private generateChecklistItems(type: string, task: Task): string[] {
    const items: string[] = [];
    
    switch (type) {
      case 'Setup':
        items.push('Set up development environment');
        items.push('Review requirements');
        items.push('Create branch');
        break;
      case 'Core Implementation':
        items.push('Implement main functionality');
        items.push('Add error handling');
        items.push('Write initial tests');
        break;
      case 'Edge Cases':
        items.push('Handle edge cases');
        items.push('Add validation');
        items.push('Test error scenarios');
        break;
      case 'Cleanup':
        items.push('Refactor code');
        items.push('Update documentation');
        items.push('Run linter');
        break;
    }
    
    return items;
  }

  async createGitHubIssues(hierarchy: TaskHierarchy, owner: string, repo: string): Promise<void> {
    if (!this.octokit) {
      throw new Error('GitHub token not provided');
    }

    this.emit('github:create:start', { owner, repo });

    const epicIssue = await this.octokit.issues.create({
      owner,
      repo,
      title: `[EPIC] ${hierarchy.epic.title}`,
      body: this.formatEpicBody(hierarchy.epic),
      labels: hierarchy.epic.labels
    });

    for (const story of hierarchy.stories) {
      const storyIssue = await this.octokit.issues.create({
        owner,
        repo,
        title: `[STORY] ${story.title}`,
        body: this.formatStoryBody(story, epicIssue.data.number),
        labels: story.labels
      });

      const storyTasks = hierarchy.tasks.filter(t => t.storyId === story.title);
      for (const task of storyTasks) {
        await this.octokit.issues.create({
          owner,
          repo,
          title: `[TASK] ${task.title}`,
          body: this.formatTaskBody(task, storyIssue.data.number),
          labels: task.labels
        });
      }
    }

    this.emit('github:create:complete', { owner, repo });
  }

  private formatEpicBody(epic: Epic): string {
    return `## Description
${epic.description}

## Acceptance Criteria
${epic.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n')}

## Priority
${epic.priority}

## Business Value
${epic.businessValue}/100

## Estimated Stories
${epic.estimatedStories}`;
  }

  private formatStoryBody(story: Story, epicNumber: number): string {
    return `## User Story
${story.userStory}

## Acceptance Criteria
${story.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n')}

## Story Points
${story.storyPoints}

## Dependencies
${story.dependencies.map(d => `- ${d}`).join('\n') || 'None'}

## Parent Epic
#${epicNumber}`;
  }

  private formatTaskBody(task: Task, storyNumber: number): string {
    return `## Description
${task.description}

## Technical Details
${task.technicalDetails.map(d => `- ${d}`).join('\n')}

## Estimated Hours
${task.estimatedHours}

## Complexity
${task.complexity}

## Dependencies
${task.dependencies.map(d => `- ${d}`).join('\n') || 'None'}

## Parent Story
#${storyNumber}`;
  }
}