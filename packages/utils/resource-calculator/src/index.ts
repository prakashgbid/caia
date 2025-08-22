/**
 * @caia/resource-calculator
 * System resource analysis and optimization calculator
 */

import * as os from 'os';
import { EventEmitter } from 'events';

export interface SystemResources {
  cpu: {
    cores: number;
    speed: number;
    model: string;
    usage: number;
    available: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    available: number;
    percentage: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    percentage: number;
  };
  network: {
    interfaces: NetworkInterface[];
    bandwidth: number;
  };
}

export interface NetworkInterface {
  name: string;
  address: string;
  netmask: string;
  family: string;
  internal: boolean;
}

export interface Task {
  id: string;
  name: string;
  memoryRequired: number;
  cpuRequired: number;
  diskRequired?: number;
  priority?: number;
  duration?: number;
}

export interface ResourceRequirement {
  memory: number;
  cpu: number;
  disk?: number;
  network?: number;
}

export interface ResourceAllocation {
  taskId: string;
  allocated: ResourceRequirement;
  workerId: number;
  startTime?: number;
  endTime?: number;
}

export interface CPUAllocation {
  cores: number[];
  tasksPerCore: Map<number, string[]>;
  utilization: number;
}

export interface ResourceMetrics {
  timestamp: number;
  cpu: number;
  memory: number;
  disk: number;
  network: number;
}

export interface Bottleneck {
  resource: 'cpu' | 'memory' | 'disk' | 'network';
  severity: 'low' | 'medium' | 'high' | 'critical';
  currentUsage: number;
  threshold: number;
  impact: string;
}

export interface Optimization {
  type: 'scale-up' | 'scale-out' | 'optimize' | 'redistribute';
  resource: string;
  currentValue: number;
  recommendedValue: number;
  expectedImprovement: number;
  reason: string;
}

export class ResourceCalculator extends EventEmitter {
  private monitoringInterval?: NodeJS.Timeout;
  private metricsHistory: ResourceMetrics[] = [];
  private readonly maxHistorySize = 1000;
  
  constructor() {
    super();
  }
  
  /**
   * Get available system resources
   */
  getAvailableResources(): SystemResources {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    
    // Calculate CPU usage
    const cpuUsage = this.calculateCPUUsage(cpus);
    
    // Get network interfaces
    const networkInterfaces = os.networkInterfaces();
    const interfaces: NetworkInterface[] = [];
    
    Object.keys(networkInterfaces).forEach(name => {
      const nets = networkInterfaces[name];
      if (nets) {
        nets.forEach(net => {
          interfaces.push({
            name,
            address: net.address,
            netmask: net.netmask,
            family: net.family,
            internal: net.internal
          });
        });
      }
    });
    
    return {
      cpu: {
        cores: cpus.length,
        speed: cpus[0]?.speed || 0,
        model: cpus[0]?.model || 'Unknown',
        usage: cpuUsage,
        available: 100 - cpuUsage
      },
      memory: {
        total: totalMemory,
        free: freeMemory,
        used: usedMemory,
        available: freeMemory,
        percentage: (usedMemory / totalMemory) * 100
      },
      disk: {
        total: 0, // Would need additional library for disk stats
        free: 0,
        used: 0,
        percentage: 0
      },
      network: {
        interfaces,
        bandwidth: this.estimateNetworkBandwidth()
      }
    };
  }
  
  /**
   * Calculate optimal number of workers based on resources
   */
  calculateOptimalWorkers(): number {
    const resources = this.getAvailableResources();
    
    // Consider CPU cores
    const cpuWorkers = resources.cpu.cores;
    
    // Consider memory (assume 512MB per worker minimum)
    const memoryWorkers = Math.floor(resources.memory.available / (512 * 1024 * 1024));
    
    // Take the minimum to avoid overcommitting
    const optimal = Math.min(cpuWorkers, memoryWorkers);
    
    // Apply safety margin (use 80% of available)
    const withMargin = Math.max(1, Math.floor(optimal * 0.8));
    
    this.emit('calculation', {
      type: 'optimal-workers',
      cpu: cpuWorkers,
      memory: memoryWorkers,
      optimal,
      final: withMargin
    });
    
    return withMargin;
  }
  
