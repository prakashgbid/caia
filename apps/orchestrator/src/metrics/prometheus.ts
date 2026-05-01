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

// ─── LLM routing metrics (LAI-006) ────────────────────────────────────────────
// Wired by apps/orchestrator/src/api/routes/llm.ts. The same numbers are
// also surfaced as a JSON snapshot on GET /llm/metrics for the dashboard.

export const llmCallsTotal = new Counter({
  name: 'conductor_llm_calls_total',
  help: 'Total LLM calls dispatched through /llm/route',
  labelNames: ['provider', 'model', 'task_type', 'outcome'],
  registers: [promRegistry],
});

export const llmCallDurationMs = new Histogram({
  name: 'conductor_llm_call_duration_ms',
  help: 'Wall-clock duration of LLM calls',
  labelNames: ['provider', 'model', 'task_type'],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000],
  registers: [promRegistry],
});

export const llmTokensTotal = new Counter({
  name: 'conductor_llm_tokens_total',
  help: 'Total LLM tokens consumed (prompt + completion)',
  labelNames: ['provider', 'model', 'kind'],
  registers: [promRegistry],
});

export const llmEstimatedSavedUsd = new Counter({
  name: 'conductor_llm_estimated_saved_usd',
  help:
    'Estimated USD saved per call vs the all-Claude baseline. Only ' +
    'increments when local routing avoided a Claude call.',
  labelNames: ['provider'],
  registers: [promRegistry],
});

// ─── Pipeline observability counters (G8) ─────────────────────────────────────
// Populated by wirePipelineMetrics() in metrics/pipeline-metrics.ts.

export const pipelineStagesTotal = new Counter({
  name: 'conductor_pipeline_stages_total',
  help: 'Total pipeline stage transitions (pipeline.stage.advanced events)',
  labelNames: ['stage'],
  registers: [promRegistry],
});

export const agentRunsTotal = new Counter({
  name: 'conductor_agent_runs_total',
  help: 'Total agent-run completions by agent role and outcome',
  labelNames: ['agent', 'outcome'],
  registers: [promRegistry],
});

export const storiesTotal = new Counter({
  name: 'conductor_stories_total',
  help: 'Total story lifecycle outcomes (validation_passed|failed, completed, pipeline_failed)',
  labelNames: ['outcome'],
  registers: [promRegistry],
});

export const workerCrashesTotal = new Counter({
  name: 'conductor_worker_crashes_total',
  help: 'Total worker crashes detected via stale heartbeat (worker.crashed events)',
  registers: [promRegistry],
});

export const capsuleFreezesTotal = new Counter({
  name: 'conductor_capsule_freezes_total',
  help: 'Total ticket capsule-frozen events by status and skip reason',
  labelNames: ['status', 'reason'],
  registers: [promRegistry],
});
