/**
 * @caia/progress-tracker
 * Real-time progress monitoring and reporting
 */

import { EventEmitter } from 'events';

export interface ProgressItem {
  id: string;
  name: string;
  current: number;
  total: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  startTime?: number;
  endTime?: number;
  duration?: number;
  estimatedCompletion?: number;
  metadata?: Record<string, unknown>;
  parentId?: string;
  children?: string[];
}

export interface ProgressUpdate {
  id: string;
  current?: number;
  total?: number;
  status?: ProgressItem['status'];
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface ProgressStats {
  totalItems: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  cancelled: number;
  overallProgress: number;
  estimatedTimeRemaining?: number;
  averageItemDuration?: number;
  throughput?: number; // items per second
}

export interface ProgressSnapshot {
  timestamp: number;
  items: ProgressItem[];
  stats: ProgressStats;
}

export interface ProgressRenderer {
  render(items: ProgressItem[], stats: ProgressStats): string;
}

export interface ProgressNotification {
  id: string;
  type: 'started' | 'progress' | 'completed' | 'failed' | 'milestone';
  message: string;
  timestamp: number;
  progress?: number;
  metadata?: Record<string, unknown>;
}

export interface ProgressMilestone {
  id: string;
  name: string;
  threshold: number; // Progress percentage
  message: string;
  triggered: boolean;
}

export interface ProgressConfiguration {
  updateInterval?: number;
  autoCleanup?: boolean;
  cleanupDelay?: number;
  enableEstimation?: boolean;
  enableHistory?: boolean;
  maxHistorySize?: number;
  renderer?: ProgressRenderer;
}

export class ProgressTracker extends EventEmitter {
  private items: Map<string, ProgressItem> = new Map();
  private history: ProgressSnapshot[] = [];
  private milestones: Map<string, ProgressMilestone[]> = new Map();
  private notifications: ProgressNotification[] = [];
  private updateInterval?: NodeJS.Timeout;
  private cleanupTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private config: Required<ProgressConfiguration>;

  constructor(config: ProgressConfiguration = {}) {
    super();
    this.config = {
      updateInterval: 1000,
      autoCleanup: true,
      cleanupDelay: 30000,
      enableEstimation: true,
      enableHistory: true,
      maxHistorySize: 1000,
      renderer: new DefaultProgressRenderer(),
      ...config
    };
  }

  /**
   * Create a new progress item
   */
  create(id: string, name: string, total: number = 100, parentId?: string): ProgressItem {
    const item: ProgressItem = {
      id,
      name,
      current: 0,
      total,
      status: 'pending',
      progress: 0,
      startTime: Date.now(),
      children: [],
      parentId,
      metadata: {}
    };

    // Add to parent's children if specified
    if (parentId) {
      const parent = this.items.get(parentId);
      if (parent && parent.children) {
        parent.children.push(id);
      }
    }

    this.items.set(id, item);
    this.emit('item-created', item);
    
    this.addNotification({
      id,
      type: 'started',
      message: `Started: ${name}`,
      timestamp: Date.now()
    });

    return item;
  }

  /**
   * Start tracking an item
   */
  start(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;

    item.status = 'running';
    item.startTime = Date.now();
    
    this.items.set(id, item);
    this.emit('item-started', item);
    
    return true;
  }

  /**
   * Update progress for an item
   */
  update(id: string, update: ProgressUpdate): boolean {
    const item = this.items.get(id);
    if (!item) return false;

    const oldProgress = item.progress;
    
    // Update properties
    if (update.current !== undefined) {
      item.current = update.current;
    }
    if (update.total !== undefined) {
      item.total = update.total;
    }
    if (update.status !== undefined) {
      item.status = update.status;
    }
    if (update.metadata) {
      item.metadata = { ...item.metadata, ...update.metadata };
    }

    // Calculate progress
    item.progress = item.total > 0 ? Math.min(100, (item.current / item.total) * 100) : 0;

    // Update duration and estimation
    if (item.startTime) {
      item.duration = Date.now() - item.startTime;
      
      if (this.config.enableEstimation && item.progress > 0) {
        const timePerPercent = item.duration / item.progress;
        const remainingPercent = 100 - item.progress;
        item.estimatedCompletion = Date.now() + (timePerPercent * remainingPercent);
      }
    }

    this.items.set(id, item);
    
    // Check milestones
    this.checkMilestones(id, oldProgress, item.progress);
    
    // Update parent progress if this is a child
    if (item.parentId) {
      this.updateParentProgress(item.parentId);
    }

    this.emit('item-updated', item, update);
    
    this.addNotification({
      id,
      type: 'progress',
      message: update.message || `Progress: ${item.progress.toFixed(1)}%`,
      timestamp: Date.now(),
      progress: item.progress
    });

    return true;
  }

