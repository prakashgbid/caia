import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { FeatureArchitect } from '../../../src/hierarchical/stream3/feature-architect';
import { Epic, Feature, Story, Task, InitiativePlan } from '../../../src/hierarchical/types';

describe('FeatureArchitect', () => {
  let architect: FeatureArchitect;
  let mockEpic: Epic;
  let mockInitiativePlan: InitiativePlan;

  beforeEach(() => {
    architect = new FeatureArchitect();
    
    mockEpic = {
      id: 'epic-1',
      title: 'User Management System',
      description: 'Complete user management including registration, authentication, profiles, and permissions',
      parentInitiative: 'init-1',
      priority: 'high',
      status: 'planning',
      estimatedEffort: { hours: 40, confidence: 0.8 },
      acceptanceCriteria: [
        'Users can register with email',
        'Users can login securely',
        'Users can manage profiles',
        'Admin can manage permissions'
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    mockInitiativePlan = {
      initiative: {
        id: 'init-1',
        title: 'E-commerce Platform Initiative',
        description: 'Full e-commerce solution',
        originalIdea: {
          id: 'idea-1',
          title: 'E-commerce Platform',
          description: 'Build e-commerce platform'
        },
        status: 'planning',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      epics: [mockEpic],
      timeline: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        milestones: [],
        phases: []
      },
      riskAssessment: {
        risks: [],
        mitigationStrategies: [],
        overallRiskLevel: 'medium'
      },
      resourceRequirements: {
        roles: ['developer', 'designer'],
        skills: ['javascript', 'react'],
        tools: ['vscode', 'git'],
        budget: { amount: 50000, currency: 'USD' }
      },
      successMetrics: []
    };
  });

  describe('decomposeEpicToFeatures', () => {
    it('should decompose epic into logical features', async () => {
      const features = await architect.decomposeEpicToFeatures(mockEpic);
      
      expect(features).toBeArrayOfSize(expect.any(Number));
      expect(features.length).toBeGreaterThan(0);
      
      features.forEach(feature => {
        expect(feature).toHaveProperty('id');
        expect(feature).toHaveProperty('title');
        expect(feature).toHaveProperty('description');
        expect(feature).toHaveProperty('parentEpic', mockEpic.id);
        expect(feature).toHaveProperty('priority');
        expect(feature).toHaveProperty('estimatedEffort');
        expect(feature).toHaveProperty('acceptanceCriteria');
      });
    });

    it('should create features covering all epic acceptance criteria', async () => {
      const features = await architect.decomposeEpicToFeatures(mockEpic);
      
      const featureTitles = features.map(f => f.title.toLowerCase());
      
      // Should have features for each major aspect
      expect(featureTitles.some(title => title.includes('registration') || title.includes('register'))).toBe(true);
      expect(featureTitles.some(title => title.includes('authentication') || title.includes('login'))).toBe(true);
      expect(featureTitles.some(title => title.includes('profile'))).toBe(true);
      expect(featureTitles.some(title => title.includes('permission'))).toBe(true);
    });

    it('should maintain effort estimation consistency', async () => {
      const features = await architect.decomposeEpicToFeatures(mockEpic);
      
      const totalFeatureEffort = features.reduce((sum, feature) => sum + feature.estimatedEffort.hours, 0);
      const epicEffort = mockEpic.estimatedEffort.hours;
      
      // Total feature effort should be within 15% of epic estimate
      expect(totalFeatureEffort).toBeGreaterThan(epicEffort * 0.85);
      expect(totalFeatureEffort).toBeLessThan(epicEffort * 1.15);
    });
  });

  describe('decomposeFeatureToStories', () => {
    it('should decompose feature into user stories', async () => {
      const features = await architect.decomposeEpicToFeatures(mockEpic);
      const feature = features[0];
      
      const stories = await architect.decomposeFeatureToStories(feature);
      
      expect(stories).toBeArrayOfSize(expect.any(Number));
      expect(stories.length).toBeGreaterThan(0);
      
      stories.forEach(story => {
        expect(story).toHaveProperty('id');
        expect(story).toHaveProperty('title');
        expect(story).toHaveProperty('description');
        expect(story).toHaveProperty('parentFeature', feature.id);
        expect(story).toHaveProperty('asA');
        expect(story).toHaveProperty('iWant');
        expect(story).toHaveProperty('soThat');
        expect(story).toHaveProperty('priority');
        expect(story).toHaveProperty('estimatedEffort');
      });
    });

    it('should create stories with proper user story format', async () => {
      const features = await architect.decomposeEpicToFeatures(mockEpic);
      const stories = await architect.decomposeFeatureToStories(features[0]);
      
      stories.forEach(story => {
        expect(story.asA).toBeTruthy();
        expect(story.iWant).toBeTruthy();
        expect(story.soThat).toBeTruthy();
        
        // Check user story format makes sense
        expect(story.asA.toLowerCase()).toMatch(/user|admin|customer|visitor/);
        expect(story.iWant.toLowerCase()).toMatch(/want|need|should be able/);
      });
    });

    it('should assign appropriate story points', async () => {
      const features = await architect.decomposeEpicToFeatures(mockEpic);
      const stories = await architect.decomposeFeatureToStories(features[0]);
      
      stories.forEach(story => {
        expect(story).toHaveProperty('storyPoints');
        expect([1, 2, 3, 5, 8, 13]).toContain(story.storyPoints);
      });
    });
  });

  describe('decomposeStoryToTasks', () => {
    it('should decompose story into technical tasks', async () => {
      const features = await architect.decomposeEpicToFeatures(mockEpic);
      const stories = await architect.decomposeFeatureToStories(features[0]);
      const story = stories[0];
      
      const tasks = await architect.decomposeStoryToTasks(story);
      
      expect(tasks).toBeArrayOfSize(expect.any(Number));
      expect(tasks.length).toBeGreaterThan(0);
      
      tasks.forEach(task => {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('title');
        expect(task).toHaveProperty('description');
        expect(task).toHaveProperty('parentStory', story.id);
        expect(task).toHaveProperty('type');
        expect(task).toHaveProperty('priority');
        expect(task).toHaveProperty('estimatedHours');
        expect(task).toHaveProperty('skillRequired');
      });
    });

    it('should create tasks with appropriate types', async () => {
      const features = await architect.decomposeEpicToFeatures(mockEpic);
      const stories = await architect.decomposeFeatureToStories(features[0]);
      const tasks = await architect.decomposeStoryToTasks(stories[0]);
      
      const taskTypes = tasks.map(t => t.type);
      const validTypes = ['development', 'testing', 'documentation', 'deployment', 'research', 'design'];
      
      taskTypes.forEach(type => {
        expect(validTypes).toContain(type);
      });
      
      // Should have at least development and testing tasks
      expect(taskTypes).toContain('development');
      expect(taskTypes).toContain('testing');
    });

    it('should assign appropriate skills to tasks', async () => {
      const features = await architect.decomposeEpicToFeatures(mockEpic);
      const stories = await architect.decomposeFeatureToStories(features[0]);
      const tasks = await architect.decomposeStoryToTasks(stories[0]);
      
      tasks.forEach(task => {
        expect(task.skillRequired).toBeTruthy();
        expect(typeof task.skillRequired).toBe('string');
        expect(task.skillRequired.length).toBeGreaterThan(0);
      });
    });
  });

  describe('generateArchitecture', () => {
    it('should generate comprehensive architecture from initiative plan', async () => {
      const architecture = await architect.generateArchitecture(mockInitiativePlan);
      
      expect(architecture).toHaveProperty('initiative');
      expect(architecture).toHaveProperty('epics');
      expect(architecture).toHaveProperty('features');
      expect(architecture).toHaveProperty('stories');
      expect(architecture).toHaveProperty('tasks');
      expect(architecture).toHaveProperty('dependencies');
      expect(architecture).toHaveProperty('estimations');
      expect(architecture).toHaveProperty('metadata');
    });

    it('should maintain hierarchical relationships', async () => {
      const architecture = await architect.generateArchitecture(mockInitiativePlan);
      
      // Check epic relationships
      architecture.epics.forEach(epic => {
        expect(epic.parentInitiative).toBe(architecture.initiative.id);
      });
      
      // Check feature relationships
      architecture.features.forEach(feature => {
        const parentEpic = architecture.epics.find(e => e.id === feature.parentEpic);
        expect(parentEpic).toBeTruthy();
      });
      
      // Check story relationships
      architecture.stories.forEach(story => {
        const parentFeature = architecture.features.find(f => f.id === story.parentFeature);
        expect(parentFeature).toBeTruthy();
      });
      
      // Check task relationships
      architecture.tasks.forEach(task => {
        const parentStory = architecture.stories.find(s => s.id === task.parentStory);
        expect(parentStory).toBeTruthy();
      });
    });

    it('should calculate accurate estimations', async () => {
      const architecture = await architect.generateArchitecture(mockInitiativePlan);
      
      expect(architecture.estimations).toHaveProperty('totalStoryPoints');
      expect(architecture.estimations).toHaveProperty('totalHours');
      expect(architecture.estimations).toHaveProperty('totalFeatures');
      expect(architecture.estimations).toHaveProperty('totalStories');
      expect(architecture.estimations).toHaveProperty('totalTasks');
      
      // Verify calculations
      expect(architecture.estimations.totalFeatures).toBe(architecture.features.length);
      expect(architecture.estimations.totalStories).toBe(architecture.stories.length);
      expect(architecture.estimations.totalTasks).toBe(architecture.tasks.length);
      
      const calculatedStoryPoints = architecture.stories.reduce((sum, story) => sum + story.storyPoints, 0);
      expect(architecture.estimations.totalStoryPoints).toBe(calculatedStoryPoints);
      
      const calculatedHours = architecture.tasks.reduce((sum, task) => sum + task.estimatedHours, 0);
      expect(architecture.estimations.totalHours).toBeCloseTo(calculatedHours, 0);
    });

    it('should identify dependencies correctly', async () => {
      const architecture = await architect.generateArchitecture(mockInitiativePlan);
      
      expect(architecture.dependencies).toHaveProperty('features');
      expect(architecture.dependencies).toHaveProperty('stories');
      expect(architecture.dependencies).toHaveProperty('tasks');
      
      // Dependencies should be arrays
      expect(Array.isArray(architecture.dependencies.features)).toBe(true);
      expect(Array.isArray(architecture.dependencies.stories)).toBe(true);
      expect(Array.isArray(architecture.dependencies.tasks)).toBe(true);
    });
  });

  describe('validateArchitecture', () => {
    it('should validate complete architecture', async () => {
      const architecture = await architect.generateArchitecture(mockInitiativePlan);
      const validation = await architect.validateArchitecture(architecture);
      
      expect(validation).toHaveProperty('isValid');
      expect(validation).toHaveProperty('errors');
      expect(validation).toHaveProperty('warnings');
      
      if (!validation.isValid) {
        console.log('Architecture validation errors:', validation.errors);
        console.log('Architecture validation warnings:', validation.warnings);
      }
      
      expect(validation.isValid).toBe(true);
    });

    it('should detect orphaned items', async () => {
      const architecture = await architect.generateArchitecture(mockInitiativePlan);
      
      // Create orphaned feature
      architecture.features.push({
        id: 'orphan-feature',
        title: 'Orphaned Feature',
        description: 'This feature has no parent epic',
        parentEpic: 'non-existent-epic',
        priority: 'low',
        estimatedEffort: { hours: 5, confidence: 0.5 },
        acceptanceCriteria: [],
        status: 'planning',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      const validation = await architect.validateArchitecture(architecture);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(error => error.includes('orphan'))).toBe(true);
    });

    it('should detect missing required fields', async () => {
      const architecture = await architect.generateArchitecture(mockInitiativePlan);
      
      // Remove required field
      delete (architecture.features[0] as any).title;
      
      const validation = await architect.validateArchitecture(architecture);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(error => error.includes('title'))).toBe(true);
    });
  });

  describe('optimizeArchitecture', () => {
    it('should optimize architecture for better organization', async () => {
      const architecture = await architect.generateArchitecture(mockInitiativePlan);
      const optimized = await architect.optimizeArchitecture(architecture);
      
      expect(optimized).toHaveProperty('architecture');
      expect(optimized).toHaveProperty('optimizations');
      expect(optimized).toHaveProperty('improvements');
      
      expect(optimized.optimizations.length).toBeGreaterThanOrEqual(0);
    });

    it('should suggest meaningful improvements', async () => {
      const architecture = await architect.generateArchitecture(mockInitiativePlan);
      const optimized = await architect.optimizeArchitecture(architecture);
      
      if (optimized.improvements.length > 0) {
        optimized.improvements.forEach(improvement => {
          expect(improvement).toHaveProperty('type');
          expect(improvement).toHaveProperty('description');
          expect(improvement).toHaveProperty('impact');
        });
      }
    });
  });

  describe('error handling', () => {
    it('should handle invalid epic gracefully', async () => {
      const invalidEpic = { id: 'invalid' } as any;
      
      await expect(architect.decomposeEpicToFeatures(invalidEpic))
        .rejects.toThrow('Invalid epic');
    });

    it('should handle empty initiative plan', async () => {
      const emptyPlan = {
        initiative: mockInitiativePlan.initiative,
        epics: [],
        timeline: mockInitiativePlan.timeline,
        riskAssessment: mockInitiativePlan.riskAssessment,
        resourceRequirements: mockInitiativePlan.resourceRequirements,
        successMetrics: []
      };
      
      const architecture = await architect.generateArchitecture(emptyPlan);
      
      expect(architecture.epics).toBeArrayOfSize(0);
      expect(architecture.features).toBeArrayOfSize(0);
      expect(architecture.stories).toBeArrayOfSize(0);
      expect(architecture.tasks).toBeArrayOfSize(0);
    });
  });

  describe('performance', () => {
    it('should handle large epics efficiently', async () => {
      const largeEpic = {
        ...mockEpic,
        description: 'A'.repeat(10000), // Very large description
        acceptanceCriteria: Array(50).fill('Acceptance criterion')
      };
      
      const startTime = Date.now();
      const features = await architect.decomposeEpicToFeatures(largeEpic);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(10000); // Should complete within 10 seconds
      expect(features.length).toBeGreaterThan(0);
    });

    it('should process multiple epics in parallel', async () => {
      const epics = Array(5).fill(null).map((_, i) => ({
        ...mockEpic,
        id: `epic-${i}`,
        title: `Epic ${i}`
      }));
      
      const startTime = Date.now();
      const results = await Promise.all(
        epics.map(epic => architect.decomposeEpicToFeatures(epic))
      );
      const endTime = Date.now();
      
      expect(results).toBeArrayOfSize(5);
      expect(endTime - startTime).toBeLessThan(20000); // Parallel processing
    });
  });
});