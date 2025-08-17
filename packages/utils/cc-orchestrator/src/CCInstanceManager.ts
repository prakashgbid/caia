/**
 * CC Instance Manager
 * 
 * Manages the lifecycle of Claude Code instances for parallel execution.
 * Handles spawning, monitoring, recycling, and termination of CC instances.
 */

import { EventEmitter } from 'eventemitter3';
import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';

export interface CCInstanceConfig {
  id: string;
  memory?: number;           // Memory limit in MB
  timeout?: number;          // Max execution time in ms
  env?: Record<string, string>;
  preserveContext?: boolean;
  autoRecycle?: boolean;     // Auto-recycle after N tasks
  recycleThreshold?: number; // Number of tasks before recycle
}

export interface CCInstanceStats {
  id: string;
  pid?: number;
  status: 'starting' | 'ready' | 'busy' | 'error' | 'terminated';
  tasksCompleted: number;
  tasksFailed: number;
  memoryUsage: number;
  cpuUsage: number;
  uptime: number;
  lastActivity: Date;
}

export interface CCCommand {
  type: 'EXECUTE' | 'CONTEXT' | 'STATUS' | 'TERMINATE';
  payload: any;
  timeout?: number;
  callback?: (result: any) => void;
}

/**
 * Manages individual CC instances
 */
export class CCInstanceManager extends EventEmitter {
  private instances: Map<string, CCInstanceInfo> = new Map();
  private availablePool: Set<string> = new Set();
  private busyPool: Set<string> = new Set();
  private maxInstances: number;
  private instanceCounter = 0;
  private monitoring = true;
  private monitorInterval?: NodeJS.Timeout;

  constructor(maxInstances = 50) {
    super();
    this.maxInstances = maxInstances;
    this.startMonitoring();
  }

  /**
   * Create a new CC instance
   */
  async createInstance(config?: Partial<CCInstanceConfig>): Promise<string> {
    if (this.instances.size >= this.maxInstances) {
      throw new Error(`Maximum instances limit reached: ${this.maxInstances}`);
    }

    const id = config?.id || `cc-${++this.instanceCounter}-${Date.now()}`;
    
    const instanceConfig: CCInstanceConfig = {
      id,
      memory: 512,
      timeout: 60000,
      preserveContext: true,
      autoRecycle: true,
      recycleThreshold: 10,
      ...config
    };

    const instanceInfo = await this.spawnInstance(instanceConfig);
    this.instances.set(id, instanceInfo);
    this.availablePool.add(id);
    
    this.emit('instance:created', { id, config: instanceConfig });
    
    return id;
  }

  /**
   * Spawn a CC process
   */
  private async spawnInstance(config: CCInstanceConfig): Promise<CCInstanceInfo> {
    return new Promise((resolve, reject) => {
      // Prepare environment variables
      const env = {
        ...process.env,
        CC_INSTANCE_ID: config.id,
        CC_MEMORY_LIMIT: String(config.memory),
        CC_TIMEOUT: String(config.timeout),
        CC_PRESERVE_CONTEXT: String(config.preserveContext),
        NODE_OPTIONS: `--max-old-space-size=${config.memory}`,
        ...config.env
      };

      // Spawn CC worker process
      const ccProcess = spawn('node', [
        this.getWorkerPath(),
        '--instance-id', config.id
      ], {
        env,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      });

      const instanceInfo: CCInstanceInfo = {
        id: config.id,
        process: ccProcess,
        config,
        stats: {
          id: config.id,
          pid: ccProcess.pid,
          status: 'starting',
          tasksCompleted: 0,
          tasksFailed: 0,
          memoryUsage: 0,
          cpuUsage: 0,
          uptime: 0,
          lastActivity: new Date()
        },
        messageQueue: [],
        context: {}
      };

      // Handle process events
      ccProcess.on('message', (message) => {
        this.handleInstanceMessage(config.id, message);
      });

      ccProcess.on('error', (error) => {
        this.handleInstanceError(config.id, error);
        reject(error);
      });

      ccProcess.on('exit', (code, signal) => {
        this.handleInstanceExit(config.id, code, signal);
      });

      // Wait for ready signal
      ccProcess.once('message', (message: any) => {
        if (message.type === 'READY') {
          instanceInfo.stats.status = 'ready';
          this.emit('instance:ready', config.id);
          resolve(instanceInfo);
        }
      });

      // Set timeout for initialization
      setTimeout(() => {
        if (instanceInfo.stats.status === 'starting') {
          ccProcess.kill();
          reject(new Error(`Instance ${config.id} failed to start within timeout`));
        }
      }, 10000);
    });
  }

  /**
   * Get an available instance
   */
  async getAvailableInstance(): Promise<string> {
    // Check for available instances
    if (this.availablePool.size > 0) {
      const id = this.availablePool.values().next().value;
      this.availablePool.delete(id);
      this.busyPool.add(id);
      return id;
    }

    // Create new instance if under limit
    if (this.instances.size < this.maxInstances) {
      const id = await this.createInstance();
      this.availablePool.delete(id);
      this.busyPool.add(id);
      return id;
    }

    // Wait for an instance to become available
    return this.waitForAvailableInstance();
  }

