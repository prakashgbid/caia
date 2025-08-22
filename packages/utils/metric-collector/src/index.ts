/**
 * @caia/metric-collector
 * Universal metrics gathering and analysis system
 */

import { EventEmitter } from 'events';
import * as os from 'os';

export interface Metric {
  name: string;
  value: number;
  unit?: string;
  timestamp: number;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface MetricSeries {
  name: string;
  values: Array<{ timestamp: number; value: number }>;
  unit?: string;
  tags?: Record<string, string>;
}

export interface MetricAggregation {
  min: number;
  max: number;
  avg: number;
  sum: number;
  count: number;
  stddev: number;
  percentiles: Record<string, number>;
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    loadAverage: number[];
    cores: number;
  };
  memory: {
    used: number;
    free: number;
    total: number;
    percentage: number;
  };
  disk: {
    used?: number;
    free?: number;
    total?: number;
    percentage?: number;
    ioStats?: {
      reads: number;
      writes: number;
      readTime: number;
      writeTime: number;
    };
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
    errors: number;
  };
  process: {
    pid: number;
    uptime: number;
    memory: NodeJS.MemoryUsage;
    cpu: number;
  };
}

export interface PerformanceMetrics {
  responseTime: number;
  throughput: number;
  errorRate: number;
  availability: number;
  latency: {
    p50: number;
    p95: number;
    p99: number;
  };
}

export interface BusinessMetrics {
  revenue?: number;
  users?: number;
  sessions?: number;
  conversions?: number;
  churn?: number;
  [key: string]: number | undefined;
}

export interface MetricAlert {
  id: string;
  metric: string;
  condition: 'above' | 'below' | 'equals' | 'not_equals';
  threshold: number;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  triggered: boolean;
  triggeredAt?: number;
  resolvedAt?: number;
}

export interface MetricExporter {
  name: string;
  export(metrics: Metric[]): Promise<void>;
  supports: string[];
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface MetricQuery {
  name?: string;
  tags?: Record<string, string>;
  timeRange?: TimeRange;
  aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  groupBy?: string[];
  limit?: number;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: Array<{
    id: string;
    type: 'line' | 'bar' | 'gauge' | 'table' | 'number';
    query: MetricQuery;
    title: string;
    refreshInterval?: number;
  }>;
}

export class MetricCollector extends EventEmitter {
  private metrics: Map<string, Metric[]> = new Map();
  private collectors: Map<string, () => Promise<Metric[]>> = new Map();
  private alerts: Map<string, MetricAlert> = new Map();
  private exporters: MetricExporter[] = [];
  private collectionInterval?: NodeJS.Timeout;
  private readonly maxMetricsPerSeries = 10000;
  private readonly defaultTags: Record<string, string> = {};

  constructor(defaultTags?: Record<string, string>) {
    super();
    this.defaultTags = defaultTags || {};
    this.setupDefaultCollectors();
  }

  /**
   * Record a single metric
   */
  record(name: string, value: number, unit?: string, tags?: Record<string, string>): void {
    const metric: Metric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      tags: { ...this.defaultTags, ...tags }
    };

    this.addMetric(metric);
    this.emit('metric-recorded', metric);
    this.checkAlerts(metric);
  }

  /**
   * Record multiple metrics at once
   */
  recordBatch(metrics: Array<{ name: string; value: number; unit?: string; tags?: Record<string, string> }>): void {
    const timestamp = Date.now();
    const processedMetrics = metrics.map(m => ({
      name: m.name,
      value: m.value,
      unit: m.unit,
      timestamp,
      tags: { ...this.defaultTags, ...m.tags }
    }));

    processedMetrics.forEach(metric => {
      this.addMetric(metric);
      this.checkAlerts(metric);
    });

    this.emit('batch-recorded', processedMetrics);
  }

  /**
   * Increment a counter metric
   */
  increment(name: string, value: number = 1, tags?: Record<string, string>): void {
    this.record(name, value, 'count', tags);
  }

  /**
   * Record a gauge metric
   */
  gauge(name: string, value: number, unit?: string, tags?: Record<string, string>): void {
    this.record(name, value, unit || 'gauge', tags);
  }

