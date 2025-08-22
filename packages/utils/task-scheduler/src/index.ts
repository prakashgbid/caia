/**
 * @caia/task-scheduler
 * Intelligent task scheduling and prioritization
 */

import { EventEmitter } from 'events';

export interface Task {
  id: string;
  name: string;
  priority: number; // 1-10, 10 being highest
  dependencies?: string[];
  estimatedDuration?: number; // milliseconds
  deadline?: number; // timestamp
  retryAttempts?: number;
  maxRetries?: number;
  backoffStrategy?: 'linear' | 'exponential' | 'fixed';
  backoffDelay?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  status: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying';
  createdAt: number;
  scheduledAt?: number;
  startedAt?: number;
  completedAt?: number;
  lastAttemptAt?: number;
  executor?: string;
  result?: unknown;
  error?: string;
  resourceRequirements?: {
    cpu?: number;
    memory?: number;
    gpu?: boolean;
    network?: boolean;
  };
}

export interface TaskQueue {
  id: string;
  name: string;
  concurrency: number;
  tasks: Task[];
  paused: boolean;
  priority: number;
}

export interface ExecutionContext {
  taskId: string;
  attempt: number;
  startTime: number;
  resources?: Record<string, unknown>;
  cancel: () => void;
}

export interface TaskExecutor {
  id: string;
  name: string;
  execute: (task: Task, context: ExecutionContext) => Promise<unknown>;
  canHandle: (task: Task) => boolean;
  priority?: number;
  concurrency?: number;
}

export interface SchedulingStrategy {
  name: string;
  schedule: (tasks: Task[], resources: SystemResources) => Task[];
}

export interface SystemResources {
  cpu: { available: number; total: number };
  memory: { available: number; total: number };
  gpu: { available: number; total: number };
  network: { bandwidth: number; connections: number };
  custom?: Record<string, number>;
}

export interface TaskMetrics {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageExecutionTime: number;
  successRate: number;
  throughput: number; // tasks per second
  queueWaitTime: number;
  resourceUtilization: {
    cpu: number;
    memory: number;
    gpu: number;
  };
}

export interface SchedulingConfig {
  defaultConcurrency: number;
  maxRetries: number;
  defaultBackoffDelay: number;
  enableMetrics: boolean;
  enableDeadlineChecking: boolean;
  deadlineCheckInterval: number;
  resourceMonitoringInterval: number;
  strategy: SchedulingStrategy;
  executors: TaskExecutor[];
}

export interface TaskFilter {
  status?: Task['status'][];
  priority?: { min?: number; max?: number };
  tags?: string[];
  createdAfter?: number;
  createdBefore?: number;
  hasDeadline?: boolean;
  overdue?: boolean;
}

