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
  const counters = new Map<string, { help: string; values: Map<string, number> }>();
  const gauges = new Map<string, { help: string; values: Map<string, number> }>();
  const histograms = new Map<string, { help: string; buckets: number[]; observations: number[] }>();

  function labelKey(labels: MetricLabels = {}): string {
    return JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
  }

  return {
    counter(name, help) {
      const values = new Map<string, number>();
      counters.set(name, { help, values });
      return {
        type: 'counter',
        inc(labels, value = 1) { const k = labelKey(labels); values.set(k, (values.get(k) ?? 0) + value); },
        get(labels) { return values.get(labelKey(labels)) ?? 0; },
      };
    },

    gauge(name, help) {
      const values = new Map<string, number>();
      gauges.set(name, { help, values });
      return {
        type: 'gauge',
        set(value, labels) { values.set(labelKey(labels), value); },
        inc(labels, value = 1) { const k = labelKey(labels); values.set(k, (values.get(k) ?? 0) + value); },
        dec(labels, value = 1) { const k = labelKey(labels); values.set(k, (values.get(k) ?? 0) - value); },
        get(labels) { return values.get(labelKey(labels)) ?? 0; },
      };
    },

    histogram(name, help, buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
      const observations: number[] = [];
      histograms.set(name, { help, buckets, observations });
      return {
        type: 'histogram',
        observe(value) { observations.push(value); },
        getCount() { return observations.length; },
        getSum() { return observations.reduce((a, b) => a + b, 0); },
      };
    },

    render() {
      const lines: string[] = [];
      for (const [name, { help, values }] of counters) {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
        for (const [, v] of values) lines.push(`${name} ${v}`);
      }
      for (const [name, { help, values }] of gauges) {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
        for (const [, v] of values) lines.push(`${name} ${v}`);
      }
      return lines.join('\n');
    },
  };
}
