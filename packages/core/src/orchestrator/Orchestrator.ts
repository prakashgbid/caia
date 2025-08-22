import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { createLogger, Logger, format, transports } from 'winston';
import {
  OrchestratorConfig,
  Task,
  TaskResult,
  TaskStatus,
  TaskPriority,
  AgentConfig,
  AgentMetadata,
  AgentStatus,
  Message,
  MessageType,
  CAIAError,
  AgentError,
  TaskError,
  Plugin
} from '../types/index.js';
import { BaseAgent } from '../agent/BaseAgent.js';
import { MessageBus } from '../communication/MessageBus.js';
import { PluginManager } from '../plugin/PluginManager.js';

export interface TaskQueue {
  pending: Task[];
  running: Map<string, { task: Task; agentId: string; startTime: Date }>;
  completed: TaskResult[];
  failed: TaskResult[];
}

export interface AgentRegistry {
  agents: Map<string, BaseAgent>;
  metadata: Map<string, AgentMetadata>;
}

export interface OrchestratorStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  runningTasks: number;
  registeredAgents: number;
  activeAgents: number;
  uptime: number;
  averageTaskTime: number;
}

export class Orchestrator extends EventEmitter {
  private readonly config: OrchestratorConfig;
  private readonly logger: Logger;
  private readonly messageBus: MessageBus;
  private readonly pluginManager: PluginManager;
  private readonly taskQueue: TaskQueue;
  private readonly agentRegistry: AgentRegistry;
  private readonly startTime: Date;
  
