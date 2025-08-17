/**
 * Work Distribution Engine
 * 
 * Intelligently distributes work across CC instances based on:
 * - Task complexity and estimated duration
 * - Instance capacity and current load
 * - Priority and dependencies
 * - Context locality for related tasks
 */

import { EventEmitter } from 'eventemitter3';
import { CCInstanceManager } from './CCInstanceManager';

export interface WorkItem {
  id: string;
  type: 'PROJECT' | 'INITIATIVE' | 'FEATURE' | 'STORY' | 'TASK';
  parentId?: string;
  dependencies?: string[];
  priority: number;
  complexity: 'low' | 'medium' | 'high' | 'critical';
  estimatedDuration?: number;
  context?: any;
  input: any;
  retryCount?: number;
  maxRetries?: number;
}

export interface WorkDistributionStrategy {
  type: 'round-robin' | 'least-loaded' | 'context-aware' | 'priority-based' | 'hybrid';
  contextAffinity?: boolean;  // Keep related work on same instance
  loadBalancing?: boolean;    // Distribute based on instance load
  priorityQueuing?: boolean;  // Process high priority first
}

export interface DistributionMetrics {
  totalWork: number;
  distributed: number;
  pending: number;
  completed: number;
  failed: number;
  avgWaitTime: number;
  avgExecutionTime: number;
  throughput: number;
  efficiency: number;
}

/**
 * Distributes work items across CC instances
 */
