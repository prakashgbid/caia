import { EventEmitter } from 'events';
import axios from 'axios';

export interface Task {
  id: string;
  title: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimatedHours: number;
  dependencies: string[];
  labels: string[];
  priority: number;
}

export interface CCInstanceProfile {
  id: string;
  capacity: number;
  currentLoad: number;
  specializations: string[];
  performance: number;
  availability: 'available' | 'busy' | 'offline';
  completedTasks: number;
  averageCompletionTime: number;
}

export interface AllocationStrategy {
  type: 'round-robin' | 'load-balanced' | 'specialized' | 'performance-based';
  maxTasksPerInstance?: number;
  preferSpecialization?: boolean;
  balanceLoad?: boolean;
}

export interface AllocationResult {
  taskId: string;
  instanceId: string;
  confidence: number;
  estimatedCompletionTime: number;
  alternativeInstances: string[];
}

export class TaskAllocator extends EventEmitter {
  private instances: Map<string, CCInstanceProfile>;
  private taskQueue: Task[];
  private allocations: Map<string, AllocationResult>;
  private strategy: AllocationStrategy;

  constructor(strategy: AllocationStrategy = { type: 'load-balanced' }) {
    super();
    this.instances = new Map();
    this.taskQueue = [];
    this.allocations = new Map();
    this.strategy = strategy;
  }

  registerInstance(profile: CCInstanceProfile): void {
    this.instances.set(profile.id, profile);
    this.emit('instance:registered', profile);
    this.processQueue();
  }

  updateInstanceProfile(id: string, updates: Partial<CCInstanceProfile>): void {
    const profile = this.instances.get(id);
    if (profile) {
      Object.assign(profile, updates);
      this.emit('instance:updated', profile);
      this.rebalanceIfNeeded();
    }
  }

  async allocateTask(task: Task): Promise<AllocationResult> {
    this.emit('allocation:start', task);
    
    const bestInstance = this.findBestInstance(task);
    
    if (!bestInstance) {
      this.taskQueue.push(task);
      this.emit('task:queued', task);
      throw new Error('No available instance for task');
    }

    const allocation: AllocationResult = {
      taskId: task.id,
      instanceId: bestInstance.id,
      confidence: this.calculateConfidence(task, bestInstance),
      estimatedCompletionTime: this.estimateCompletionTime(task, bestInstance),
      alternativeInstances: this.findAlternatives(task, bestInstance.id)
    };

    this.allocations.set(task.id, allocation);
    bestInstance.currentLoad += task.estimatedHours;
    
    this.emit('allocation:complete', allocation);
    return allocation;
  }

  private findBestInstance(task: Task): CCInstanceProfile | null {
    const availableInstances = Array.from(this.instances.values()).filter(
      instance => instance.availability === 'available' &&
                  instance.currentLoad + task.estimatedHours <= instance.capacity
    );

    if (availableInstances.length === 0) return null;

    switch (this.strategy.type) {
      case 'round-robin':
        return this.roundRobinSelect(availableInstances);
      case 'specialized':
        return this.specializedSelect(availableInstances, task);
      case 'performance-based':
        return this.performanceSelect(availableInstances);
      case 'load-balanced':
      default:
        return this.loadBalancedSelect(availableInstances);
    }
  }

  private roundRobinSelect(instances: CCInstanceProfile[]): CCInstanceProfile {
    return instances[0];
  }

  private specializedSelect(instances: CCInstanceProfile[], task: Task): CCInstanceProfile {
    const scored = instances.map(instance => ({
      instance,
      score: this.calculateSpecializationScore(instance, task)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].instance;
  }

  private performanceSelect(instances: CCInstanceProfile[]): CCInstanceProfile {
    return instances.reduce((best, current) => 
      current.performance > best.performance ? current : best
    );
  }

  private loadBalancedSelect(instances: CCInstanceProfile[]): CCInstanceProfile {
    return instances.reduce((best, current) => {
      const bestUtilization = best.currentLoad / best.capacity;
      const currentUtilization = current.currentLoad / current.capacity;
      return currentUtilization < bestUtilization ? current : best;
    });
  }

  private calculateSpecializationScore(instance: CCInstanceProfile, task: Task): number {
    const matchingSpecs = instance.specializations.filter(spec =>
      task.labels.includes(spec)
    );
    return matchingSpecs.length * 10 + instance.performance;
  }

  private calculateConfidence(task: Task, instance: CCInstanceProfile): number {
    let confidence = 0.5;
    
    if (instance.performance > 0.9) confidence += 0.2;
    if (instance.completedTasks > 10) confidence += 0.1;
    
    const specScore = this.calculateSpecializationScore(instance, task) / 100;
    confidence += Math.min(0.2, specScore);
    
    return Math.min(1, confidence);
  }

  private estimateCompletionTime(task: Task, instance: CCInstanceProfile): number {
    const baseTime = task.estimatedHours;
    const performanceFactor = 2 - instance.performance;
    const loadFactor = 1 + (instance.currentLoad / instance.capacity) * 0.5;
    
    return baseTime * performanceFactor * loadFactor;
  }

  private findAlternatives(task: Task, excludeId: string): string[] {
    return Array.from(this.instances.values())
      .filter(instance => 
        instance.id !== excludeId &&
        instance.availability === 'available' &&
        instance.currentLoad + task.estimatedHours <= instance.capacity
      )
      .sort((a, b) => this.calculateSpecializationScore(b, task) - this.calculateSpecializationScore(a, task))
      .slice(0, 3)
      .map(instance => instance.id);
  }

  private processQueue(): void {
    const pendingTasks = [...this.taskQueue];
    this.taskQueue = [];
    
    for (const task of pendingTasks) {
      try {
        this.allocateTask(task);
      } catch (error) {
        this.taskQueue.push(task);
      }
    }
  }

  private rebalanceIfNeeded(): void {
    if (this.strategy.balanceLoad) {
      this.emit('rebalance:start');
      // Rebalancing logic here
      this.emit('rebalance:complete');
    }
  }

  getAllocations(): Map<string, AllocationResult> {
    return new Map(this.allocations);
  }

  getQueueStatus(): { queued: number; allocated: number; instances: number } {
    return {
      queued: this.taskQueue.length,
      allocated: this.allocations.size,
      instances: this.instances.size
    };
  }

  async deallocateTask(taskId: string): Promise<void> {
    const allocation = this.allocations.get(taskId);
    if (allocation) {
      const instance = this.instances.get(allocation.instanceId);
      if (instance) {
        // Assuming we stored the task's estimated hours somewhere
        instance.currentLoad = Math.max(0, instance.currentLoad - 1);
        instance.completedTasks++;
      }
      this.allocations.delete(taskId);
      this.emit('task:deallocated', taskId);
      this.processQueue();
    }
  }
}