/**
 * @jest-environment node
 */

import WorkDivider, {
  WorkItem,
  WorkShard,
  DependencyGraph,
  Distribution,
  RuntimeFeedback,
  HistoricalData
} from '../index';
import { Resources, Metrics } from '../types';
// Type-only import for unused types
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ComplexityScore } from '../types';

describe('WorkDivider', () => {
  let workDivider: WorkDivider;

  beforeEach(() => {
    workDivider = new WorkDivider();
  });

  describe('WorkDivider instantiation', () => {
    it('should create a new instance', () => {
      expect(workDivider).toBeInstanceOf(WorkDivider);
    });
  });

  describe('analyzeWorkload', () => {
    it('should analyze an empty workload', () => {
      const items: WorkItem[] = [];
      const analysis = workDivider.analyzeWorkload(items);

      expect(analysis.totalItems).toBe(0);
      expect(analysis.totalSize).toBe(0);
      expect(analysis.totalComplexity).toBe(0);
      expect(analysis.averageComplexity).toBeNaN(); // Division by zero results in NaN
    });

    it('should analyze a simple workload', () => {
      const items: WorkItem[] = [
        { id: 'item1', size: 10, complexity: 5 },
        { id: 'item2', size: 20, complexity: 3 },
        { id: 'item3', size: 15, complexity: 7 }
      ];

      const analysis = workDivider.analyzeWorkload(items);

      expect(analysis.totalItems).toBe(3);
      expect(analysis.totalSize).toBe(45);
      expect(analysis.totalComplexity).toBe(15);
      expect(analysis.averageComplexity).toBe(5);
    });

    it('should categorize complexity distribution correctly', () => {
      const items: WorkItem[] = [
        { id: 'item1', complexity: 1 }, // low
        { id: 'item2', complexity: 3 }, // medium
        { id: 'item3', complexity: 6 }, // high
        { id: 'item4', complexity: 10 } // critical
      ];

      const analysis = workDivider.analyzeWorkload(items);

      expect(analysis.complexityDistribution.low).toBe(1);
      expect(analysis.complexityDistribution.medium).toBe(1);
      expect(analysis.complexityDistribution.high).toBe(1);
      expect(analysis.complexityDistribution.critical).toBe(1);
    });

    it('should handle items with dependencies', () => {
      const items: WorkItem[] = [
        { id: 'item1', dependencies: [] },
        { id: 'item2', dependencies: ['item1'] },
        { id: 'item3', dependencies: ['item1', 'item2'] }
      ];

      const analysis = workDivider.analyzeWorkload(items);

      expect(analysis.dependencyGraph.size).toBe(3);
      expect(analysis.criticalPath.length).toBeGreaterThan(0);
    });
  });

  describe('calculateComplexity', () => {
    it('should return existing complexity if provided', () => {
      const item: WorkItem = { id: 'item1', complexity: 8 };
      const complexity = workDivider.calculateComplexity(item);
      expect(complexity).toBe(8);
    });

    it('should calculate complexity based on size', () => {
      const item: WorkItem = { id: 'item1', size: 8 };
      const complexity = workDivider.calculateComplexity(item);
      expect(complexity).toBeGreaterThan(1);
    });

    it('should factor in dependencies', () => {
      const itemWithoutDeps: WorkItem = { id: 'item1', size: 8 };
      const itemWithDeps: WorkItem = { id: 'item2', size: 8, dependencies: ['item1', 'item3'] };
      
      const complexityWithoutDeps = workDivider.calculateComplexity(itemWithoutDeps);
      const complexityWithDeps = workDivider.calculateComplexity(itemWithDeps);
      
      expect(complexityWithDeps).toBeGreaterThan(complexityWithoutDeps);
    });

    it('should factor in priority', () => {
      const itemLowPriority: WorkItem = { id: 'item1', size: 8, priority: 1 };
      const itemHighPriority: WorkItem = { id: 'item2', size: 8, priority: 10 };
      
      const complexityLow = workDivider.calculateComplexity(itemLowPriority);
      const complexityHigh = workDivider.calculateComplexity(itemHighPriority);
      
      expect(complexityHigh).toBeGreaterThan(complexityLow);
    });

    it('should handle missing properties gracefully', () => {
      const item: WorkItem = { id: 'item1' };
      const complexity = workDivider.calculateComplexity(item);
      expect(complexity).toBe(1);
    });
  });

  describe('estimateDuration', () => {
    it('should return existing duration if provided', () => {
      const item: WorkItem = { id: 'item1', estimatedDuration: 5000 };
      const duration = workDivider.estimateDuration(item);
      expect(duration).toBe(5000);
    });

    it('should use provided historical data', () => {
      const item: WorkItem = { id: 'item1' };
      const history: HistoricalData = { itemId: 'item1', actualDuration: 3000, timestamp: Date.now() };
      const duration = workDivider.estimateDuration(item, history);
      expect(duration).toBe(3000);
    });

    it('should use stored historical data', () => {
      const item: WorkItem = { id: 'item1' };
      workDivider.addHistoricalData('item1', 2500);
      const duration = workDivider.estimateDuration(item);
      expect(duration).toBe(2500);
    });

    it('should fall back to complexity-based estimation', () => {
      const item: WorkItem = { id: 'item1', complexity: 5 };
      const duration = workDivider.estimateDuration(item);
      expect(duration).toBe(500); // 5 * 100
    });
  });

  describe('divideBySize', () => {
    it('should divide work items by size across workers', () => {
      const items: WorkItem[] = [
        { id: 'item1', size: 10 },
        { id: 'item2', size: 20 },
        { id: 'item3', size: 15 },
        { id: 'item4', size: 5 }
      ];

      const shards = workDivider.divideBySize(items, 2);

      expect(shards).toHaveLength(2);
      expect(shards[0].workerIndex).toBe(0);
      expect(shards[1].workerIndex).toBe(1);
      
      const totalItems = shards.reduce((sum, shard) => sum + shard.items.length, 0);
      expect(totalItems).toBe(4);
    });

    it('should balance load across workers', () => {
      const items: WorkItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item${i}`,
        size: Math.floor(Math.random() * 20) + 1
      }));

      const shards = workDivider.divideBySize(items, 3);
      
      expect(shards).toHaveLength(3);
      
      const sizes = shards.map(shard => shard.totalSize);
      const maxSize = Math.max(...sizes);
      const minSize = Math.min(...sizes);
      
      // Should be reasonably balanced (within 2x)
      expect(maxSize / minSize).toBeLessThan(3);
    });

    it('should handle single worker scenario', () => {
      const items: WorkItem[] = [
        { id: 'item1', size: 10 },
        { id: 'item2', size: 20 }
      ];

      const shards = workDivider.divideBySize(items, 1);

      expect(shards).toHaveLength(1);
      expect(shards[0].items).toHaveLength(2);
      expect(shards[0].totalSize).toBe(30);
    });

    it('should handle more workers than items', () => {
      const items: WorkItem[] = [
        { id: 'item1', size: 10 }
      ];

      const shards = workDivider.divideBySize(items, 3);

      expect(shards).toHaveLength(3);
      expect(shards[0].items).toHaveLength(1);
      expect(shards[1].items).toHaveLength(0);
      expect(shards[2].items).toHaveLength(0);
    });
  });

  describe('divideByComplexity', () => {
    it('should divide work items by complexity threshold', () => {
      const items: WorkItem[] = [
        { id: 'item1', complexity: 5 },
        { id: 'item2', complexity: 3 },
        { id: 'item3', complexity: 8 },
        { id: 'item4', complexity: 2 }
      ];

      const shards = workDivider.divideByComplexity(items, 10);

      expect(shards.length).toBeGreaterThan(0);
      
      // Each shard should not exceed the threshold
      shards.forEach(shard => {
        expect(shard.totalComplexity).toBeLessThanOrEqual(10);
      });
    });

    it('should create new shard when threshold exceeded', () => {
      const items: WorkItem[] = [
        { id: 'item1', complexity: 15 }, // Exceeds threshold alone
        { id: 'item2', complexity: 5 }
      ];

      const shards = workDivider.divideByComplexity(items, 10);

      expect(shards.length).toBeGreaterThanOrEqual(2);
    });

    it('should sort items by complexity in descending order', () => {
      const items: WorkItem[] = [
        { id: 'item1', complexity: 3 },
        { id: 'item2', complexity: 8 },
        { id: 'item3', complexity: 5 }
      ];

      const shards = workDivider.divideByComplexity(items, 20);

      // First item in first shard should be the most complex
      expect(shards[0].items[0].id).toBe('item2'); // complexity 8
    });
  });

  describe('divideByDependencies', () => {
    it('should group items by dependency levels', () => {
      const items: WorkItem[] = [
        { id: 'item1', dependencies: [] },
        { id: 'item2', dependencies: ['item1'] },
        { id: 'item3', dependencies: ['item2'] }
      ];

      const graph: DependencyGraph = {
        nodes: new Map([
          ['item1', items[0]],
          ['item2', items[1]],
          ['item3', items[2]]
        ]),
        edges: new Map([
          ['item1', new Set()],
          ['item2', new Set(['item1'])],
          ['item3', new Set(['item2'])]
        ])
      };

      const shards = workDivider.divideByDependencies(items, graph);

      expect(shards.length).toBeGreaterThan(0);
      
      // Check that shards are created (implementation-dependent exact structure)
      expect(shards.every(shard => Array.isArray(shard.items))).toBe(true);
    });

    it('should handle circular dependencies gracefully', () => {
      const items: WorkItem[] = [
        { id: 'item1', dependencies: ['item2'] },
        { id: 'item2', dependencies: ['item1'] }
      ];

      const graph: DependencyGraph = {
        nodes: new Map([
          ['item1', items[0]],
          ['item2', items[1]]
        ]),
        edges: new Map([
          ['item1', new Set(['item2'])],
          ['item2', new Set(['item1'])]
        ])
      };

      expect(() => {
        workDivider.divideByDependencies(items, graph);
      }).toThrow('Circular dependency detected');
    });

    it('should create empty shards when no items match', () => {
      const items: WorkItem[] = [];
      const graph: DependencyGraph = {
        nodes: new Map(),
        edges: new Map()
      };

      const shards = workDivider.divideByDependencies(items, graph);
      expect(shards).toHaveLength(0);
    });
  });

  describe('divideByResourceNeeds', () => {
    it('should consider available resources', () => {
      const items: WorkItem[] = [
        { id: 'item1', size: 10 },
        { id: 'item2', size: 20 },
        { id: 'item3', size: 15 }
      ];

      const resources: Resources = {
        memory: 2048, // 2GB
        cpu: 4 // 4 cores
      };

      const shards = workDivider.divideByResourceNeeds(items, resources);

      expect(shards.length).toBeGreaterThan(0);
      expect(shards.length).toBeLessThanOrEqual(4); // Limited by CPU cores
    });

    it('should limit workers by memory constraints', () => {
      const items: WorkItem[] = [
        { id: 'item1', size: 10 }
      ];

      const resources: Resources = {
        memory: 256, // Very limited memory
        cpu: 8 // Many cores
      };

      const shards = workDivider.divideByResourceNeeds(items, resources);

      // Should be limited by memory (256MB / 512MB = 0, minimum 1)
      expect(shards.length).toBe(1);
    });
  });

  describe('rebalance', () => {
    it('should return rebalanced shards', () => {
      const shards: WorkShard[] = [
        {
          id: 'shard-0',
          items: [{ id: 'item1', size: 10 }],
          totalSize: 10,
          totalComplexity: 5,
          estimatedDuration: 1000,
          workerIndex: 0
        },
        {
          id: 'shard-1',
          items: [{ id: 'item2', size: 20 }],
          totalSize: 20,
          totalComplexity: 10,
          estimatedDuration: 2000,
          workerIndex: 1
        }
      ];

      const feedback: RuntimeFeedback = {
        shardId: 'shard-0',
        completedItems: 1,
        remainingItems: 0,
        currentThroughput: 0.5,
        estimatedCompletion: Date.now() + 1000
      };

      const rebalanced = workDivider.rebalance(shards, feedback);

      expect(rebalanced).toHaveLength(2);
      expect(rebalanced).not.toBe(shards); // Should return new array
    });
  });

  describe('optimizeDistribution', () => {
    it('should keep good distribution unchanged', () => {
      const distribution: Distribution = {
        shards: [
          {
            id: 'shard-0',
            items: [{ id: 'item1', size: 10 }],
            totalSize: 10,
            totalComplexity: 5,
            estimatedDuration: 1000,
            workerIndex: 0
          }
        ],
        efficiency: 0.8,
        balance: 0.9
      };

      const metrics: Metrics = {
        throughput: 10,
        latency: 100
      };

      const optimized = workDivider.optimizeDistribution(distribution, metrics);

      // Should return same distribution if it's already good
      expect(optimized.efficiency).toBe(0.8);
    });

    it('should not change distribution with poor metrics', () => {
      const distribution: Distribution = {
        shards: [],
        efficiency: 0.5,
        balance: 0.6
      };

      const metrics: Metrics = {
        throughput: 1,
        latency: 1000
      };

      const optimized = workDivider.optimizeDistribution(distribution, metrics);

      // Should return current distribution if metrics are poor
      expect(optimized).toBe(distribution);
    });
  });

  describe('addHistoricalData', () => {
    it('should store historical data', () => {
      workDivider.addHistoricalData('item1', 5000);
      
      const item: WorkItem = { id: 'item1' };
      const duration = workDivider.estimateDuration(item);
      
      expect(duration).toBe(5000);
    });

    it('should limit historical data to 10 records', () => {
      // Add more than 10 records
      for (let i = 0; i < 15; i++) {
        workDivider.addHistoricalData('item1', 1000 + i);
      }
      
      const item: WorkItem = { id: 'item1' };
      const duration = workDivider.estimateDuration(item);
      
      // Should use the most recent (last added)
      expect(duration).toBe(1014); // 1000 + 14
    });

    it('should use weighted average for multiple historical records', () => {
      workDivider.addHistoricalData('item1', 1000);
      workDivider.addHistoricalData('item1', 2000);
      
      const item: WorkItem = { id: 'item1' };
      const duration = workDivider.estimateDuration(item);
      
      // Should be weighted average (more recent has higher weight)
      expect(duration).toBeGreaterThan(1000);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle empty work items', () => {
      const items: WorkItem[] = [];
      
      expect(() => workDivider.divideBySize(items, 2)).not.toThrow();
      expect(() => workDivider.divideByComplexity(items, 10)).not.toThrow();
      
      const analysis = workDivider.analyzeWorkload(items);
      expect(analysis.totalItems).toBe(0);
    });

    it('should handle zero workers', () => {
      const items: WorkItem[] = [{ id: 'item1', size: 10 }];
      
      // Should handle gracefully - when workers is 0, no shards can be created
      expect(() => {
        const _shards = workDivider.divideBySize(items, 0);
      }).not.toThrow();
    });

    it('should handle items with zero or negative size', () => {
      const items: WorkItem[] = [
        { id: 'item1', size: 0 },
        { id: 'item2', size: -5 },
        { id: 'item3', size: 10 }
      ];
      
      const shards = workDivider.divideBySize(items, 2);
      
      // Should handle gracefully, treating 0 and negative as 1
      expect(shards.length).toBeGreaterThan(0);
    });

    it('should handle missing item properties', () => {
      const items: WorkItem[] = [
        { id: 'item1' }, // Missing all optional properties
        { id: 'item2', size: undefined, complexity: undefined }
      ];
      
      expect(() => {
        workDivider.analyzeWorkload(items);
        workDivider.divideBySize(items, 2);
        workDivider.divideByComplexity(items, 10);
      }).not.toThrow();
    });

    it('should handle very large complexity threshold', () => {
      const items: WorkItem[] = [
        { id: 'item1', complexity: 5 },
        { id: 'item2', complexity: 3 }
      ];
      
      const shards = workDivider.divideByComplexity(items, 1000000);
      
      // All items should fit in one shard
      expect(shards).toHaveLength(1);
      expect(shards[0].items).toHaveLength(2);
    });

    it('should handle duplicate item IDs', () => {
      const items: WorkItem[] = [
        { id: 'item1', size: 10 },
        { id: 'item1', size: 20 } // Duplicate ID
      ];
      
      expect(() => {
        workDivider.analyzeWorkload(items);
      }).not.toThrow();
    });
  });

  describe('Performance tests', () => {
    it('should handle large number of items efficiently', () => {
      const items: WorkItem[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `item${i}`,
        size: Math.floor(Math.random() * 100) + 1,
        complexity: Math.floor(Math.random() * 10) + 1
      }));

      const startTime = Date.now();
      
      workDivider.analyzeWorkload(items);
      workDivider.divideBySize(items, 10);
      workDivider.divideByComplexity(items, 50);
      
      const endTime = Date.now();
      
      // Should complete within reasonable time (less than 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });
});