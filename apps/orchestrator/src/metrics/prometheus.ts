/**
 * Prometheus metrics registry for Conductor API.
 * Exposes /prom-metrics endpoint (Prometheus text format).
 * The existing /metrics endpoint keeps returning JSON — these are additive.
 */

import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

export const promRegistry = new Registry();

collectDefaultMetrics({ register: promRegistry, prefix: 'conductor_' });

// ─── Event bus counters ───────────────────────────────────────────────────────

export const eventsPublishedTotal = new Counter({
  name: 'conductor_events_published_total',
  help: 'Total events published through the event bus',
  labelNames: ['type', 'actor', 'severity'],
  registers: [promRegistry],
});

// ─── Task counters ────────────────────────────────────────────────────────────

export const tasksProcessedTotal = new Counter({
  name: 'conductor_tasks_processed_total',
  help: 'Total tasks processed by the executor',
  labelNames: ['status', 'domain'],
  registers: [promRegistry],
});

// ─── Gate failures ────────────────────────────────────────────────────────────

export const gateFailuresTotal = new Counter({
  name: 'conductor_gate_failures_total',
  help: 'Total gate check failures',
  labelNames: ['gate', 'stage'],
  registers: [promRegistry],
});

// ─── Sentinel findings ────────────────────────────────────────────────────────

export const sentinelFindingsTotal = new Counter({
  name: 'conductor_sentinel_findings_filed_total',
  help: 'Total completeness sentinel findings',
  labelNames: ['severity', 'check_kind'],
  registers: [promRegistry],
});

// ─── Stage duration histograms ────────────────────────────────────────────────

export const stageDurationMs = new Histogram({
  name: 'conductor_stage_duration_ms',
  help: 'Duration in ms for pipeline stages',
  labelNames: ['stage', 'status'],
  buckets: [10, 50, 100, 500, 1000, 5000, 15000, 60000],
  registers: [promRegistry],
});

export const buildStepDurationMs = new Histogram({
  name: 'conductor_build_step_duration_ms',
  help: 'Duration in ms for build steps',
  labelNames: ['step_name', 'status'],
  buckets: [100, 500, 1000, 5000, 10000, 30000, 60000, 120000],
  registers: [promRegistry],
});

export const workerDurationMs = new Histogram({
  name: 'conductor_worker_duration_ms',
  help: 'Duration in ms for executor workers (task runs)',
  labelNames: ['status', 'domain'],
  buckets: [1000, 5000, 15000, 60000, 300000, 1800000],
  registers: [promRegistry],
});

// ─── HTTP request counter (wired in app.ts) ───────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'conductor_http_requests_total',
  help: 'Total HTTP requests handled by the API',
  labelNames: ['method', 'path', 'status'],
  registers: [promRegistry],
});