  private isRunning = false;
  private taskSchedulerTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: OrchestratorConfig) {
    super();
    
    this.config = config;
    this.startTime = new Date();
    
    // Initialize logger
    this.logger = createLogger({
      level: config.logging.level,
      format: config.logging.format === 'json' 
        ? format.combine(format.timestamp(), format.json())
        : format.combine(format.timestamp(), format.simple()),
      transports: [
        new transports.Console(),
        new transports.File({ filename: 'orchestrator.log' })
      ]
    });

    // Initialize components
    this.messageBus = new MessageBus(
      {
        maxListeners: 100,
        messageTimeout: 30000,
        enableTracing: true
      },
      this.logger
    );

    this.pluginManager = new PluginManager(this.logger);
    
    this.taskQueue = {
      pending: [],
      running: new Map(),
      completed: [],
      failed: []
    };
    
    this.agentRegistry = {
      agents: new Map(),
      metadata: new Map()
    };

    this.setupEventHandlers();
    this.logger.info('Orchestrator initialized', { config });
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new CAIAError('Orchestrator is already running', 'ALREADY_RUNNING');
    }

    try {
      this.logger.info('Starting orchestrator');
      
      // Load plugins
      await this.loadPlugins();
      
      // Start task scheduler
      this.startTaskScheduler();
      
      // Start health checks
      this.startHealthChecks();
      
      // Start cleanup timer
      this.startCleanupTimer();
      
      this.isRunning = true;
      this.emit('started');
      this.logger.info('Orchestrator started successfully');
      
    } catch (error) {
      this.logger.error('Failed to start orchestrator', { error });
      throw new CAIAError(
        `Failed to start orchestrator: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'START_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.logger.info('Stopping orchestrator');
      
      this.isRunning = false;
      
      // Stop timers
      if (this.taskSchedulerTimer) {
        clearInterval(this.taskSchedulerTimer);
        this.taskSchedulerTimer = undefined;
      }
      
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = undefined;
      }
      
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = undefined;
      }
      
      // Cancel all running tasks
      const cancelPromises = Array.from(this.taskQueue.running.keys()).map(taskId =>
        this.cancelTask(taskId)
      );
      await Promise.allSettled(cancelPromises);
      
      // Shutdown agents
      const shutdownPromises = Array.from(this.agentRegistry.agents.values()).map(agent =>
        agent.shutdown().catch(error => 
          this.logger.warn('Agent shutdown failed', { agentId: agent.getConfig().id, error })
        )
      );
      await Promise.allSettled(shutdownPromises);
      
      // Shutdown plugins
      await this.pluginManager.shutdown();
      
      // Shutdown message bus
      await this.messageBus.shutdown();
      
      this.emit('stopped');
      this.logger.info('Orchestrator stopped successfully');
      
    } catch (error) {
      this.logger.error('Failed to stop orchestrator', { error });
      throw new CAIAError(
        `Failed to stop orchestrator: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STOP_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Register an agent with the orchestrator
   */
  async registerAgent(agent: BaseAgent): Promise<void> {
    const config = agent.getConfig();
    
    if (this.agentRegistry.agents.has(config.id)) {
      throw new AgentError(`Agent already registered: ${config.id}`, config.id);
    }

    try {
      this.logger.info('Registering agent', { agentId: config.id, agentName: config.name });
      
      // Initialize agent if not already initialized
      if (agent.getMetadata().status === AgentStatus.INACTIVE) {
        await agent.initialize();
      }
      
      // Register with registry
      this.agentRegistry.agents.set(config.id, agent);
      this.agentRegistry.metadata.set(config.id, agent.getMetadata());
      
      // Subscribe to agent events
      this.subscribeToAgentEvents(agent);
      
      // Subscribe agent to messages
      this.messageBus.subscribe(
        { to: config.id },
        config.id,
        async (message) => {
          try {
            await agent.handleMessage(message);
          } catch (error) {
            this.logger.error('Agent message handling failed', { 
              agentId: config.id, 
              messageId: message.id, 
              error 
            });
          }
        }
      );
      
      // Notify plugins
      await this.pluginManager.notifyAgentRegistered(config.id);
      
      this.emit('agentRegistered', { agentId: config.id, config });
      this.logger.info('Agent registered successfully', { agentId: config.id });
      
    } catch (error) {
      const agentError = new AgentError(
        `Failed to register agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
        config.id,
        { originalError: error }
      );
      this.logger.error('Agent registration failed', { error: agentError });
      throw agentError;
    }
  }

  /**
   * Unregister an agent
   */
  async unregisterAgent(agentId: string): Promise<void> {
    const agent = this.agentRegistry.agents.get(agentId);
    if (!agent) {
      throw new AgentError(`Agent not found: ${agentId}`, agentId);
    }

    try {
      this.logger.info('Unregistering agent', { agentId });
      
      // Cancel agent's tasks
      const agentTasks = Array.from(this.taskQueue.running.entries())
        .filter(([_, info]) => info.agentId === agentId)
        .map(([taskId]) => taskId);
        
      for (const taskId of agentTasks) {
        await this.cancelTask(taskId);
      }
      
      // Unsubscribe from messages
      this.messageBus.unsubscribeAll(agentId);
      
      // Shutdown agent
      await agent.shutdown();
      
      // Remove from registry
      this.agentRegistry.agents.delete(agentId);
      this.agentRegistry.metadata.delete(agentId);
      
      this.emit('agentUnregistered', { agentId, reason: 'Manual unregistration' });
      this.logger.info('Agent unregistered successfully', { agentId });
      
    } catch (error) {
      const agentError = new AgentError(
        `Failed to unregister agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
        agentId,
        { originalError: error }
      );
      this.logger.error('Agent unregistration failed', { error: agentError });
      throw agentError;
    }
  }

  /**
   * Submit a task for execution
   */
  async submitTask(task: Omit<Task, 'id' | 'createdAt'>): Promise<string> {
    const fullTask: Task = {
      ...task,
      id: uuidv4(),
      createdAt: new Date()
    };

    try {
      this.logger.info('Submitting task', { taskId: fullTask.id, taskType: fullTask.type });
      
      // Validate task
      this.validateTask(fullTask);
      
      // Add to pending queue
      this.addTaskToPendingQueue(fullTask);
      
      // Notify plugins
      await this.pluginManager.notifyTaskAssigned(fullTask);
      
      this.emit('taskSubmitted', fullTask);
      this.logger.info('Task submitted successfully', { taskId: fullTask.id });
      
      return fullTask.id;
      
    } catch (error) {
      const taskError = new TaskError(
        `Failed to submit task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        fullTask.id,
        { originalError: error }
      );
      this.logger.error('Task submission failed', { error: taskError });
      throw taskError;
    }
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<void> {
    try {
      this.logger.info('Cancelling task', { taskId });
      
      // Check if task is running
      const runningTask = this.taskQueue.running.get(taskId);
      if (runningTask) {
        const agent = this.agentRegistry.agents.get(runningTask.agentId);
        if (agent) {
          await agent.cancelTask(taskId);
        }
        this.taskQueue.running.delete(taskId);
      }
      
      // Remove from pending queue
      this.taskQueue.pending = this.taskQueue.pending.filter(task => task.id !== taskId);
      
      this.logger.info('Task cancelled successfully', { taskId });
      
    } catch (error) {
      const taskError = new TaskError(
        `Failed to cancel task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        taskId,
        { originalError: error }
      );
      this.logger.error('Task cancellation failed', { error: taskError });
      throw taskError;
    }
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId: string): TaskStatus | undefined {
    // Check running tasks
    if (this.taskQueue.running.has(taskId)) {
      return TaskStatus.RUNNING;
    }
    
    // Check pending tasks
    if (this.taskQueue.pending.some(task => task.id === taskId)) {
      return TaskStatus.PENDING;
    }
    
    // Check completed tasks
    const completed = this.taskQueue.completed.find(result => result.taskId === taskId);
    if (completed) {
      return completed.status;
    }
    
    // Check failed tasks
    const failed = this.taskQueue.failed.find(result => result.taskId === taskId);
    if (failed) {
      return failed.status;
    }
    
    return undefined;
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): OrchestratorStats {
    const totalTasks = this.taskQueue.completed.length + this.taskQueue.failed.length + 
                      this.taskQueue.pending.length + this.taskQueue.running.size;
    
    const completedTasks = this.taskQueue.completed.length;
    const failedTasks = this.taskQueue.failed.length;
    
    const avgTaskTime = completedTasks > 0 
      ? this.taskQueue.completed.reduce((sum, result) => sum + result.executionTime, 0) / completedTasks
      : 0;
    
    const activeAgents = Array.from(this.agentRegistry.metadata.values())
      .filter(metadata => metadata.status === AgentStatus.IDLE || metadata.status === AgentStatus.BUSY)
      .length;

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      pendingTasks: this.taskQueue.pending.length,
      runningTasks: this.taskQueue.running.size,
      registeredAgents: this.agentRegistry.agents.size,
      activeAgents,
      uptime: Date.now() - this.startTime.getTime(),
      averageTaskTime: avgTaskTime
    };
  }

  /**
   * Get agent metadata
   */
  getAgentMetadata(agentId?: string): AgentMetadata | AgentMetadata[] {
    if (agentId) {
      const metadata = this.agentRegistry.metadata.get(agentId);
      if (!metadata) {
        throw new AgentError(`Agent not found: ${agentId}`, agentId);
      }
      return metadata;
    }
    
    return Array.from(this.agentRegistry.metadata.values());
  }

  /**
   * Get message bus instance
   */
  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  /**
   * Get plugin manager instance
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  // Private methods

  private async loadPlugins(): Promise<void> {
    if (this.config.plugins.length === 0) {
      this.logger.info('No plugins configured');
      return;
    }

    // Register plugin configurations
    for (const pluginConfig of this.config.plugins) {
      this.pluginManager.registerPlugin(pluginConfig);
    }

    this.logger.info('Plugins registered', { count: this.config.plugins.length });
  }

  private setupEventHandlers(): void {
    // Handle orchestrator shutdown on process exit
    process.on('SIGINT', async () => {
      this.logger.info('Received SIGINT, shutting down gracefully');
      await this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      this.logger.info('Received SIGTERM, shutting down gracefully');
      await this.stop();
      process.exit(0);
    });
  }

  private subscribeToAgentEvents(agent: BaseAgent): void {
    const agentId = agent.getConfig().id;
    
    agent.on('taskCompleted', async (result: TaskResult) => {
      await this.handleTaskCompleted(result, agentId);
    });
    
    agent.on('error', (error: Error) => {
      this.logger.error('Agent error', { agentId, error });
      this.emit('agentError', { agentId, error });
    });
    
    agent.on('heartbeat', (metadata: AgentMetadata) => {
      this.agentRegistry.metadata.set(agentId, metadata);
    });

    agent.on('healthCheckFailed', (metadata: AgentMetadata) => {
      this.logger.warn('Agent health check failed', { agentId, metadata });
      this.emit('agentHealthCheckFailed', { agentId, metadata });
    });
  }

  private async handleTaskCompleted(result: TaskResult, agentId: string): Promise<void> {
    try {
      // Remove from running tasks
      this.taskQueue.running.delete(result.taskId);
      
      // Add to appropriate queue
      if (result.status === TaskStatus.COMPLETED) {
        this.taskQueue.completed.push(result);
      } else {
        this.taskQueue.failed.push(result);
      }
      
      // Notify plugins
      await this.pluginManager.notifyTaskCompleted(result);
      
      // Send result message
      await this.messageBus.send({
        type: MessageType.TASK_RESULT,
        from: 'orchestrator',
        payload: { result },
        correlationId: result.taskId
      });
      
      this.emit('taskCompleted', { result, agentId });
      this.logger.info('Task completed', { 
        taskId: result.taskId, 
        status: result.status, 
        agentId,
        executionTime: result.executionTime 
      });
      
    } catch (error) {
      this.logger.error('Failed to handle task completion', { 
        taskId: result.taskId, 
        agentId, 
        error 
      });
    }
  }

  private startTaskScheduler(): void {
    this.taskSchedulerTimer = setInterval(async () => {
      await this.scheduleNextTasks();
    }, 1000); // Check every second
  }

  private async scheduleNextTasks(): Promise<void> {
    if (!this.isRunning || this.taskQueue.pending.length === 0) {
      return;
    }

    // Sort pending tasks by priority and creation time
    const sortedTasks = [...this.taskQueue.pending].sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      return a.createdAt.getTime() - b.createdAt.getTime(); // Older tasks first
    });

    for (const task of sortedTasks) {
      const availableAgent = this.findAvailableAgent(task);
      if (availableAgent) {
        await this.assignTaskToAgent(task, availableAgent);
      }
    }
  }

  private findAvailableAgent(task: Task): BaseAgent | undefined {
    for (const [agentId, agent] of this.agentRegistry.agents.entries()) {
      const metadata = this.agentRegistry.metadata.get(agentId);
      if (!metadata) continue;
      
      // Check if agent is available and can handle the task
      if (metadata.status === AgentStatus.IDLE || 
          (metadata.status === AgentStatus.BUSY && 
           metadata.currentTasks.length < agent.getConfig().maxConcurrentTasks)) {
        
        if (agent.canHandleTask(task.type, task.requirements)) {
          return agent;
        }
      }
    }
    
    return undefined;
  }

  private async assignTaskToAgent(task: Task, agent: BaseAgent): Promise<void> {
    try {
      // Remove from pending queue
      this.taskQueue.pending = this.taskQueue.pending.filter(t => t.id !== task.id);
      
      // Add to running tasks
      this.taskQueue.running.set(task.id, {
        task,
        agentId: agent.getConfig().id,
        startTime: new Date()
      });
      
      // Assign task to agent
      await agent.assignTask(task);
      
      this.logger.info('Task assigned to agent', { 
        taskId: task.id, 
        agentId: agent.getConfig().id 
      });
      
    } catch (error) {
      // Move task back to pending if assignment failed
      this.taskQueue.running.delete(task.id);
      this.addTaskToPendingQueue(task);
      
      this.logger.error('Failed to assign task to agent', { 
        taskId: task.id, 
        agentId: agent.getConfig().id, 
        error 
      });
    }
  }

  private addTaskToPendingQueue(task: Task): void {
    // Check if task is scheduled for future execution
    if (task.scheduledAt && task.scheduledAt > new Date()) {
      // Set timeout to add task to queue when scheduled time arrives
      const delay = task.scheduledAt.getTime() - Date.now();
      setTimeout(() => {
        if (this.isRunning) {
          this.taskQueue.pending.push(task);
        }
      }, delay);
    } else {
      this.taskQueue.pending.push(task);
    }
  }

  private validateTask(task: Task): void {
    if (!task.type || task.type.trim().length === 0) {
      throw new TaskError('Task type is required', task.id);
    }
    
    if (!Object.values(TaskPriority).includes(task.priority)) {
      throw new TaskError(`Invalid task priority: ${task.priority}`, task.id);
    }
    
    if (task.deadline && task.deadline <= new Date()) {
      throw new TaskError('Task deadline is in the past', task.id);
    }
    
    if (task.scheduledAt && task.deadline && task.scheduledAt > task.deadline) {
      throw new TaskError('Task scheduled time is after deadline', task.id);
    }
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  private async performHealthChecks(): Promise<void> {
    // Check for timed out tasks
    const now = Date.now();
    const timedOutTasks: string[] = [];
    
    for (const [taskId, info] of this.taskQueue.running.entries()) {
      const timeout = info.task.timeout || this.config.taskTimeout;
      if (now - info.startTime.getTime() > timeout) {
        timedOutTasks.push(taskId);
      }
    }
    
    // Cancel timed out tasks
    for (const taskId of timedOutTasks) {
      try {
        await this.cancelTask(taskId);
        this.logger.warn('Task timed out and cancelled', { taskId });
      } catch (error) {
        this.logger.error('Failed to cancel timed out task', { taskId, error });
      }
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, 60000); // Cleanup every minute
  }

  private performCleanup(): void {
    // Keep only last 1000 completed/failed tasks
    if (this.taskQueue.completed.length > 1000) {
      this.taskQueue.completed = this.taskQueue.completed.slice(-1000);
    }
    
    if (this.taskQueue.failed.length > 1000) {
      this.taskQueue.failed = this.taskQueue.failed.slice(-1000);
    }
    
    // Clear message bus history
    this.messageBus.clearHistory();
  }
}