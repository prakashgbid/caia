/**
 * @caia/work-divider
 * Intelligent work distribution engine for parallel task execution
 */

export interface WorkItem {
  id: string;
  size?: number;
  complexity?: number;
  dependencies?: string[];
  priority?: number;
  estimatedDuration?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkShard {
  id: string;
  items: WorkItem[];
  totalSize: number;
  totalComplexity: number;
  estimatedDuration: number;
  workerIndex: number;
}

export interface WorkloadAnalysis {
  totalItems: number;
  totalSize: number;
  totalComplexity: number;
  averageComplexity: number;
  complexityDistribution: Record<string, number>;
  dependencyGraph: Map<string, string[]>;
  criticalPath: string[];
}

export interface HistoricalData {
  itemId: string;
  actualDuration: number;
  timestamp: number;
}

export interface RuntimeFeedback {
  shardId: string;
  completedItems: number;
  remainingItems: number;
  currentThroughput: number;
  estimatedCompletion: number;
}

export interface DependencyGraph {
  nodes: Map<string, WorkItem>;
  edges: Map<string, Set<string>>;
}

export interface Distribution {
  shards: WorkShard[];
  efficiency: number;
  balance: number;
}

export class WorkDivider {
  private historicalData: Map<string, HistoricalData[]> = new Map();
  
  /**
   * Analyze workload characteristics
   */
  analyzeWorkload(items: WorkItem[]): WorkloadAnalysis {
    const totalSize = items.reduce((sum, item) => sum + (item.size || 1), 0);
    const totalComplexity = items.reduce((sum, item) => sum + (item.complexity || 1), 0);
    
    const complexityDistribution: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };
    
    items.forEach(item => {
      const complexity = item.complexity || 1;
      if (complexity <= 2) complexityDistribution.low++;
      else if (complexity <= 5) complexityDistribution.medium++;
      else if (complexity <= 8) complexityDistribution.high++;
      else complexityDistribution.critical++;
    });
    
    const dependencyGraph = this.buildDependencyGraph(items);
    const criticalPath = this.findCriticalPath(dependencyGraph);
    
    return {
      totalItems: items.length,
      totalSize,
      totalComplexity,
      averageComplexity: totalComplexity / items.length,
      complexityDistribution,
      dependencyGraph,
      criticalPath
    };
  }
  
  /**
   * Calculate complexity score for a work item
   */
  calculateComplexity(item: WorkItem): number {
    if (item.complexity) return item.complexity;
    
    let complexity = 1;
    
    // Factor in size
    if (item.size) {
      complexity += Math.log2(item.size);
    }
    
    // Factor in dependencies
    if (item.dependencies && item.dependencies.length > 0) {
      complexity += item.dependencies.length * 0.5;
    }
    
    // Factor in priority
    if (item.priority) {
      complexity *= (1 + item.priority / 10);
    }
    
    return Math.round(complexity * 100) / 100;
  }
  
  /**
   * Estimate duration for a work item
   */
  estimateDuration(item: WorkItem, history?: HistoricalData): number {
    if (item.estimatedDuration) return item.estimatedDuration;
    
    // Check historical data
    if (history) {
      return history.actualDuration;
    }
    
    const historicalItems = this.historicalData.get(item.id);
    if (historicalItems && historicalItems.length > 0) {
      // Use weighted average of historical durations
      const weights = historicalItems.map((_, i) => Math.pow(0.9, i));
      const weightedSum = historicalItems.reduce(
        (sum, h, i) => sum + h.actualDuration * weights[i],
        0
      );
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      return weightedSum / totalWeight;
    }
    
    // Fallback to complexity-based estimation
    const complexity = this.calculateComplexity(item);
    return complexity * 100; // 100ms per complexity unit
  }
  
  /**
   * Divide work by size
   */
  divideBySize(items: WorkItem[], workers: number): WorkShard[] {
    const _targetSize = items.reduce((sum, item) => sum + (item.size || 1), 0) / workers;
    const shards: WorkShard[] = [];
    
    for (let i = 0; i < workers; i++) {
      shards.push({
        id: `shard-${i}`,
        items: [],
        totalSize: 0,
        totalComplexity: 0,
        estimatedDuration: 0,
        workerIndex: i
      });
    }
    
    // Sort items by size (largest first)
    const sortedItems = [...items].sort((a, b) => (b.size || 1) - (a.size || 1));
    
    // Distribute items using best-fit algorithm
    sortedItems.forEach(item => {
      const bestShard = shards.reduce((best, shard) => 
        shard.totalSize < best.totalSize ? shard : best
      );
      
      bestShard.items.push(item);
      bestShard.totalSize += item.size || 1;
      bestShard.totalComplexity += this.calculateComplexity(item);
      bestShard.estimatedDuration += this.estimateDuration(item);
    });
    
    return shards;
  }
  
