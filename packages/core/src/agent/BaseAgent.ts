import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  AgentConfig,
  AgentStatus,
  AgentMetadata,
  Task,
  TaskResult,
  TaskStatus,
  TaskHandler,
  Message,
  MessageType,
  HealthCheckFunction,
  AgentError,
  TaskError,
  CAIAError
} from '../types/index.js';
import { Logger } from 'winston';

export abstract class BaseAgent extends EventEmitter {
  protected readonly config: AgentConfig;
  protected status: AgentStatus = AgentStatus.INACTIVE;
  protected currentTasks: Map<string, Task> = new Map();
  protected completedTasksCount = 0;
  protected failedTasksCount = 0;
  protected startTime: Date;
  protected lastHeartbeat: Date;
  protected logger: Logger;
  private healthCheckTimer?: NodeJS.Timeout;
  private taskTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: AgentConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ agentId: config.id, agentName: config.name });
    this.startTime = new Date();
    this.lastHeartbeat = new Date();
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing agent', { config: this.config });
      
      await this.onInitialize();
      
      this.status = AgentStatus.IDLE;
      this.lastHeartbeat = new Date();
      
      // Start health check if interval is configured
      if (this.config.healthCheckInterval && this.config.healthCheckInterval > 0) {
        this.startHealthCheck();
      }
      
      this.emit('initialized', this.getMetadata());
      this.logger.info('Agent initialized successfully');
    } catch (error) {
      this.status = AgentStatus.ERROR;
      const agentError = new AgentError(
        `Failed to initialize agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.config.id,
        { originalError: error }
      );
      this.logger.error('Agent initialization failed', { error: agentError });
      this.emit('error', agentError);
      throw agentError;
    }
  }

  /**
   * Shutdown the agent gracefully
   */
  async shutdown(): Promise<void> {
    try {
      this.logger.info('Shutting down agent');
      
      this.status = AgentStatus.TERMINATING;
      
      // Stop health check
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = undefined;
      }
      
      // Cancel all running tasks
      const cancelPromises = Array.from(this.currentTasks.keys()).map(taskId => 
        this.cancelTask(taskId)
      );
      await Promise.allSettled(cancelPromises);
      
      // Cleanup task timeouts
      this.taskTimeouts.forEach(timeout => clearTimeout(timeout));
      this.taskTimeouts.clear();
      
      await this.onShutdown();
      
      this.status = AgentStatus.TERMINATED;
      this.emit('shutdown', this.getMetadata());
      this.logger.info('Agent shutdown completed');
    } catch (error) {
      const agentError = new AgentError(
        `Failed to shutdown agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.config.id,
        { originalError: error }
      );
      this.logger.error('Agent shutdown failed', { error: agentError });
      throw agentError;
    }
  }

  /**
   * Assign a task to the agent
   */
  async assignTask(task: Task): Promise<void> {
    if (this.status !== AgentStatus.IDLE && this.status !== AgentStatus.BUSY) {
      throw new AgentError(`Agent is not available for task assignment. Status: ${this.status}`, this.config.id);
    }

    if (this.currentTasks.size >= this.config.maxConcurrentTasks) {
      throw new AgentError(
        `Agent has reached maximum concurrent tasks limit: ${this.config.maxConcurrentTasks}`,
        this.config.id
      );
    }

    // Validate task requirements
    if (task.requirements && task.requirements.length > 0) {
      const hasRequiredCapabilities = task.requirements.every(requirement =>
        this.config.capabilities.some(capability => capability.name === requirement)
      );
      
      if (!hasRequiredCapabilities) {
        throw new AgentError(
          `Agent does not have required capabilities: ${task.requirements.join(', ')}`,
          this.config.id,
          { requiredCapabilities: task.requirements, availableCapabilities: this.config.capabilities }
        );
      }
    }

    try {
      this.currentTasks.set(task.id, task);
      this.status = AgentStatus.BUSY;
      
      this.logger.info('Task assigned', { taskId: task.id, taskType: task.type });
      this.emit('taskAssigned', task);
      
      // Set task timeout if specified
      const timeout = task.timeout || this.config.timeout;
      if (timeout) {
        const timeoutHandle = setTimeout(() => {
          this.handleTaskTimeout(task.id);
        }, timeout);
        this.taskTimeouts.set(task.id, timeoutHandle);
      }
      
      // Execute task asynchronously
      this.executeTaskAsync(task);
      
    } catch (error) {
      this.currentTasks.delete(task.id);
      if (this.currentTasks.size === 0) {
        this.status = AgentStatus.IDLE;
      }
      
      const taskError = new TaskError(
        `Failed to assign task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        task.id,
        { agentId: this.config.id, originalError: error }
      );
      this.logger.error('Task assignment failed', { error: taskError });
      throw taskError;
    }
  }

  /**
   * Cancel a running task
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = this.currentTasks.get(taskId);
    if (!task) {
      throw new TaskError(`Task not found: ${taskId}`, taskId, { agentId: this.config.id });
    }

    try {
      await this.onTaskCancel(task);
      
      this.currentTasks.delete(taskId);
      
      // Clear timeout
      const timeout = this.taskTimeouts.get(taskId);
      if (timeout) {
        clearTimeout(timeout);
        this.taskTimeouts.delete(taskId);
      }
      
      if (this.currentTasks.size === 0) {
        this.status = AgentStatus.IDLE;
      }
      
      const result: TaskResult = {
        taskId,
        status: TaskStatus.CANCELLED,
        executionTime: Date.now() - task.createdAt.getTime(),
        completedAt: new Date()
      };
      
      this.logger.info('Task cancelled', { taskId });
      this.emit('taskCompleted', result);
      
    } catch (error) {
      const taskError = new TaskError(
        `Failed to cancel task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        taskId,
        { agentId: this.config.id, originalError: error }
      );
      this.logger.error('Task cancellation failed', { error: taskError });
      throw taskError;
    }
  }

  /**
   * Handle incoming messages
   */
  async handleMessage(message: Message): Promise<void> {
    try {
      this.logger.debug('Received message', { messageId: message.id, type: message.type, from: message.from });
      
      switch (message.type) {
        case MessageType.TASK_ASSIGNMENT:
          if (message.payload.task) {
            await this.assignTask(message.payload.task as Task);
          }
          break;
          
        case MessageType.SYSTEM_EVENT:
          await this.onSystemEvent(message);
          break;
          
        default:
          await this.onMessage(message);
          break;
      }
      
    } catch (error) {
      const agentError = new AgentError(
        `Failed to handle message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.config.id,
        { messageId: message.id, originalError: error }
      );
      this.logger.error('Message handling failed', { error: agentError });
      this.emit('error', agentError);
    }
  }

  /**
   * Get agent metadata
   */
  getMetadata(): AgentMetadata {
    return {
      id: this.config.id,
      name: this.config.name,
      status: this.status,
      capabilities: this.config.capabilities,
      currentTasks: Array.from(this.currentTasks.keys()),
      completedTasks: this.completedTasksCount,
      failedTasks: this.failedTasksCount,
      uptime: Date.now() - this.startTime.getTime(),
      lastHeartbeat: this.lastHeartbeat,
      version: this.getVersion()
    };
  }

  /**
   * Check if agent can handle a specific task type
   */
  canHandleTask(taskType: string, requirements?: string[]): boolean {
    const hasCapability = this.config.capabilities.some(cap => cap.name === taskType);
    if (!hasCapability) return false;
    
    if (requirements && requirements.length > 0) {
      return requirements.every(req =>
        this.config.capabilities.some(cap => cap.name === req)
      );
    }
    
    return true;
  }

  /**
   * Get agent configuration
   */
  getConfig(): Readonly<AgentConfig> {
    return Object.freeze({ ...this.config });
  }

  // Protected methods for subclasses to implement

  /**
   * Initialize agent-specific logic
   */
  protected abstract onInitialize(): Promise<void>;

  /**
   * Shutdown agent-specific logic
   */
  protected abstract onShutdown(): Promise<void>;

  /**
   * Execute a task
   */
  protected abstract executeTask(task: Task): Promise<TaskResult>;

  /**
   * Handle task cancellation
   */
  protected abstract onTaskCancel(task: Task): Promise<void>;

  /**
   * Handle incoming messages (override for custom message handling)
   */
  protected async onMessage(message: Message): Promise<void> {
    // Default implementation - subclasses can override
    this.logger.debug('Received unhandled message', { message });
  }

  /**
   * Handle system events
   */
  protected async onSystemEvent(message: Message): Promise<void> {
    // Default implementation - subclasses can override
    this.logger.debug('Received system event', { event: message.payload });
  }

  /**
   * Get agent version (override in subclasses)
   */
  protected getVersion(): string {
    return '1.0.0';
  }

  /**
   * Health check implementation (override for custom health checks)
   */
  protected async healthCheck(): Promise<boolean> {
    return this.status !== AgentStatus.ERROR && this.status !== AgentStatus.TERMINATED;
  }

  // Private methods

  private async executeTaskAsync(task: Task): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting task execution', { taskId: task.id });
      
      const result = await this.executeTask(task);
      
      // Clear timeout
      const timeout = this.taskTimeouts.get(task.id);
      if (timeout) {
        clearTimeout(timeout);
        this.taskTimeouts.delete(task.id);
      }
      
      // Update task tracking
      this.currentTasks.delete(task.id);
      this.completedTasksCount++;
      
      if (this.currentTasks.size === 0) {
        this.status = AgentStatus.IDLE;
      }
      
      result.executionTime = Date.now() - startTime;
      result.completedAt = new Date();
      
      this.logger.info('Task completed successfully', { 
        taskId: task.id, 
        executionTime: result.executionTime,
        status: result.status 
      });
      
      this.emit('taskCompleted', result);
      
    } catch (error) {
      // Clear timeout
      const timeout = this.taskTimeouts.get(task.id);
      if (timeout) {
        clearTimeout(timeout);
        this.taskTimeouts.delete(task.id);
      }
      
      // Update task tracking
      this.currentTasks.delete(task.id);
      this.failedTasksCount++;
      
      if (this.currentTasks.size === 0) {
        this.status = AgentStatus.IDLE;
      }
      
      const result: TaskResult = {
        taskId: task.id,
        status: TaskStatus.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
        executionTime: Date.now() - startTime,
        completedAt: new Date()
      };
      
      this.logger.error('Task execution failed', { 
        taskId: task.id, 
        executionTime: result.executionTime,
        error: result.error 
      });
      
      this.emit('taskCompleted', result);
      this.emit('error', new TaskError(
        `Task execution failed: ${result.error.message}`,
        task.id,
        { agentId: this.config.id, originalError: error }
      ));
    }
  }

  private async handleTaskTimeout(taskId: string): Promise<void> {
    const task = this.currentTasks.get(taskId);
    if (!task) return;
    
    this.logger.warn('Task timeout', { taskId, timeout: task.timeout || this.config.timeout });
    
    try {
      await this.cancelTask(taskId);
    } catch (error) {
      this.logger.error('Failed to cancel timed out task', { taskId, error });
    }
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    this.healthCheckTimer = setInterval(async () => {
      try {
        const isHealthy = await this.healthCheck();
        this.lastHeartbeat = new Date();
        
        if (!isHealthy && this.status !== AgentStatus.ERROR) {
          this.status = AgentStatus.ERROR;
          this.emit('healthCheckFailed', this.getMetadata());
          this.logger.error('Health check failed');
        } else if (isHealthy && this.status === AgentStatus.ERROR) {
          this.status = this.currentTasks.size > 0 ? AgentStatus.BUSY : AgentStatus.IDLE;
          this.emit('healthCheckRecovered', this.getMetadata());
          this.logger.info('Health check recovered');
        }
        
        this.emit('heartbeat', this.getMetadata());
        
      } catch (error) {
        this.logger.error('Health check error', { error });
      }
    }, this.config.healthCheckInterval);
  }
}