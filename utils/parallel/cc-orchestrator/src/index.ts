/**
 * @caia/util-cc-orchestrator
 * 
 * Orchestrates massive parallel Claude Code instances for ParaForge workflow.
 * Handles spawning 100s of CC instances for hierarchical Jira ticket creation.
 */

import { EventEmitter } from 'eventemitter3';
import PQueue from 'p-queue';
import Bottleneck from 'bottleneck';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export interface CCInstance {
  id: string;
  process: ChildProcess;
  status: 'idle' | 'busy' | 'error' | 'terminated';
  currentTask?: CCTask;
  startTime: Date;
  completedTasks: number;
}

export interface CCTask {
  id: string;
  type: 'PROJECT' | 'INITIATIVE' | 'FEATURE' | 'STORY' | 'TASK';
  parentId?: string;
  input: any;
  context: any;
  priority: number;
  retries: number;
  timeout: number;
}

export interface CCResult {
  taskId: string;
  success: boolean;
  data?: any;
  error?: Error;
  duration: number;
  instanceId: string;
}

export interface OrchestratorConfig {
  maxInstances: number;          // Max CC instances running simultaneously
  instancesPerMinute: number;    // Rate limit for spawning new instances
  tasksPerInstance: number;      // Max tasks per CC instance before recycling
  taskTimeout: number;            // Timeout per task (ms)
  apiRateLimit: number;          // API calls per minute
  retryAttempts: number;         // Retries for failed tasks
  contextPreservation: boolean;  // Maintain context across instances
  debug: boolean;
}

/**
 * Claude Code Orchestrator
 * Manages parallel CC instances for massive concurrent operations
 */