  /**
   * Complete an item
   */
  complete(id: string, message?: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;

    item.status = 'completed';
    item.current = item.total;
    item.progress = 100;
    item.endTime = Date.now();
    
    if (item.startTime) {
      item.duration = item.endTime - item.startTime;
    }

    this.items.set(id, item);
    this.emit('item-completed', item);
    
    this.addNotification({
      id,
      type: 'completed',
      message: message || `Completed: ${item.name}`,
      timestamp: Date.now(),
      progress: 100
    });

    // Schedule cleanup if enabled
    if (this.config.autoCleanup) {
      this.scheduleCleanup(id);
    }

    return true;
  }

  /**
   * Fail an item
   */
  fail(id: string, error?: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;

    item.status = 'failed';
    item.endTime = Date.now();
    
    if (item.startTime) {
      item.duration = item.endTime - item.startTime;
    }

    if (error) {
      item.metadata = { ...item.metadata, error };
    }

    this.items.set(id, item);
    this.emit('item-failed', item);
    
    this.addNotification({
      id,
      type: 'failed',
      message: error || `Failed: ${item.name}`,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Cancel an item
   */
  cancel(id: string, reason?: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;

    item.status = 'cancelled';
    item.endTime = Date.now();
    
    if (item.startTime) {
      item.duration = item.endTime - item.startTime;
    }

    if (reason) {
      item.metadata = { ...item.metadata, cancelReason: reason };
    }

    this.items.set(id, item);
    this.emit('item-cancelled', item);
    
    return true;
  }

  /**
   * Get a specific progress item
   */
  get(id: string): ProgressItem | undefined {
    return this.items.get(id);
  }

  /**
   * Get all progress items
   */
  getAll(): ProgressItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Get items by status
   */
  getByStatus(status: ProgressItem['status']): ProgressItem[] {
    return Array.from(this.items.values()).filter(item => item.status === status);
  }

  /**
   * Get root items (items without parents)
   */
  getRootItems(): ProgressItem[] {
    return Array.from(this.items.values()).filter(item => !item.parentId);
  }

  /**
   * Get children of a specific item
   */
  getChildren(parentId: string): ProgressItem[] {
    const parent = this.items.get(parentId);
    if (!parent || !parent.children) return [];
    
    return parent.children
      .map(childId => this.items.get(childId))
      .filter(Boolean) as ProgressItem[];
  }

  /**
   * Calculate overall statistics
   */
  getStats(): ProgressStats {
    const items = Array.from(this.items.values());
    
    const stats: ProgressStats = {
      totalItems: items.length,
      completed: items.filter(i => i.status === 'completed').length,
      failed: items.filter(i => i.status === 'failed').length,
      running: items.filter(i => i.status === 'running').length,
      pending: items.filter(i => i.status === 'pending').length,
      cancelled: items.filter(i => i.status === 'cancelled').length,
      overallProgress: 0
    };

    // Calculate overall progress (weighted by total)
    if (items.length > 0) {
      const totalWeight = items.reduce((sum, item) => sum + item.total, 0);
      const completedWeight = items.reduce((sum, item) => sum + (item.current || 0), 0);
      stats.overallProgress = totalWeight > 0 ? (completedWeight / totalWeight) * 100 : 0;
    }

    // Calculate average duration and throughput
    const completedItems = items.filter(i => i.status === 'completed' && i.duration);
    if (completedItems.length > 0) {
      const totalDuration = completedItems.reduce((sum, item) => sum + (item.duration || 0), 0);
      stats.averageItemDuration = totalDuration / completedItems.length;
      
      // Throughput in items per second
      const timeSpan = this.getTimeSpan();
      if (timeSpan > 0) {
        stats.throughput = completedItems.length / (timeSpan / 1000);
      }
    }

    // Estimate time remaining
    const runningItems = items.filter(i => i.status === 'running');
    if (runningItems.length > 0 && stats.averageItemDuration) {
      const avgTimeRemaining = runningItems.reduce((sum, item) => {
        if (item.estimatedCompletion) {
          return sum + Math.max(0, item.estimatedCompletion - Date.now());
        }
        return sum + stats.averageItemDuration! * (1 - item.progress / 100);
      }, 0) / runningItems.length;
      
      stats.estimatedTimeRemaining = avgTimeRemaining;
    }

    return stats;
  }

  /**
   * Add a milestone for an item
   */
  addMilestone(itemId: string, milestone: Omit<ProgressMilestone, 'triggered'>): void {
    const fullMilestone: ProgressMilestone = {
      ...milestone,
      triggered: false
    };
    
    if (!this.milestones.has(itemId)) {
      this.milestones.set(itemId, []);
    }
    
    this.milestones.get(itemId)!.push(fullMilestone);
    this.emit('milestone-added', itemId, fullMilestone);
  }

  /**
   * Get milestones for an item
   */
  getMilestones(itemId: string): ProgressMilestone[] {
    return this.milestones.get(itemId) || [];
  }

  /**
   * Get recent notifications
   */
  getNotifications(limit: number = 50): ProgressNotification[] {
    return this.notifications.slice(-limit);
  }

  /**
   * Render current progress
   */
  render(): string {
    return this.config.renderer.render(this.getAll(), this.getStats());
  }

  /**
   * Take a snapshot of current state
   */
  snapshot(): ProgressSnapshot {
    const snapshot: ProgressSnapshot = {
      timestamp: Date.now(),
      items: this.getAll().map(item => ({ ...item })),
      stats: this.getStats()
    };

    if (this.config.enableHistory) {
      this.history.push(snapshot);
      
      // Trim history if too large
      if (this.history.length > this.config.maxHistorySize) {
        this.history.shift();
      }
    }

    return snapshot;
  }

  /**
   * Get historical snapshots
   */
  getHistory(limit?: number): ProgressSnapshot[] {
    if (limit) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /**
   * Start automatic updates
   */
  startTracking(): void {
    if (this.updateInterval) return;

    this.updateInterval = setInterval(() => {
      this.snapshot();
      this.emit('update', this.getStats());
    }, this.config.updateInterval);

    this.emit('tracking-started');
  }

  /**
   * Stop automatic updates
   */
  stopTracking(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
      this.emit('tracking-stopped');
    }
  }

  /**
   * Clear completed items
   */
  clearCompleted(): number {
    const completed = this.getByStatus('completed');
    let cleared = 0;
    
    completed.forEach(item => {
      if (this.items.delete(item.id)) {
        cleared++;
        // Cancel any pending cleanup
        const timeout = this.cleanupTimeouts.get(item.id);
        if (timeout) {
          clearTimeout(timeout);
          this.cleanupTimeouts.delete(item.id);
        }
      }
    });

    this.emit('items-cleared', { count: cleared, type: 'completed' });
    return cleared;
  }

  /**
   * Clear all items
   */
  clearAll(): number {
    const count = this.items.size;
    this.items.clear();
    
    // Clear all cleanup timeouts
    this.cleanupTimeouts.forEach(timeout => clearTimeout(timeout));
    this.cleanupTimeouts.clear();

    this.emit('items-cleared', { count, type: 'all' });
    return count;
  }

  /**
   * Export progress data
   */
  export(format: 'json' | 'csv' | 'html' = 'json'): string {
    const data = {
      timestamp: Date.now(),
      items: this.getAll(),
      stats: this.getStats(),
      history: this.config.enableHistory ? this.history : undefined
    };

    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'csv':
        return this.exportToCsv(data.items);
      case 'html':
        return this.exportToHtml(data);
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  /**
   * Check milestones for an item
   */
  private checkMilestones(itemId: string, oldProgress: number, newProgress: number): void {
    const milestones = this.milestones.get(itemId);
    if (!milestones) return;

    milestones.forEach(milestone => {
      if (!milestone.triggered && 
          oldProgress < milestone.threshold && 
          newProgress >= milestone.threshold) {
        milestone.triggered = true;
        
        this.addNotification({
          id: itemId,
          type: 'milestone',
          message: milestone.message,
          timestamp: Date.now(),
          progress: newProgress
        });
        
        this.emit('milestone-reached', itemId, milestone);
      }
    });
  }

  /**
   * Update parent progress based on children
   */
  private updateParentProgress(parentId: string): void {
    const parent = this.items.get(parentId);
    if (!parent || !parent.children) return;

    const children = this.getChildren(parentId);
    if (children.length === 0) return;

    // Calculate weighted average progress
    const totalWeight = children.reduce((sum, child) => sum + child.total, 0);
    const completedWeight = children.reduce((sum, child) => sum + child.current, 0);
    
    const newCurrent = totalWeight > 0 ? completedWeight : 0;
    const newTotal = totalWeight || children.length * 100;
    
    // Update parent without triggering cascading updates
    parent.current = newCurrent;
    parent.total = newTotal;
    parent.progress = newTotal > 0 ? (newCurrent / newTotal) * 100 : 0;
    
    // Update status based on children
    const hasRunning = children.some(c => c.status === 'running');
    const allCompleted = children.every(c => c.status === 'completed');
    const hasFailed = children.some(c => c.status === 'failed');
    
    if (hasFailed) {
      parent.status = 'failed';
    } else if (allCompleted) {
      parent.status = 'completed';
    } else if (hasRunning) {
      parent.status = 'running';
    }
    
    this.items.set(parentId, parent);
    
    // Recursively update grandparent
    if (parent.parentId) {
      this.updateParentProgress(parent.parentId);
    }
  }

  /**
   * Schedule cleanup for completed items
   */
  private scheduleCleanup(itemId: string): void {
    if (this.cleanupTimeouts.has(itemId)) {
      clearTimeout(this.cleanupTimeouts.get(itemId)!);
    }

    const timeout = setTimeout(() => {
      this.items.delete(itemId);
      this.cleanupTimeouts.delete(itemId);
      this.emit('item-cleaned', itemId);
    }, this.config.cleanupDelay);

    this.cleanupTimeouts.set(itemId, timeout);
  }

  /**
   * Add a notification
   */
  private addNotification(notification: ProgressNotification): void {
    this.notifications.push(notification);
    
    // Keep only recent notifications (last 1000)
    if (this.notifications.length > 1000) {
      this.notifications.shift();
    }
    
    this.emit('notification', notification);
  }

  /**
   * Get time span of tracking
   */
  private getTimeSpan(): number {
    const items = Array.from(this.items.values());
    if (items.length === 0) return 0;
    
    const startTimes = items
      .map(item => item.startTime)
      .filter(Boolean) as number[];
    
    if (startTimes.length === 0) return 0;
    
    const earliest = Math.min(...startTimes);
    return Date.now() - earliest;
  }

  /**
   * Export to CSV format
   */
  private exportToCsv(items: ProgressItem[]): string {
    const headers = ['id', 'name', 'status', 'progress', 'current', 'total', 'duration'];
    const rows = items.map(item => [
      item.id,
      item.name,
      item.status,
      item.progress.toFixed(2),
      item.current.toString(),
      item.total.toString(),
      (item.duration || 0).toString()
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * Export to HTML format
   */
  private exportToHtml(data: any): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Progress Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .status-completed { color: green; }
        .status-failed { color: red; }
        .status-running { color: blue; }
        .status-pending { color: orange; }
    </style>
</head>
<body>
    <h1>Progress Report</h1>
    <div>
        <p><strong>Overall Progress:</strong> ${data.stats.overallProgress.toFixed(2)}%</p>
        <p><strong>Completed:</strong> ${data.stats.completed}/${data.stats.totalItems}</p>
        <p><strong>Failed:</strong> ${data.stats.failed}</p>
        <p><strong>Running:</strong> ${data.stats.running}</p>
    </div>
    
    <table>
        <thead>
            <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Duration</th>
            </tr>
        </thead>
        <tbody>
            ${data.items.map((item: ProgressItem) => `
                <tr>
                    <td>${item.id}</td>
                    <td>${item.name}</td>
                    <td class="status-${item.status}">${item.status}</td>
                    <td>${item.progress.toFixed(1)}%</td>
                    <td>${item.duration ? (item.duration / 1000).toFixed(2) + 's' : 'N/A'}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    
    <p><small>Generated on ${new Date().toLocaleString()}</small></p>
</body>
</html>
    `.trim();
  }
}

/**
 * Default progress renderer
 */
export class DefaultProgressRenderer implements ProgressRenderer {
  render(items: ProgressItem[], stats: ProgressStats): string {
    let output = '\n=== Progress Report ===\n';
    output += `Overall: ${stats.overallProgress.toFixed(1)}% `;
    output += `(${stats.completed}/${stats.totalItems} completed)\n\n`;

    const rootItems = items.filter(item => !item.parentId);
    
    rootItems.forEach(item => {
      output += this.renderItem(item, items, 0);
    });

    return output;
  }

  private renderItem(item: ProgressItem, allItems: ProgressItem[], depth: number): string {
    const indent = '  '.repeat(depth);
    const bar = this.createProgressBar(item.progress);
    const status = this.getStatusIcon(item.status);
    const duration = item.duration ? ` (${(item.duration / 1000).toFixed(1)}s)` : '';
    
    let output = `${indent}${status} ${item.name}: ${bar} ${item.progress.toFixed(1)}%${duration}\n`;
    
    // Render children
    if (item.children) {
      const children = item.children
        .map(childId => allItems.find(i => i.id === childId))
        .filter(Boolean) as ProgressItem[];
      
      children.forEach(child => {
        output += this.renderItem(child, allItems, depth + 1);
      });
    }
    
    return output;
  }

  private createProgressBar(progress: number, width: number = 20): string {
    const filled = Math.round((progress / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
  }

  private getStatusIcon(status: ProgressItem['status']): string {
    switch (status) {
      case 'completed': return '✓';
      case 'failed': return '✗';
      case 'running': return '▶';
      case 'cancelled': return '⏹';
      default: return '○';
    }
  }
}

// Export default
export default ProgressTracker;