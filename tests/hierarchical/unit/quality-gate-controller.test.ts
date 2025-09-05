import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { QualityGateController } from '../../../src/hierarchical/stream4/quality-gate-controller';
import { QualityGate, ValidationResult, Architecture } from '../../../src/hierarchical/types';

describe('QualityGateController', () => {
  let controller: QualityGateController;
  let mockArchitecture: Architecture;
  let mockQualityGates: QualityGate[];

  beforeEach(() => {
    controller = new QualityGateController();
    
    mockArchitecture = {
      initiative: {
        id: 'init-1',
        title: 'Test Initiative',
        description: 'Test initiative for validation',
        status: 'planning',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      epics: [
        {
          id: 'epic-1',
          title: 'Test Epic',
          description: 'Test epic description',
          parentInitiative: 'init-1',
          priority: 'high',
          status: 'planning',
          estimatedEffort: { hours: 40, confidence: 0.8 },
          acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      features: [
        {
          id: 'feature-1',
          title: 'Test Feature',
          description: 'Test feature description',
          parentEpic: 'epic-1',
          priority: 'high',
          status: 'planning',
          estimatedEffort: { hours: 20, confidence: 0.8 },
          acceptanceCriteria: ['Feature criterion 1'],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      stories: [
        {
          id: 'story-1',
          title: 'Test Story',
          description: 'Test story description',
          parentFeature: 'feature-1',
          asA: 'user',
          iWant: 'to test the system',
          soThat: 'I can verify it works',
          priority: 'high',
          status: 'planning',
          estimatedEffort: { hours: 8, confidence: 0.9 },
          storyPoints: 5,
          acceptanceCriteria: ['Story acceptance criterion'],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      tasks: [
        {
          id: 'task-1',
          title: 'Test Task',
          description: 'Test task description',
          parentStory: 'story-1',
          type: 'development',
          priority: 'high',
          status: 'planning',
          estimatedHours: 4,
          skillRequired: 'javascript',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      dependencies: {
        features: [],
        stories: [],
        tasks: []
      },
      estimations: {
        totalStoryPoints: 5,
        totalHours: 40,
        totalFeatures: 1,
        totalStories: 1,
        totalTasks: 1
      },
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        version: '1.0.0'
      }
    };

    mockQualityGates = [
      {
        id: 'completeness-gate',
        name: 'Completeness Gate',
        description: 'Ensures all required fields are present',
        type: 'completeness',
        rules: [
          {
            id: 'title-required',
            description: 'All items must have titles',
            condition: 'title.length > 0',
            severity: 'error',
            category: 'completeness'
          }
        ],
        threshold: { errors: 0, warnings: 5 },
        enabled: true,
        order: 1
      },
      {
        id: 'consistency-gate',
        name: 'Consistency Gate',
        description: 'Ensures data consistency across hierarchy',
        type: 'consistency',
        rules: [
          {
            id: 'parent-child-consistency',
            description: 'Parent-child relationships must be valid',
            condition: 'parentExists',
            severity: 'error',
            category: 'consistency'
          }
        ],
        threshold: { errors: 0, warnings: 10 },
        enabled: true,
        order: 2
      }
    ];
  });

  describe('validateArchitecture', () => {
    it('should validate complete architecture successfully', async () => {
      const result = await controller.validateArchitecture(mockArchitecture, mockQualityGates);
      
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('gateResults');
      expect(result).toHaveProperty('overallScore');
      expect(result).toHaveProperty('summary');
      
      expect(result.gateResults).toBeArrayOfSize(mockQualityGates.length);
    });

    it('should run all enabled quality gates', async () => {
      const result = await controller.validateArchitecture(mockArchitecture, mockQualityGates);
      
      result.gateResults.forEach((gateResult, index) => {
        expect(gateResult.gate.id).toBe(mockQualityGates[index].id);
        expect(gateResult).toHaveProperty('passed');
        expect(gateResult).toHaveProperty('errors');
        expect(gateResult).toHaveProperty('warnings');
        expect(gateResult).toHaveProperty('score');
      });
    });

    it('should skip disabled quality gates', async () => {
      mockQualityGates[0].enabled = false;
      
      const result = await controller.validateArchitecture(mockArchitecture, mockQualityGates);
      
      expect(result.gateResults).toBeArrayOfSize(1);
      expect(result.gateResults[0].gate.id).toBe('consistency-gate');
    });

    it('should calculate overall score correctly', async () => {
      const result = await controller.validateArchitecture(mockArchitecture, mockQualityGates);
      
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      
      // Score should be average of gate scores
      const expectedScore = result.gateResults.reduce((sum, gr) => sum + gr.score, 0) / result.gateResults.length;
      expect(result.overallScore).toBeCloseTo(expectedScore, 1);
    });
  });

  describe('runQualityGate', () => {
    it('should run completeness gate successfully', async () => {
      const gate = mockQualityGates[0];
      const result = await controller.runQualityGate(mockArchitecture, gate);
      
      expect(result).toHaveProperty('gate');
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('executionTime');
    });

    it('should detect missing required fields', async () => {
      // Remove title from a feature
      delete (mockArchitecture.features[0] as any).title;
      
      const gate = mockQualityGates[0];
      const result = await controller.runQualityGate(mockArchitecture, gate);
      
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(error => error.includes('title'))).toBe(true);
    });

    it('should validate parent-child relationships', async () => {
      // Set invalid parent reference
      mockArchitecture.features[0].parentEpic = 'non-existent-epic';
      
      const gate = mockQualityGates[1];
      const result = await controller.runQualityGate(mockArchitecture, gate);
      
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should measure execution time', async () => {
      const gate = mockQualityGates[0];
      const result = await controller.runQualityGate(mockArchitecture, gate);
      
      expect(result.executionTime).toBeGreaterThan(0);
      expect(result.executionTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('validateRule', () => {
    it('should validate title requirement rule', async () => {
      const rule = mockQualityGates[0].rules[0];
      const item = mockArchitecture.features[0];
      
      const result = await controller.validateRule(item, rule, mockArchitecture);
      
      expect(result).toHaveProperty('passed', true);
      expect(result).toHaveProperty('message');
    });

    it('should fail validation for missing title', async () => {
      const rule = mockQualityGates[0].rules[0];
      const item = { ...mockArchitecture.features[0] };
      delete (item as any).title;
      
      const result = await controller.validateRule(item, rule, mockArchitecture);
      
      expect(result.passed).toBe(false);
      expect(result.message).toContain('title');
    });

    it('should handle complex validation conditions', async () => {
      const complexRule = {
        id: 'effort-estimation',
        description: 'Effort estimation must be realistic',
        condition: 'estimatedEffort.hours > 0 && estimatedEffort.confidence >= 0.5',
        severity: 'warning' as const,
        category: 'estimation' as const
      };
      
      const result = await controller.validateRule(mockArchitecture.features[0], complexRule, mockArchitecture);
      
      expect(result.passed).toBe(true);
    });
  });

  describe('createQualityGate', () => {
    it('should create new quality gate with valid configuration', () => {
      const config = {
        name: 'Custom Gate',
        description: 'Custom validation gate',
        type: 'custom' as const,
        rules: [
          {
            id: 'custom-rule',
            description: 'Custom rule',
            condition: 'id.length > 0',
            severity: 'error' as const,
            category: 'custom' as const
          }
        ],
        threshold: { errors: 0, warnings: 3 },
        enabled: true,
        order: 99
      };
      
      const gate = controller.createQualityGate(config);
      
      expect(gate).toHaveProperty('id');
      expect(gate.name).toBe(config.name);
      expect(gate.description).toBe(config.description);
      expect(gate.type).toBe(config.type);
      expect(gate.rules).toEqual(config.rules);
      expect(gate.threshold).toEqual(config.threshold);
      expect(gate.enabled).toBe(config.enabled);
      expect(gate.order).toBe(config.order);
    });

    it('should generate unique IDs for quality gates', () => {
      const config = {
        name: 'Test Gate',
        description: 'Test gate',
        type: 'test' as const,
        rules: [],
        threshold: { errors: 0, warnings: 5 },
        enabled: true,
        order: 1
      };
      
      const gate1 = controller.createQualityGate(config);
      const gate2 = controller.createQualityGate(config);
      
      expect(gate1.id).not.toBe(gate2.id);
    });
  });

  describe('getDefaultQualityGates', () => {
    it('should return standard set of quality gates', () => {
      const defaultGates = controller.getDefaultQualityGates();
      
      expect(defaultGates.length).toBeGreaterThan(0);
      
      defaultGates.forEach(gate => {
        expect(gate).toHaveProperty('id');
        expect(gate).toHaveProperty('name');
        expect(gate).toHaveProperty('description');
        expect(gate).toHaveProperty('type');
        expect(gate).toHaveProperty('rules');
        expect(gate).toHaveProperty('threshold');
        expect(gate).toHaveProperty('enabled');
        expect(gate).toHaveProperty('order');
      });
    });

    it('should include essential gate types', () => {
      const defaultGates = controller.getDefaultQualityGates();
      const gateTypes = defaultGates.map(g => g.type);
      
      expect(gateTypes).toContain('completeness');
      expect(gateTypes).toContain('consistency');
      expect(gateTypes).toContain('estimation');
      expect(gateTypes).toContain('hierarchy');
    });

    it('should have gates in logical order', () => {
      const defaultGates = controller.getDefaultQualityGates();
      
      for (let i = 1; i < defaultGates.length; i++) {
        expect(defaultGates[i].order).toBeGreaterThanOrEqual(defaultGates[i - 1].order);
      }
    });
  });

  describe('generateQualityReport', () => {
    it('should generate comprehensive quality report', async () => {
      const validationResult = await controller.validateArchitecture(mockArchitecture, mockQualityGates);
      const report = controller.generateQualityReport(validationResult);
      
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('gateResults');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('metrics');
      expect(report).toHaveProperty('timestamp');
      
      expect(report.summary).toHaveProperty('overallScore');
      expect(report.summary).toHaveProperty('totalGates');
      expect(report.summary).toHaveProperty('passedGates');
      expect(report.summary).toHaveProperty('failedGates');
    });

    it('should include actionable recommendations', async () => {
      // Create architecture with some issues
      mockArchitecture.features[0].estimatedEffort.confidence = 0.2; // Low confidence
      
      const validationResult = await controller.validateArchitecture(mockArchitecture, mockQualityGates);
      const report = controller.generateQualityReport(validationResult);
      
      expect(report.recommendations).toBeArrayOfSize(expect.any(Number));
      
      if (report.recommendations.length > 0) {
        report.recommendations.forEach(rec => {
          expect(rec).toHaveProperty('type');
          expect(rec).toHaveProperty('priority');
          expect(rec).toHaveProperty('description');
          expect(rec).toHaveProperty('action');
        });
      }
    });

    it('should calculate quality metrics', async () => {
      const validationResult = await controller.validateArchitecture(mockArchitecture, mockQualityGates);
      const report = controller.generateQualityReport(validationResult);
      
      expect(report.metrics).toHaveProperty('coverageScore');
      expect(report.metrics).toHaveProperty('consistencyScore');
      expect(report.metrics).toHaveProperty('completenessScore');
      expect(report.metrics).toHaveProperty('estimationAccuracy');
      
      Object.values(report.metrics).forEach(score => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('error handling', () => {
    it('should handle null architecture gracefully', async () => {
      await expect(controller.validateArchitecture(null as any, mockQualityGates))
        .rejects.toThrow('Invalid architecture');
    });

    it('should handle empty quality gates array', async () => {
      const result = await controller.validateArchitecture(mockArchitecture, []);
      
      expect(result.isValid).toBe(true);
      expect(result.gateResults).toBeArrayOfSize(0);
      expect(result.overallScore).toBe(100);
    });

    it('should handle malformed quality gate rules', async () => {
      const malformedGate = {
        ...mockQualityGates[0],
        rules: [
          {
            id: 'malformed-rule',
            description: 'Malformed rule',
            condition: 'invalid.javascript.syntax...',
            severity: 'error' as const,
            category: 'test' as const
          }
        ]
      };
      
      const result = await controller.runQualityGate(mockArchitecture, malformedGate);
      
      expect(result.passed).toBe(false);
      expect(result.errors.some(error => error.includes('rule evaluation'))).toBe(true);
    });

    it('should timeout on long-running validations', async () => {
      const timeoutGate = {
        ...mockQualityGates[0],
        rules: Array(1000).fill(null).map((_, i) => ({
          id: `rule-${i}`,
          description: `Rule ${i}`,
          condition: 'id.length > 0',
          severity: 'warning' as const,
          category: 'performance' as const
        }))
      };
      
      const startTime = Date.now();
      const result = await controller.runQualityGate(mockArchitecture, timeoutGate);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(30000); // Should timeout before 30 seconds
    });
  });

  describe('performance', () => {
    it('should validate large architectures efficiently', async () => {
      // Create large architecture
      const largeArchitecture = {
        ...mockArchitecture,
        features: Array(100).fill(null).map((_, i) => ({
          ...mockArchitecture.features[0],
          id: `feature-${i}`,
          title: `Feature ${i}`
        })),
        stories: Array(500).fill(null).map((_, i) => ({
          ...mockArchitecture.stories[0],
          id: `story-${i}`,
          title: `Story ${i}`,
          parentFeature: `feature-${i % 100}`
        })),
        tasks: Array(2000).fill(null).map((_, i) => ({
          ...mockArchitecture.tasks[0],
          id: `task-${i}`,
          title: `Task ${i}`,
          parentStory: `story-${i % 500}`
        }))
      };
      
      const startTime = Date.now();
      const result = await controller.validateArchitecture(largeArchitecture, mockQualityGates);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(15000); // Should complete within 15 seconds
      expect(result).toHaveProperty('overallScore');
    });

    it('should run quality gates in parallel when possible', async () => {
      const manyGates = Array(10).fill(null).map((_, i) => ({
        ...mockQualityGates[0],
        id: `gate-${i}`,
        name: `Gate ${i}`
      }));
      
      const startTime = Date.now();
      const result = await controller.validateArchitecture(mockArchitecture, manyGates);
      const endTime = Date.now();
      
      expect(result.gateResults).toBeArrayOfSize(10);
      expect(endTime - startTime).toBeLessThan(10000); // Parallel execution should be faster
    });
  });
});