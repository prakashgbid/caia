/**
 * @jest-environment node
 */

import ResourceCalculator, {
  Task,
  ResourceMetrics,
  Bottleneck
} from '../index';
// Explicitly unused types for type-only imports
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { SystemResources, ResourceRequirement, ResourceAllocation, CPUAllocation, Optimization } from '../index';

// Mock os module
jest.mock('os', () => ({
  cpus: jest.fn(() => [
    { model: 'Intel Core i7', speed: 2800, times: { user: 1000, nice: 0, sys: 500, idle: 8500, irq: 0 } },
    { model: 'Intel Core i7', speed: 2800, times: { user: 1200, nice: 0, sys: 600, idle: 8200, irq: 0 } },
    { model: 'Intel Core i7', speed: 2800, times: { user: 1100, nice: 0, sys: 550, idle: 8350, irq: 0 } },
    { model: 'Intel Core i7', speed: 2800, times: { user: 1050, nice: 0, sys: 525, idle: 8425, irq: 0 } }
  ]),
  totalmem: jest.fn(() => 16 * 1024 * 1024 * 1024), // 16GB
  freemem: jest.fn(() => 8 * 1024 * 1024 * 1024), // 8GB free
  loadavg: jest.fn(() => [1.5, 1.2, 1.0]),
  networkInterfaces: jest.fn(() => ({
    eth0: [
      {
        address: '192.168.1.100',
        netmask: '255.255.255.0',
        family: 'IPv4',
        internal: false
      }
    ],
    lo: [
      {
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        family: 'IPv4',
        internal: true
      }
    ]
  }))
}));

