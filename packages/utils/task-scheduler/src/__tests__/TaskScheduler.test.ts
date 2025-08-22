/**
 * @jest-environment node
 */

import TaskScheduler, {
  Task,
  TaskExecutor,
  ExecutionContext,
  TaskMetrics,
  TaskFilter,
  PriorityFirstStrategy,
  ShortestJobFirstStrategy,
  FairShareStrategy
} from '../index';
// Type-only imports for unused types
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { TaskQueue, SchedulingStrategy, SystemResources } from '../index';

// Mock executor for testing
class MockExecutor implements TaskExecutor {
  id: string;
  name: string;
  executionTime: number;
  shouldFail: boolean;

  constructor(id: string, executionTime = 100, shouldFail = false) {
    this.id = id;
    this.name = `Mock Executor ${id}`;
    this.executionTime = executionTime;
    this.shouldFail = shouldFail;
  }

  async execute(task: Task, _context: ExecutionContext): Promise<any> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (this.shouldFail) {
          reject(new Error(`Mock execution failed for ${task.id}`));
        } else {
          resolve(`Result for ${task.id}`);
        }
      }, this.executionTime);
    });
  }

  canHandle(task: Task): boolean {
    return task.name.includes('mock') || task.metadata?.executor === this.id;
  }
}