  /**
   * Predict resource usage for a task
   */
  predictResourceUsage(task: Task): ResourceRequirement {
    const baseMemory = task.memoryRequired || 256 * 1024 * 1024; // 256MB default
    const baseCPU = task.cpuRequired || 0.25; // 25% of one core default
    
    // Apply priority multiplier
    const priorityMultiplier = 1 + (task.priority || 0) / 10;
    
    // Apply duration factor (longer tasks might need more resources)
    const durationFactor = task.duration ? Math.log10(task.duration + 1) : 1;
    
    return {
      memory: Math.ceil(baseMemory * priorityMultiplier),
      cpu: Math.min(1, baseCPU * priorityMultiplier * durationFactor),
      disk: task.diskRequired || 0,
      network: 0 // Would need more sophisticated calculation
    };
  }
  
  /**
   * Allocate resources to tasks
   */
  allocateResources(tasks: Task[]): ResourceAllocation[] {
    const allocations: ResourceAllocation[] = [];
    const available = this.getAvailableResources();
    
    let remainingMemory = available.memory.available;
    let remainingCPU = available.cpu.available / 100 * available.cpu.cores;
    
    // Sort tasks by priority
    const sortedTasks = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    let workerId = 0;
    for (const task of sortedTasks) {
      const required = this.predictResourceUsage(task);
      
      if (required.memory <= remainingMemory && required.cpu <= remainingCPU) {
        allocations.push({
          taskId: task.id,
          allocated: required,
          workerId: workerId++,
          startTime: Date.now()
        });
        
        remainingMemory -= required.memory;
        remainingCPU -= required.cpu;
      } else {
        // Task cannot be allocated
        this.emit('allocation-failed', {
          task,
          reason: 'Insufficient resources',
          required,
          available: { memory: remainingMemory, cpu: remainingCPU }
        });
      }
    }
    
    return allocations;
  }
  
  /**
   * Calculate memory per worker
   */
  calculateMemoryPerWorker(totalMemory: number, overhead: number = 0.2): number {
    // Reserve overhead for system and other processes
    const availableMemory = totalMemory * (1 - overhead);
    const workers = this.calculateOptimalWorkers();
    
    return Math.floor(availableMemory / workers);
  }
  
  /**
   * Optimize CPU distribution
   */
  optimizeCPUDistribution(cores: number, tasks: Task[]): CPUAllocation {
    const tasksPerCore = new Map<number, string[]>();
    
    // Initialize cores
    for (let i = 0; i < cores; i++) {
      tasksPerCore.set(i, []);
    }
    
    // Distribute tasks using round-robin with load balancing
    const coreLoads = new Array(cores).fill(0);
    
    tasks.forEach(task => {
      // Find least loaded core
      let minLoad = coreLoads[0];
      let minCore = 0;
      
      for (let i = 1; i < cores; i++) {
        if (coreLoads[i] < minLoad) {
          minLoad = coreLoads[i];
          minCore = i;
        }
      }
      
      // Assign task to least loaded core
      const coreTasks = tasksPerCore.get(minCore) || [];
      coreTasks.push(task.id);
      tasksPerCore.set(minCore, coreTasks);
      
      // Update load
      coreLoads[minCore] += task.cpuRequired || 0.25;
    });
    
    // Calculate overall utilization
    const totalLoad = coreLoads.reduce((sum, load) => sum + load, 0);
    const utilization = (totalLoad / cores) * 100;
    
    return {
      cores: Array.from({ length: cores }, (_, i) => i),
      tasksPerCore,
      utilization
    };
  }
  
  /**
   * Track resource usage over time
   */
  trackResourceUsage(): ResourceMetrics {
    const resources = this.getAvailableResources();
    
    const metrics: ResourceMetrics = {
      timestamp: Date.now(),
      cpu: resources.cpu.usage,
      memory: resources.memory.percentage,
      disk: resources.disk.percentage,
      network: 0 // Would need bandwidth monitoring
    };
    
    // Add to history
    this.metricsHistory.push(metrics);
    
    // Trim history if too large
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift();
    }
    
    this.emit('metrics', metrics);
    
