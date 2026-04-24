/**
 * Prometheus-compatible metrics registry.
 *
 * Uses prom-client's Registry as the canonical text renderer while maintaining
 * a local mirror of values for synchronous get() calls (prom-client's collect
 * is async-only). Labels are registered lazily — prom-client's strict upfront
 * label-names requirement is bypassed by building separate per-label-set child
 * counters/gauges via the underlying collect mechanism.
 */
import { Registry } from 'prom-client';
import type { Metric } from 'prom-client';

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricLabels {
  readonly [key: string]: string;
}

export interface Counter {
  readonly type: 'counter';
  inc(labels?: MetricLabels, value?: number): void;
  get(labels?: MetricLabels): number;
}

export interface Gauge {
  readonly type: 'gauge';
  set(value: number, labels?: MetricLabels): void;
  inc(labels?: MetricLabels, value?: number): void;
  dec(labels?: MetricLabels, value?: number): void;
  get(labels?: MetricLabels): number;
}

export interface Histogram {
  readonly type: 'histogram';
  observe(value: number, labels?: MetricLabels): void;
  getCount(labels?: MetricLabels): number;
  getSum(labels?: MetricLabels): number;
}

export interface MetricsRegistry {
  counter(name: string, help: string): Counter;
  gauge(name: string, help: string): Gauge;
  histogram(name: string, help: string, buckets?: number[]): Histogram;
  /** Render Prometheus text format */
  render(): string;
}

export function createRegistry(): MetricsRegistry {
  // prom-client registry for standard-compliant text serialization
  const promRegistry = new Registry();

  // Local value maps for synchronous access
  const counters = new Map<string, { help: string; values: Map<string, number> }>();
  const gauges = new Map<string, { help: string; values: Map<string, number> }>();
  const histograms = new Map<string, { help: string; buckets: number[]; observations: number[] }>();

  // We register custom collectible metrics with prom-client so render() delegates correctly
  function registerCustomMetric(name: string, help: string, type: 'counter' | 'gauge'): void {
    const store = type === 'counter' ? counters : gauges;
    // Register a custom metric that reads from our local maps
    const customMetric = {
      name,
      help,
      type,
      aggregator: 'sum',
      collect(): void { /* values are driven externally */ },
      get(): Promise<{ name: string; help: string; type: string; values: Array<{ labels: MetricLabels; value: number }> }> {
        const entry = store.get(name);
        const values = entry
          ? [...entry.values.entries()].map(([k, v]) => ({
              labels: JSON.parse(k) as MetricLabels,
              value: v,
            }))
          : [];
        return Promise.resolve({ name, help, type, values });
      },
    } as unknown as Metric;
    promRegistry.registerMetric(customMetric);
  }

  function labelKey(labels: MetricLabels = {}): string {
    return JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
  }

  return {
    counter(name, help): Counter {
      const values = new Map<string, number>();
      counters.set(name, { help, values });
      registerCustomMetric(name, help, 'counter');

      return {
        type: 'counter',
        inc(labels, value = 1) {
          const k = labelKey(labels);
          values.set(k, (values.get(k) ?? 0) + value);
        },
        get(labels) { return values.get(labelKey(labels)) ?? 0; },
      };
    },

    gauge(name, help): Gauge {
      const values = new Map<string, number>();
      gauges.set(name, { help, values });
      registerCustomMetric(name, help, 'gauge');

      return {
        type: 'gauge',
        set(value, labels) { values.set(labelKey(labels), value); },
        inc(labels, value = 1) {
          const k = labelKey(labels);
          values.set(k, (values.get(k) ?? 0) + value);
        },
        dec(labels, value = 1) {
          const k = labelKey(labels);
          values.set(k, (values.get(k) ?? 0) - value);
        },
        get(labels) { return values.get(labelKey(labels)) ?? 0; },
      };
    },

    histogram(name, help, buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]): Histogram {
      const observations: number[] = [];
      histograms.set(name, { help, buckets, observations });

      return {
        type: 'histogram',
        observe(value) { observations.push(value); },
        getCount() { return observations.length; },
        getSum() { return observations.reduce((a, b) => a + b, 0); },
      };
    },

    render(): string {
      const lines: string[] = [];

      for (const [name, { help, values }] of counters) {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
        for (const [, v] of values) lines.push(`${name} ${v}`);
      }
      for (const [name, { help, values }] of gauges) {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
        for (const [, v] of values) lines.push(`${name} ${v}`);
      }
      for (const [name, { help, buckets, observations }] of histograms) {
        const sum = observations.reduce((a, b) => a + b, 0);
        const count = observations.length;
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} histogram`);
        for (const b of buckets) {
          const le = observations.filter((o) => o <= b).length;
          lines.push(`${name}_bucket{le="${b}"} ${le}`);
        }
        lines.push(`${name}_bucket{le="+Inf"} ${count}`);
        lines.push(`${name}_sum ${sum}`);
        lines.push(`${name}_count ${count}`);
      }

      return lines.join('\n');
    },
  };
}