describe('TaskScheduler', () => {
  let taskScheduler: TaskScheduler;

  beforeEach(() => {
    taskScheduler = new TaskScheduler({
      defaultConcurrency: 2,
      maxRetries: 2,
      enableMetrics: true
    });
  });

  afterEach(() => {
    taskScheduler.stop();
  });

  describe('TaskScheduler instantiation', () => {
    it('should create a new instance with default config', () => {
      const scheduler = new TaskScheduler();
      expect(scheduler).toBeInstanceOf(TaskScheduler);
      expect(scheduler.getQueues()).toHaveLength(1); // default queue
    });

    it('should create instance with custom config', () => {
      const config = {
        defaultConcurrency: 5,
        maxRetries: 3,
        enableMetrics: false
      };

      const scheduler = new TaskScheduler(config);
      expect(scheduler).toBeInstanceOf(TaskScheduler);
    });
  });

  describe('addTask', () => {
    it('should add a task and return task ID', () => {
      const taskId = taskScheduler.addTask({
        name: 'test-task',
        priority: 5
      });

      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');

      const task = taskScheduler.getTask(taskId);
      expect(task).toBeDefined();
      expect(task?.name).toBe('test-task');
      expect(task?.priority).toBe(5);
      expect(task?.status).toBe('pending');
    });

    it('should emit task-added event', async () => {
      const taskPromise = new Promise<Task>((resolve) => {
        taskScheduler.on('task-added', (task: Task) => {
          expect(task.name).toBe('event-test');
          expect(task.status).toBe('pending');
          resolve(task);
        });
      });

      taskScheduler.addTask({ name: 'event-test' });
      await taskPromise;
    });

    it('should auto-schedule tasks with no dependencies', () => {
      const mockExecutor = new MockExecutor('test-executor');
      taskScheduler.registerExecutor(mockExecutor);

      const taskId = taskScheduler.addTask({
        name: 'mock-task',
        priority: 5
      });

      const _task = taskScheduler.getTask(taskId);
      setTimeout(() => {
        const updatedTask = taskScheduler.getTask(taskId);
        expect(updatedTask?.status).toBeOneOf(['scheduled', 'running']);
      }, 10);
    });

    it('should handle tasks with dependencies', () => {
      const task1Id = taskScheduler.addTask({
        name: 'dependency-task',
        priority: 5
      });

      const task2Id = taskScheduler.addTask({
        name: 'dependent-task',
        dependencies: [task1Id],
        priority: 3
      });

      const task2 = taskScheduler.getTask(task2Id);
      expect(task2?.status).toBe('pending'); // Should not be scheduled yet
    });
  });

  describe('scheduleTask', () => {
    it('should schedule a task to a queue', () => {
      const taskId = taskScheduler.addTask({
        name: 'schedule-test',
        priority: 5
      });

      const scheduled = taskScheduler.scheduleTask(taskId);
      expect(scheduled).toBe(true);

      const task = taskScheduler.getTask(taskId);
      expect(task?.status).toBe('scheduled');
      expect(task?.scheduledAt).toBeDefined();
    });

    it('should not schedule task with unmet dependencies', () => {
      const task1Id = taskScheduler.addTask({
        name: 'dep-task',
        priority: 5
      });

      const task2Id = taskScheduler.addTask({
        name: 'dependent',
        dependencies: [task1Id]
      });

      const scheduled = taskScheduler.scheduleTask(task2Id);
      expect(scheduled).toBe(false);
    });

    it('should emit task-scheduled event', (done) => {
      taskScheduler.on('task-scheduled', (task: Task, queueId: string) => {
        expect(task.name).toBe('scheduled-event-test');
        expect(queueId).toBe('default');
        done();
      });

      const taskId = taskScheduler.addTask({
        name: 'scheduled-event-test'
      });
      taskScheduler.scheduleTask(taskId);
    });
  });

  describe('task execution', () => {
    beforeEach(() => {
      const mockExecutor = new MockExecutor('test-executor', 50);
      taskScheduler.registerExecutor(mockExecutor);
    });

    it('should execute scheduled tasks', (done) => {
      taskScheduler.on('task-completed', (task: Task) => {
        expect(task.name).toBe('mock-execution');
        expect(task.status).toBe('completed');
        expect(task.result).toBe(`Result for ${task.id}`);
        done();
      });

      taskScheduler.addTask({
        name: 'mock-execution',
        priority: 5
      });

      taskScheduler.start();
    });

    it('should handle task execution failures', (done) => {
      const failingExecutor = new MockExecutor('failing-executor', 50, true);
      taskScheduler.registerExecutor(failingExecutor);

      taskScheduler.on('task-failed', (task: Task, error: any) => {
        expect(task.name).toBe('mock-failing');
        expect(task.status).toBe('failed');
        expect(error).toBeInstanceOf(Error);
        done();
      });

      taskScheduler.addTask({
        name: 'mock-failing',
        priority: 5,
        metadata: { executor: 'failing-executor' }
      });

      taskScheduler.start();
    });

    it('should retry failed tasks', (done) => {
      let attemptCount = 0;
      const unreliableExecutor: TaskExecutor = {
        id: 'unreliable',
        name: 'Unreliable Executor',
        canHandle: () => true,
        execute: async (task: Task) => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Temporary failure');
          }
          return 'Success after retries';
        }
      };

      taskScheduler.registerExecutor(unreliableExecutor);

      taskScheduler.on('task-completed', (task: Task) => {
        expect(task.retryAttempts).toBe(2);
        expect(task.result).toBe('Success after retries');
        done();
      });

      taskScheduler.addTask({
        name: 'retry-test',
        maxRetries: 3
      });

      taskScheduler.start();
    });

    it('should respect concurrency limits', (done) => {
      const slowExecutor = new MockExecutor('slow-executor', 200);
      taskScheduler.registerExecutor(slowExecutor);

      let runningTasks = 0;
      let maxConcurrent = 0;

      taskScheduler.on('task-started', () => {
        runningTasks++;
        maxConcurrent = Math.max(maxConcurrent, runningTasks);
      });

      taskScheduler.on('task-completed', () => {
        runningTasks--;
      });

      // Add more tasks than concurrency limit
      for (let i = 0; i < 5; i++) {
        taskScheduler.addTask({
          name: `mock-concurrent-${i}`
        });
      }

      taskScheduler.start();

      setTimeout(() => {
        expect(maxConcurrent).toBeLessThanOrEqual(2); // Default concurrency
        taskScheduler.stop();
        done();
      }, 300);
    });
  });

  describe('task cancellation', () => {
    it('should cancel a scheduled task', () => {
      const taskId = taskScheduler.addTask({
        name: 'cancellable',
        priority: 5
      });

      const cancelled = taskScheduler.cancelTask(taskId);
      expect(cancelled).toBe(true);

      const task = taskScheduler.getTask(taskId);
      expect(task?.status).toBe('cancelled');
      expect(task?.completedAt).toBeDefined();
    });

    it('should cancel a running task', (done) => {
      const slowExecutor = new MockExecutor('slow-executor', 1000);
      taskScheduler.registerExecutor(slowExecutor);

      let taskId: string;

      taskScheduler.on('task-started', (task: Task) => {
        // Cancel the task after it starts
        setTimeout(() => {
          const cancelled = taskScheduler.cancelTask(task.id);
          expect(cancelled).toBe(true);
        }, 100);
      });

      taskScheduler.on('task-cancelled', (task: Task) => {
        expect(task.status).toBe('cancelled');
        done();
      });

      taskId = taskScheduler.addTask({
        name: 'mock-slow',
        priority: 5
      });

      taskScheduler.start();
    });

    it('should emit task-cancelled event', (done) => {
      taskScheduler.on('task-cancelled', (task: Task) => {
        expect(task.name).toBe('cancel-event-test');
        expect(task.status).toBe('cancelled');
        done();
      });

      const taskId = taskScheduler.addTask({
        name: 'cancel-event-test'
      });
      taskScheduler.cancelTask(taskId);
    });
  });

  describe('queues management', () => {
    it('should create custom queue', () => {
      const queue = taskScheduler.createQueue('custom-queue', 'Custom Queue', 3, 10);

      expect(queue.id).toBe('custom-queue');
      expect(queue.name).toBe('Custom Queue');
      expect(queue.concurrency).toBe(3);
      expect(queue.priority).toBe(10);
      expect(queue.paused).toBe(false);
    });

    it('should pause and resume queues', () => {
      const queueId = 'pausable-queue';
      taskScheduler.createQueue(queueId, 'Pausable Queue');

      const paused = taskScheduler.pauseQueue(queueId);
      expect(paused).toBe(true);

      const queue = taskScheduler.getQueue(queueId);
      expect(queue?.paused).toBe(true);

      const resumed = taskScheduler.resumeQueue(queueId);
      expect(resumed).toBe(true);
      expect(queue?.paused).toBe(false);
    });

    it('should emit queue events', async () => {
      const createdPromise = new Promise((resolve) => {
        taskScheduler.on('queue-created', resolve);
      });

      const pausedPromise = new Promise((resolve) => {
        taskScheduler.on('queue-paused', resolve);
      });

      const resumedPromise = new Promise((resolve) => {
        taskScheduler.on('queue-resumed', resolve);
      });

      const queueId = 'event-queue';
      taskScheduler.createQueue(queueId, 'Event Queue');
      await createdPromise;

      taskScheduler.pauseQueue(queueId);
      await pausedPromise;

      taskScheduler.resumeQueue(queueId);
      await resumedPromise;
    });
  });

  describe('executors management', () => {
    it('should register and unregister executors', () => {
      const executor = new MockExecutor('test-register');

      taskScheduler.registerExecutor(executor);
      taskScheduler.unregisterExecutor('test-register');

      // Try to execute a task - should emit no-executor-found
      const noExecutorPromise = new Promise((resolve) => {
        taskScheduler.on('no-executor-found', resolve);
      });

      taskScheduler.addTask({
        name: 'no-executor-test',
        metadata: { executor: 'test-register' }
      });

      taskScheduler.start();

      return noExecutorPromise;
    });

    it('should emit executor events', async () => {
      const registeredPromise = new Promise((resolve) => {
        taskScheduler.on('executor-registered', resolve);
      });

      const unregisteredPromise = new Promise((resolve) => {
        taskScheduler.on('executor-unregistered', resolve);
      });

      const executor = new MockExecutor('event-executor');
      taskScheduler.registerExecutor(executor);
      await registeredPromise;

      taskScheduler.unregisterExecutor('event-executor');
      await unregisteredPromise;
    });
  });

  describe('scheduling strategies', () => {
    it('should use PriorityFirstStrategy by default', () => {
      const tasks: Task[] = [
        { id: '1', name: 'low', priority: 1, status: 'scheduled', createdAt: Date.now(), retryAttempts: 0 },
        { id: '2', name: 'high', priority: 10, status: 'scheduled', createdAt: Date.now(), retryAttempts: 0 },
        { id: '3', name: 'medium', priority: 5, status: 'scheduled', createdAt: Date.now(), retryAttempts: 0 }
      ];

      const strategy = new PriorityFirstStrategy();
      const sorted = strategy.schedule(tasks, {} as SystemResources);

      expect(sorted[0].priority).toBe(10); // highest priority first
      expect(sorted[1].priority).toBe(5);
      expect(sorted[2].priority).toBe(1);
    });

    it('should use ShortestJobFirstStrategy', () => {
      const tasks: Task[] = [
        { id: '1', name: 'long', estimatedDuration: 10000, status: 'scheduled', createdAt: Date.now(), retryAttempts: 0 },
        { id: '2', name: 'short', estimatedDuration: 1000, status: 'scheduled', createdAt: Date.now(), retryAttempts: 0 },
        { id: '3', name: 'medium', estimatedDuration: 5000, status: 'scheduled', createdAt: Date.now(), retryAttempts: 0 }
      ];

      const strategy = new ShortestJobFirstStrategy();
      const sorted = strategy.schedule(tasks, {} as SystemResources);

      expect(sorted[0].estimatedDuration).toBe(1000); // shortest first
      expect(sorted[1].estimatedDuration).toBe(5000);
      expect(sorted[2].estimatedDuration).toBe(10000);
    });

    it('should use FairShareStrategy', () => {
      const strategy = new FairShareStrategy();
      const tasks: Task[] = [
        { id: '1', name: 'task1', executor: 'executor1', status: 'scheduled', createdAt: Date.now(), retryAttempts: 0 },
        { id: '2', name: 'task2', executor: 'executor2', status: 'scheduled', createdAt: Date.now(), retryAttempts: 0 }
      ];

      const sorted = strategy.schedule(tasks, {} as SystemResources);
      expect(sorted).toHaveLength(2);
    });
  });

  describe('task queries and filtering', () => {
    beforeEach(() => {
      const now = Date.now();
      
      taskScheduler.addTask({
        name: 'running-task',
        priority: 5,
        tags: ['test', 'important']
      });

      taskScheduler.addTask({
        name: 'completed-task',
        priority: 3,
        tags: ['test']
      });

      taskScheduler.addTask({
        name: 'failed-task',
        priority: 8,
        tags: ['production']
      });
    });

    it('should filter tasks by status', () => {
      const filter: TaskFilter = {
        status: ['pending']
      };

      const tasks = taskScheduler.getTasks(filter);
      expect(tasks.every(task => task.status === 'pending')).toBe(true);
    });

    it('should filter tasks by priority range', () => {
      const filter: TaskFilter = {
        priority: { min: 5, max: 10 }
      };

      const tasks = taskScheduler.getTasks(filter);
      expect(tasks.every(task => task.priority >= 5 && task.priority <= 10)).toBe(true);
    });

    it('should filter tasks by tags', () => {
      const filter: TaskFilter = {
        tags: ['test']
      };

      const tasks = taskScheduler.getTasks(filter);
      expect(tasks.every(task => task.tags?.includes('test'))).toBe(true);
    });

    it('should filter tasks by creation time', () => {
      const now = Date.now();
      const filter: TaskFilter = {
        createdAfter: now - 10000,
        createdBefore: now + 10000
      };

      const tasks = taskScheduler.getTasks(filter);
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('should get all tasks without filter', () => {
      const allTasks = taskScheduler.getTasks();
      expect(allTasks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('metrics and monitoring', () => {
    beforeEach(() => {
      const fastExecutor = new MockExecutor('fast-executor', 50);
      taskScheduler.registerExecutor(fastExecutor);
    });

    it('should collect metrics when enabled', (done) => {
      taskScheduler.on('metrics-updated', (metrics: TaskMetrics) => {
        expect(metrics.totalTasks).toBeGreaterThan(0);
        expect(metrics.runningTasks).toBeGreaterThanOrEqual(0);
        expect(metrics.completedTasks).toBeGreaterThanOrEqual(0);
        expect(metrics.successRate).toBeGreaterThanOrEqual(0);
        expect(metrics.successRate).toBeLessThanOrEqual(100);
        done();
      });

      taskScheduler.addTask({
        name: 'mock-metrics',
        priority: 5
      });

      taskScheduler.start();
    });

    it('should provide current metrics', () => {
      taskScheduler.addTask({ name: 'metric-test-1' });
      taskScheduler.addTask({ name: 'metric-test-2' });

      const metrics = taskScheduler.getMetrics();

      expect(metrics.totalTasks).toBe(2);
      expect(metrics.pendingTasks).toBe(2);
      expect(metrics.runningTasks).toBe(0);
      expect(metrics.completedTasks).toBe(0);
    });

    it('should clear completed tasks', () => {
      taskScheduler.addTask({ name: 'clear-test-1' });
      taskScheduler.addTask({ name: 'clear-test-2' });

      // Manually mark as completed for testing
      const tasks = taskScheduler.getTasks();
      tasks.forEach(task => {
        task.status = 'completed';
      });

      const cleared = taskScheduler.clearCompleted();
      expect(cleared).toBe(2);

      const remainingTasks = taskScheduler.getTasks();
      expect(remainingTasks.every(task => task.status !== 'completed')).toBe(true);
    });
  });

  describe('deadline monitoring', () => {
    it('should detect overdue tasks', (done) => {
      const pastDeadline = Date.now() - 10000; // 10 seconds ago

      taskScheduler.on('task-overdue', (task: Task, overdueTime: number) => {
        expect(task.name).toBe('overdue-test');
        expect(overdueTime).toBeGreaterThan(0);
        done();
      });

      taskScheduler.addTask({
        name: 'overdue-test',
        deadline: pastDeadline
      });

      taskScheduler.start();
    });

    it('should warn about approaching deadlines', (done) => {
      const nearDeadline = Date.now() + 30000; // 30 seconds from now

      taskScheduler.on('task-deadline-warning', (task: Task, timeRemaining: number) => {
        expect(task.name).toBe('deadline-warning-test');
        expect(timeRemaining).toBeLessThan(300000); // 5 minutes
        done();
      });

      taskScheduler.addTask({
        name: 'deadline-warning-test',
        deadline: nearDeadline
      });

      taskScheduler.start();
    });
  });

  describe('scheduler lifecycle', () => {
    it('should start and stop scheduler', () => {
      expect(() => {
        taskScheduler.start();
        taskScheduler.stop();
      }).not.toThrow();
    });

    it('should emit scheduler events', async () => {
      const startedPromise = new Promise((resolve) => {
        taskScheduler.on('scheduler-started', resolve);
      });

      const stoppedPromise = new Promise((resolve) => {
        taskScheduler.on('scheduler-stopped', resolve);
      });

      taskScheduler.start();
      await startedPromise;

      taskScheduler.stop();
      await stoppedPromise;
    });

    it('should not start multiple times', () => {
      taskScheduler.start();
      
      // Starting again should not cause issues
      expect(() => taskScheduler.start()).not.toThrow();
      
      taskScheduler.stop();
    });
  });

  describe('dependency resolution', () => {
    it('should execute dependent tasks after dependencies complete', (done) => {
      const mockExecutor = new MockExecutor('dep-executor', 50);
      taskScheduler.registerExecutor(mockExecutor);

      const task1Id = taskScheduler.addTask({
        name: 'mock-dependency'
      });

      const task2Id = taskScheduler.addTask({
        name: 'mock-dependent',
        dependencies: [task1Id]
      });

      let task1Completed = false;
      let task2Started = false;

      taskScheduler.on('task-completed', (task: Task) => {
        if (task.id === task1Id) {
          task1Completed = true;
        }
      });

      taskScheduler.on('task-started', (task: Task) => {
        if (task.id === task2Id) {
          task2Started = true;
          expect(task1Completed).toBe(true);
          done();
        }
      });

      taskScheduler.start();
    });

    it('should handle complex dependency chains', (done) => {
      const mockExecutor = new MockExecutor('chain-executor', 30);
      taskScheduler.registerExecutor(mockExecutor);

      const task1Id = taskScheduler.addTask({ name: 'mock-chain-1' });
      const task2Id = taskScheduler.addTask({ name: 'mock-chain-2', dependencies: [task1Id] });
      const task3Id = taskScheduler.addTask({ name: 'mock-chain-3', dependencies: [task2Id] });

      const completionOrder: string[] = [];

      taskScheduler.on('task-completed', (task: Task) => {
        completionOrder.push(task.id);
        
        if (completionOrder.length === 3) {
          expect(completionOrder).toEqual([task1Id, task2Id, task3Id]);
          done();
        }
      });

      taskScheduler.start();
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle tasks with no suitable executor', (done) => {
      taskScheduler.on('no-executor-found', (task: Task) => {
        expect(task.name).toBe('no-executor');
        done();
      });

      taskScheduler.addTask({
        name: 'no-executor',
        metadata: { requiresSpecialExecutor: true }
      });

      taskScheduler.start();
    });

    it('should handle executor exceptions gracefully', (done) => {
      const throwingExecutor: TaskExecutor = {
        id: 'throwing',
        name: 'Throwing Executor',
        canHandle: () => true,
        execute: async () => {
          throw new Error('Executor exception');
        }
      };

      taskScheduler.registerExecutor(throwingExecutor);

      taskScheduler.on('task-failed', (task: Task, error: any) => {
        expect(error.message).toBe('Executor exception');
        done();
      });

      taskScheduler.addTask({
        name: 'exception-test'
      });

      taskScheduler.start();
    });

    it('should handle removing non-existent tasks', () => {
      const removed = taskScheduler.removeTask('non-existent');
      expect(removed).toBe(false);
    });

    it('should handle scheduling non-existent tasks', () => {
      const scheduled = taskScheduler.scheduleTask('non-existent');
      expect(scheduled).toBe(false);
    });

    it('should handle invalid queue operations', () => {
      expect(taskScheduler.pauseQueue('non-existent')).toBe(false);
      expect(taskScheduler.resumeQueue('non-existent')).toBe(false);
    });

    it('should handle task retry exhaustion', (done) => {
      const alwaysFailingExecutor: TaskExecutor = {
        id: 'always-failing',
        name: 'Always Failing',
        canHandle: () => true,
        execute: async () => {
          throw new Error('Always fails');
        }
      };

      taskScheduler.registerExecutor(alwaysFailingExecutor);

      taskScheduler.on('task-retry-exhausted', (task: Task) => {
        expect(task.retryAttempts).toBe(2); // maxRetries from config
        done();
      });

      taskScheduler.addTask({
        name: 'exhaust-retries'
      });

      taskScheduler.start();
    });
  });

  describe('Performance tests', () => {
    it('should handle many tasks efficiently', () => {
      const startTime = Date.now();
      
      // Add many tasks
      for (let i = 0; i < 1000; i++) {
        taskScheduler.addTask({
          name: `perf-task-${i}`,
          priority: Math.floor(Math.random() * 10)
        });
      }

      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // Should be fast
      expect(taskScheduler.getTasks()).toHaveLength(1000);
    });

    it('should handle rapid task scheduling', () => {
      const fastExecutor = new MockExecutor('perf-executor', 1);
      taskScheduler.registerExecutor(fastExecutor);

      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        const taskId = taskScheduler.addTask({
          name: `mock-rapid-${i}`
        });
        taskScheduler.scheduleTask(taskId);
      }

      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(500);
    });
  });
});