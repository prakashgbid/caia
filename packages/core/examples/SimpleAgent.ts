/**
 * Example implementation of a simple agent that extends BaseAgent
 * This demonstrates how to create custom agents for the CAIA system
 */

import { BaseAgent } from '../src/agent/BaseAgent.js';
import { 
  Task, 
  TaskResult, 
  TaskStatus, 
  AgentConfig, 
  Message,
  TaskError 
} from '../src/types/index.js';
import { Logger } from 'winston';

export interface SimpleAgentConfig extends AgentConfig {
  // Add any custom configuration for this agent
  processingDelay?: number;
  allowedTaskTypes?: string[];
}

/**
 * A simple agent that can handle basic text processing tasks
 */
export class SimpleAgent extends BaseAgent {
  private readonly processingDelay: number;
  private readonly allowedTaskTypes: Set<string>;
  private cancelledTasks: Set<string> = new Set();

  constructor(config: SimpleAgentConfig, logger: Logger) {
    super(config, logger);
    this.processingDelay = config.processingDelay || 1000;
    this.allowedTaskTypes = new Set(config.allowedTaskTypes || ['text-process', 'echo', 'delay']);
  }

  protected async onInitialize(): Promise<void> {
    this.logger.info('SimpleAgent initializing', { 
      agentId: this.config.id,
      processingDelay: this.processingDelay,
      allowedTaskTypes: Array.from(this.allowedTaskTypes)
    });
    
    // Perform any initialization logic here
    // For example, loading models, connecting to services, etc.
    
    this.logger.info('SimpleAgent initialized successfully');
  }

  protected async onShutdown(): Promise<void> {
    this.logger.info('SimpleAgent shutting down', { agentId: this.config.id });
    
    // Perform cleanup here
    // For example, closing connections, saving state, etc.
    
    this.logger.info('SimpleAgent shutdown completed');
  }

  protected async executeTask(task: Task): Promise<TaskResult> {
    this.logger.info('Executing task', { taskId: task.id, taskType: task.type });

    // Check if task type is supported
    if (!this.allowedTaskTypes.has(task.type)) {
      throw new TaskError(
        `Unsupported task type: ${task.type}. Supported types: ${Array.from(this.allowedTaskTypes).join(', ')}`,
        task.id
      );
    }

    // Check if task was cancelled
    if (this.cancelledTasks.has(task.id)) {
      this.cancelledTasks.delete(task.id);
      return {
        taskId: task.id,
        status: TaskStatus.CANCELLED,
        executionTime: 0,
        completedAt: new Date()
      };
    }

    try {
      let result: unknown;

      switch (task.type) {
        case 'echo':
          result = await this.handleEchoTask(task);
          break;
        case 'text-process':
          result = await this.handleTextProcessTask(task);
          break;
        case 'delay':
          result = await this.handleDelayTask(task);
          break;
        default:
          throw new TaskError(`Unknown task type: ${task.type}`, task.id);
      }

      return {
        taskId: task.id,
        status: TaskStatus.COMPLETED,
        result,
        executionTime: 0, // Will be set by BaseAgent
        completedAt: new Date(),
        metadata: {
          agentType: 'SimpleAgent',
          processingDelay: this.processingDelay
        }
      };

    } catch (error) {
      this.logger.error('Task execution failed', { 
        taskId: task.id, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      
      return {
        taskId: task.id,
        status: TaskStatus.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
        executionTime: 0, // Will be set by BaseAgent
        completedAt: new Date()
      };
    }
  }

  protected async onTaskCancel(task: Task): Promise<void> {
    this.logger.info('Cancelling task', { taskId: task.id });
    
    // Mark task as cancelled
    this.cancelledTasks.add(task.id);
    
    // Perform any cleanup specific to this task
    // For example, stopping ongoing operations, releasing resources, etc.
  }

  protected async onMessage(message: Message): Promise<void> {
    this.logger.debug('Received custom message', { 
      messageId: message.id, 
      type: message.type, 
      from: message.from 
    });
    
    // Handle custom messages specific to this agent
    // For example, configuration updates, status requests, etc.
  }

  protected getVersion(): string {
    return '1.0.0';
  }

  protected async healthCheck(): Promise<boolean> {
    // Perform health checks specific to this agent
    // For example, checking connectivity, resource availability, etc.
    
    try {
      // Simulate health check
      await this.sleep(100);
      return true;
    } catch (error) {
      this.logger.error('Health check failed', { error });
      return false;
    }
  }

  // Custom task handlers

  private async handleEchoTask(task: Task): Promise<string> {
    const input = task.payload.text as string;
    if (typeof input !== 'string') {
      throw new TaskError('Echo task requires text payload', task.id);
    }

    // Simulate processing delay
    await this.sleep(this.processingDelay);

    return `Echo: ${input}`;
  }

  private async handleTextProcessTask(task: Task): Promise<{
    original: string;
    processed: string;
    wordCount: number;
    characterCount: number;
  }> {
    const input = task.payload.text as string;
    if (typeof input !== 'string') {
      throw new TaskError('Text process task requires text payload', task.id);
    }

    // Simulate processing delay
    await this.sleep(this.processingDelay);

    const processed = input.toLowerCase().trim();
    const wordCount = processed.split(/\s+/).filter(word => word.length > 0).length;
    const characterCount = processed.length;

    return {
      original: input,
      processed,
      wordCount,
      characterCount
    };
  }

  private async handleDelayTask(task: Task): Promise<{ delayed: number }> {
    const delay = task.payload.delay as number;
    if (typeof delay !== 'number' || delay < 0) {
      throw new TaskError('Delay task requires positive delay payload', task.id);
    }

    // Apply the requested delay
    await this.sleep(delay);

    return { delayed: delay };
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public methods for external interaction

  /**
   * Get current agent statistics
   */
  public getAgentStats(): {
    currentTasks: number;
    completedTasks: number;
    failedTasks: number;
    supportedTaskTypes: string[];
    processingDelay: number;
  } {
    const metadata = this.getMetadata();
    
    return {
      currentTasks: metadata.currentTasks.length,
      completedTasks: metadata.completedTasks,
      failedTasks: metadata.failedTasks,
      supportedTaskTypes: Array.from(this.allowedTaskTypes),
      processingDelay: this.processingDelay
    };
  }

  /**
   * Update the processing delay
   */
  public updateProcessingDelay(delay: number): void {
    if (delay < 0) {
      throw new Error('Processing delay must be non-negative');
    }
    
    (this as any).processingDelay = delay;
    this.logger.info('Processing delay updated', { newDelay: delay });
  }

  /**
   * Add a new supported task type
   */
  public addSupportedTaskType(taskType: string): void {
    this.allowedTaskTypes.add(taskType);
    this.logger.info('Added supported task type', { taskType });
  }

  /**
   * Remove a supported task type
   */
  public removeSupportedTaskType(taskType: string): void {
    this.allowedTaskTypes.delete(taskType);
    this.logger.info('Removed supported task type', { taskType });
  }
}