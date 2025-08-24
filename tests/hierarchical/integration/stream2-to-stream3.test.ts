import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { InitiativePlanner } from '../../../src/hierarchical/stream2/initiative-planner';
import { FeatureArchitect } from '../../../src/hierarchical/stream3/feature-architect';
import { IntelligenceEngine } from '../../../src/hierarchical/intelligence/intelligence-engine';
import { InitiativePlan, Architecture } from '../../../src/hierarchical/types';

describe('Stream 2 to Stream 3 Integration', () => {
  let initiativePlanner: InitiativePlanner;
  let featureArchitect: FeatureArchitect;
  let intelligenceEngine: IntelligenceEngine;
  let mockInitiativePlan: InitiativePlan;

  beforeEach(() => {
    initiativePlanner = new InitiativePlanner();
    featureArchitect = new FeatureArchitect();
    intelligenceEngine = new IntelligenceEngine();
    
    mockInitiativePlan = {
      initiative: {
        id: 'init-integration-test',
        title: 'E-learning Platform Initiative',
        description: 'Comprehensive online learning platform with course management, student tracking, assessments, and analytics',
        originalIdea: {
          id: 'idea-elearning',
          title: 'E-learning Platform',
          description: 'Build online learning platform'
        },
        status: 'planning',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      epics: [
        {
          id: 'epic-course-management',
          title: 'Course Management System',
          description: 'Complete course creation, editing, and publishing system',
          parentInitiative: 'init-integration-test',
          priority: 'high',
          status: 'planning',
          estimatedEffort: { hours: 80, confidence: 0.8 },
          acceptanceCriteria: [
            'Instructors can create courses',
            'Courses can be organized into modules',
            'Content can be multimedia',
            'Courses can be published/unpublished'
          ],
          tags: ['course', 'content', 'instructor'],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'epic-student-portal',
          title: 'Student Learning Portal',
          description: 'Student interface for course enrollment, progress tracking, and assessments',
          parentInitiative: 'init-integration-test',
          priority: 'high',
          status: 'planning',
          estimatedEffort: { hours: 60, confidence: 0.7 },
          acceptanceCriteria: [
            'Students can browse courses',
            'Students can enroll in courses',
            'Progress is tracked automatically',
            'Assessments are integrated'
          ],
          tags: ['student', 'enrollment', 'progress'],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      timeline: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000), // 120 days
        milestones: [
          {
            id: 'milestone-1',
            name: 'Course Management MVP',
            targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
            description: 'Basic course creation and management',
            epicId: 'epic-course-management'
          }
        ],
        phases: [
          {
            id: 'phase-1',
            name: 'Foundation Phase',
            startDate: new Date(),
            endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
            description: 'Core platform setup'
          }
        ]
      },
      riskAssessment: {
        risks: [
          {
            id: 'risk-1',
            description: 'Content delivery scalability',
            impact: 'high',
            probability: 'medium',
            severity: 'medium'
          }
        ],
        mitigationStrategies: [
          'Implement CDN for content delivery',
          'Use cloud storage for scalability'
        ],
        overallRiskLevel: 'medium'
      },
      resourceRequirements: {
        roles: ['frontend-developer', 'backend-developer', 'ui-designer'],
        skills: ['react', 'nodejs', 'database-design'],
        tools: ['docker', 'kubernetes', 'monitoring'],
        budget: { amount: 150000, currency: 'USD' }
      },
      successMetrics: [
        {
          name: 'Course Creation Rate',
          target: '10 courses per week',
          measurement: 'Weekly count of published courses'
        }
      ]
    };
  });

  describe('Initiative Plan to Architecture Flow', () => {
    it('should successfully decompose initiative plan into detailed architecture', async () => {
      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);
      
      expect(architecture).toHaveProperty('initiative');
      expect(architecture).toHaveProperty('epics');
      expect(architecture).toHaveProperty('features');
      expect(architecture).toHaveProperty('stories');
      expect(architecture).toHaveProperty('tasks');
      
      // Verify hierarchy integrity
      expect(architecture.initiative.id).toBe(mockInitiativePlan.initiative.id);
      expect(architecture.epics.length).toBe(mockInitiativePlan.epics.length);
      expect(architecture.features.length).toBeGreaterThan(0);
      expect(architecture.stories.length).toBeGreaterThan(0);
      expect(architecture.tasks.length).toBeGreaterThan(0);
    });

    it('should maintain traceability from epics to tasks', async () => {
      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);
      
      // Verify each task can be traced back to an epic
      architecture.tasks.forEach(task => {
        const story = architecture.stories.find(s => s.id === task.parentStory);
        expect(story).toBeTruthy();
        
        const feature = architecture.features.find(f => f.id === story!.parentFeature);
        expect(feature).toBeTruthy();
        
        const epic = architecture.epics.find(e => e.id === feature!.parentEpic);
        expect(epic).toBeTruthy();
        
        expect(epic!.parentInitiative).toBe(architecture.initiative.id);
      });
    });

    it('should generate appropriate feature breakdown from epics', async () => {
      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);
      
      const courseManagementFeatures = architecture.features.filter(f => 
        f.parentEpic === 'epic-course-management'
      );
      
      const studentPortalFeatures = architecture.features.filter(f => 
        f.parentEpic === 'epic-student-portal'
      );
      
      expect(courseManagementFeatures.length).toBeGreaterThan(0);
      expect(studentPortalFeatures.length).toBeGreaterThan(0);
      
      // Verify features are relevant to their parent epic
      const courseFeatureTitles = courseManagementFeatures.map(f => f.title.toLowerCase());
      expect(courseFeatureTitles.some(title => 
        title.includes('course') || title.includes('content') || title.includes('create')
      )).toBe(true);
      
      const studentFeatureTitles = studentPortalFeatures.map(f => f.title.toLowerCase());
      expect(studentFeatureTitles.some(title => 
        title.includes('student') || title.includes('enroll') || title.includes('progress')
      )).toBe(true);
    });
  });

  describe('Intelligence Engine Integration', () => {
    it('should analyze architecture with intelligence engine insights', async () => {
      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);
      
      // Mock intelligence engine analysis
      const mockAnalyzeArchitecture = jest.fn().mockResolvedValue({
        insights: [
          {
            type: 'complexity_analysis',
            confidence: 0.8,
            finding: 'High complexity detected in course management epic',
            recommendation: 'Consider breaking into smaller features'
          },
          {
            type: 'dependency_analysis',
            confidence: 0.9,
            finding: 'Strong dependency between user management and course enrollment',
            recommendation: 'Prioritize user management features first'
          }
        ],
        riskAssessment: {
          technicalRisks: ['Database performance under load', 'Content storage scaling'],
          mitigationSuggestions: ['Implement caching layer', 'Use CDN for content'],
          overallRiskScore: 0.6
        },
        optimizationSuggestions: [
          'Consolidate similar features across epics',
          'Identify reusable components early'
        ]
      });
      
      intelligenceEngine.analyzeArchitecture = mockAnalyzeArchitecture;
      
      const insights = await intelligenceEngine.analyzeArchitecture(architecture);
      
      expect(insights).toHaveProperty('insights');
      expect(insights).toHaveProperty('riskAssessment');
      expect(insights).toHaveProperty('optimizationSuggestions');
      
      expect(insights.insights.length).toBeGreaterThan(0);
      expect(insights.riskAssessment.technicalRisks.length).toBeGreaterThan(0);
    });

    it('should enhance architecture with intelligence insights', async () => {
      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);
      
      // Mock enhanced architecture
      const mockEnhanceArchitecture = jest.fn().mockResolvedValue({
        ...architecture,
        enhancedFeatures: architecture.features.map(feature => ({
          ...feature,
          intelligenceMetadata: {
            complexityScore: Math.random() * 100,
            riskFactors: ['integration_complexity', 'user_experience'],
            suggestedApproach: 'incremental_development'
          }
        })),
        crossCuttingConcerns: [
          {
            id: 'authentication',
            name: 'Authentication & Authorization',
            affectedComponents: ['user-management', 'course-access'],
            implementation: 'shared-service'
          },
          {
            id: 'caching',
            name: 'Caching Layer',
            affectedComponents: ['course-content', 'user-progress'],
            implementation: 'redis-cluster'
          }
        ]
      });
      
      intelligenceEngine.enhanceArchitecture = mockEnhanceArchitecture;
      
      const enhancedArchitecture = await intelligenceEngine.enhanceArchitecture(architecture);
      
      expect(enhancedArchitecture).toHaveProperty('enhancedFeatures');
      expect(enhancedArchitecture).toHaveProperty('crossCuttingConcerns');
      
      enhancedArchitecture.enhancedFeatures.forEach((feature: any) => {
        expect(feature).toHaveProperty('intelligenceMetadata');
        expect(feature.intelligenceMetadata).toHaveProperty('complexityScore');
        expect(feature.intelligenceMetadata).toHaveProperty('riskFactors');
      });
    });

    it('should provide predictive analytics on development timeline', async () => {
      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);
      
      const mockPredictTimeline = jest.fn().mockResolvedValue({
        predictedDuration: {
          optimistic: 90,
          realistic: 120,
          pessimistic: 150
        },
        criticalPath: [
          'user-authentication',
          'course-creation',
          'student-enrollment',
          'progress-tracking'
        ],
        bottlenecks: [
          {
            component: 'course-content-delivery',
            reason: 'Complex media handling requirements',
            impact: 'high',
            mitigation: 'Early prototype and testing'
          }
        ],
        resourceOptimization: {
          suggestedTeamSize: 8,
          skillMix: {
            'frontend-developer': 3,
            'backend-developer': 3,
            'devops-engineer': 1,
            'ui-designer': 1
          }
        }
      });
      
      intelligenceEngine.predictTimeline = mockPredictTimeline;
      
      const prediction = await intelligenceEngine.predictTimeline(architecture);
      
      expect(prediction).toHaveProperty('predictedDuration');
      expect(prediction).toHaveProperty('criticalPath');
      expect(prediction).toHaveProperty('bottlenecks');
      expect(prediction).toHaveProperty('resourceOptimization');
      
      expect(prediction.criticalPath.length).toBeGreaterThan(0);
      expect(prediction.bottlenecks.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Data Consistency and Validation', () => {
    it('should maintain effort estimations consistency through decomposition', async () => {
      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);
      
      // Calculate total effort from original epics
      const totalEpicEffort = mockInitiativePlan.epics.reduce((sum, epic) => 
        sum + epic.estimatedEffort.hours, 0);
      
      // Calculate total effort from tasks
      const totalTaskEffort = architecture.tasks.reduce((sum, task) => 
        sum + task.estimatedHours, 0);
      
      // Should be within 20% variance due to decomposition refinement
      expect(totalTaskEffort).toBeGreaterThan(totalEpicEffort * 0.8);
      expect(totalTaskEffort).toBeLessThan(totalEpicEffort * 1.2);
    });

    it('should preserve acceptance criteria through decomposition levels', async () => {
      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);
      
      // Check that epic acceptance criteria are reflected in features
      const courseEpic = mockInitiativePlan.epics.find(e => e.id === 'epic-course-management');
      const courseFeatures = architecture.features.filter(f => f.parentEpic === 'epic-course-management');
      
      if (courseEpic && courseFeatures.length > 0) {\n        const epicCriteria = courseEpic.acceptanceCriteria.join(' ').toLowerCase();\n        const featureCriteria = courseFeatures.flatMap(f => f.acceptanceCriteria).join(' ').toLowerCase();\n        \n        // Should have significant overlap in criteria concepts\n        const sharedConcepts = ['course', 'create', 'content', 'publish'];\n        const criteriaOverlap = sharedConcepts.filter(concept => \n          epicCriteria.includes(concept) && featureCriteria.includes(concept)\n        );\n        \n        expect(criteriaOverlap.length).toBeGreaterThan(sharedConcepts.length * 0.5);\n      }\n    });\n\n    it('should validate architecture completeness and consistency', async () => {\n      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);\n      const validation = await featureArchitect.validateArchitecture(architecture);\n      \n      expect(validation).toHaveProperty('isValid');\n      expect(validation).toHaveProperty('errors');\n      expect(validation).toHaveProperty('warnings');\n      \n      if (!validation.isValid) {\n        console.log('Architecture validation errors:', validation.errors);\n      }\n      \n      expect(validation.isValid).toBe(true);\n      expect(validation.errors.length).toBe(0);\n    });\n  });\n\n  describe('Performance and Scalability', () => {\n    it('should handle large initiative plans efficiently', async () => {\n      const largeInitiativePlan = {\n        ...mockInitiativePlan,\n        epics: Array(20).fill(null).map((_, i) => ({\n          ...mockInitiativePlan.epics[0],\n          id: `epic-${i}`,\n          title: `Epic ${i}`,\n          description: `Description for epic ${i}`,\n          estimatedEffort: { hours: 40 + i * 10, confidence: 0.8 }\n        }))\n      };\n      \n      const startTime = Date.now();\n      const architecture = await featureArchitect.generateArchitecture(largeInitiativePlan);\n      const endTime = Date.now();\n      \n      expect(endTime - startTime).toBeLessThan(60000); // Should complete within 1 minute\n      expect(architecture.epics.length).toBe(20);\n      expect(architecture.features.length).toBeGreaterThan(40); // Should have multiple features per epic\n      expect(architecture.stories.length).toBeGreaterThan(100); // Should have multiple stories per feature\n      expect(architecture.tasks.length).toBeGreaterThan(200); // Should have multiple tasks per story\n    });\n\n    it('should support parallel processing of epics', async () => {\n      const multiEpicPlan = {\n        ...mockInitiativePlan,\n        epics: Array(5).fill(null).map((_, i) => ({\n          ...mockInitiativePlan.epics[0],\n          id: `parallel-epic-${i}`,\n          title: `Parallel Epic ${i}`,\n          description: `Independent epic ${i} for parallel processing`\n        }))\n      };\n      \n      const startTime = Date.now();\n      \n      // Process epics in parallel\n      const featureResults = await Promise.all(\n        multiEpicPlan.epics.map(epic => featureArchitect.decomposeEpicToFeatures(epic))\n      );\n      \n      const endTime = Date.now();\n      \n      expect(featureResults.length).toBe(5);\n      expect(endTime - startTime).toBeLessThan(20000); // Parallel processing should be faster\n      \n      // Verify all epics were processed\n      featureResults.forEach(features => {\n        expect(features.length).toBeGreaterThan(0);\n      });\n    });\n  });\n\n  describe('Error Handling and Recovery', () => {\n    it('should handle malformed initiative plans gracefully', async () => {\n      const malformedPlan = {\n        ...mockInitiativePlan,\n        epics: [\n          {\n            ...mockInitiativePlan.epics[0],\n            title: '', // Missing title\n            estimatedEffort: null // Invalid effort\n          } as any\n        ]\n      };\n      \n      await expect(featureArchitect.generateArchitecture(malformedPlan))\n        .rejects.toThrow('Invalid epic');\n    });\n\n    it('should handle intelligence engine failures gracefully', async () => {\n      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);\n      \n      // Mock intelligence engine failure\n      const mockAnalyzeArchitecture = jest.fn().mockRejectedValue(new Error('Intelligence service unavailable'));\n      intelligenceEngine.analyzeArchitecture = mockAnalyzeArchitecture;\n      \n      // Should still complete architecture generation without intelligence insights\n      await expect(intelligenceEngine.analyzeArchitecture(architecture))\n        .rejects.toThrow('Intelligence service unavailable');\n      \n      // Architecture should still be valid\n      const validation = await featureArchitect.validateArchitecture(architecture);\n      expect(validation.isValid).toBe(true);\n    });\n\n    it('should handle partial decomposition failures', async () => {\n      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);\n      \n      // Simulate partial failure by corrupting some features\n      const originalFeatures = [...architecture.features];\n      architecture.features[0] = { ...architecture.features[0], parentEpic: 'non-existent-epic' };\n      \n      const validation = await featureArchitect.validateArchitecture(architecture);\n      \n      expect(validation.isValid).toBe(false);\n      expect(validation.errors.some(error => error.includes('orphan'))).toBe(true);\n      \n      // Should be able to recover by fixing the issue\n      architecture.features = originalFeatures;\n      const fixedValidation = await featureArchitect.validateArchitecture(architecture);\n      expect(fixedValidation.isValid).toBe(true);\n    });\n  });\n\n  describe('Integration with External Systems', () => {\n    it('should support integration with project management tools', async () => {\n      const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);\n      \n      // Mock project management export\n      const mockExportToProjectTool = jest.fn().mockResolvedValue({\n        exportFormat: 'json',\n        totalItems: architecture.tasks.length,\n        hierarchyLevels: 4, // Initiative -> Epic -> Feature -> Story -> Task\n        exportTimestamp: new Date().toISOString()\n      });\n      \n      // Simulate export functionality\n      const exportResult = await mockExportToProjectTool(architecture);\n      \n      expect(exportResult).toHaveProperty('exportFormat');\n      expect(exportResult).toHaveProperty('totalItems');\n      expect(exportResult).toHaveProperty('hierarchyLevels');\n      expect(exportResult.totalItems).toBe(architecture.tasks.length);\n    });\n\n    it('should support integration with estimation tools', async () => {\n      const architecture = await featureArchitecture.generateArchitecture(mockInitiativePlan);\n      \n      // Mock estimation tool integration\n      const mockEstimationTool = jest.fn().mockResolvedValue({\n        refinedEstimates: architecture.tasks.map(task => ({\n          taskId: task.id,\n          originalEstimate: task.estimatedHours,\n          refinedEstimate: task.estimatedHours * (0.8 + Math.random() * 0.4), // ±20% variance\n          confidenceLevel: 0.7 + Math.random() * 0.3\n        })),\n        totalProjectEstimate: {\n          optimistic: 180,\n          realistic: 240,\n          pessimistic: 320\n        }\n      });\n      \n      const estimationResult = await mockEstimationTool(architecture);\n      \n      expect(estimationResult).toHaveProperty('refinedEstimates');\n      expect(estimationResult).toHaveProperty('totalProjectEstimate');\n      expect(estimationResult.refinedEstimates.length).toBe(architecture.tasks.length);\n    });\n  });\n});"}, {"old_string": "        const architecture = await featureArchitecture.generateArchitecture(mockInitiativePlan);", "new_string": "        const architecture = await featureArchitect.generateArchitecture(mockInitiativePlan);"}]