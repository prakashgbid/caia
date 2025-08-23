import { TaskDecomposer, TaskHierarchy } from '../src';

describe('TaskDecomposer', () => {
  let decomposer: TaskDecomposer;

  beforeEach(() => {
    decomposer = new TaskDecomposer();
  });

  describe('decompose', () => {
    it('should decompose a simple idea into task hierarchy', async () => {
      const idea = 'Create a user authentication system with email verification';
      const hierarchy = await decomposer.decompose(idea);

      expect(hierarchy.epic).toBeDefined();
      expect(hierarchy.epic.title).toContain('Create');
      expect(hierarchy.stories.length).toBeGreaterThan(0);
      expect(hierarchy.tasks.length).toBeGreaterThan(0);
    });

    it('should generate acceptance criteria when option is enabled', async () => {
      const idea = 'Build a dashboard for analytics';
      const hierarchy = await decomposer.decompose(idea, undefined, {
        generateAcceptanceCriteria: true
      });

      expect(hierarchy.epic.acceptanceCriteria.length).toBeGreaterThan(0);
      hierarchy.stories.forEach(story => {
        expect(story.acceptanceCriteria.length).toBeGreaterThan(0);
      });
    });

    it('should analyze complexity correctly', async () => {
      const complexIdea = 'Migrate the entire monolithic architecture to microservices with zero downtime';
      const hierarchy = await decomposer.decompose(complexIdea, undefined, {
        analyzeComplexity: true
      });

      expect(hierarchy.epic.priority).toBe('high');
      expect(hierarchy.tasks.some(t => t.complexity === 'complex')).toBe(true);
    });

    it('should identify dependencies when option is enabled', async () => {
      const idea = 'First setup database, then create API, finally build UI';
      const hierarchy = await decomposer.decompose(idea, undefined, {
        identifyDependencies: true
      });

      const hasDependencies = hierarchy.stories.some(s => s.dependencies.length > 0) ||
                              hierarchy.tasks.some(t => t.dependencies.length > 0);
      expect(hasDependencies).toBe(true);
    });

    it('should suggest appropriate labels', async () => {
      const idea = 'Create API endpoints for user management with security';
      const hierarchy = await decomposer.decompose(idea, undefined, {
        suggestLabels: true
      });

      expect(hierarchy.epic.labels).toContain('api');
      expect(hierarchy.epic.labels).toContain('security');
    });

    it('should handle context information', async () => {
      const idea = 'Improve performance';
      const context = 'Current response time is 5s, target is under 1s';
      const hierarchy = await decomposer.decompose(idea, context);

      expect(hierarchy.epic.description).toContain(context);
    });

    it('should estimate story points and hours', async () => {
      const idea = 'Implement complex payment processing system';
      const hierarchy = await decomposer.decompose(idea, undefined, {
        autoEstimate: true
      });

      hierarchy.stories.forEach(story => {
        expect(story.storyPoints).toBeGreaterThan(0);
        expect(story.estimatedTasks).toBeGreaterThan(0);
      });

      hierarchy.tasks.forEach(task => {
        expect(task.estimatedHours).toBeGreaterThan(0);
      });
    });

    it('should create subtasks for complex tasks', async () => {
      const idea = 'Build a complex real-time data processing pipeline';
      const hierarchy = await decomposer.decompose(idea);

      expect(hierarchy.subtasks.length).toBeGreaterThan(0);
      hierarchy.subtasks.forEach(subtask => {
        expect(subtask.checklistItems.length).toBeGreaterThan(0);
        expect(subtask.estimatedMinutes).toBeGreaterThan(0);
      });
    });

    it('should emit events during decomposition', async () => {
      const startSpy = jest.fn();
      const completeSpy = jest.fn();

      decomposer.on('decomposition:start', startSpy);
      decomposer.on('decomposition:complete', completeSpy);

      const idea = 'Create a feature';
      await decomposer.decompose(idea);

      expect(startSpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });

    it('should handle different priority levels', async () => {
      const urgentIdea = 'URGENT: Fix critical security vulnerability';
      const urgentHierarchy = await decomposer.decompose(urgentIdea);
      expect(urgentHierarchy.epic.priority).toBe('critical');

      const lowPriorityIdea = 'Nice to have: Add dark mode theme';
      const lowHierarchy = await decomposer.decompose(lowPriorityIdea);
      expect(lowHierarchy.epic.priority).toBe('low');
    });

    it('should calculate business value', async () => {
      const highValueIdea = 'Increase revenue by improving customer experience';
      const hierarchy = await decomposer.decompose(highValueIdea);

      expect(hierarchy.epic.businessValue).toBeGreaterThan(50);
    });

    it('should respect maxDepth option', async () => {
      const idea = 'Simple task';
      const hierarchy = await decomposer.decompose(idea, undefined, {
        maxDepth: 2
      });

      expect(hierarchy.epic).toBeDefined();
      expect(hierarchy.stories.length).toBeGreaterThan(0);
      expect(hierarchy.tasks.length).toBe(0);
      expect(hierarchy.subtasks.length).toBe(0);
    });

    it('should generate technical details when requested', async () => {
      const idea = 'Implement user authentication';
      const hierarchy = await decomposer.decompose(idea, undefined, {
        includeTechnicalDetails: true
      });

      hierarchy.tasks.forEach(task => {
        expect(task.technicalDetails.length).toBeGreaterThan(0);
      });
    });

    it('should handle empty idea gracefully', async () => {
      const idea = '';
      const hierarchy = await decomposer.decompose(idea);

      expect(hierarchy.epic).toBeDefined();
      expect(hierarchy.epic.title).toBeDefined();
    });
  });

  describe('createGitHubIssues', () => {
    it('should throw error when GitHub token not provided', async () => {
      const hierarchy: TaskHierarchy = {
        epic: {
          title: 'Test Epic',
          description: 'Test Description',
          acceptanceCriteria: [],
          labels: ['epic'],
          priority: 'medium',
          estimatedStories: 1,
          businessValue: 50
        },
        stories: [],
        tasks: [],
        subtasks: []
      };

      await expect(
        decomposer.createGitHubIssues(hierarchy, 'owner', 'repo')
      ).rejects.toThrow('GitHub token not provided');
    });

    it('should create GitHub issues when token is provided', async () => {
      const mockCreate = jest.fn().mockResolvedValue({ data: { number: 1 } });
      const decomposerWithToken = new TaskDecomposer('fake-token');
      (decomposerWithToken as any).octokit = {
        issues: { create: mockCreate }
      };

      const hierarchy: TaskHierarchy = {
        epic: {
          title: 'Test Epic',
          description: 'Test Description',
          acceptanceCriteria: ['Criteria 1'],
          labels: ['epic'],
          priority: 'high',
          estimatedStories: 1,
          businessValue: 75
        },
        stories: [{
          title: 'Test Story',
          userStory: 'As a user...',
          acceptanceCriteria: ['Story criteria'],
          labels: ['story'],
          priority: 'medium',
          estimatedTasks: 1,
          storyPoints: 3,
          dependencies: []
        }],
        tasks: [{
          storyId: 'Test Story',
          title: 'Test Task',
          description: 'Task description',
          technicalDetails: ['Detail 1'],
          estimatedHours: 2,
          complexity: 'simple',
          labels: ['task'],
          dependencies: []
        }],
        subtasks: []
      };

      const startSpy = jest.fn();
      const completeSpy = jest.fn();
      decomposerWithToken.on('github:create:start', startSpy);
      decomposerWithToken.on('github:create:complete', completeSpy);

      await decomposerWithToken.createGitHubIssues(hierarchy, 'owner', 'repo');

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(startSpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle very long ideas', async () => {
      const longIdea = 'Create '.repeat(100) + 'system';
      const hierarchy = await decomposer.decompose(longIdea);

      expect(hierarchy.epic).toBeDefined();
      expect(hierarchy.stories.length).toBeLessThanOrEqual(8);
    });

    it('should handle ideas with special characters', async () => {
      const specialIdea = 'Create @user #hashtag $payment system!';
      const hierarchy = await decomposer.decompose(specialIdea);

      expect(hierarchy.epic).toBeDefined();
      expect(hierarchy.epic.title).toBeDefined();
    });

    it('should handle multiple languages gracefully', async () => {
      const multiLangIdea = 'Create système de paiement';
      const hierarchy = await decomposer.decompose(multiLangIdea);

      expect(hierarchy.epic).toBeDefined();
    });
  });
});