export class CCOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private instances: Map<string, CCInstance> = new Map();
  private taskQueue: PQueue;
  private rateLimiter: Bottleneck;
  private results: Map<string, CCResult> = new Map();
  private contextStore: Map<string, any> = new Map();
  private metrics = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    activeInstances: 0,
    totalInstances: 0,
    avgTaskDuration: 0
  };

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    
    this.config = {
      maxInstances: 50,
      instancesPerMinute: 30,
      tasksPerInstance: 10,
      taskTimeout: 60000,
      apiRateLimit: 100,
      retryAttempts: 3,
      contextPreservation: true,
      debug: false,
      ...config
    };

    // Initialize task queue with concurrency limit
    this.taskQueue = new PQueue({
      concurrency: this.config.maxInstances,
      interval: 60000,
      intervalCap: this.config.apiRateLimit
    });

    // Initialize rate limiter for API calls
    this.rateLimiter = new Bottleneck({
      maxConcurrent: this.config.maxInstances,
      minTime: 60000 / this.config.apiRateLimit,
      reservoir: this.config.apiRateLimit,
      reservoirRefreshAmount: this.config.apiRateLimit,
      reservoirRefreshInterval: 60000
    });

    this.initialize();
  }

  private initialize(): void {
    this.log('CC Orchestrator initialized', this.config);
    this.emit('initialized', this.config);
  }

  /**
   * Execute ParaForge workflow with massive parallelization
   */
  async executeParaForgeWorkflow(projectInput: any): Promise<any> {
    this.log('Starting ParaForge workflow');
    this.emit('workflow:start', projectInput);

    try {
      // Phase 1: Create PROJECT epic with single CC+PO instance
      const projectResult = await this.executeTask({
        id: `project-${Date.now()}`,
        type: 'PROJECT',
        input: projectInput,
        context: {},
        priority: 1,
        retries: 0,
        timeout: this.config.taskTimeout * 2
      });

      if (!projectResult.success) {
        throw new Error('Failed to create PROJECT epic');
      }

      // Phase 2: Create INITIATIVEs in parallel
      const initiatives = this.extractInitiatives(projectResult.data);
      const initiativeResults = await this.executeParallelTasks(
        initiatives.map((init, i) => ({
          id: `initiative-${i}-${Date.now()}`,
          type: 'INITIATIVE' as const,
          parentId: projectResult.taskId,
          input: init,
          context: this.getContext(projectResult.taskId),
          priority: 2,
          retries: 0,
          timeout: this.config.taskTimeout
        }))
      );

      // Phase 3: Create FEATUREs in parallel (spawn new CC for each)
      const featureTasks: CCTask[] = [];
      for (const initResult of initiativeResults) {
        if (initResult.success) {
          const features = this.extractFeatures(initResult.data);
          featureTasks.push(...features.map((feat, i) => ({
            id: `feature-${initResult.taskId}-${i}-${Date.now()}`,
            type: 'FEATURE' as const,
            parentId: initResult.taskId,
            input: feat,
            context: this.getContext(initResult.taskId),
            priority: 3,
            retries: 0,
            timeout: this.config.taskTimeout
          })));
        }
      }
      const featureResults = await this.executeParallelTasks(featureTasks);

      // Phase 4: Create STORIEs in parallel (spawn new CC for each)
      const storyTasks: CCTask[] = [];
      for (const featResult of featureResults) {
        if (featResult.success) {
          const stories = this.extractStories(featResult.data);
          storyTasks.push(...stories.map((story, i) => ({
            id: `story-${featResult.taskId}-${i}-${Date.now()}`,
            type: 'STORY' as const,
            parentId: featResult.taskId,
            input: story,
            context: this.getContext(featResult.taskId),
            priority: 4,
            retries: 0,
            timeout: this.config.taskTimeout
          })));
        }
      }
      const storyResults = await this.executeParallelTasks(storyTasks);

      // Phase 5: Create TASKs in parallel (spawn new CC for each)
      const taskTasks: CCTask[] = [];
      for (const storyResult of storyResults) {
        if (storyResult.success) {
          const tasks = this.extractTasks(storyResult.data);
          taskTasks.push(...tasks.map((task, i) => ({
            id: `task-${storyResult.taskId}-${i}-${Date.now()}`,
            type: 'TASK' as const,
            parentId: storyResult.taskId,
            input: task,
            context: this.getContext(storyResult.taskId),
            priority: 5,
            retries: 0,
            timeout: this.config.taskTimeout
          })));
        }
      }
      const taskResults = await this.executeParallelTasks(taskTasks);

      // Aggregate all results
      const workflow = {
        project: projectResult,
        initiatives: initiativeResults,
        features: featureResults,
        stories: storyResults,
        tasks: taskResults,
        metrics: this.getMetrics()
      };

      this.emit('workflow:complete', workflow);
      return workflow;

    } catch (error) {
      this.emit('workflow:error', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: CCTask): Promise<CCResult> {
    return this.rateLimiter.schedule(() => 
      this.taskQueue.add(async () => {
        const startTime = Date.now();
        const instance = await this.getOrCreateInstance();
        
        try {
          this.metrics.totalTasks++;
          this.emit('task:start', task);
          
          // Execute task on CC instance
          const result = await this.executeOnInstance(instance, task);
          
          // Store result
          this.results.set(task.id, result);
          
          // Preserve context if enabled
          if (this.config.contextPreservation) {
            this.contextStore.set(task.id, result.data?.context);
          }
          
          this.metrics.completedTasks++;
          this.updateAverageTaskDuration(Date.now() - startTime);
          
          this.emit('task:complete', result);
          return result;
          
        } catch (error) {
          this.metrics.failedTasks++;
          
          const errorResult: CCResult = {
            taskId: task.id,
            success: false,
            error: error as Error,
            duration: Date.now() - startTime,
            instanceId: instance.id
          };
          
          // Retry logic
          if (task.retries < this.config.retryAttempts) {
            task.retries++;
            this.log(`Retrying task ${task.id} (attempt ${task.retries})`);
            return this.executeTask(task);
          }
          
          this.emit('task:error', errorResult);
          return errorResult;
        }
      })
    );
  }

  /**
   * Execute multiple tasks in parallel
   */
  private async executeParallelTasks(tasks: CCTask[]): Promise<CCResult[]> {
    this.log(`Executing ${tasks.length} tasks in parallel`);
    
    // Sort by priority
    tasks.sort((a, b) => a.priority - b.priority);
    
    // Execute all tasks in parallel with rate limiting
    const promises = tasks.map(task => this.executeTask(task));
    return Promise.all(promises);
  }

  /**
   * Get or create a CC instance
   */
  private async getOrCreateInstance(): Promise<CCInstance> {
    // Find an idle instance
    for (const [id, instance] of this.instances) {
      if (instance.status === 'idle' && 
          instance.completedTasks < this.config.tasksPerInstance) {
        return instance;
      }
    }
    
    // Create new instance if under limit
    if (this.instances.size < this.config.maxInstances) {
      return this.createInstance();
    }
    
    // Wait for an instance to become available
    await this.waitForAvailableInstance();
    return this.getOrCreateInstance();
  }

  /**
   * Create a new CC instance
   */
  private async createInstance(): Promise<CCInstance> {
    const id = `cc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.log(`Creating CC instance: ${id}`);
    
    // In production, this would spawn actual CC process
    // For now, simulate with child process
    const process = spawn('node', [
      path.join(__dirname, 'cc-worker.js'),
      '--id', id
    ], {
      env: {
        ...process.env,
        CC_INSTANCE_ID: id,
        CC_DEBUG: this.config.debug ? 'true' : 'false'
      }
    });
    
    const instance: CCInstance = {
      id,
      process,
      status: 'idle',
      startTime: new Date(),
      completedTasks: 0
    };
    
    this.instances.set(id, instance);
    this.metrics.totalInstances++;
    this.metrics.activeInstances++;
    
    this.emit('instance:created', instance);
    return instance;
  }

  /**
   * Execute task on specific CC instance
   */
  private async executeOnInstance(
    instance: CCInstance, 
    task: CCTask
  ): Promise<CCResult> {
    instance.status = 'busy';
    instance.currentTask = task;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Task ${task.id} timed out`));
      }, task.timeout);
      
      // In production, send task to CC instance via IPC
      // For now, simulate execution
      setTimeout(() => {
        clearTimeout(timeout);
        
        const result: CCResult = {
          taskId: task.id,
          success: true,
          data: this.simulateTaskExecution(task),
          duration: Math.random() * 5000 + 1000,
          instanceId: instance.id
        };
        
        instance.status = 'idle';
        instance.completedTasks++;
        instance.currentTask = undefined;
        
        resolve(result);
      }, Math.random() * 3000 + 1000);
    });
  }

  /**
   * Simulate task execution (in production, actual CC+PO execution)
   */
  private simulateTaskExecution(task: CCTask): any {
    switch (task.type) {
      case 'PROJECT':
        return {
          epicKey: 'PROJ-1',
          summary: 'PROJECT: AI-Powered Application',
          initiatives: ['Auth System', 'Dashboard', 'API']
        };
      
      case 'INITIATIVE':
        return {
          epicKey: `INIT-${Math.random().toString(36).substr(2, 5)}`,
          summary: `INITIATIVE: ${task.input}`,
          features: ['Feature 1', 'Feature 2']
        };
      
      case 'FEATURE':
        return {
          epicKey: `FEAT-${Math.random().toString(36).substr(2, 5)}`,
          summary: `FEATURE: ${task.input}`,
          stories: ['Story 1', 'Story 2']
        };
      
      case 'STORY':
        return {
          storyKey: `STORY-${Math.random().toString(36).substr(2, 5)}`,
          summary: `STORY: ${task.input}`,
          tasks: ['Task 1', 'Task 2']
        };
      
      case 'TASK':
        return {
          taskKey: `TASK-${Math.random().toString(36).substr(2, 5)}`,
          summary: `TASK: ${task.input}`,
          todos: ['TODO 1', 'TODO 2']
        };
      
      default:
        return {};
    }
  }

  /**
   * Extract initiatives from project result
   */
  private extractInitiatives(projectData: any): any[] {
    return projectData?.initiatives || [];
  }

  /**
   * Extract features from initiative result
   */
  private extractFeatures(initiativeData: any): any[] {
    return initiativeData?.features || [];
  }

  /**
   * Extract stories from feature result
   */
  private extractStories(featureData: any): any[] {
    return featureData?.stories || [];
  }

  /**
   * Extract tasks from story result
   */
  private extractTasks(storyData: any): any[] {
    return storyData?.tasks || [];
  }

  /**
   * Get preserved context for a parent task
   */
  private getContext(parentId?: string): any {
    if (!parentId || !this.config.contextPreservation) {
      return {};
    }
    return this.contextStore.get(parentId) || {};
  }

  /**
   * Wait for an instance to become available
   */
  private async waitForAvailableInstance(): Promise<void> {
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        for (const [, instance] of this.instances) {
          if (instance.status === 'idle') {
            clearInterval(checkInterval);
            resolve();
            return;
          }
        }
      }, 100);
    });
  }

  /**
   * Update average task duration metric
   */
  private updateAverageTaskDuration(duration: number): void {
    const total = this.metrics.avgTaskDuration * (this.metrics.completedTasks - 1);
    this.metrics.avgTaskDuration = (total + duration) / this.metrics.completedTasks;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      queueSize: this.taskQueue.size,
      pendingTasks: this.taskQueue.pending,
      instanceUtilization: this.metrics.activeInstances / this.config.maxInstances
    };
  }

  /**
   * Cleanup all instances
   */
  async cleanup(): Promise<void> {
    this.log('Cleaning up CC instances');
    
    for (const [id, instance] of this.instances) {
      instance.process.kill();
      this.instances.delete(id);
    }
    
    this.metrics.activeInstances = 0;
    this.emit('cleanup:complete');
  }

  /**
   * Log message
   */
  private log(message: string, ...args: any[]): void {
    if (this.config.debug) {
      console.log(`[CC-Orchestrator] ${message}`, ...args);
    }
  }
}

export default CCOrchestrator;