export class TaskScheduler extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private queues: Map<string, TaskQueue> = new Map();
  private executors: Map<string, TaskExecutor> = new Map();
  private runningTasks: Map<string, ExecutionContext> = new Map();
  private completedTasks: Task[] = [];
  private metrics: TaskMetrics;
  private config: SchedulingConfig;
  private schedulingInterval?: NodeJS.Timeout;
  private deadlineCheckInterval?: NodeJS.Timeout;
  private resourceMonitorInterval?: NodeJS.Timeout;
  private systemResources: SystemResources;

  constructor(config: Partial<SchedulingConfig> = {}) {
    super();
    
    this.config = {
      defaultConcurrency: 5,
      maxRetries: 3,
      defaultBackoffDelay: 1000,
      enableMetrics: true,
      enableDeadlineChecking: true,
      deadlineCheckInterval: 30000,
      resourceMonitoringInterval: 5000,
      strategy: new PriorityFirstStrategy(),
      executors: [],
      ...config
    };

    this.metrics = this.initializeMetrics();
    this.systemResources = this.initializeResources();
    
    // Register default executors
    this.config.executors.forEach(executor => {
      this.registerExecutor(executor);
    });

    // Create default queue
    this.createQueue('default', 'Default Queue', this.config.defaultConcurrency);
  }

  /**
   * Add a task to the scheduler
   */
  addTask(task: Omit<Task, 'id' | 'status' | 'createdAt'> & { id?: string }): string {
    const taskId = task.id || this.generateTaskId();
    
    const fullTask: Task = {
      ...task,
      id: taskId,
      status: 'pending',
      createdAt: Date.now(),
      retryAttempts: 0,
      maxRetries: task.maxRetries ?? this.config.maxRetries,
      backoffStrategy: task.backoffStrategy ?? 'exponential',
      backoffDelay: task.backoffDelay ?? this.config.defaultBackoffDelay
    };

    this.tasks.set(taskId, fullTask);
    this.emit('task-added', fullTask);
    
    // Schedule immediately if no dependencies
    if (!fullTask.dependencies || fullTask.dependencies.length === 0) {
      this.scheduleTask(taskId);
    }

    return taskId;
  }

  /**
   * Remove a task from the scheduler
   */
  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Cancel if running
    if (task.status === 'running') {
      this.cancelTask(taskId);
    }

    this.tasks.delete(taskId);
    this.emit('task-removed', taskId);
    return true;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get tasks by filter
   */
  getTasks(filter?: TaskFilter): Task[] {
    let tasks = Array.from(this.tasks.values());

    if (!filter) return tasks;

    if (filter.status) {
      tasks = tasks.filter(task => filter.status!.includes(task.status));
    }

    if (filter.priority) {
      tasks = tasks.filter(task => {
        if (filter.priority!.min !== undefined && task.priority < filter.priority!.min) return false;
        if (filter.priority!.max !== undefined && task.priority > filter.priority!.max) return false;
        return true;
      });
    }

    if (filter.tags) {
      tasks = tasks.filter(task => 
        task.tags && filter.tags!.some(tag => task.tags!.includes(tag))
      );
    }

    if (filter.createdAfter) {
      tasks = tasks.filter(task => task.createdAt >= filter.createdAfter!);
    }

    if (filter.createdBefore) {
      tasks = tasks.filter(task => task.createdAt <= filter.createdBefore!);
    }

    if (filter.hasDeadline !== undefined) {
      tasks = tasks.filter(task => 
        filter.hasDeadline ? task.deadline !== undefined : task.deadline === undefined
      );
    }

    if (filter.overdue) {
      const now = Date.now();
      tasks = tasks.filter(task => 
        task.deadline !== undefined && task.deadline < now && task.status !== 'completed'
      );
    }

    return tasks;
  }

  /**
   * Schedule a task for execution
   */
  scheduleTask(taskId: string, queueId: string = 'default'): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending') return false;

    // Check dependencies
    if (task.dependencies && !this.areDependenciesMet(task.dependencies)) {
      return false;
    }

    const queue = this.queues.get(queueId);
    if (!queue) return false;

    task.status = 'scheduled';
    task.scheduledAt = Date.now();
    queue.tasks.push(task);
    
    this.tasks.set(taskId, task);
    this.emit('task-scheduled', task, queueId);
    
    // Try to execute immediately if queue has capacity
    this.processQueue(queueId);
    
    return true;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'running') {
      const context = this.runningTasks.get(taskId);
      if (context) {
        context.cancel();
        this.runningTasks.delete(taskId);
      }
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();
    
    // Remove from queues
    this.queues.forEach(queue => {
      queue.tasks = queue.tasks.filter(t => t.id !== taskId);
    });

    this.tasks.set(taskId, task);
    this.emit('task-cancelled', task);
    
    return true;
  }

  /**
   * Retry a failed task
   */
  retryTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'failed') return false;

    if (task.retryAttempts! >= task.maxRetries!) {
      this.emit('task-retry-exhausted', task);
      return false;
    }

    task.status = 'pending';
    task.retryAttempts = (task.retryAttempts || 0) + 1;
    task.error = undefined;
    
    this.tasks.set(taskId, task);
    this.emit('task-retrying', task);
    
    // Schedule with backoff delay
    const delay = this.calculateBackoffDelay(task);
    setTimeout(() => {
      this.scheduleTask(taskId);
    }, delay);
    
    return true;
  }

  /**
   * Create a new task queue
   */
  createQueue(id: string, name: string, concurrency: number = 1, priority: number = 0): TaskQueue {
    const queue: TaskQueue = {
      id,
      name,
      concurrency,
      tasks: [],
      paused: false,
      priority
    };

    this.queues.set(id, queue);
    this.emit('queue-created', queue);
    
    return queue;
  }

  /**
   * Get queue by ID
   */
  getQueue(queueId: string): TaskQueue | undefined {
    return this.queues.get(queueId);
  }

  /**
   * Get all queues
   */
  getQueues(): TaskQueue[] {
    return Array.from(this.queues.values());
  }

  /**
   * Pause a queue
   */
  pauseQueue(queueId: string): boolean {
    const queue = this.queues.get(queueId);
    if (!queue) return false;

    queue.paused = true;
    this.emit('queue-paused', queue);
    return true;
  }

  /**
   * Resume a queue
   */
  resumeQueue(queueId: string): boolean {
    const queue = this.queues.get(queueId);
    if (!queue) return false;

    queue.paused = false;
    this.emit('queue-resumed', queue);
    
    // Process the queue
    this.processQueue(queueId);
    return true;
  }

  /**
   * Register a task executor
   */
  registerExecutor(executor: TaskExecutor): void {
    this.executors.set(executor.id, executor);
    this.emit('executor-registered', executor);
  }

  /**
   * Unregister a task executor
   */
  unregisterExecutor(executorId: string): boolean {
    const removed = this.executors.delete(executorId);
    if (removed) {
      this.emit('executor-unregistered', executorId);
    }
    return removed;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    this.schedulingInterval = setInterval(() => {
      this.processAllQueues();
    }, 1000);

    if (this.config.enableDeadlineChecking) {
      this.deadlineCheckInterval = setInterval(() => {
        this.checkDeadlines();
      }, this.config.deadlineCheckInterval);
    }

    this.resourceMonitorInterval = setInterval(() => {
      this.updateSystemResources();
      this.updateMetrics();
    }, this.config.resourceMonitoringInterval);

    this.emit('scheduler-started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.schedulingInterval) {
      clearInterval(this.schedulingInterval);
      this.schedulingInterval = undefined;
    }

    if (this.deadlineCheckInterval) {
      clearInterval(this.deadlineCheckInterval);
      this.deadlineCheckInterval = undefined;
    }

    if (this.resourceMonitorInterval) {
      clearInterval(this.resourceMonitorInterval);
      this.resourceMonitorInterval = undefined;
    }

    // Cancel all running tasks
    this.runningTasks.forEach((context, taskId) => {
      context.cancel();
    });
    this.runningTasks.clear();

    this.emit('scheduler-stopped');
  }

  /**
   * Get current metrics
   */
  getMetrics(): TaskMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(): number {
    const completed = this.getTasks({ status: ['completed'] });
    let cleared = 0;

    completed.forEach(task => {
      this.tasks.delete(task.id);
      cleared++;
    });

    this.completedTasks = [];
    this.emit('completed-tasks-cleared', cleared);
    
    return cleared;
  }

  /**
   * Process all queues
   */
  private processAllQueues(): void {
    this.queues.forEach((queue, queueId) => {
      if (!queue.paused) {
        this.processQueue(queueId);
      }
    });
  }

  /**
   * Process a specific queue
   */
  private processQueue(queueId: string): void {
    const queue = this.queues.get(queueId);
    if (!queue || queue.paused) return;

    // Count running tasks in this queue
    const runningInQueue = Array.from(this.runningTasks.values())
      .filter(context => {
        const task = this.tasks.get(context.taskId);
        return task && this.findQueueForTask(task.id) === queueId;
      }).length;

    // Execute tasks up to concurrency limit
    const availableSlots = queue.concurrency - runningInQueue;
    if (availableSlots <= 0) return;

    // Sort tasks by scheduling strategy
    const sortedTasks = this.config.strategy.schedule(queue.tasks, this.systemResources);
    
    const tasksToExecute = sortedTasks
      .filter(task => task.status === 'scheduled')
      .slice(0, availableSlots);

    tasksToExecute.forEach(task => {
      this.executeTask(task);
    });
  }

  /**
   * Execute a task
   */
  private async executeTask(task: Task): Promise<void> {
    // Find suitable executor
    const executor = this.findExecutor(task);
    if (!executor) {
      this.emit('no-executor-found', task);
      return;
    }

    // Update task status
    task.status = 'running';
    task.startedAt = Date.now();
    task.executor = executor.id;
    this.tasks.set(task.id, task);

    // Create execution context
    let cancelled = false;
    const context: ExecutionContext = {
      taskId: task.id,
      attempt: task.retryAttempts || 1,
      startTime: Date.now(),
      cancel: () => { cancelled = true; }
    };

    this.runningTasks.set(task.id, context);
    this.emit('task-started', task, executor);

    try {
      // Execute the task
      const result = await executor.execute(task, context);
      
      if (cancelled) {
        task.status = 'cancelled';
      } else {
        task.status = 'completed';
        task.result = result;
      }
      
      task.completedAt = Date.now();
      
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = Date.now();
      task.lastAttemptAt = Date.now();
      
      this.emit('task-failed', task, error);
      
      // Auto-retry if configured
      if (task.retryAttempts! < task.maxRetries!) {
        setTimeout(() => {
          this.retryTask(task.id);
        }, this.calculateBackoffDelay(task));
      }
    } finally {
      this.runningTasks.delete(task.id);
      this.tasks.set(task.id, task);
      
      // Remove from queue
      this.queues.forEach(queue => {
        queue.tasks = queue.tasks.filter(t => t.id !== task.id);
      });
      
      if (task.status === 'completed') {
        this.completedTasks.push(task);
        this.emit('task-completed', task);
        
        // Check if this completes dependencies for other tasks
        this.checkDependentTasks(task.id);
      }
    }
  }

  /**
   * Find suitable executor for a task
   */
  private findExecutor(task: Task): TaskExecutor | undefined {
    const candidates = Array.from(this.executors.values())
      .filter(executor => executor.canHandle(task))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    return candidates[0];
  }

  /**
   * Check if task dependencies are met
   */
  private areDependenciesMet(dependencies: string[]): boolean {
    return dependencies.every(depId => {
      const depTask = this.tasks.get(depId);
      return depTask && depTask.status === 'completed';
    });
  }

  /**
   * Check for tasks whose dependencies are now met
   */
  private checkDependentTasks(completedTaskId: string): void {
    const pendingTasks = this.getTasks({ status: ['pending'] });
    
    pendingTasks.forEach(task => {
      if (task.dependencies?.includes(completedTaskId) && 
          this.areDependenciesMet(task.dependencies)) {
        this.scheduleTask(task.id);
      }
    });
  }

  /**
   * Calculate backoff delay for retries
   */
  private calculateBackoffDelay(task: Task): number {
    const attempt = task.retryAttempts || 1;
    const baseDelay = task.backoffDelay || this.config.defaultBackoffDelay;

    switch (task.backoffStrategy) {
      case 'linear':
        return baseDelay * attempt;
      case 'exponential':
        return baseDelay * Math.pow(2, attempt - 1);
      case 'fixed':
      default:
        return baseDelay;
    }
  }

  /**
   * Check for tasks approaching or past deadlines
   */
  private checkDeadlines(): void {
    const now = Date.now();
    const tasks = this.getTasks({ hasDeadline: true });

    tasks.forEach(task => {
      if (!task.deadline) return;
      
      const timeToDeadline = task.deadline - now;
      
      if (timeToDeadline < 0 && task.status !== 'completed') {
        this.emit('task-overdue', task, Math.abs(timeToDeadline));
      } else if (timeToDeadline < 300000 && timeToDeadline > 0) { // 5 minutes warning
        this.emit('task-deadline-warning', task, timeToDeadline);
      }
    });
  }

  /**
   * Find which queue contains a task
   */
  private findQueueForTask(taskId: string): string | undefined {
    for (const [queueId, queue] of this.queues) {
      if (queue.tasks.some(task => task.id === taskId)) {
        return queueId;
      }
    }
    return undefined;
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): TaskMetrics {
    return {
      totalTasks: 0,
      pendingTasks: 0,
      runningTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageExecutionTime: 0,
      successRate: 0,
      throughput: 0,
      queueWaitTime: 0,
      resourceUtilization: {
        cpu: 0,
        memory: 0,
        gpu: 0
      }
    };
  }

  /**
   * Initialize system resources
   */
  private initializeResources(): SystemResources {
    return {
      cpu: { available: 80, total: 100 },
      memory: { available: 70, total: 100 },
      gpu: { available: 90, total: 100 },
      network: { bandwidth: 1000, connections: 10 }
    };
  }

  /**
   * Update system resources
   */
  private updateSystemResources(): void {
    // In a real implementation, this would query actual system resources
    // For now, simulate some resource usage
    const runningTaskCount = this.runningTasks.size;
    const cpuUsage = Math.min(95, runningTaskCount * 10);
    const memoryUsage = Math.min(90, runningTaskCount * 15);
    
    this.systemResources.cpu.available = 100 - cpuUsage;
    this.systemResources.memory.available = 100 - memoryUsage;
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    if (!this.config.enableMetrics) return;

    const allTasks = Array.from(this.tasks.values());
    const completedTasks = allTasks.filter(t => t.status === 'completed');
    const failedTasks = allTasks.filter(t => t.status === 'failed');
    const runningTasks = allTasks.filter(t => t.status === 'running');
    const pendingTasks = allTasks.filter(t => t.status === 'pending');

    this.metrics.totalTasks = allTasks.length;
    this.metrics.completedTasks = completedTasks.length;
    this.metrics.failedTasks = failedTasks.length;
    this.metrics.runningTasks = runningTasks.length;
    this.metrics.pendingTasks = pendingTasks.length;

    // Calculate success rate
    const finishedTasks = completedTasks.length + failedTasks.length;
    this.metrics.successRate = finishedTasks > 0 ? 
      (completedTasks.length / finishedTasks) * 100 : 0;

    // Calculate average execution time
    const tasksWithDuration = completedTasks.filter(t => t.startedAt && t.completedAt);
    if (tasksWithDuration.length > 0) {
      const totalDuration = tasksWithDuration.reduce((sum, task) => 
        sum + (task.completedAt! - task.startedAt!), 0);
      this.metrics.averageExecutionTime = totalDuration / tasksWithDuration.length;
    }

    // Calculate resource utilization
    this.metrics.resourceUtilization.cpu = 100 - this.systemResources.cpu.available;
    this.metrics.resourceUtilization.memory = 100 - this.systemResources.memory.available;
    this.metrics.resourceUtilization.gpu = 100 - this.systemResources.gpu.available;

    this.emit('metrics-updated', this.metrics);
  }
}