  /**
   * Execute task on instance
   */
  async executeOnInstance(instanceId: string, task: any, timeout = 60000): Promise<any> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Task execution timeout on instance ${instanceId}`));
      }, timeout);

      // Send task to instance
      instance.process.send({
        type: 'EXECUTE',
        payload: task,
        id: `task-${Date.now()}`
      });

      // Wait for response
      const responseHandler = (message: any) => {
        if (message.type === 'RESULT') {
          clearTimeout(timeoutHandle);
          instance.process.removeListener('message', responseHandler);
          
          // Update stats
          if (message.success) {
            instance.stats.tasksCompleted++;
          } else {
            instance.stats.tasksFailed++;
          }
          instance.stats.lastActivity = new Date();
          
          // Check if recycle needed
          if (instance.config.autoRecycle && 
              instance.stats.tasksCompleted >= instance.config.recycleThreshold!) {
            this.recycleInstance(instanceId);
          }
          
          resolve(message.result);
        }
      };

      instance.process.on('message', responseHandler);
    });
  }

  /**
   * Release instance back to pool
   */
  releaseInstance(instanceId: string): void {
    if (this.busyPool.has(instanceId)) {
      this.busyPool.delete(instanceId);
      this.availablePool.add(instanceId);
      this.emit('instance:released', instanceId);
    }
  }

  /**
   * Recycle an instance
   */
  async recycleInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    this.emit('instance:recycling', instanceId);
    
    // Preserve context if needed
    const context = instance.config.preserveContext ? instance.context : {};
    
    // Terminate old instance
    await this.terminateInstance(instanceId);
    
    // Create new instance with same config
    const newInstance = await this.createInstance({
      ...instance.config,
      id: instanceId
    });
    
    // Restore context
    const newInstanceInfo = this.instances.get(newInstance);
    if (newInstanceInfo) {
      newInstanceInfo.context = context;
    }
    
    this.emit('instance:recycled', instanceId);
  }

  /**
   * Terminate an instance
   */
  async terminateInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    // Remove from pools
    this.availablePool.delete(instanceId);
    this.busyPool.delete(instanceId);
    
    // Send terminate signal
    instance.process.send({ type: 'TERMINATE' });
    
    // Wait for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        instance.process.kill('SIGKILL');
        resolve();
      }, 5000);
      
      instance.process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    // Remove from instances
    this.instances.delete(instanceId);
    this.emit('instance:terminated', instanceId);
  }

  /**
   * Terminate all instances
   */
  async terminateAll(): Promise<void> {
    const promises = Array.from(this.instances.keys()).map(id => 
      this.terminateInstance(id)
    );
    await Promise.all(promises);
  }

  /**
   * Handle instance message
   */
  private handleInstanceMessage(instanceId: string, message: any): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    switch (message.type) {
      case 'STATUS':
        instance.stats = { ...instance.stats, ...message.stats };
        break;
      
      case 'CONTEXT':
        instance.context = message.context;
        break;
      
      case 'LOG':
        this.emit('instance:log', { instanceId, log: message.log });
        break;
      
      case 'ERROR':
        this.emit('instance:error', { instanceId, error: message.error });
        break;
    }
  }

  /**
   * Handle instance error
   */
  private handleInstanceError(instanceId: string, error: Error): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.stats.status = 'error';
    }
    
    this.emit('instance:error', { instanceId, error });
    
    // Auto-recycle on error
    this.recycleInstance(instanceId);
  }

  /**
   * Handle instance exit
   */
  private handleInstanceExit(instanceId: string, code: number | null, signal: string | null): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.stats.status = 'terminated';
    }
    
    this.emit('instance:exit', { instanceId, code, signal });
    
    // Remove from pools
    this.availablePool.delete(instanceId);
    this.busyPool.delete(instanceId);
    this.instances.delete(instanceId);
  }

  /**
   * Wait for available instance
   */
  private waitForAvailableInstance(): Promise<string> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.availablePool.size > 0) {
          clearInterval(checkInterval);
          const id = this.availablePool.values().next().value;
          this.availablePool.delete(id);
          this.busyPool.add(id);
          resolve(id);
        }
      }, 100);
    });
  }

  /**
   * Start monitoring instances
   */
  private startMonitoring(): void {
    this.monitorInterval = setInterval(() => {
      this.updateInstanceStats();
    }, 5000);
  }

  /**
   * Update instance statistics
   */
  private updateInstanceStats(): void {
    for (const [id, instance] of this.instances) {
      if (instance.process.pid) {
        // Get process stats (in production, use proper process monitoring)
        const stats = this.getProcessStats(instance.process.pid);
        instance.stats.memoryUsage = stats.memory;
        instance.stats.cpuUsage = stats.cpu;
        instance.stats.uptime = Date.now() - instance.stats.lastActivity.getTime();
      }
    }
  }

  /**
   * Get process statistics
   */
  private getProcessStats(pid: number): { memory: number; cpu: number } {
    // In production, use proper process monitoring
    // For now, return mock values
    return {
      memory: Math.random() * 512,
      cpu: Math.random() * 100
    };
  }

  /**
   * Get worker script path
   */
  private getWorkerPath(): string {
    // In production, return actual CC worker path
    return __dirname + '/cc-worker.js';
  }

  /**
   * Get instance statistics
   */
  getStats(): {
    total: number;
    available: number;
    busy: number;
    instances: CCInstanceStats[];
  } {
    return {
      total: this.instances.size,
      available: this.availablePool.size,
      busy: this.busyPool.size,
      instances: Array.from(this.instances.values()).map(i => i.stats)
    };
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    this.monitoring = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    await this.terminateAll();
  }
}

interface CCInstanceInfo {
  id: string;
  process: ChildProcess;
  config: CCInstanceConfig;
  stats: CCInstanceStats;
  messageQueue: any[];
  context: any;
}

export default CCInstanceManager;