export class WorkDistributor extends EventEmitter {
  private instanceManager: CCInstanceManager;
  private strategy: WorkDistributionStrategy;
  private workQueue: Map<string, WorkItem> = new Map();
  private pendingWork: WorkItem[] = [];
  private inProgressWork: Map<string, WorkItem> = new Map();
  private completedWork: Map<string, any> = new Map();
  private instanceWorkMap: Map<string, Set<string>> = new Map();
  private contextInstanceMap: Map<string, string> = new Map();
  private metrics: DistributionMetrics;
  private distributionInterval?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    instanceManager: CCInstanceManager,
    strategy: WorkDistributionStrategy = {
      type: 'hybrid',
      contextAffinity: true,
      loadBalancing: true,
      priorityQueuing: true
    }
  ) {
    super();
    this.instanceManager = instanceManager;
    this.strategy = strategy;
    this.metrics = this.initializeMetrics();
    this.initialize();
  }

  private initialize(): void {
    // Start distribution loop
    this.startDistribution();
    this.emit('initialized', this.strategy);
  }

  /**
   * Add work item to distribution queue
   */
  addWork(work: WorkItem | WorkItem[]): void {
    const items = Array.isArray(work) ? work : [work];
    
    for (const item of items) {
      this.workQueue.set(item.id, item);
      this.pendingWork.push(item);
      this.metrics.totalWork++;
      this.emit('work:added', item);
    }
    
    // Sort pending work by priority and dependencies
    this.sortPendingWork();
  }

  /**
   * Start work distribution
   */
  startDistribution(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.distributionInterval = setInterval(() => {
      this.distributeWork();
    }, 100); // Check every 100ms
    
    this.emit('distribution:started');
  }

  /**
   * Stop work distribution
   */
  stopDistribution(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.distributionInterval) {
      clearInterval(this.distributionInterval);
    }
    
    this.emit('distribution:stopped');
  }

  /**
   * Main distribution logic
   */
  private async distributeWork(): Promise<void> {
    if (this.pendingWork.length === 0) return;
    
    // Get available instances
    const stats = this.instanceManager.getStats();
    if (stats.available === 0 && stats.total >= 50) {
      // All instances busy and at max capacity
      return;
    }
    
    // Process pending work items
    const itemsToDistribute = this.getNextWorkItems();
    
    for (const item of itemsToDistribute) {
      const instanceId = await this.selectInstance(item);
      if (instanceId) {
        await this.assignWorkToInstance(item, instanceId);
      }
    }
  }

  /**
   * Get next work items to distribute
   */
  private getNextWorkItems(): WorkItem[] {
    const items: WorkItem[] = [];
    const maxBatch = 10; // Process up to 10 items at once
    
    for (let i = 0; i < Math.min(maxBatch, this.pendingWork.length); i++) {
      const item = this.pendingWork[i];
      
      // Check dependencies
      if (this.areDependenciesCompleted(item)) {
        items.push(item);
      }
    }
    
    return items;
  }

  /**
   * Check if work item dependencies are completed
   */
  private areDependenciesCompleted(item: WorkItem): boolean {
    if (!item.dependencies || item.dependencies.length === 0) {
      return true;
    }
    
    return item.dependencies.every(depId => 
      this.completedWork.has(depId)
    );
  }

  /**
   * Select best instance for work item
   */
  private async selectInstance(item: WorkItem): Promise<string | null> {
    switch (this.strategy.type) {
      case 'context-aware':
        return this.selectContextAwareInstance(item);
      
      case 'least-loaded':
        return this.selectLeastLoadedInstance();
      
      case 'priority-based':
        return this.selectPriorityBasedInstance(item);
      
      case 'round-robin':
        return this.selectRoundRobinInstance();
      
      case 'hybrid':
      default:
        return this.selectHybridInstance(item);
    }
  }

  /**
   * Context-aware instance selection
   */
  private async selectContextAwareInstance(item: WorkItem): Promise<string | null> {
    // Check if parent work was processed by specific instance
    if (item.parentId && this.contextInstanceMap.has(item.parentId)) {
      const instanceId = this.contextInstanceMap.get(item.parentId)!;
      const stats = this.instanceManager.getStats();
      const instance = stats.instances.find(i => i.id === instanceId);
      
      if (instance && instance.status === 'ready') {
        return instanceId;
      }
    }
    
    // Fall back to least loaded
    return this.selectLeastLoadedInstance();
  }

  /**
   * Select least loaded instance
   */
  private async selectLeastLoadedInstance(): Promise<string | null> {
    const stats = this.instanceManager.getStats();
    
    // Find instance with least work
    let minLoad = Infinity;
    let selectedId: string | null = null;
    
    for (const instance of stats.instances) {
      if (instance.status === 'ready') {
        const load = this.instanceWorkMap.get(instance.id)?.size || 0;
        if (load < minLoad) {
          minLoad = load;
          selectedId = instance.id;
        }
      }
    }
    
    // Create new instance if needed and possible
    if (!selectedId && stats.total < 50) {
      selectedId = await this.instanceManager.createInstance();
    }
    
    return selectedId;
  }

  /**
   * Priority-based instance selection
   */
  private async selectPriorityBasedInstance(item: WorkItem): Promise<string | null> {
    // High priority items get dedicated instances
    if (item.priority <= 2 && item.complexity === 'critical') {
      const instanceId = await this.instanceManager.createInstance({
        memory: 1024, // More memory for critical tasks
        timeout: 120000 // Longer timeout
      });
      return instanceId;
    }
    
    return this.selectLeastLoadedInstance();
  }

  /**
   * Round-robin instance selection
   */
  private async selectRoundRobinInstance(): Promise<string | null> {
    const stats = this.instanceManager.getStats();
    const availableInstances = stats.instances.filter(i => i.status === 'ready');
    
    if (availableInstances.length === 0) {
      return this.instanceManager.createInstance();
    }
    
    // Simple round-robin
    const index = this.metrics.distributed % availableInstances.length;
    return availableInstances[index].id;
  }

  /**
   * Hybrid instance selection (combines multiple strategies)
   */
  private async selectHybridInstance(item: WorkItem): Promise<string | null> {
    // Priority 1: Context affinity for related work
    if (this.strategy.contextAffinity && item.parentId) {
      const contextInstance = await this.selectContextAwareInstance(item);
      if (contextInstance) return contextInstance;
    }
    
    // Priority 2: Critical items get dedicated resources
    if (item.priority === 1 || item.complexity === 'critical') {
      return this.selectPriorityBasedInstance(item);
    }
    
    // Priority 3: Load balancing
    if (this.strategy.loadBalancing) {
      return this.selectLeastLoadedInstance();
    }
    
    // Fall back to round-robin
    return this.selectRoundRobinInstance();
  }

  /**
   * Assign work to instance
   */
  private async assignWorkToInstance(item: WorkItem, instanceId: string): Promise<void> {
    const startTime = Date.now();
    
    // Remove from pending
    const index = this.pendingWork.findIndex(w => w.id === item.id);
    if (index !== -1) {
      this.pendingWork.splice(index, 1);
    }
    
    // Add to in-progress
    this.inProgressWork.set(item.id, item);
    
    // Track instance work
    if (!this.instanceWorkMap.has(instanceId)) {
      this.instanceWorkMap.set(instanceId, new Set());
    }
    this.instanceWorkMap.get(instanceId)!.add(item.id);
    
    // Track context mapping
    if (item.parentId) {
      this.contextInstanceMap.set(item.id, instanceId);
    }
    
    // Update metrics
    this.metrics.distributed++;
    this.metrics.pending = this.pendingWork.length;
    const waitTime = startTime - (item as any).addedTime || 0;
    this.updateAverageWaitTime(waitTime);
    
    this.emit('work:assigned', { item, instanceId });
    
    try {
      // Execute work on instance
      const result = await this.instanceManager.executeOnInstance(
        instanceId,
        item,
        this.getTimeout(item)
      );
      
      // Handle completion
      this.handleWorkCompletion(item, instanceId, result);
      
    } catch (error) {
      // Handle failure
      this.handleWorkFailure(item, instanceId, error as Error);
    }
  }

  /**
   * Handle work completion
   */
  private handleWorkCompletion(item: WorkItem, instanceId: string, result: any): void {
    const executionTime = Date.now() - (this.inProgressWork.get(item.id) as any).startTime;
    
    // Update tracking
    this.inProgressWork.delete(item.id);
    this.completedWork.set(item.id, result);
    this.instanceWorkMap.get(instanceId)?.delete(item.id);
    
    // Update metrics
    this.metrics.completed++;
    this.updateAverageExecutionTime(executionTime);
    this.updateThroughput();
    
    // Release instance
    this.instanceManager.releaseInstance(instanceId);
    
    this.emit('work:completed', { item, instanceId, result, executionTime });
  }

  /**
   * Handle work failure
   */
  private handleWorkFailure(item: WorkItem, instanceId: string, error: Error): void {
    this.inProgressWork.delete(item.id);
    this.instanceWorkMap.get(instanceId)?.delete(item.id);
    
    // Retry logic
    item.retryCount = (item.retryCount || 0) + 1;
    const maxRetries = item.maxRetries || 3;
    
    if (item.retryCount < maxRetries) {
      // Re-add to pending with increased priority
      item.priority = Math.max(1, item.priority - 1);
      this.pendingWork.push(item);
      this.sortPendingWork();
      
      this.emit('work:retry', { item, attempt: item.retryCount });
    } else {
      // Max retries reached
      this.metrics.failed++;
      this.emit('work:failed', { item, instanceId, error });
    }
    
    // Release instance
    this.instanceManager.releaseInstance(instanceId);
  }

  /**
   * Sort pending work by priority and dependencies
   */
  private sortPendingWork(): void {
    this.pendingWork.sort((a, b) => {
      // First by priority
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      
      // Then by complexity
      const complexityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const aComplexity = complexityOrder[a.complexity];
      const bComplexity = complexityOrder[b.complexity];
      
      if (aComplexity !== bComplexity) {
        return aComplexity - bComplexity;
      }
      
      // Finally by dependencies (items with fewer deps first)
      const aDeps = a.dependencies?.length || 0;
      const bDeps = b.dependencies?.length || 0;
      return aDeps - bDeps;
    });
  }

  /**
   * Get timeout for work item
   */
  private getTimeout(item: WorkItem): number {
    if (item.estimatedDuration) {
      return item.estimatedDuration * 1.5; // 50% buffer
    }
    
    // Default timeouts by complexity
    const timeouts = {
      low: 30000,
      medium: 60000,
      high: 120000,
      critical: 180000
    };
    
    return timeouts[item.complexity];
  }

  /**
   * Update metrics
   */
  private updateAverageWaitTime(waitTime: number): void {
    const total = this.metrics.avgWaitTime * (this.metrics.distributed - 1);
    this.metrics.avgWaitTime = (total + waitTime) / this.metrics.distributed;
  }

  private updateAverageExecutionTime(executionTime: number): void {
    const total = this.metrics.avgExecutionTime * (this.metrics.completed || 1);
    this.metrics.avgExecutionTime = (total + executionTime) / (this.metrics.completed + 1);
  }

  private updateThroughput(): void {
    const elapsed = Date.now() - (this as any).startTime || 1;
    this.metrics.throughput = (this.metrics.completed / elapsed) * 1000 * 60; // per minute
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): DistributionMetrics {
    return {
      totalWork: 0,
      distributed: 0,
      pending: 0,
      completed: 0,
      failed: 0,
      avgWaitTime: 0,
      avgExecutionTime: 0,
      throughput: 0,
      efficiency: 0
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): DistributionMetrics {
    this.metrics.efficiency = this.metrics.completed / Math.max(1, this.metrics.distributed);
    return { ...this.metrics };
  }

  /**
   * Get work status
   */
  getWorkStatus(): {
    pending: WorkItem[];
    inProgress: WorkItem[];
    completed: string[];
    failed: number;
  } {
    return {
      pending: [...this.pendingWork],
      inProgress: Array.from(this.inProgressWork.values()),
      completed: Array.from(this.completedWork.keys()),
      failed: this.metrics.failed
    };
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    this.stopDistribution();
    this.workQueue.clear();
    this.pendingWork = [];
    this.inProgressWork.clear();
    this.completedWork.clear();
    this.instanceWorkMap.clear();
    this.contextInstanceMap.clear();
  }
}

export default WorkDistributor;