    return metrics;
  }
  
  /**
   * Detect resource bottlenecks
   */
  detectBottlenecks(): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];
    const resources = this.getAvailableResources();
    
    // Check CPU
    if (resources.cpu.usage > 80) {
      bottlenecks.push({
        resource: 'cpu',
        severity: resources.cpu.usage > 95 ? 'critical' : resources.cpu.usage > 90 ? 'high' : 'medium',
        currentUsage: resources.cpu.usage,
        threshold: 80,
        impact: 'Tasks may run slower than expected'
      });
    }
    
    // Check Memory
    if (resources.memory.percentage > 85) {
      bottlenecks.push({
        resource: 'memory',
        severity: resources.memory.percentage > 95 ? 'critical' : resources.memory.percentage > 90 ? 'high' : 'medium',
        currentUsage: resources.memory.percentage,
        threshold: 85,
        impact: 'System may start swapping, causing severe performance degradation'
      });
    }
    
    // Check Disk
    if (resources.disk.percentage > 90) {
      bottlenecks.push({
        resource: 'disk',
        severity: resources.disk.percentage > 98 ? 'critical' : resources.disk.percentage > 95 ? 'high' : 'medium',
        currentUsage: resources.disk.percentage,
        threshold: 90,
        impact: 'Disk operations may fail'
      });
    }
    
    return bottlenecks;
  }
  
  /**
   * Suggest optimizations based on current state
   */
  suggestOptimizations(): Optimization[] {
    const optimizations: Optimization[] = [];
    const resources = this.getAvailableResources();
    const bottlenecks = this.detectBottlenecks();
    
    bottlenecks.forEach(bottleneck => {
      if (bottleneck.resource === 'cpu' && bottleneck.severity === 'critical') {
        optimizations.push({
          type: 'scale-out',
          resource: 'cpu',
          currentValue: resources.cpu.cores,
          recommendedValue: resources.cpu.cores * 2,
          expectedImprovement: 50,
          reason: 'CPU usage is critically high, consider adding more workers or machines'
        });
      }
      
      if (bottleneck.resource === 'memory' && bottleneck.severity === 'high') {
        optimizations.push({
          type: 'optimize',
          resource: 'memory',
          currentValue: resources.memory.used,
          recommendedValue: resources.memory.used * 0.7,
          expectedImprovement: 30,
          reason: 'Memory usage is high, consider optimizing memory-intensive operations'
        });
      }
    });
    
    // Suggest worker count optimization
    const currentWorkers = this.calculateOptimalWorkers();
    const utilization = resources.cpu.usage;
    
    if (utilization < 50 && currentWorkers > 1) {
      optimizations.push({
        type: 'scale-up',
        resource: 'workers',
        currentValue: currentWorkers,
        recommendedValue: Math.ceil(currentWorkers / 2),
        expectedImprovement: 20,
        reason: 'CPU utilization is low, consider reducing worker count to save resources'
      });
    }
    
    return optimizations;
  }
  
  /**
   * Start monitoring resources
   */
  startMonitoring(interval: number = 1000): void {
    if (this.monitoringInterval) {
      return;
    }
    
    this.monitoringInterval = setInterval(() => {
      this.trackResourceUsage();
      
      const bottlenecks = this.detectBottlenecks();
      if (bottlenecks.length > 0) {
        this.emit('bottlenecks', bottlenecks);
      }
    }, interval);
  }
  
  /**
   * Stop monitoring resources
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }
  
  /**
   * Calculate CPU usage from CPU info
   */
  private calculateCPUUsage(cpus: os.CpuInfo[]): number {
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~(100 * idle / total);
    
    return usage;
  }
  
  /**
   * Estimate network bandwidth (simplified)
   */
  private estimateNetworkBandwidth(): number {
    // This would need actual network monitoring
    // For now, return a reasonable default (100 Mbps)
    return 100 * 1024 * 1024 / 8; // Convert to bytes/sec
  }
  
  /**
   * Get metrics history
   */
  getMetricsHistory(): ResourceMetrics[] {
    return [...this.metricsHistory];
  }
  
  /**
   * Clear metrics history
   */
  clearMetricsHistory(): void {
    this.metricsHistory = [];
  }
}

// Export default
export default ResourceCalculator;