describe('ResourceCalculator', () => {
  let resourceCalculator: ResourceCalculator;

  beforeEach(() => {
    resourceCalculator = new ResourceCalculator();
  });

  afterEach(() => {
    resourceCalculator.stopMonitoring();
    resourceCalculator.clearMetricsHistory();
  });

  describe('ResourceCalculator instantiation', () => {
    it('should create a new instance', () => {
      expect(resourceCalculator).toBeInstanceOf(ResourceCalculator);
    });

    it('should extend EventEmitter', () => {
      expect(resourceCalculator.on).toBeDefined();
      expect(resourceCalculator.emit).toBeDefined();
    });
  });

  describe('getAvailableResources', () => {
    it('should return system resources', () => {
      const resources = resourceCalculator.getAvailableResources();

      expect(resources).toHaveProperty('cpu');
      expect(resources).toHaveProperty('memory');
      expect(resources).toHaveProperty('disk');
      expect(resources).toHaveProperty('network');

      expect(resources.cpu.cores).toBe(4);
      expect(resources.cpu.model).toBe('Intel Core i7');
      expect(resources.cpu.speed).toBe(2800);
      expect(resources.cpu.usage).toBeGreaterThanOrEqual(0);
      expect(resources.cpu.usage).toBeLessThanOrEqual(100);

      expect(resources.memory.total).toBe(16 * 1024 * 1024 * 1024);
      expect(resources.memory.free).toBe(8 * 1024 * 1024 * 1024);
      expect(resources.memory.used).toBe(8 * 1024 * 1024 * 1024);
      expect(resources.memory.percentage).toBe(50);

      expect(resources.network.interfaces).toHaveLength(2);
    });

    it('should include network interfaces', () => {
      const resources = resourceCalculator.getAvailableResources();
      
      expect(resources.network.interfaces).toEqual([
        {
          name: 'eth0',
          address: '192.168.1.100',
          netmask: '255.255.255.0',
          family: 'IPv4',
          internal: false
        },
        {
          name: 'lo',
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          internal: true
        }
      ]);
    });
  });

  describe('calculateOptimalWorkers', () => {
    it('should calculate optimal workers based on CPU and memory', () => {
      const workers = resourceCalculator.calculateOptimalWorkers();

      expect(workers).toBeGreaterThan(0);
      expect(workers).toBeLessThanOrEqual(4); // Limited by CPU cores
    });

    it('should emit calculation event', async () => {
      const calculationPromise = new Promise((resolve) => {
        resourceCalculator.on('calculation', (data) => {
          expect(data.type).toBe('optimal-workers');
          expect(data.cpu).toBe(4);
          expect(data.memory).toBeGreaterThan(0);
          expect(data.optimal).toBeGreaterThan(0);
          expect(data.final).toBeGreaterThan(0);
          resolve(data);
        });
      });

      resourceCalculator.calculateOptimalWorkers();
      await calculationPromise;
    });

    it('should apply safety margin', () => {
      const workers = resourceCalculator.calculateOptimalWorkers();
      
      // With 4 cores and plenty of memory, should get 3 workers (80% of 4)
      expect(workers).toBe(3);
    });

    it('should return at least 1 worker', () => {
      // Mock very limited resources
      const os = jest.requireMock('os');
      os.freemem.mockReturnValue(100 * 1024 * 1024); // 100MB
      
      const workers = resourceCalculator.calculateOptimalWorkers();
      expect(workers).toBeGreaterThanOrEqual(1);
    });
  });

  describe('predictResourceUsage', () => {
    it('should predict resource usage for a task', () => {
      const task: Task = {
        id: 'task1',
        name: 'Test Task',
        memoryRequired: 512 * 1024 * 1024, // 512MB
        cpuRequired: 0.5 // 50% of one core
      };

      const prediction = resourceCalculator.predictResourceUsage(task);

      expect(prediction.memory).toBeGreaterThanOrEqual(512 * 1024 * 1024);
      expect(prediction.cpu).toBeGreaterThan(0);
      expect(prediction.cpu).toBeLessThanOrEqual(1);
    });

    it('should use defaults for missing requirements', () => {
      const task: Task = {
        id: 'task1',
        name: 'Test Task'
      };

      const prediction = resourceCalculator.predictResourceUsage(task);

      expect(prediction.memory).toBe(256 * 1024 * 1024); // Default 256MB
      expect(prediction.cpu).toBe(0.25); // Default 25%
      expect(prediction.disk).toBe(0);
    });

    it('should factor in priority', () => {
      const lowPriorityTask: Task = {
        id: 'task1',
        name: 'Low Priority',
        memoryRequired: 256 * 1024 * 1024,
        cpuRequired: 0.25,
        priority: 1
      };

      const highPriorityTask: Task = {
        id: 'task2',
        name: 'High Priority',
        memoryRequired: 256 * 1024 * 1024,
        cpuRequired: 0.25,
        priority: 10
      };

      const lowPrediction = resourceCalculator.predictResourceUsage(lowPriorityTask);
      const highPrediction = resourceCalculator.predictResourceUsage(highPriorityTask);

      expect(highPrediction.memory).toBeGreaterThan(lowPrediction.memory);
      expect(highPrediction.cpu).toBeGreaterThan(lowPrediction.cpu);
    });

    it('should factor in duration', () => {
      const shortTask: Task = {
        id: 'task1',
        name: 'Short Task',
        memoryRequired: 256 * 1024 * 1024,
        cpuRequired: 0.25,
        duration: 1000 // 1 second
      };

      const longTask: Task = {
        id: 'task2',
        name: 'Long Task',
        memoryRequired: 256 * 1024 * 1024,
        cpuRequired: 0.25,
        duration: 60000 // 1 minute
      };

      const shortPrediction = resourceCalculator.predictResourceUsage(shortTask);
      const longPrediction = resourceCalculator.predictResourceUsage(longTask);

      expect(longPrediction.cpu).toBeGreaterThan(shortPrediction.cpu);
    });
  });

  describe('allocateResources', () => {
    it('should allocate resources to tasks', () => {
      const tasks: Task[] = [
        {
          id: 'task1',
          name: 'Task 1',
          memoryRequired: 1024 * 1024 * 1024, // 1GB
          cpuRequired: 0.5,
          priority: 5
        },
        {
          id: 'task2',
          name: 'Task 2',
          memoryRequired: 512 * 1024 * 1024, // 512MB
          cpuRequired: 0.25,
          priority: 8
        }
      ];

      const allocations = resourceCalculator.allocateResources(tasks);

      expect(allocations).toHaveLength(2);
      expect(allocations[0].taskId).toBe('task2'); // Higher priority first
      expect(allocations[1].taskId).toBe('task1');
      
      allocations.forEach(allocation => {
        expect(allocation.allocated.memory).toBeGreaterThan(0);
        expect(allocation.allocated.cpu).toBeGreaterThan(0);
        expect(allocation.workerId).toBeGreaterThanOrEqual(0);
        expect(allocation.startTime).toBeGreaterThan(0);
      });
    });

    it('should reject tasks when insufficient resources', async () => {
      const tasks: Task[] = [
        {
          id: 'task1',
          name: 'Huge Task',
          memoryRequired: 32 * 1024 * 1024 * 1024, // 32GB (more than available)
          cpuRequired: 8 // 8 cores (more than available)
        }
      ];

      const allocationFailedPromise = new Promise((resolve) => {
        resourceCalculator.on('allocation-failed', (data) => {
          expect(data.task.id).toBe('task1');
          expect(data.reason).toBe('Insufficient resources');
          expect(data.required.memory).toBe(32 * 1024 * 1024 * 1024);
          resolve(data);
        });
      });

      const allocations = resourceCalculator.allocateResources(tasks);
      expect(allocations).toHaveLength(0);
      await allocationFailedPromise;
    });

    it('should handle empty task list', () => {
      const allocations = resourceCalculator.allocateResources([]);
      expect(allocations).toHaveLength(0);
    });
  });

  describe('calculateMemoryPerWorker', () => {
    it('should calculate memory per worker with default overhead', () => {
      const totalMemory = 8 * 1024 * 1024 * 1024; // 8GB
      const memoryPerWorker = resourceCalculator.calculateMemoryPerWorker(totalMemory);

      const optimalWorkers = resourceCalculator.calculateOptimalWorkers();
      const expectedMemory = Math.floor((totalMemory * 0.8) / optimalWorkers);

      expect(memoryPerWorker).toBe(expectedMemory);
    });

    it('should calculate memory per worker with custom overhead', () => {
      const totalMemory = 8 * 1024 * 1024 * 1024; // 8GB
      const overhead = 0.3; // 30%
      const memoryPerWorker = resourceCalculator.calculateMemoryPerWorker(totalMemory, overhead);

      const optimalWorkers = resourceCalculator.calculateOptimalWorkers();
      const expectedMemory = Math.floor((totalMemory * 0.7) / optimalWorkers);

      expect(memoryPerWorker).toBe(expectedMemory);
    });
  });

  describe('optimizeCPUDistribution', () => {
    it('should distribute tasks across CPU cores', () => {
      const tasks: Task[] = [
        { id: 'task1', name: 'Task 1', cpuRequired: 0.5 },
        { id: 'task2', name: 'Task 2', cpuRequired: 0.3 },
        { id: 'task3', name: 'Task 3', cpuRequired: 0.8 }
      ];

      const allocation = resourceCalculator.optimizeCPUDistribution(4, tasks);

      expect(allocation.cores).toEqual([0, 1, 2, 3]);
      expect(allocation.tasksPerCore.size).toBe(4);
      expect(allocation.utilization).toBeGreaterThan(0);
      expect(allocation.utilization).toBeLessThanOrEqual(100);

      // All tasks should be assigned
      const totalAssignedTasks = Array.from(allocation.tasksPerCore.values())
        .reduce((sum, taskList) => sum + taskList.length, 0);
      expect(totalAssignedTasks).toBe(3);
    });

    it('should balance load across cores', () => {
      const tasks: Task[] = Array.from({ length: 8 }, (_, i) => ({
        id: `task${i}`,
        name: `Task ${i}`,
        cpuRequired: 0.25
      }));

      const allocation = resourceCalculator.optimizeCPUDistribution(4, tasks);

      // Each core should get 2 tasks
      allocation.tasksPerCore.forEach((taskList) => {
        expect(taskList.length).toBe(2);
      });
    });

    it('should handle more cores than tasks', () => {
      const tasks: Task[] = [
        { id: 'task1', name: 'Task 1', cpuRequired: 0.5 }
      ];

      const allocation = resourceCalculator.optimizeCPUDistribution(4, tasks);

      expect(allocation.cores).toEqual([0, 1, 2, 3]);
      
      // Only one core should have a task
      const coresWithTasks = Array.from(allocation.tasksPerCore.values())
        .filter(taskList => taskList.length > 0);
      expect(coresWithTasks).toHaveLength(1);
    });
  });

  describe('trackResourceUsage', () => {
    it('should track and emit resource metrics', async () => {
      const metricsPromise = new Promise<ResourceMetrics>((resolve) => {
        resourceCalculator.on('metrics', (metrics: ResourceMetrics) => {
          expect(metrics.timestamp).toBeGreaterThan(0);
          expect(metrics.cpu).toBeGreaterThanOrEqual(0);
          expect(metrics.memory).toBeGreaterThanOrEqual(0);
          expect(metrics.disk).toBeGreaterThanOrEqual(0);
          expect(metrics.network).toBeGreaterThanOrEqual(0);
          resolve(metrics);
        });
      });

      resourceCalculator.trackResourceUsage();
      await metricsPromise;
    });

    it('should store metrics in history', () => {
      resourceCalculator.trackResourceUsage();
      resourceCalculator.trackResourceUsage();

      const history = resourceCalculator.getMetricsHistory();
      expect(history).toHaveLength(2);
      
      history.forEach(metric => {
        expect(metric.timestamp).toBeGreaterThan(0);
        expect(metric.cpu).toBeGreaterThanOrEqual(0);
      });
    });

    it('should limit history size', () => {
      // Add more than maxHistorySize (1000) metrics
      for (let i = 0; i < 1005; i++) {
        resourceCalculator.trackResourceUsage();
      }

      const history = resourceCalculator.getMetricsHistory();
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('detectBottlenecks', () => {
    it('should detect CPU bottleneck', () => {
      // Mock high CPU usage
      const os = jest.requireMock('os');
      os.cpus.mockReturnValue([
        { model: 'Intel Core i7', speed: 2800, times: { user: 9000, nice: 0, sys: 500, idle: 500, irq: 0 } }
      ]);

      const bottlenecks = resourceCalculator.detectBottlenecks();
      const cpuBottleneck = bottlenecks.find(b => b.resource === 'cpu');

      expect(cpuBottleneck).toBeDefined();
      expect(cpuBottleneck?.severity).toBeOneOf(['medium', 'high', 'critical']);
      expect(cpuBottleneck?.currentUsage).toBeGreaterThan(80);
    });

    it('should detect memory bottleneck', () => {
      // Mock high memory usage
      const os = jest.requireMock('os');
      os.totalmem.mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB
      os.freemem.mockReturnValue(0.5 * 1024 * 1024 * 1024); // 0.5GB free (93.75% used)

      const bottlenecks = resourceCalculator.detectBottlenecks();
      const memoryBottleneck = bottlenecks.find(b => b.resource === 'memory');

      expect(memoryBottleneck).toBeDefined();
      expect(memoryBottleneck?.severity).toBeOneOf(['medium', 'high', 'critical']);
      expect(memoryBottleneck?.currentUsage).toBeGreaterThan(85);
    });

    it('should return empty array when no bottlenecks', () => {
      // Ensure normal resource usage (already mocked in beforeEach)
      const bottlenecks = resourceCalculator.detectBottlenecks();
      
      // With 50% memory usage and normal CPU, should be no bottlenecks
      expect(bottlenecks).toHaveLength(0);
    });
  });

  describe('suggestOptimizations', () => {
    it('should suggest CPU scale-out for critical CPU bottleneck', () => {
      // Mock critical CPU usage
      const os = jest.requireMock('os');
      os.cpus.mockReturnValue([
        { model: 'Intel Core i7', speed: 2800, times: { user: 9500, nice: 0, sys: 400, idle: 100, irq: 0 } }
      ]);

      const optimizations = resourceCalculator.suggestOptimizations();
      const cpuOptimization = optimizations.find(o => o.resource === 'cpu');

      expect(cpuOptimization).toBeDefined();
      expect(cpuOptimization?.type).toBe('scale-out');
      expect(cpuOptimization?.recommendedValue).toBeGreaterThan(cpuOptimization?.currentValue);
    });

    it('should suggest memory optimization for high memory usage', () => {
      // Mock high memory usage
      const os = jest.requireMock('os');
      os.totalmem.mockReturnValue(8 * 1024 * 1024 * 1024);
      os.freemem.mockReturnValue(0.4 * 1024 * 1024 * 1024); // 95% used

      const optimizations = resourceCalculator.suggestOptimizations();
      const memoryOptimization = optimizations.find(o => o.resource === 'memory');

      expect(memoryOptimization).toBeDefined();
      expect(memoryOptimization?.type).toBe('optimize');
    });

    it('should suggest worker reduction for low CPU utilization', () => {
      // Mock very low CPU usage
      const os = jest.requireMock('os');
      os.cpus.mockReturnValue([
        { model: 'Intel Core i7', speed: 2800, times: { user: 100, nice: 0, sys: 50, idle: 9850, irq: 0 } }
      ]);

      const optimizations = resourceCalculator.suggestOptimizations();
      const workerOptimization = optimizations.find(o => o.resource === 'workers');

      expect(workerOptimization).toBeDefined();
      expect(workerOptimization?.type).toBe('scale-up');
    });
  });

  describe('startMonitoring and stopMonitoring', () => {
    it('should start monitoring and emit updates', async () => {
      let updateCount = 0;
      
      const monitoringPromise = new Promise<void>((resolve) => {
        resourceCalculator.on('metrics', () => {
          updateCount++;
          if (updateCount >= 2) {
            resourceCalculator.stopMonitoring();
            resolve();
          }
        });
      });

      resourceCalculator.startMonitoring(100); // 100ms interval
      await monitoringPromise;
      expect(updateCount).toBeGreaterThanOrEqual(2);
    });

    it('should detect bottlenecks during monitoring', async () => {
      // Mock high memory usage
      const os = jest.requireMock('os');
      os.totalmem.mockReturnValue(8 * 1024 * 1024 * 1024);
      os.freemem.mockReturnValue(0.3 * 1024 * 1024 * 1024); // 96.25% used

      const bottlenecksPromise = new Promise<Bottleneck[]>((resolve) => {
        resourceCalculator.on('bottlenecks', (bottlenecks: Bottleneck[]) => {
          expect(bottlenecks.length).toBeGreaterThan(0);
          resourceCalculator.stopMonitoring();
          resolve(bottlenecks);
        });
      });

      resourceCalculator.startMonitoring(100);
      await bottlenecksPromise;
    });

    it('should not start monitoring if already running', () => {
      resourceCalculator.startMonitoring(1000);
      resourceCalculator.startMonitoring(1000); // Second call should be ignored
      
      // Should not throw or cause issues
      expect(() => resourceCalculator.stopMonitoring()).not.toThrow();
    });
  });

  describe('getMetricsHistory and clearMetricsHistory', () => {
    it('should return copy of metrics history', () => {
      resourceCalculator.trackResourceUsage();
      const history1 = resourceCalculator.getMetricsHistory();
      const history2 = resourceCalculator.getMetricsHistory();

      expect(history1).toEqual(history2);
      expect(history1).not.toBe(history2); // Different objects
    });

    it('should clear metrics history', () => {
      resourceCalculator.trackResourceUsage();
      resourceCalculator.trackResourceUsage();
      
      expect(resourceCalculator.getMetricsHistory()).toHaveLength(2);
      
      resourceCalculator.clearMetricsHistory();
      
      expect(resourceCalculator.getMetricsHistory()).toHaveLength(0);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle os module errors gracefully', () => {
      const os = jest.requireMock('os');
      os.cpus.mockImplementation(() => {
        throw new Error('OS Error');
      });

      // Should not crash
      expect(() => resourceCalculator.getAvailableResources()).not.toThrow();
    });

    it('should handle empty CPU info', () => {
      const os = jest.requireMock('os');
      os.cpus.mockReturnValue([]);

      const resources = resourceCalculator.getAvailableResources();
      expect(resources.cpu.cores).toBe(0);
      expect(resources.cpu.speed).toBe(0);
      expect(resources.cpu.model).toBe('Unknown');
    });

    it('should handle zero memory scenarios', () => {
      const os = jest.requireMock('os');
      os.totalmem.mockReturnValue(0);
      os.freemem.mockReturnValue(0);

      const resources = resourceCalculator.getAvailableResources();
      expect(resources.memory.total).toBe(0);
      expect(resources.memory.percentage).toBe(0);
    });

    it('should handle task with zero CPU requirement', () => {
      const task: Task = {
        id: 'task1',
        name: 'Zero CPU Task',
        cpuRequired: 0
      };

      const prediction = resourceCalculator.predictResourceUsage(task);
      expect(prediction.cpu).toBe(0);
    });

    it('should handle very high priority tasks', () => {
      const task: Task = {
        id: 'task1',
        name: 'Max Priority Task',
        memoryRequired: 256 * 1024 * 1024,
        cpuRequired: 0.25,
        priority: 1000 // Very high priority
      };

      const prediction = resourceCalculator.predictResourceUsage(task);
      expect(prediction.memory).toBeGreaterThan(256 * 1024 * 1024);
      expect(prediction.cpu).toBeGreaterThan(0.25);
    });
  });

  describe('Performance tests', () => {
    it('should handle many tasks efficiently', () => {
      const tasks: Task[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `task${i}`,
        name: `Task ${i}`,
        memoryRequired: Math.random() * 1024 * 1024 * 1024,
        cpuRequired: Math.random(),
        priority: Math.floor(Math.random() * 10)
      }));

      const startTime = Date.now();
      
      resourceCalculator.allocateResources(tasks);
      resourceCalculator.optimizeCPUDistribution(4, tasks);
      
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});