  /**
   * Record a timing metric
   */
  timing(name: string, duration: number, tags?: Record<string, string>): void {
    this.record(name, duration, 'ms', tags);
  }

  /**
   * Record a histogram metric
   */
  histogram(name: string, value: number, tags?: Record<string, string>): void {
    this.record(name, value, 'histogram', tags);
  }

  /**
   * Time a function execution
   */
  async time<T>(name: string, fn: () => Promise<T>, tags?: Record<string, string>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.timing(name, Date.now() - start, { ...tags, status: 'success' });
      return result;
    } catch (error) {
      this.timing(name, Date.now() - start, { ...tags, status: 'error' });
      throw error;
    }
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics(): Promise<SystemMetrics> {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const systemMetrics: SystemMetrics = {
      cpu: {
        usage: await this.getCPUUsage(),
        loadAverage: loadAvg,
        cores: cpus.length
      },
      memory: {
        used: usedMem,
        free: freeMem,
        total: totalMem,
        percentage: (usedMem / totalMem) * 100
      },
      disk: {
        // Would need additional libraries for disk metrics
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0,
        errors: 0
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: 0 // Would need process-specific CPU calculation
      }
    };

    // Record as individual metrics
    this.gauge('system.cpu.usage', systemMetrics.cpu.usage, '%');
    this.gauge('system.memory.used', systemMetrics.memory.used, 'bytes');
    this.gauge('system.memory.percentage', systemMetrics.memory.percentage, '%');
    this.gauge('process.memory.heapUsed', systemMetrics.process.memory.heapUsed, 'bytes');
    this.gauge('process.uptime', systemMetrics.process.uptime, 'seconds');

    return systemMetrics;
  }

