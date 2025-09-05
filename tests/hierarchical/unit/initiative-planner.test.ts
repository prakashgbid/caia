import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { InitiativePlanner } from '../../../src/hierarchical/stream2/initiative-planner';
import { Initiative, AnalysisResult, InitiativePlan } from '../../../src/hierarchical/types';

describe('InitiativePlanner', () => {
  let planner: InitiativePlanner;
  let mockAnalysisResult: AnalysisResult;
  let mockInitiative: Initiative;

  beforeEach(() => {
    planner = new InitiativePlanner();
    
    mockAnalysisResult = {
      idea: {
        id: 'test-idea-1',
        title: 'E-commerce Platform',
        description: 'Build a comprehensive e-commerce platform with user management, product catalog, shopping cart, and payment processing',
        complexity: 'complex',
        priority: 'high',
        tags: ['ecommerce', 'web', 'backend', 'frontend']
      },
      validation: { isValid: true, errors: [], warnings: [] },
      complexity: 'complex',
      keywords: ['ecommerce', 'user-management', 'payment', 'catalog'],
      effort: { hours: 160, confidence: 0.8 },
      recommendations: ['Break down into smaller components', 'Consider microservices architecture'],
      timestamp: Date.now()
    };

    mockInitiative = {
      id: 'init-1',
      title: 'E-commerce Platform Initiative',
      description: 'Full stack e-commerce solution',
      originalIdea: mockAnalysisResult.idea,
      analysisResult: mockAnalysisResult,
      status: 'planning',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  });

  describe('createInitiative', () => {
    it('should create initiative from analysis result', async () => {
      const initiative = await planner.createInitiative(mockAnalysisResult);
      
      expect(initiative).toHaveProperty('id');
      expect(initiative).toHaveProperty('title');
      expect(initiative).toHaveProperty('description');
      expect(initiative).toHaveProperty('originalIdea');
      expect(initiative).toHaveProperty('analysisResult');
      expect(initiative.status).toBe('planning');
    });

    it('should generate unique IDs for initiatives', async () => {
      const initiative1 = await planner.createInitiative(mockAnalysisResult);
      const initiative2 = await planner.createInitiative(mockAnalysisResult);
      
      expect(initiative1.id).not.toBe(initiative2.id);
    });

    it('should set timestamps correctly', async () => {
      const beforeCreation = Date.now();
      const initiative = await planner.createInitiative(mockAnalysisResult);
      const afterCreation = Date.now();
      
      expect(initiative.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreation);
      expect(initiative.createdAt.getTime()).toBeLessThanOrEqual(afterCreation);
      expect(initiative.updatedAt.getTime()).toEqual(initiative.createdAt.getTime());
    });
  });

  describe('decomposeToEpics', () => {
    it('should decompose complex initiative into epics', async () => {
      const epics = await planner.decomposeToEpics(mockInitiative);
      
      expect(epics).toBeArrayOfSize(expect.any(Number));
      expect(epics.length).toBeGreaterThan(0);
      
      epics.forEach(epic => {
        expect(epic).toHaveProperty('id');
        expect(epic).toHaveProperty('title');
        expect(epic).toHaveProperty('description');
        expect(epic).toHaveProperty('parentInitiative', mockInitiative.id);
        expect(epic).toHaveProperty('priority');
        expect(epic).toHaveProperty('estimatedEffort');
      });
    });

    it('should create logical groupings for epics', async () => {
      const epics = await planner.decomposeToEpics(mockInitiative);
      
      const epicTitles = epics.map(e => e.title.toLowerCase());
      
      // Should have core e-commerce functionality
      expect(epicTitles.some(title => title.includes('user') || title.includes('auth'))).toBe(true);
      expect(epicTitles.some(title => title.includes('product') || title.includes('catalog'))).toBe(true);
      expect(epicTitles.some(title => title.includes('cart') || title.includes('order'))).toBe(true);
      expect(epicTitles.some(title => title.includes('payment'))).toBe(true);
    });

    it('should maintain effort estimation consistency', async () => {
      const epics = await planner.decomposeToEpics(mockInitiative);
      
      const totalEpicEffort = epics.reduce((sum, epic) => sum + epic.estimatedEffort.hours, 0);
      const originalEffort = mockAnalysisResult.effort.hours;
      
      // Total epic effort should be within 20% of original estimate
      expect(totalEpicEffort).toBeGreaterThan(originalEffort * 0.8);
      expect(totalEpicEffort).toBeLessThan(originalEffort * 1.2);
    });
  });

  describe('prioritizeEpics', () => {
    it('should prioritize epics based on dependencies and business value', async () => {
      const epics = await planner.decomposeToEpics(mockInitiative);
      const prioritizedEpics = await planner.prioritizeEpics(epics, mockInitiative);
      
      expect(prioritizedEpics).toBeArrayOfSize(epics.length);
      
      // Check that priorities are assigned
      prioritizedEpics.forEach(epic => {
        expect(['critical', 'high', 'medium', 'low']).toContain(epic.priority);
      });
      
      // First epic should be high priority
      expect(['critical', 'high']).toContain(prioritizedEpics[0].priority);
    });

    it('should consider dependencies when prioritizing', async () => {
      const epics = await planner.decomposeToEpics(mockInitiative);
      epics[1].dependencies = [epics[0].id]; // Make epic 1 depend on epic 0
      
      const prioritizedEpics = await planner.prioritizeEpics(epics, mockInitiative);
      
      // Epic with no dependencies should come before its dependents
      const epic0Index = prioritizedEpics.findIndex(e => e.id === epics[0].id);
      const epic1Index = prioritizedEpics.findIndex(e => e.id === epics[1].id);
      
      expect(epic0Index).toBeLessThan(epic1Index);
    });
  });

  describe('generateTimeline', () => {
    it('should generate realistic timeline', async () => {
      const epics = await planner.decomposeToEpics(mockInitiative);
      const timeline = await planner.generateTimeline(epics, mockInitiative);
      
      expect(timeline).toHaveProperty('startDate');
      expect(timeline).toHaveProperty('endDate');
      expect(timeline).toHaveProperty('milestones');
      expect(timeline).toHaveProperty('phases');
      
      expect(timeline.endDate.getTime()).toBeGreaterThan(timeline.startDate.getTime());
      expect(timeline.milestones.length).toBeGreaterThan(0);
    });

    it('should respect epic dependencies in timeline', async () => {
      const epics = await planner.decomposeToEpics(mockInitiative);
      if (epics.length > 1) {
        epics[1].dependencies = [epics[0].id];
      }
      
      const timeline = await planner.generateTimeline(epics, mockInitiative);
      
      // Find milestones for dependent epics
      const epic0Milestone = timeline.milestones.find(m => m.epicId === epics[0].id);
      const epic1Milestone = timeline.milestones.find(m => m.epicId === epics[1]?.id);
      
      if (epic0Milestone && epic1Milestone) {\n        expect(epic0Milestone.targetDate.getTime()).toBeLessThan(epic1Milestone.targetDate.getTime());\n      }\n    });\n\n    it('should include buffer time for risk management', async () => {\n      const epics = await planner.decomposeToEpics(mockInitiative);\n      const timeline = await planner.generateTimeline(epics, mockInitiative);\n      \n      const totalEpicEffort = epics.reduce((sum, epic) => sum + epic.estimatedEffort.hours, 0);\n      const timelineHours = (timeline.endDate.getTime() - timeline.startDate.getTime()) / (1000 * 60 * 60);\n      \n      // Timeline should include buffer (assuming 8 hours per day)\n      const workingDays = timelineHours / 24; // Convert to days\n      const estimatedWorkingDays = totalEpicEffort / 8;\n      \n      expect(workingDays).toBeGreaterThan(estimatedWorkingDays);\n    });\n  });\n\n  describe('createInitiativePlan', () => {\n    it('should create comprehensive initiative plan', async () => {\n      const plan = await planner.createInitiativePlan(mockAnalysisResult);\n      \n      expect(plan).toHaveProperty('initiative');\n      expect(plan).toHaveProperty('epics');\n      expect(plan).toHaveProperty('timeline');\n      expect(plan).toHaveProperty('riskAssessment');\n      expect(plan).toHaveProperty('resourceRequirements');\n      expect(plan).toHaveProperty('successMetrics');\n    });\n\n    it('should include risk assessment', async () => {\n      const plan = await planner.createInitiativePlan(mockAnalysisResult);\n      \n      expect(plan.riskAssessment).toHaveProperty('risks');\n      expect(plan.riskAssessment).toHaveProperty('mitigationStrategies');\n      expect(plan.riskAssessment).toHaveProperty('overallRiskLevel');\n      \n      expect(plan.riskAssessment.risks.length).toBeGreaterThan(0);\n    });\n\n    it('should define resource requirements', async () => {\n      const plan = await planner.createInitiativePlan(mockAnalysisResult);\n      \n      expect(plan.resourceRequirements).toHaveProperty('roles');\n      expect(plan.resourceRequirements).toHaveProperty('skills');\n      expect(plan.resourceRequirements).toHaveProperty('tools');\n      expect(plan.resourceRequirements).toHaveProperty('budget');\n    });\n\n    it('should define success metrics', async () => {\n      const plan = await planner.createInitiativePlan(mockAnalysisResult);\n      \n      expect(plan.successMetrics).toBeArrayOfSize(expect.any(Number));\n      expect(plan.successMetrics.length).toBeGreaterThan(0);\n      \n      plan.successMetrics.forEach(metric => {\n        expect(metric).toHaveProperty('name');\n        expect(metric).toHaveProperty('target');\n        expect(metric).toHaveProperty('measurement');\n      });\n    });\n  });\n\n  describe('validatePlan', () => {\n    it('should validate a complete plan', async () => {\n      const plan = await planner.createInitiativePlan(mockAnalysisResult);\n      const validation = await planner.validatePlan(plan);\n      \n      expect(validation).toHaveProperty('isValid');\n      expect(validation).toHaveProperty('errors');\n      expect(validation).toHaveProperty('warnings');\n      \n      if (!validation.isValid) {\n        console.log('Validation errors:', validation.errors);\n      }\n      \n      expect(validation.isValid).toBe(true);\n    });\n\n    it('should detect missing required fields', async () => {\n      const incompletePlan = {\n        initiative: mockInitiative,\n        epics: [],\n        timeline: null,\n        riskAssessment: null,\n        resourceRequirements: null,\n        successMetrics: []\n      } as any;\n      \n      const validation = await planner.validatePlan(incompletePlan);\n      \n      expect(validation.isValid).toBe(false);\n      expect(validation.errors.length).toBeGreaterThan(0);\n    });\n  });\n\n  describe('error handling', () => {\n    it('should handle invalid analysis results', async () => {\n      const invalidAnalysis = {\n        idea: null,\n        validation: { isValid: false, errors: ['Invalid'], warnings: [] }\n      } as any;\n      \n      await expect(planner.createInitiativePlan(invalidAnalysis))\n        .rejects.toThrow('Invalid analysis result');\n    });\n\n    it('should handle empty epic lists gracefully', async () => {\n      const emptyEpics: any[] = [];\n      \n      const timeline = await planner.generateTimeline(emptyEpics, mockInitiative);\n      \n      expect(timeline.milestones).toBeArrayOfSize(0);\n      expect(timeline.phases).toBeArrayOfSize(0);\n    });\n  });\n\n  describe('performance', () => {\n    it('should handle large initiatives efficiently', async () => {\n      const largeAnalysis = {\n        ...mockAnalysisResult,\n        effort: { hours: 2000, confidence: 0.7 }\n      };\n      \n      const startTime = Date.now();\n      const plan = await planner.createInitiativePlan(largeAnalysis);\n      const endTime = Date.now();\n      \n      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds\n      expect(plan.epics.length).toBeGreaterThan(5); // Should break down large initiatives\n    });\n\n    it('should process multiple initiatives in parallel', async () => {\n      const analyses = Array(5).fill(null).map((_, i) => ({\n        ...mockAnalysisResult,\n        idea: { ...mockAnalysisResult.idea, id: `idea-${i}`, title: `Initiative ${i}` }\n      }));\n      \n      const startTime = Date.now();\n      const plans = await Promise.all(\n        analyses.map(analysis => planner.createInitiativePlan(analysis))\n      );\n      const endTime = Date.now();\n      \n      expect(plans).toBeArrayOfSize(5);\n      expect(endTime - startTime).toBeLessThan(15000); // Parallel processing should be faster\n    });\n  });\n});