  /**
   * Divide work by complexity
   */
  divideByComplexity(items: WorkItem[], threshold: number): WorkShard[] {
    const shards: WorkShard[] = [];
    let currentShard: WorkShard | null = null;
    let shardIndex = 0;
    
    // Sort items by complexity
    const sortedItems = [...items].sort((a, b) => 
      this.calculateComplexity(b) - this.calculateComplexity(a)
    );
    
    sortedItems.forEach(item => {
      const complexity = this.calculateComplexity(item);
      
      if (!currentShard || currentShard.totalComplexity + complexity > threshold) {
        currentShard = {
          id: `shard-${shardIndex++}`,
          items: [],
          totalSize: 0,
          totalComplexity: 0,
          estimatedDuration: 0,
          workerIndex: shardIndex - 1
        };
        shards.push(currentShard);
      }
      
      currentShard.items.push(item);
      currentShard.totalSize += item.size || 1;
      currentShard.totalComplexity += complexity;
      currentShard.estimatedDuration += this.estimateDuration(item);
    });
    
    return shards;
  }
  
  /**
   * Divide work considering dependencies
   */
  divideByDependencies(items: WorkItem[], graph: DependencyGraph): WorkShard[] {
    const levels = this.topologicalSort(graph);
    const shards: WorkShard[] = [];
    
    // Create shards for each dependency level
    levels.forEach((level, index) => {
      const shard: WorkShard = {
        id: `shard-${index}`,
        items: [],
        totalSize: 0,
        totalComplexity: 0,
        estimatedDuration: 0,
        workerIndex: index
      };
      
      level.forEach(itemId => {
        const item = graph.nodes.get(itemId);
        if (item) {
          shard.items.push(item);
          shard.totalSize += item.size || 1;
          shard.totalComplexity += this.calculateComplexity(item);
          shard.estimatedDuration += this.estimateDuration(item);
        }
      });
      
      if (shard.items.length > 0) {
        shards.push(shard);
      }
    });
    
    return shards;
  }
  
  /**
   * Divide work by resource needs
   */
  divideByResourceNeeds(items: WorkItem[], resources: { memory: number; cpu: number }): WorkShard[] {
    // Implementation would consider resource requirements
    // For now, delegate to size-based division
    const workers = Math.min(resources.cpu, Math.floor(resources.memory / 512));
    return this.divideBySize(items, workers);
  }
  
  /**
   * Rebalance shards based on runtime feedback
   */
  rebalance(shards: WorkShard[], feedback: RuntimeFeedback): WorkShard[] {
    // Find underutilized and overutilized shards
    const _avgThroughput = shards.reduce((sum, _shard) => {
      const shardFeedback = feedback; // In real implementation, would lookup by shard.id
      return sum + shardFeedback.currentThroughput;
    }, 0) / shards.length;
    
    const rebalanced = [...shards];
    
    // Move items from slow shards to fast shards
    // Implementation would be more sophisticated
    
    return rebalanced;
  }
  
  /**
   * Optimize distribution based on metrics
   */
  optimizeDistribution(current: Distribution, metrics: { throughput: number; latency: number }): Distribution {
    // Calculate new efficiency score
    const efficiency = metrics.throughput / (metrics.latency + 1);
    
    // If current distribution is good enough, keep it
    if (efficiency > current.efficiency * 1.1) {
      return current;
    }
    
    // Otherwise, rebalance
    // Implementation would use genetic algorithm or similar
    
    return current;
  }
  
  /**
   * Build dependency graph from work items
   */
  private buildDependencyGraph(items: WorkItem[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    
    items.forEach(item => {
      graph.set(item.id, item.dependencies || []);
    });
    
    return graph;
  }
  
  /**
   * Find critical path in dependency graph
   */
  private findCriticalPath(graph: Map<string, string[]>): string[] {
    // Simplified critical path finding
    // In production, would use proper CPM algorithm
    const path: string[] = [];
    const visited = new Set<string>();
    
    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      const deps = graph.get(nodeId) || [];
      deps.forEach(dep => dfs(dep));
      
      path.push(nodeId);
    };
    
    graph.forEach((_, nodeId) => {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    });
    
    return path;
  }
  
  /**
   * Topological sort for dependency resolution
   */
  private topologicalSort(graph: DependencyGraph): string[][] {
    const levels: string[][] = [];
    const inDegree = new Map<string, number>();
    
    // Calculate in-degrees
    graph.nodes.forEach((_, nodeId) => {
      inDegree.set(nodeId, 0);
    });
    
    graph.edges.forEach(deps => {
      deps.forEach(dep => {
        inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
      });
    });
    
    // Process nodes level by level
    while (inDegree.size > 0) {
      const currentLevel: string[] = [];
      
      inDegree.forEach((degree, nodeId) => {
        if (degree === 0) {
          currentLevel.push(nodeId);
        }
      });
      
      if (currentLevel.length === 0) {
        throw new Error('Circular dependency detected');
      }
      
      currentLevel.forEach(nodeId => {
        inDegree.delete(nodeId);
        const deps = graph.edges.get(nodeId) || new Set();
        deps.forEach(dep => {
          const current = inDegree.get(dep);
          if (current !== undefined) {
            inDegree.set(dep, current - 1);
          }
        });
      });
      
      levels.push(currentLevel);
    }
    
    return levels;
  }
  
  /**
   * Store historical data for future estimations
   */
  addHistoricalData(itemId: string, actualDuration: number): void {
    const history = this.historicalData.get(itemId) || [];
    history.unshift({
      itemId,
      actualDuration,
      timestamp: Date.now()
    });
    
    // Keep only last 10 records
    if (history.length > 10) {
      history.pop();
    }
    
    this.historicalData.set(itemId, history);
  }
}

// Export types
export * from './types';

// Export main class as default
export default WorkDivider;