  /**
   * Query metrics with filters and aggregations
   */
  query(query: MetricQuery): MetricSeries[] {
    const results: MetricSeries[] = [];
    
    this.metrics.forEach((metricList, metricName) => {
      // Filter by name
      if (query.name && !metricName.includes(query.name)) {
        return;
      }

      // Filter by time range
      let filteredMetrics = metricList;
      if (query.timeRange) {
        filteredMetrics = metricList.filter(m => 
          m.timestamp >= query.timeRange!.start && 
          m.timestamp <= query.timeRange!.end
        );
      }

      // Filter by tags
      if (query.tags) {
        filteredMetrics = filteredMetrics.filter(m => {
          if (!m.tags) return false;
          return Object.entries(query.tags!).every(([key, value]) => 
            m.tags![key] === value
          );
        });
      }

      if (filteredMetrics.length === 0) return;

      // Group by tags if specified
      if (query.groupBy) {
        const groups = this.groupMetrics(filteredMetrics, query.groupBy);
        groups.forEach((groupMetrics, groupKey) => {
          results.push({
            name: `${metricName}:${groupKey}`,
            values: groupMetrics.map(m => ({ timestamp: m.timestamp, value: m.value })),
            unit: groupMetrics[0]?.unit,
            tags: groupMetrics[0]?.tags
          });
        });
      } else {
        results.push({
          name: metricName,
          values: filteredMetrics.map(m => ({ timestamp: m.timestamp, value: m.value })),
          unit: filteredMetrics[0]?.unit,
          tags: filteredMetrics[0]?.tags
        });
      }
    });

    // Apply limit
    if (query.limit) {
      return results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Aggregate metrics over time periods
   */
  aggregate(metricName: string, timeRange: TimeRange, bucket: 'minute' | 'hour' | 'day'): MetricAggregation[] {
    const metrics = this.metrics.get(metricName) || [];
    const filteredMetrics = metrics.filter(m => 
      m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
    );

    const bucketSize = this.getBucketSize(bucket);
    const buckets = new Map<number, number[]>();

    // Group metrics into time buckets
    filteredMetrics.forEach(metric => {
      const bucketKey = Math.floor(metric.timestamp / bucketSize) * bucketSize;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(metric.value);
    });

    // Calculate aggregations for each bucket
    return Array.from(buckets.entries()).map(([timestamp, values]) => {
      const sorted = values.sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;
      const variance = values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / values.length;
      
      return {
        min: Math.min(...values),
        max: Math.max(...values),
        avg,
        sum,
        count: values.length,
        stddev: Math.sqrt(variance),
        percentiles: {
          p50: this.percentile(sorted, 50),
          p90: this.percentile(sorted, 90),
          p95: this.percentile(sorted, 95),
          p99: this.percentile(sorted, 99)
        }
      };
    });
  }

  /**
   * Create a metric alert
   */
  createAlert(alert: Omit<MetricAlert, 'triggered'>): void {
    const fullAlert: MetricAlert = {
      ...alert,
      triggered: false
    };
    
    this.alerts.set(alert.id, fullAlert);
    this.emit('alert-created', fullAlert);
  }

  /**
   * Remove an alert
   */
  removeAlert(alertId: string): boolean {
    const removed = this.alerts.delete(alertId);
    if (removed) {
      this.emit('alert-removed', alertId);
    }
    return removed;
  }

  /**
   * Get all alerts
   */
  getAlerts(): MetricAlert[] {
    return Array.from(this.alerts.values());
  }

  /**
   * Add a metric exporter
   */
  addExporter(exporter: MetricExporter): void {
    this.exporters.push(exporter);
    this.emit('exporter-added', exporter);
  }

  /**
   * Export metrics to all configured exporters
   */
  async exportMetrics(metricNames?: string[]): Promise<void> {
    const metricsToExport: Metric[] = [];
    
    if (metricNames) {
      metricNames.forEach(name => {
        const metrics = this.metrics.get(name) || [];
        metricsToExport.push(...metrics);
      });
    } else {
      this.metrics.forEach(metrics => {
        metricsToExport.push(...metrics);
      });
    }

    const exportPromises = this.exporters.map(async exporter => {
      try {
        await exporter.export(metricsToExport);
        this.emit('export-success', { exporter: exporter.name, count: metricsToExport.length });
      } catch (error) {
        this.emit('export-error', { exporter: exporter.name, error });
      }
    });

    await Promise.allSettled(exportPromises);
  }

  /**
   * Start automatic metric collection
   */
  startCollection(interval: number = 30000): void {
    if (this.collectionInterval) {
      return;
    }

    this.collectionInterval = setInterval(async () => {
      try {
        // Run all registered collectors
        const promises = Array.from(this.collectors.entries()).map(async ([name, collector]) => {
          try {
            const metrics = await collector();
            metrics.forEach(metric => this.addMetric(metric));
            this.emit('collection-success', { collector: name, count: metrics.length });
          } catch (error) {
            this.emit('collection-error', { collector: name, error });
          }
        });

        await Promise.allSettled(promises);
        
        // Export metrics if exporters are configured
        if (this.exporters.length > 0) {
          await this.exportMetrics();
        }
      } catch (error) {
        this.emit('collection-error', error);
      }
    }, interval);

    this.emit('collection-started', { interval });
  }

  /**
   * Stop automatic metric collection
   */
  stopCollection(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = undefined;
      this.emit('collection-stopped');
    }
  }

  /**
   * Register a custom metric collector
   */
  registerCollector(name: string, collector: () => Promise<Metric[]>): void {
    this.collectors.set(name, collector);
    this.emit('collector-registered', name);
  }

  /**
   * Unregister a metric collector
   */
  unregisterCollector(name: string): boolean {
    const removed = this.collectors.delete(name);
    if (removed) {
      this.emit('collector-unregistered', name);
    }
    return removed;
  }

  /**
   * Get metric statistics
   */
  getStatistics(): {
    totalMetrics: number;
    uniqueNames: number;
    timeRange: { start: number; end: number } | null;
    collectors: number;
    alerts: number;
    exporters: number;
  } {
    let totalMetrics = 0;
    let earliestTimestamp = Number.MAX_SAFE_INTEGER;
    let latestTimestamp = 0;

    this.metrics.forEach(metricList => {
      totalMetrics += metricList.length;
      if (metricList.length > 0) {
        const first = metricList[0].timestamp;
        const last = metricList[metricList.length - 1].timestamp;
        earliestTimestamp = Math.min(earliestTimestamp, first);
        latestTimestamp = Math.max(latestTimestamp, last);
      }
    });

    return {
      totalMetrics,
      uniqueNames: this.metrics.size,
      timeRange: totalMetrics > 0 ? { start: earliestTimestamp, end: latestTimestamp } : null,
      collectors: this.collectors.size,
      alerts: this.alerts.size,
      exporters: this.exporters.length
    };
  }

  /**
   * Clear all metrics
   */
  clearMetrics(metricName?: string): void {
    if (metricName) {
      this.metrics.delete(metricName);
      this.emit('metrics-cleared', { metricName });
    } else {
      this.metrics.clear();
      this.emit('metrics-cleared', { all: true });
    }
  }

  /**
   * Get all metric names
   */
  getMetricNames(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Setup default system metric collectors
   */
  private setupDefaultCollectors(): void {
    this.registerCollector('system', async () => {
      await this.collectSystemMetrics();
      return []; // Already recorded in collectSystemMetrics
    });
  }

  /**
   * Add a metric to storage
   */
  private addMetric(metric: Metric): void {
    if (!this.metrics.has(metric.name)) {
      this.metrics.set(metric.name, []);
    }

    const metricList = this.metrics.get(metric.name)!;
    metricList.push(metric);

    // Maintain maximum series length
    if (metricList.length > this.maxMetricsPerSeries) {
      metricList.shift();
    }

    // Keep metrics sorted by timestamp
    metricList.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Check alerts for a metric
   */
  private checkAlerts(metric: Metric): void {
    this.alerts.forEach(alert => {
      if (alert.metric === metric.name) {
        const shouldTrigger = this.evaluateAlertCondition(alert, metric.value);
        
        if (shouldTrigger && !alert.triggered) {
          alert.triggered = true;
          alert.triggeredAt = Date.now();
          this.emit('alert-triggered', alert);
        } else if (!shouldTrigger && alert.triggered) {
          alert.triggered = false;
          alert.resolvedAt = Date.now();
          this.emit('alert-resolved', alert);
        }
      }
    });
  }

  /**
   * Evaluate alert condition
   */
  private evaluateAlertCondition(alert: MetricAlert, value: number): boolean {
    switch (alert.condition) {
      case 'above':
        return value > alert.threshold;
      case 'below':
        return value < alert.threshold;
      case 'equals':
        return value === alert.threshold;
      case 'not_equals':
        return value !== alert.threshold;
      default:
        return false;
    }
  }

  /**
   * Group metrics by specified tags
   */
  private groupMetrics(metrics: Metric[], groupBy: string[]): Map<string, Metric[]> {
    const groups = new Map<string, Metric[]>();
    
    metrics.forEach(metric => {
      const groupKey = groupBy.map(tag => metric.tags?.[tag] || 'unknown').join(':');
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(metric);
    });

    return groups;
  }

  /**
   * Get bucket size in milliseconds
   */
  private getBucketSize(bucket: 'minute' | 'hour' | 'day'): number {
    switch (bucket) {
      case 'minute':
        return 60 * 1000;
      case 'hour':
        return 60 * 60 * 1000;
      case 'day':
        return 24 * 60 * 60 * 1000;
      default:
        return 60 * 1000;
    }
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    
    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sortedValues[lower];
    }
    
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  /**
   * Get CPU usage percentage
   */
  private async getCPUUsage(): Promise<number> {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      const startTime = Date.now();
      
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const endTime = Date.now();
        
        const totalTime = (endTime - startTime) * 1000; // Convert to microseconds
        const totalUsage = endUsage.user + endUsage.system;
        const usage = (totalUsage / totalTime) * 100;
        
        resolve(Math.min(100, Math.max(0, usage)));
      }, 100);
    });
  }
}

// Built-in exporters
export class ConsoleExporter implements MetricExporter {
  name = 'console';
  supports = ['*'];

  async export(metrics: Metric[]): Promise<void> {
    console.log(`Exporting ${metrics.length} metrics:`);
    metrics.forEach(metric => {
      console.log(`${metric.name}: ${metric.value} ${metric.unit || ''} @${new Date(metric.timestamp).toISOString()}`);
    });
  }
}

export class JSONFileExporter implements MetricExporter {
  name = 'json-file';
  supports = ['*'];
  
  constructor(private filePath: string) {}

  async export(metrics: Metric[]): Promise<void> {
    const fs = await import('fs');
    const data = {
      timestamp: Date.now(),
      metrics
    };
    await fs.promises.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}

// Export default
export default MetricCollector;