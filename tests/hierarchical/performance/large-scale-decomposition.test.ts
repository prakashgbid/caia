import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { IdeaAnalyzer } from '../../../src/hierarchical/stream1/idea-analyzer';
import { InitiativePlanner } from '../../../src/hierarchical/stream2/initiative-planner';
import { FeatureArchitect } from '../../../src/hierarchical/stream3/feature-architect';
import { QualityGateController } from '../../../src/hierarchical/stream4/quality-gate-controller';
import { Idea, Architecture } from '../../../src/hierarchical/types';

describe('Large Scale Decomposition Performance Tests', () => {
  let ideaAnalyzer: IdeaAnalyzer;
  let initiativePlanner: InitiativePlanner;
  let featureArchitect: FeatureArchitect;
  let qualityGateController: QualityGateController;

  // Performance thresholds
  const PERFORMANCE_THRESHOLDS = {
    IDEA_ANALYSIS: 5000,      // 5 seconds
    INITIATIVE_PLANNING: 10000, // 10 seconds
    ARCHITECTURE_GENERATION: 30000, // 30 seconds
    QUALITY_VALIDATION: 15000, // 15 seconds
    MEMORY_LIMIT: 512 * 1024 * 1024, // 512MB
    MAX_HEAP_GROWTH: 100 * 1024 * 1024 // 100MB heap growth
  };

  beforeEach(() => {
    ideaAnalyzer = new IdeaAnalyzer();
    initiativePlanner = new InitiativePlanner();
    featureArchitect = new FeatureArchitect();
    qualityGateController = new QualityGateController();
  });

  describe('Large Scale Idea Processing', () => {
    it('should process 1000+ ideas efficiently', async () => {
      const ideas: Idea[] = Array(1000).fill(null).map((_, i) => ({
        id: `perf-idea-${i}`,
        title: `Performance Test Idea ${i}`,
        description: `This is performance test idea ${i}. It includes multiple requirements such as user authentication, data processing, API integration, frontend development, database design, testing, deployment, monitoring, and documentation. The complexity varies based on the index to simulate real-world scenarios.`,
        complexity: ['simple', 'medium', 'complex'][i % 3] as any,
        priority: ['low', 'medium', 'high', 'critical'][i % 4] as any,
        tags: [`tag-${i % 10}`, `category-${i % 5}`, `type-${i % 3}`],
        metadata: {
          source: 'performance-test',
          timestamp: Date.now(),
          batchId: `batch-${Math.floor(i / 100)}`
        }
      }));

      const startTime = Date.now();
      const initialMemory = process.memoryUsage();

      // Process ideas in parallel batches
      const batchSize = 50;
      const results = [];

      for (let i = 0; i < ideas.length; i += batchSize) {
        const batch = ideas.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(idea => ideaAnalyzer.generateAnalysisReport(idea))
        );
        results.push(...batchResults);

        // Optional memory check every 200 ideas
        if ((i + batchSize) % 200 === 0) {
          const currentMemory = process.memoryUsage();
          const memoryGrowth = currentMemory.heapUsed - initialMemory.heapUsed;
          
          console.log(`Processed ${i + batchSize} ideas. Memory growth: ${Math.round(memoryGrowth / 1024 / 1024)}MB`);
          
          // Ensure memory growth is reasonable
          expect(memoryGrowth).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_HEAP_GROWTH);
        }
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;
      const finalMemory = process.memoryUsage();

      // Performance assertions
      expect(processingTime).toBeLessThan(PERFORMANCE_THRESHOLDS.IDEA_ANALYSIS * 20); // 20x threshold for 1000 items
      expect(results.length).toBe(1000);
      expect(finalMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.MEMORY_LIMIT);

      // Quality assertions
      const validResults = results.filter(r => r.validation.isValid);
      expect(validResults.length / results.length).toBeGreaterThan(0.95); // 95% success rate

      console.log(`\n--- Large Scale Idea Processing Performance ---`);
      console.log(`Processed: ${results.length} ideas`);
      console.log(`Time: ${processingTime}ms (${Math.round(processingTime / results.length)}ms per idea)`);
      console.log(`Memory: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`);
      console.log(`Success Rate: ${Math.round(validResults.length / results.length * 100)}%`);
    }, 300000); // 5 minute timeout

    it('should handle concurrent idea analysis without race conditions', async () => {
      const concurrentIdeas: Idea[] = Array(100).fill(null).map((_, i) => ({
        id: `concurrent-idea-${i}`,
        title: `Concurrent Idea ${i}`,
        description: `Concurrent processing test idea ${i} with shared resources and potential race conditions`,
        complexity: 'medium',
        priority: 'high',
        tags: ['concurrent', 'performance'],
        metadata: {
          source: 'concurrency-test',
          timestamp: Date.now() + i
        }
      }));

      const startTime = Date.now();

      // Launch all analyses concurrently
      const results = await Promise.all(
        concurrentIdeas.map(idea => ideaAnalyzer.generateAnalysisReport(idea))
      );

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Verify no race conditions
      const uniqueIds = new Set(results.map(r => r.idea.id));
      expect(uniqueIds.size).toBe(100);

      // Verify performance benefit of concurrency
      expect(processingTime).toBeLessThan(PERFORMANCE_THRESHOLDS.IDEA_ANALYSIS * 10); // Should be much faster than sequential

      console.log(`\n--- Concurrent Analysis Performance ---`);
      console.log(`Processed: ${results.length} ideas concurrently`);
      console.log(`Time: ${processingTime}ms`);
      console.log(`Avg per idea: ${Math.round(processingTime / results.length)}ms`);
    }, 120000); // 2 minute timeout
  });

  describe('Initiative Planning Scalability', () => {
    it('should handle complex initiatives with 50+ epics', async () => {
      const complexIdea: Idea = {
        id: 'complex-enterprise-platform',
        title: 'Enterprise Platform Ecosystem',
        description: `Build a comprehensive enterprise platform ecosystem including:
        - Microservices architecture with 20+ services
        - Multi-tenant SaaS platform
        - Real-time analytics and reporting
        - AI/ML recommendation engine
        - Advanced security and compliance
        - Global CDN and edge computing
        - Mobile applications (iOS/Android)
        - Web applications (React/Angular)
        - API management and gateway
        - Message queuing and event streaming
        - Data lake and warehouse
        - Business intelligence dashboard
        - Customer support system
        - Billing and subscription management
        - Integration with 10+ third-party systems
        - Automated testing and CI/CD
        - Monitoring and observability
        - Disaster recovery and backup
        - Documentation and training portal
        - Performance optimization`,
        complexity: 'complex',
        priority: 'critical',
        tags: ['enterprise', 'platform', 'microservices', 'saas', 'ai', 'mobile', 'web'],
        metadata: {
          source: 'enterprise-initiative',
          timestamp: Date.now(),
          estimatedTeamSize: 50
        }
      };

      const startTime = Date.now();
      const initialMemory = process.memoryUsage();

      // Analyze the complex idea
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(complexIdea);
      expect(analysisResult.validation.isValid).toBe(true);

      // Create initiative plan
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);

      const planningTime = Date.now() - startTime;
      const memoryUsage = process.memoryUsage();

      // Performance assertions
      expect(planningTime).toBeLessThan(PERFORMANCE_THRESHOLDS.INITIATIVE_PLANNING * 5);
      expect(memoryUsage.heapUsed - initialMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_HEAP_GROWTH);

      // Scale assertions
      expect(initiativePlan.epics.length).toBeGreaterThan(10);
      expect(initiativePlan.epics.length).toBeLessThan(100); // Reasonable upper bound

      // Quality assertions
      const validation = await initiativePlanner.validatePlan(initiativePlan);
      expect(validation.isValid).toBe(true);

      console.log(`\n--- Complex Initiative Planning Performance ---`);
      console.log(`Epics generated: ${initiativePlan.epics.length}`);
      console.log(`Planning time: ${planningTime}ms`);
      console.log(`Memory used: ${Math.round((memoryUsage.heapUsed - initialMemory.heapUsed) / 1024 / 1024)}MB`);
      console.log(`Timeline span: ${Math.round((initiativePlan.timeline.endDate.getTime() - initiativePlan.timeline.startDate.getTime()) / (24 * 60 * 60 * 1000))} days`);
    }, 180000); // 3 minute timeout

    it('should efficiently prioritize and schedule 100+ epics', async () => {
      // Create a large set of epics with various dependencies
      const epics = Array(100).fill(null).map((_, i) => ({
        id: `epic-${i}`,
        title: `Epic ${i}`,
        description: `Description for epic ${i}`,
        parentInitiative: 'large-initiative',
        priority: ['low', 'medium', 'high', 'critical'][i % 4] as any,
        status: 'planning' as const,
        estimatedEffort: { hours: 20 + (i % 80), confidence: 0.7 + (i % 3) * 0.1 },
        acceptanceCriteria: [`Criterion 1 for epic ${i}`, `Criterion 2 for epic ${i}`],
        dependencies: i > 0 ? [`epic-${i - 1}`] : [], // Sequential dependencies
        tags: [`category-${i % 10}`],
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      const startTime = Date.now();

      // Test prioritization performance
      const mockInitiative = {
        id: 'large-initiative',
        title: 'Large Initiative',
        description: 'Initiative with many epics'
      } as any;

      const prioritizedEpics = await initiativePlanner.prioritizeEpics(epics, mockInitiative);
      
      const prioritizationTime = Date.now() - startTime;

      // Performance assertions
      expect(prioritizationTime).toBeLessThan(PERFORMANCE_THRESHOLDS.INITIATIVE_PLANNING);
      expect(prioritizedEpics.length).toBe(100);

      // Verify dependency order is maintained
      for (let i = 1; i < prioritizedEpics.length; i++) {
        const epic = prioritizedEpics[i];
        if (epic.dependencies && epic.dependencies.length > 0) {
          const dependencyIndices = epic.dependencies.map(depId => 
            prioritizedEpics.findIndex(e => e.id === depId)
          );
          
          // Dependencies should come before the epic
          dependencyIndices.forEach(depIndex => {
            expect(depIndex).toBeLessThan(i);
          });
        }
      }

      console.log(`\n--- Epic Prioritization Performance ---`);
      console.log(`Epics prioritized: ${prioritizedEpics.length}`);
      console.log(`Prioritization time: ${prioritizationTime}ms`);
      console.log(`Avg per epic: ${Math.round(prioritizationTime / prioritizedEpics.length)}ms`);
    });
  });

  describe('Architecture Generation Performance', () => {
    it('should generate comprehensive architecture for large initiatives', async () => {
      // Create a large initiative plan
      const largeInitiativePlan = {
        initiative: {
          id: 'large-architecture-test',
          title: 'Large Architecture Test Initiative',
          description: 'Testing architecture generation performance',
          status: 'planning' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        epics: Array(30).fill(null).map((_, i) => ({
          id: `arch-epic-${i}`,
          title: `Architecture Epic ${i}`,
          description: `Epic ${i} for architecture generation testing with multiple features and complex requirements`,
          parentInitiative: 'large-architecture-test',
          priority: ['low', 'medium', 'high'][i % 3] as any,
          status: 'planning' as const,
          estimatedEffort: { hours: 40 + (i % 40), confidence: 0.8 },
          acceptanceCriteria: Array(5).fill(null).map((_, j) => `Acceptance criterion ${j + 1} for epic ${i}`),
          tags: [`domain-${i % 5}`, `type-${i % 3}`],
          createdAt: new Date(),
          updatedAt: new Date()
        })),
        timeline: {
          startDate: new Date(),
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          milestones: [],
          phases: []
        },
        riskAssessment: {
          risks: [],
          mitigationStrategies: [],
          overallRiskLevel: 'medium' as const
        },
        resourceRequirements: {
          roles: ['developer', 'architect'],
          skills: ['javascript', 'database'],
          tools: ['docker', 'kubernetes'],
          budget: { amount: 1000000, currency: 'USD' }
        },
        successMetrics: []
      };

      const startTime = Date.now();
      const initialMemory = process.memoryUsage();

      const architecture = await featureArchitect.generateArchitecture(largeInitiativePlan);

      const generationTime = Date.now() - startTime;
      const finalMemory = process.memoryUsage();
      const memoryUsed = finalMemory.heapUsed - initialMemory.heapUsed;

      // Performance assertions
      expect(generationTime).toBeLessThan(PERFORMANCE_THRESHOLDS.ARCHITECTURE_GENERATION * 2);
      expect(memoryUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_HEAP_GROWTH * 2);

      // Scale assertions
      expect(architecture.epics.length).toBe(30);
      expect(architecture.features.length).toBeGreaterThan(60); // At least 2 features per epic
      expect(architecture.stories.length).toBeGreaterThan(150); // At least 2.5 stories per feature
      expect(architecture.tasks.length).toBeGreaterThan(300); // At least 2 tasks per story

      // Validate architecture integrity
      const validation = await featureArchitect.validateArchitecture(architecture);
      expect(validation.isValid).toBe(true);

      console.log(`\n--- Large Architecture Generation Performance ---`);
      console.log(`Epics: ${architecture.epics.length}`);
      console.log(`Features: ${architecture.features.length}`);
      console.log(`Stories: ${architecture.stories.length}`);
      console.log(`Tasks: ${architecture.tasks.length}`);
      console.log(`Generation time: ${generationTime}ms`);
      console.log(`Memory used: ${Math.round(memoryUsed / 1024 / 1024)}MB`);
      console.log(`Total items: ${architecture.epics.length + architecture.features.length + architecture.stories.length + architecture.tasks.length}`);
    }, 240000); // 4 minute timeout

    it('should handle parallel feature decomposition efficiently', async () => {
      const parallelEpics = Array(20).fill(null).map((_, i) => ({
        id: `parallel-epic-${i}`,
        title: `Parallel Epic ${i}`,
        description: `Epic ${i} for parallel decomposition testing`,
        parentInitiative: 'parallel-test',
        priority: 'medium' as any,
        status: 'planning' as const,
        estimatedEffort: { hours: 30 + i, confidence: 0.8 },
        acceptanceCriteria: [`Criterion for parallel epic ${i}`],
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      const startTime = Date.now();

      // Decompose all epics in parallel
      const featureResults = await Promise.all(
        parallelEpics.map(epic => featureArchitect.decomposeEpicToFeatures(epic))
      );

      const parallelTime = Date.now() - startTime;

      // Compare with sequential processing time estimate
      const avgTimePerEpic = parallelTime / parallelEpics.length;
      const estimatedSequentialTime = avgTimePerEpic * parallelEpics.length;

      expect(parallelTime).toBeLessThan(estimatedSequentialTime * 0.8); // Parallel should be at least 20% faster
      expect(featureResults.length).toBe(20);

      const totalFeatures = featureResults.reduce((sum, features) => sum + features.length, 0);
      expect(totalFeatures).toBeGreaterThan(40); // At least 2 features per epic

      console.log(`\n--- Parallel Feature Decomposition Performance ---`);
      console.log(`Epics processed: ${parallelEpics.length}`);
      console.log(`Total features: ${totalFeatures}`);
      console.log(`Parallel time: ${parallelTime}ms`);
      console.log(`Avg per epic: ${Math.round(avgTimePerEpic)}ms`);
    });
  });

  describe('Quality Gate Performance', () => {
    it('should validate large architectures within time constraints', async () => {
      // Create a large architecture for validation
      const largeArchitecture: Architecture = {
        initiative: {
          id: 'quality-perf-test',
          title: 'Quality Performance Test',
          description: 'Large architecture for quality gate testing',
          status: 'planning',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        epics: Array(25).fill(null).map((_, i) => ({
          id: `quality-epic-${i}`,
          title: `Quality Epic ${i}`,
          description: `Epic ${i} description`,
          parentInitiative: 'quality-perf-test',
          priority: 'medium' as any,
          status: 'planning' as const,
          estimatedEffort: { hours: 32, confidence: 0.8 },
          acceptanceCriteria: [`Criterion ${i}`],
          createdAt: new Date(),
          updatedAt: new Date()
        })),
        features: Array(100).fill(null).map((_, i) => ({
          id: `quality-feature-${i}`,
          title: `Quality Feature ${i}`,
          description: `Feature ${i} description`,
          parentEpic: `quality-epic-${i % 25}`,
          priority: 'medium' as any,
          status: 'planning' as const,
          estimatedEffort: { hours: 8, confidence: 0.8 },
          acceptanceCriteria: [`Feature criterion ${i}`],
          createdAt: new Date(),
          updatedAt: new Date()
        })),
        stories: Array(400).fill(null).map((_, i) => ({
          id: `quality-story-${i}`,
          title: `Quality Story ${i}`,
          description: `Story ${i} description`,
          parentFeature: `quality-feature-${i % 100}`,
          asA: 'user',
          iWant: `functionality ${i}`,
          soThat: `benefit ${i}`,
          priority: 'medium' as any,
          status: 'planning' as const,
          estimatedEffort: { hours: 2, confidence: 0.9 },
          storyPoints: 3,
          acceptanceCriteria: [`Story criterion ${i}`],
          createdAt: new Date(),
          updatedAt: new Date()
        })),
        tasks: Array(1200).fill(null).map((_, i) => ({
          id: `quality-task-${i}`,
          title: `Quality Task ${i}`,
          description: `Task ${i} description`,
          parentStory: `quality-story-${i % 400}`,
          type: ['development', 'testing', 'documentation'][i % 3] as any,
          priority: 'medium' as any,
          status: 'planning' as const,
          estimatedHours: 1,
          skillRequired: 'javascript',
          createdAt: new Date(),
          updatedAt: new Date()
        })),
        dependencies: { features: [], stories: [], tasks: [] },
        estimations: {
          totalStoryPoints: 1200,
          totalHours: 1200,
          totalFeatures: 100,
          totalStories: 400,
          totalTasks: 1200
        },
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          version: '1.0.0'
        }
      };

      const qualityGates = qualityGateController.getDefaultQualityGates();
      
      const startTime = Date.now();
      const initialMemory = process.memoryUsage();

      const validationResult = await qualityGateController.validateArchitecture(largeArchitecture, qualityGates);

      const validationTime = Date.now() - startTime;
      const finalMemory = process.memoryUsage();
      const memoryUsed = finalMemory.heapUsed - initialMemory.heapUsed;

      // Performance assertions
      expect(validationTime).toBeLessThan(PERFORMANCE_THRESHOLDS.QUALITY_VALIDATION * 3);
      expect(memoryUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.MAX_HEAP_GROWTH);

      // Quality assertions
      expect(validationResult).toHaveProperty('overallScore');
      expect(validationResult.gateResults.length).toBe(qualityGates.filter(g => g.enabled).length);

      const totalItemsValidated = 
        largeArchitecture.epics.length + 
        largeArchitecture.features.length + 
        largeArchitecture.stories.length + 
        largeArchitecture.tasks.length;

      console.log(`\n--- Quality Gate Performance ---`);
      console.log(`Items validated: ${totalItemsValidated}`);
      console.log(`Quality gates: ${validationResult.gateResults.length}`);
      console.log(`Validation time: ${validationTime}ms`);
      console.log(`Overall score: ${validationResult.overallScore}`);
      console.log(`Memory used: ${Math.round(memoryUsed / 1024 / 1024)}MB`);
      console.log(`Validation rate: ${Math.round(totalItemsValidated / (validationTime / 1000))} items/second`);
    }, 180000); // 3 minute timeout
  });

  describe('Memory Usage and Leak Detection', () => {
    it('should maintain stable memory usage during continuous processing', async () => {
      const memorySnapshots: number[] = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const ideas = Array(50).fill(null).map((_, j) => ({
          id: `memory-test-${i}-${j}`,
          title: `Memory Test Idea ${i}-${j}`,
          description: `Memory leak test idea ${i}-${j}`,
          complexity: 'medium' as any,
          priority: 'medium' as any,
          tags: ['memory-test'],
          metadata: { source: 'memory-test', timestamp: Date.now() }
        }));

        // Process batch
        await Promise.all(ideas.map(idea => ideaAnalyzer.generateAnalysisReport(idea)));

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        // Take memory snapshot
        const memoryUsage = process.memoryUsage();
        memorySnapshots.push(memoryUsage.heapUsed);

        console.log(`Iteration ${i + 1}: Heap used ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
      }

      // Analyze memory growth
      const initialMemory = memorySnapshots[0];
      const finalMemory = memorySnapshots[memorySnapshots.length - 1];
      const memoryGrowth = finalMemory - initialMemory;
      const memoryGrowthPercent = (memoryGrowth / initialMemory) * 100;

      // Memory should not grow significantly over iterations
      expect(memoryGrowthPercent).toBeLessThan(50); // Less than 50% growth

      console.log(`\n--- Memory Usage Analysis ---`);
      console.log(`Initial memory: ${Math.round(initialMemory / 1024 / 1024)}MB`);
      console.log(`Final memory: ${Math.round(finalMemory / 1024 / 1024)}MB`);
      console.log(`Memory growth: ${Math.round(memoryGrowth / 1024 / 1024)}MB (${Math.round(memoryGrowthPercent)}%)`);
    }, 300000); // 5 minute timeout
  });

  describe('Stress Testing', () => {
    it('should handle system stress without degradation', async () => {
      const stressConcurrency = 20;
      const itemsPerConcurrentProcess = 25;
      
      const startTime = Date.now();
      const initialMemory = process.memoryUsage();

      // Create concurrent stress load
      const stressPromises = Array(stressConcurrency).fill(null).map(async (_, i) => {
        const ideas = Array(itemsPerConcurrentProcess).fill(null).map((_, j) => ({
          id: `stress-${i}-${j}`,
          title: `Stress Test ${i}-${j}`,
          description: `Concurrent stress test idea ${i}-${j} with complex requirements and multiple dependencies`,
          complexity: 'complex' as any,
          priority: 'high' as any,
          tags: ['stress-test', `group-${i}`],
          metadata: { source: 'stress-test', timestamp: Date.now() }
        }));

        const results = await Promise.all(
          ideas.map(idea => ideaAnalyzer.generateAnalysisReport(idea))
        );

        return results;
      });

      const allResults = await Promise.all(stressPromises);
      const flatResults = allResults.flat();

      const endTime = Date.now();
      const finalMemory = process.memoryUsage();

      const totalProcessingTime = endTime - startTime;
      const totalItems = flatResults.length;
      const avgTimePerItem = totalProcessingTime / totalItems;
      const memoryUsed = finalMemory.heapUsed - initialMemory.heapUsed;

      // Performance under stress
      expect(totalProcessingTime).toBeLessThan(PERFORMANCE_THRESHOLDS.IDEA_ANALYSIS * 30);
      expect(memoryUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.MEMORY_LIMIT);
      expect(avgTimePerItem).toBeLessThan(1000); // Less than 1 second per item under stress

      // Quality under stress
      const validResults = flatResults.filter(r => r.validation.isValid);
      expect(validResults.length / flatResults.length).toBeGreaterThan(0.9); // 90% success rate under stress

      console.log(`\n--- Stress Test Results ---`);
      console.log(`Concurrent processes: ${stressConcurrency}`);
      console.log(`Items per process: ${itemsPerConcurrentProcess}`);
      console.log(`Total items: ${totalItems}`);
      console.log(`Total time: ${totalProcessingTime}ms`);
      console.log(`Avg per item: ${Math.round(avgTimePerItem)}ms`);
      console.log(`Memory used: ${Math.round(memoryUsed / 1024 / 1024)}MB`);
      console.log(`Success rate: ${Math.round(validResults.length / flatResults.length * 100)}%`);
    }, 600000); // 10 minute timeout
  });
});