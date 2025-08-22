/**
 * @jest-environment node
 */

import * as fs from 'fs';

import MetricCollector, {
  Metric,
  MetricExporter,
  TimeRange,
  ConsoleExporter,
  JSONFileExporter
} from '../index';

// Type-only imports for unused types
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { MetricSeries, MetricAggregation, SystemMetrics, PerformanceMetrics, MetricAlert, MetricQuery } from '../index';

// Mock os module
jest.mock('os', () => ({
  cpus: jest.fn(() => [
    { model: 'Intel Core i7', speed: 2800, times: { user: 1000, nice: 0, sys: 500, idle: 8500, irq: 0 } },
    { model: 'Intel Core i7', speed: 2800, times: { user: 1200, nice: 0, sys: 600, idle: 8200, irq: 0 } }
  ]),
  totalmem: jest.fn(() => 8 * 1024 * 1024 * 1024), // 8GB
  freemem: jest.fn(() => 4 * 1024 * 1024 * 1024), // 4GB free
  loadavg: jest.fn(() => [1.5, 1.2, 1.0]),
  networkInterfaces: jest.fn(() => ({
    eth0: [{ address: '192.168.1.100', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
  }))
}));

// Mock fs for JSONFileExporter
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn()
  }
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('MetricCollector', () => {
  let metricCollector: MetricCollector;

  beforeEach(() => {
    metricCollector = new MetricCollector();
    jest.clearAllMocks();
  });

  afterEach(() => {
    metricCollector.stopCollection();
  });

  describe('MetricCollector instantiation', () => {
    it('should create a new instance', () => {
      expect(metricCollector).toBeInstanceOf(MetricCollector);
    });

    it('should create instance with default tags', () => {
      const defaultTags = { environment: 'test', service: 'test-service' };
      const collector = new MetricCollector(defaultTags);
      
      collector.record('test.metric', 42);
      
      // The metric should include default tags
      const query = collector.query({ name: 'test.metric' });
      expect(query[0].tags).toEqual(expect.objectContaining(defaultTags));
    });
  });

  describe('record', () => {
    it('should record a metric', () => {
      metricCollector.record('test.counter', 42, 'count', { tag: 'value' });

      const metrics = metricCollector.query({ name: 'test.counter' });
      expect(metrics).toHaveLength(1);
      expect(metrics[0].values).toHaveLength(1);
      expect(metrics[0].values[0].value).toBe(42);
    });

    it('should emit metric-recorded event', async () => {
      const recordedPromise = new Promise<Metric>((resolve) => {
        metricCollector.on('metric-recorded', (metric: Metric) => {
          expect(metric.name).toBe('test.metric');
          expect(metric.value).toBe(100);
          expect(metric.unit).toBe('ms');
          expect(metric.tags).toEqual({ type: 'test' });
          resolve(metric);
        });
      });

      metricCollector.record('test.metric', 100, 'ms', { type: 'test' });
      await recordedPromise;
    });

    it('should check alerts when recording', async () => {
      metricCollector.createAlert({
        id: 'high-value-alert',
        metric: 'test.metric',
        condition: 'above',
        threshold: 50,
        severity: 'warning',
        message: 'Value too high'
      });

      const alertPromise = new Promise((resolve) => {
        metricCollector.on('alert-triggered', (alert) => {
          expect(alert.id).toBe('high-value-alert');
          expect(alert.triggered).toBe(true);
          resolve(alert);
        });
      });

      metricCollector.record('test.metric', 100);
      await alertPromise;
    });
  });

  describe('recordBatch', () => {
    it('should record multiple metrics at once', () => {
      const metrics = [
        { name: 'metric1', value: 10, unit: 'count' },
        { name: 'metric2', value: 20, tags: { type: 'test' } },
        { name: 'metric3', value: 30 }
      ];

      metricCollector.recordBatch(metrics);

      expect(metricCollector.getMetricNames()).toContain('metric1');
      expect(metricCollector.getMetricNames()).toContain('metric2');
      expect(metricCollector.getMetricNames()).toContain('metric3');
    });

    it('should emit batch-recorded event', async () => {
      const metrics = [
        { name: 'metric1', value: 10 },
        { name: 'metric2', value: 20 }
      ];

      const batchPromise = new Promise((resolve) => {
        metricCollector.on('batch-recorded', (recordedMetrics) => {
          expect(recordedMetrics).toHaveLength(2);
          expect(recordedMetrics[0].name).toBe('metric1');
          expect(recordedMetrics[1].name).toBe('metric2');
          resolve(recordedMetrics);
        });
      });

      metricCollector.recordBatch(metrics);
      await batchPromise;
    });
  });

  describe('convenience methods', () => {
    it('should increment counter', () => {
      metricCollector.increment('requests.count');
      metricCollector.increment('requests.count', 5);

      const metrics = metricCollector.query({ name: 'requests.count' });
      expect(metrics[0].values).toHaveLength(2);
      expect(metrics[0].values[0].value).toBe(1);
      expect(metrics[0].values[1].value).toBe(5);
    });

    it('should record gauge', () => {
      metricCollector.gauge('memory.usage', 75.5, '%');

      const metrics = metricCollector.query({ name: 'memory.usage' });
      expect(metrics[0].values[0].value).toBe(75.5);
      expect(metrics[0].unit).toBe('%');
    });

    it('should record timing', () => {
      metricCollector.timing('request.duration', 150);

      const metrics = metricCollector.query({ name: 'request.duration' });
      expect(metrics[0].values[0].value).toBe(150);
      expect(metrics[0].unit).toBe('ms');
    });

    it('should record histogram', () => {
      metricCollector.histogram('response.size', 1024);

      const metrics = metricCollector.query({ name: 'response.size' });
      expect(metrics[0].values[0].value).toBe(1024);
      expect(metrics[0].unit).toBe('histogram');
    });
  });

  describe('time function', () => {
    it('should time function execution', async () => {
      const slowFunction = () => new Promise(resolve => setTimeout(resolve, 100));

      await metricCollector.time('slow.function', slowFunction, { type: 'async' });

      const metrics = metricCollector.query({ name: 'slow.function' });
      expect(metrics[0].values[0].value).toBeGreaterThan(90);
      expect(metrics[0].tags).toEqual(expect.objectContaining({ type: 'async', status: 'success' }));
    });

    it('should record error status on function failure', async () => {
      const failingFunction = () => Promise.reject(new Error('Test error'));

      await expect(
        metricCollector.time('failing.function', failingFunction)
      ).rejects.toThrow('Test error');

      const metrics = metricCollector.query({ name: 'failing.function' });
      expect(metrics[0].tags).toEqual(expect.objectContaining({ status: 'error' }));
    });
  });

  describe('collectSystemMetrics', () => {
    it('should collect system metrics', async () => {
      const systemMetrics = await metricCollector.collectSystemMetrics();

      expect(systemMetrics.cpu.cores).toBe(2);
      expect(systemMetrics.cpu.usage).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.memory.total).toBe(8 * 1024 * 1024 * 1024);
      expect(systemMetrics.memory.free).toBe(4 * 1024 * 1024 * 1024);
      expect(systemMetrics.process.pid).toBe(process.pid);
    });

    it('should record system metrics as individual metrics', async () => {
      await metricCollector.collectSystemMetrics();

      expect(metricCollector.getMetricNames()).toContain('system.cpu.usage');
      expect(metricCollector.getMetricNames()).toContain('system.memory.used');
      expect(metricCollector.getMetricNames()).toContain('process.uptime');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      const _now = Date.now();
      metricCollector.record('test.metric', 10, 'count', { env: 'test' });
      metricCollector.record('test.metric', 20, 'count', { env: 'test' });
      metricCollector.record('other.metric', 30, 'gauge', { env: 'prod' });
    });

    it('should query metrics by name', () => {
      const results = metricCollector.query({ name: 'test.metric' });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('test.metric');
      expect(results[0].values).toHaveLength(2);
    });

    it('should query metrics by tags', () => {
      const results = metricCollector.query({ tags: { env: 'test' } });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('test.metric');
    });

    it('should query metrics by time range', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: now - 1000,
        end: now + 1000
      };

      const results = metricCollector.query({ timeRange });

      expect(results.length).toBeGreaterThan(0);
    });

    it('should limit query results', () => {
      metricCollector.record('limited.metric', 1);
      metricCollector.record('limited.metric', 2);
      metricCollector.record('limited.metric', 3);

      const results = metricCollector.query({ name: 'limited', limit: 1 });

      expect(results).toHaveLength(1);
    });

    it('should group metrics by tags', () => {
      metricCollector.record('grouped.metric', 10, 'count', { group: 'A' });
      metricCollector.record('grouped.metric', 20, 'count', { group: 'B' });

      const results = metricCollector.query({
        name: 'grouped.metric',
        groupBy: ['group']
      });

      expect(results).toHaveLength(2);
      expect(results.some(r => r.name.includes('A'))).toBe(true);
      expect(results.some(r => r.name.includes('B'))).toBe(true);
    });
  });

  describe('aggregate', () => {
    beforeEach(() => {
      const _now = Date.now();
      // Record metrics with different timestamps
      for (let i = 0; i < 10; i++) {
        metricCollector.record('test.values', i * 10);
      }
    });

    it('should aggregate metrics by time buckets', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: now - 60000,
        end: now + 60000
      };

      const aggregations = metricCollector.aggregate('test.values', timeRange, 'minute');

      expect(aggregations.length).toBeGreaterThan(0);
      aggregations.forEach(agg => {
        expect(agg.min).toBeGreaterThanOrEqual(0);
        expect(agg.max).toBeGreaterThanOrEqual(agg.min);
        expect(agg.avg).toBeGreaterThanOrEqual(agg.min);
        expect(agg.avg).toBeLessThanOrEqual(agg.max);
        expect(agg.count).toBeGreaterThan(0);
        expect(agg.percentiles.p50).toBeDefined();
      });
    });

    it('should handle empty metric data', () => {
      const timeRange: TimeRange = {
        start: Date.now() + 60000, // Future time range
        end: Date.now() + 120000
      };

      const aggregations = metricCollector.aggregate('test.values', timeRange, 'minute');

      expect(aggregations).toHaveLength(0);
    });
  });

  describe('alerts', () => {
    it('should create an alert', () => {
      const alert = {
        id: 'test-alert',
        metric: 'test.metric',
        condition: 'above' as const,
        threshold: 100,
        severity: 'warning' as const,
        message: 'Test alert'
      };

      metricCollector.createAlert(alert);

      const alerts = metricCollector.getAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toBe('test-alert');
      expect(alerts[0].triggered).toBe(false);
    });

    it('should trigger alert when condition is met', async () => {
      metricCollector.createAlert({
        id: 'threshold-alert',
        metric: 'test.metric',
        condition: 'above',
        threshold: 50,
        severity: 'error',
        message: 'Value exceeded threshold'
      });

      const alertPromise = new Promise((resolve) => {
        metricCollector.on('alert-triggered', (alert) => {
          expect(alert.triggered).toBe(true);
          expect(alert.triggeredAt).toBeDefined();
          resolve(alert);
        });
      });

      metricCollector.record('test.metric', 100);
      await alertPromise;
    });

    it('should resolve alert when condition is no longer met', async () => {
      metricCollector.createAlert({
        id: 'resolve-alert',
        metric: 'test.metric',
        condition: 'above',
        threshold: 50,
        severity: 'warning',
        message: 'Test alert'
      });

      let alertTriggered = false;

      const resolvedPromise = new Promise((resolve) => {
        metricCollector.on('alert-triggered', () => {
          alertTriggered = true;
          // Record a value that resolves the alert
          metricCollector.record('test.metric', 25);
        });

        metricCollector.on('alert-resolved', (alert) => {
          expect(alertTriggered).toBe(true);
          expect(alert.triggered).toBe(false);
          expect(alert.resolvedAt).toBeDefined();
          resolve(alert);
        });
      });

      metricCollector.record('test.metric', 100); // Trigger alert
      await resolvedPromise;
    });

    it('should remove alert', () => {
      metricCollector.createAlert({
        id: 'removable-alert',
        metric: 'test.metric',
        condition: 'above',
        threshold: 50,
        severity: 'info',
        message: 'Test alert'
      });

      expect(metricCollector.getAlerts()).toHaveLength(1);

      const removed = metricCollector.removeAlert('removable-alert');
      expect(removed).toBe(true);
      expect(metricCollector.getAlerts()).toHaveLength(0);
    });

    it('should handle different alert conditions', () => {
      const testCases = [
        { condition: 'below' as const, threshold: 50, value: 25, shouldTrigger: true },
        { condition: 'below' as const, threshold: 50, value: 75, shouldTrigger: false },
        { condition: 'equals' as const, threshold: 100, value: 100, shouldTrigger: true },
        { condition: 'not_equals' as const, threshold: 100, value: 50, shouldTrigger: true }
      ];

      testCases.forEach((testCase, index) => {
        const alertId = `test-alert-${index}`;
        metricCollector.createAlert({
          id: alertId,
          metric: 'condition.test',
          condition: testCase.condition,
          threshold: testCase.threshold,
          severity: 'info',
          message: 'Test condition'
        });

        metricCollector.record('condition.test', testCase.value);

        const alerts = metricCollector.getAlerts();
        const alert = alerts.find(a => a.id === alertId);
        expect(alert?.triggered).toBe(testCase.shouldTrigger);
      });
    });
  });

  describe('exporters', () => {
    it('should add and use metric exporters', async () => {
      const mockExporter: MetricExporter = {
        name: 'mock-exporter',
        supports: ['test'],
        export: jest.fn().mockResolvedValue(undefined)
      };

      metricCollector.addExporter(mockExporter);
      metricCollector.record('test.metric', 42);

      await metricCollector.exportMetrics();

      expect(mockExporter.export).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'test.metric',
            value: 42
          })
        ])
      );
    });

    it('should export specific metrics', async () => {
      const mockExporter: MetricExporter = {
        name: 'mock-exporter',
        supports: ['test'],
        export: jest.fn().mockResolvedValue(undefined)
      };

      metricCollector.addExporter(mockExporter);
      metricCollector.record('export.this', 1);
      metricCollector.record('not.this', 2);

      await metricCollector.exportMetrics(['export.this']);

      expect(mockExporter.export).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'export.this',
            value: 1
          })
        ])
      );
    });

    it('should handle export errors gracefully', async () => {
      const errorExporter: MetricExporter = {
        name: 'error-exporter',
        supports: ['test'],
        export: jest.fn().mockRejectedValue(new Error('Export failed'))
      };

      const eventPromise = new Promise((resolve) => {
        metricCollector.on('export-error', resolve);
      });

      metricCollector.addExporter(errorExporter);
      await metricCollector.exportMetrics();

      const errorEvent = await eventPromise;
      expect(errorEvent).toHaveProperty('exporter', 'error-exporter');
      expect(errorEvent).toHaveProperty('error');
    });
  });

  describe('collection automation', () => {
    it('should start and stop automatic collection', async () => {
      let collectionCount = 0;

      const collectionPromise = new Promise<void>((resolve) => {
        metricCollector.on('collection-success', () => {
          collectionCount++;
          if (collectionCount >= 2) {
            metricCollector.stopCollection();
            resolve();
          }
        });
      });

      metricCollector.startCollection(100); // 100ms interval
      await collectionPromise;
      expect(collectionCount).toBeGreaterThanOrEqual(2);
    });

    it('should register and run custom collectors', async () => {
      const customCollector = jest.fn().mockResolvedValue([
        { name: 'custom.metric', value: 123, timestamp: Date.now() }
      ]);

      metricCollector.registerCollector('custom', customCollector);

      const customCollectionPromise = new Promise((resolve) => {
        metricCollector.on('collection-success', (event) => {
          if (event.collector === 'custom') {
            expect(customCollector).toHaveBeenCalled();
            expect(event.count).toBe(1);
            resolve(event);
          }
        });
      });

      metricCollector.startCollection(100);
      await customCollectionPromise;
    });

    it('should handle collector errors', async () => {
      const errorCollector = jest.fn().mockRejectedValue(new Error('Collection failed'));

      metricCollector.registerCollector('error-collector', errorCollector);

      const errorPromise = new Promise((resolve) => {
        metricCollector.on('collection-error', (event) => {
          expect(event.collector).toBe('error-collector');
          expect(event.error).toBeInstanceOf(Error);
          resolve(event);
        });
      });

      metricCollector.startCollection(100);
      await errorPromise;
    });

    it('should unregister collectors', () => {
      const collector = jest.fn();
      metricCollector.registerCollector('test-collector', collector);

      const removed = metricCollector.unregisterCollector('test-collector');
      expect(removed).toBe(true);

      const removedAgain = metricCollector.unregisterCollector('test-collector');
      expect(removedAgain).toBe(false);
    });
  });

  describe('statistics and management', () => {
    beforeEach(() => {
      metricCollector.record('stat.metric1', 10);
      metricCollector.record('stat.metric2', 20);
      metricCollector.record('stat.metric1', 30);
    });

    it('should provide statistics', () => {
      const stats = metricCollector.getStatistics();

      expect(stats.totalMetrics).toBe(3);
      expect(stats.uniqueNames).toBe(2);
      expect(stats.timeRange).toBeDefined();
      expect(stats.timeRange?.start).toBeLessThanOrEqual(stats.timeRange?.end);
      expect(stats.collectors).toBeGreaterThanOrEqual(1); // Default system collector
      expect(stats.alerts).toBe(0);
      expect(stats.exporters).toBe(0);
    });

    it('should clear specific metrics', () => {
      metricCollector.clearMetrics('stat.metric1');

      expect(metricCollector.getMetricNames()).toContain('stat.metric2');
      expect(metricCollector.getMetricNames()).not.toContain('stat.metric1');
    });

    it('should clear all metrics', () => {
      metricCollector.clearMetrics();

      expect(metricCollector.getStatistics().totalMetrics).toBe(0);
      expect(metricCollector.getMetricNames()).toHaveLength(0);
    });

    it('should get metric names', () => {
      const names = metricCollector.getMetricNames();

      expect(names).toContain('stat.metric1');
      expect(names).toContain('stat.metric2');
    });
  });

  describe('built-in exporters', () => {
    it('should use ConsoleExporter', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const exporter = new ConsoleExporter();

      const metrics: Metric[] = [
        { name: 'test.metric', value: 42, timestamp: Date.now() }
      ];

      await exporter.export(metrics);

      expect(consoleSpy).toHaveBeenCalledWith('Exporting 1 metrics:');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('test.metric: 42')
      );

      consoleSpy.mockRestore();
    });

    it('should use JSONFileExporter', async () => {
      const exporter = new JSONFileExporter('/tmp/metrics.json');

      const metrics: Metric[] = [
        { name: 'test.metric', value: 42, timestamp: Date.now() }
      ];

      await exporter.export(metrics);

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/metrics.json',
        expect.stringContaining('"metrics"')
      );
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle metrics with missing properties', () => {
      expect(() => {
        metricCollector.record('test', 0); // Zero value
        metricCollector.record('test', NaN); // NaN value
        metricCollector.record('test', Infinity); // Infinity value
      }).not.toThrow();
    });

    it('should handle very large metric values', () => {
      const largeValue = Number.MAX_SAFE_INTEGER;
      metricCollector.record('large.metric', largeValue);

      const metrics = metricCollector.query({ name: 'large.metric' });
      expect(metrics[0].values[0].value).toBe(largeValue);
    });

    it('should handle rapid metric recording', () => {
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        metricCollector.record('rapid.metric', i);
      }

      const endTime = Date.now();
      const stats = metricCollector.getStatistics();

      expect(stats.totalMetrics).toBe(1000);
      expect(endTime - startTime).toBeLessThan(1000); // Should be fast
    });

    it('should maintain metric series size limit', () => {
      // Record more than the maximum allowed (10,000)
      for (let i = 0; i < 10005; i++) {
        metricCollector.record('limited.series', i);
      }

      const metrics = metricCollector.query({ name: 'limited.series' });
      expect(metrics[0].values.length).toBeLessThanOrEqual(10000);
    });

    it('should handle concurrent operations', async () => {
      const promises = [];

      // Simulate concurrent operations
      for (let i = 0; i < 100; i++) {
        promises.push(
          Promise.resolve().then(() => {
            metricCollector.record('concurrent.metric', i);
          })
        );
      }

      await Promise.all(promises);

      const stats = metricCollector.getStatistics();
      expect(stats.totalMetrics).toBe(100);
    });

    it('should handle malformed alert conditions', () => {
      metricCollector.createAlert({
        id: 'malformed-alert',
        metric: 'test.metric',
        condition: 'invalid' as any,
        threshold: 50,
        severity: 'info',
        message: 'Test'
      });

      // Should not trigger for any value
      metricCollector.record('test.metric', 100);
      metricCollector.record('test.metric', 0);

      const alerts = metricCollector.getAlerts();
      expect(alerts[0].triggered).toBe(false);
    });
  });

  describe('Performance tests', () => {
    it('should handle high-frequency metric recording', () => {
      const startTime = Date.now();
      const numMetrics = 10000;

      for (let i = 0; i < numMetrics; i++) {
        metricCollector.record(`metric.${i % 100}`, Math.random() * 100);
      }

      const endTime = Date.now();
      const stats = metricCollector.getStatistics();

      expect(stats.totalMetrics).toBe(numMetrics);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should handle complex queries efficiently', () => {
      // Setup test data
      for (let i = 0; i < 1000; i++) {
        metricCollector.record('perf.test', Math.random() * 100, 'gauge', {
          group: `group${i % 10}`,
          env: i % 2 === 0 ? 'prod' : 'test'
        });
      }

      const startTime = Date.now();

      // Perform complex queries
      metricCollector.query({ tags: { env: 'prod' } });
      metricCollector.query({ name: 'perf', groupBy: ['group'] });
      metricCollector.query({ tags: { group: 'group5' }, limit: 50 });

      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(500); // Should be fast
    });
  });
});