/**
 * Executor metrics — Prometheus-compatible in-process registry.
 * Exposes /metrics on EXECUTOR_METRICS_PORT when set.
 */

import * as http from 'http';

type Labels = Readonly<Record<string, string>>;

function lkey(labels: Labels): string {
  return JSON.stringify(Object.fromEntries(Object.entries(labels).sort()));
}

function labelsFmt(labels: Labels): string {
  const pairs = Object.entries(labels);
  return pairs.length ? `{${pairs.map(([k, v]) => `${k}="${v}"`).join(',')}}` : '';
}

class CounterImpl {
  private vals = new Map<string, number>();
  constructor(readonly name: string, readonly help: string) {}

  inc(labels: Labels = {}, n = 1): void {
    const k = lkey(labels);
    this.vals.set(k, (this.vals.get(k) ?? 0) + n);
  }

  lines(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.vals) {
      out.push(`${this.name}${labelsFmt(JSON.parse(k) as Labels)} ${v}`);
    }
    if (this.vals.size === 0) out.push(`${this.name} 0`);
    return out;
  }
}

class GaugeImpl {
  private vals = new Map<string, number>();
  constructor(readonly name: string, readonly help: string) {}

  set(v: number, labels: Labels = {}): void { this.vals.set(lkey(labels), v); }
  inc(labels: Labels = {}, n = 1): void {
    const k = lkey(labels);
    this.vals.set(k, (this.vals.get(k) ?? 0) + n);
  }
  dec(labels: Labels = {}, n = 1): void {
    const k = lkey(labels);
    this.vals.set(k, (this.vals.get(k) ?? 0) - n);
  }

  lines(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [k, v] of this.vals) {
      out.push(`${this.name}${labelsFmt(JSON.parse(k) as Labels)} ${v}`);
    }
    if (this.vals.size === 0) out.push(`${this.name} 0`);
    return out;
  }
}

// Duration buckets in milliseconds
const MS_BUCKETS = [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000];

class HistogramImpl {
  private obs: number[] = [];
  constructor(readonly name: string, readonly help: string, readonly buckets = MS_BUCKETS) {}

  observe(v: number): void { this.obs.push(v); }

  lines(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    const sum = this.obs.reduce((a, b) => a + b, 0);
    for (const b of this.buckets) {
      out.push(`${this.name}_bucket{le="${b}"} ${this.obs.filter(v => v <= b).length}`);
    }
    out.push(
      `${this.name}_bucket{le="+Inf"} ${this.obs.length}`,
      `${this.name}_sum ${sum}`,
      `${this.name}_count ${this.obs.length}`,
    );
    return out;
  }
}

// ─── Named metrics ──────────────────────────────────────────────────────────

export const metrics = {
  /** Tasks dispatched; labels: model (haiku|sonnet|opus), domain */
  tasksDispatched: new CounterImpl(
    'conductor_executor_tasks_dispatched_total',
    'Tasks dispatched to claude subprocess by model and domain',
  ),

  /** Dispatch failures before process spawned; labels: none */
  dispatchFailures: new CounterImpl(
    'conductor_executor_dispatch_failures_total',
    'Task dispatch failures (subprocess could not be spawned)',
  ),

  /** Completed worker outcomes; labels: outcome (done|failed|stalled|dead) */
  taskCompletions: new CounterImpl(
    'conductor_executor_task_completions_total',
    'Task completion outcomes from monitored workers',
  ),

  /** Wall-clock duration from spawn to completion (ms) */
  taskDurationMs: new HistogramImpl(
    'conductor_executor_task_duration_ms',
    'Task wall-clock duration from spawn to completion in milliseconds',
  ),

  /** Live count of currently executing workers */
  inFlightWorkers: new GaugeImpl(
    'conductor_executor_in_flight_workers',
    'Currently executing worker subprocesses',
  ),

  /** Tasks waiting in queue at last tick */
  queueDepth: new GaugeImpl(
    'conductor_executor_queue_depth',
    'Tasks in queued state at last tick',
  ),

  /** Scheduler skips per classification; labels: reason (paused|deps|domain_cap) */
  schedulerSkips: new CounterImpl(
    'conductor_executor_scheduler_skips_total',
    'Tasks skipped by scheduler per reason class',
  ),

  /** Circuit breaker trips — task paused after exhausting retry threshold */
  circuitBreakerTrips: new CounterImpl(
    'conductor_executor_circuit_breaker_trips_total',
    'Tasks paused by circuit breaker after exceeding failure threshold',
  ),

  /** gate:publish failures in completeness check */
  completenessFailures: new CounterImpl(
    'conductor_executor_completeness_check_failures_total',
    'Completeness gate check failures after task completion',
  ),

  /** Tasks recovered from dead PIDs on daemon restart */
  recoveryRestores: new CounterImpl(
    'conductor_executor_recovery_restores_total',
    'Tasks re-queued after orphaned run detected on daemon restart',
  ),
};

function renderAll(): string {
  return (Object.values(metrics) as Array<{ lines(): string[] }>)
    .flatMap(m => m.lines())
    .join('\n') + '\n';
}

/** Classify a raw scheduler skip reason into a stable label value. */
export function classifySkipReason(reason: string): string {
  if (reason.startsWith('paused')) return 'paused';
  if (reason.startsWith('waiting for deps')) return 'deps';
  if (reason.startsWith('domain cap')) return 'domain_cap';
  return 'other';
}

/** Start Prometheus scrape endpoint on EXECUTOR_METRICS_PORT (no-op if unset). */
export function startMetricsServer(): void {
  const port = process.env['EXECUTOR_METRICS_PORT'];
  if (!port) return;
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(renderAll());
  });
  srv.listen(parseInt(port, 10), () => {
    process.stderr.write(`[executor:metrics] http://localhost:${port}/metrics\n`);
  });
  srv.on('error', (err: Error) => {
    process.stderr.write(`[executor:metrics] server error: ${err.message}\n`);
  });
}