/**
 * Priority-first scheduling strategy
 */
export class PriorityFirstStrategy implements SchedulingStrategy {
  name = 'priority-first';

  schedule(tasks: Task[]): Task[] {
    return tasks.sort((a, b) => {
      // First by priority (higher first)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      
      // Then by deadline (earlier first)
      if (a.deadline && b.deadline) {
        return a.deadline - b.deadline;
      }
      if (a.deadline && !b.deadline) return -1;
      if (!a.deadline && b.deadline) return 1;
      
      // Finally by creation time (older first)
      return a.createdAt - b.createdAt;
    });
  }
}

/**
 * Shortest job first scheduling strategy
 */
export class ShortestJobFirstStrategy implements SchedulingStrategy {
  name = 'shortest-job-first';

  schedule(tasks: Task[]): Task[] {
    return tasks.sort((a, b) => {
      const aDuration = a.estimatedDuration || 60000; // Default 1 minute
      const bDuration = b.estimatedDuration || 60000;
      
      if (aDuration !== bDuration) {
        return aDuration - bDuration;
      }
      
      return b.priority - a.priority;
    });
  }
}

/**
 * Fair share scheduling strategy
 */
export class FairShareStrategy implements SchedulingStrategy {
  name = 'fair-share';
  private lastExecutionTime: Map<string, number> = new Map();

  schedule(tasks: Task[]): Task[] {
    const now = Date.now();
    
    return tasks.sort((a, b) => {
      const aLastExecution = this.lastExecutionTime.get(a.executor || 'default') || 0;
      const bLastExecution = this.lastExecutionTime.get(b.executor || 'default') || 0;
      
      const aWaitTime = now - aLastExecution;
      const bWaitTime = now - bLastExecution;
      
      // Longer wait time gets priority
      if (aWaitTime !== bWaitTime) {
        return bWaitTime - aWaitTime;
      }
      
      return b.priority - a.priority;
    });
  }
}

// Export default
export default TaskScheduler;