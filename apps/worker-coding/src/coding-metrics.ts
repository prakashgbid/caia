/**
 * Coding Agent worker metrics — Prometheus counters, histograms, and gauges
 * for the worker lifecycle, LLM engine, test runner, and DoD self-check.
 *
 * All metrics share a single isolated Registry so the worker's /metrics
 * endpoint does not bleed into the global prom-client default registry.
 */
import { Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ worker: 'coding' });

// ─── Worker lifecycle ────────────────────────────────────────────────────────

export const workerRegistrationsTotal = new Counter({
  name: 'coding_worker_registrations_total',
  help: 'Number of successful worker registrations with the orchestrator',
  registers: [registry],
});

export const workerHeartbeatsTotal = new Counter({
  name: 'coding_worker_heartbeats_total',
  help: 'Heartbeat tick outcomes',
  labelNames: ['outcome'] as const,  // ok | error
  registers: [registry],
});

export const workerPollsTotal = new Counter({
  name: 'coding_worker_polls_total',
  help: 'Assignment poll tick outcomes',
  labelNames: ['outcome'] as const,  // ok | no-assignment | error
  registers: [registry],
});

export const workerAssignmentsTotal = new Counter({
  name: 'coding_worker_assignments_total',
  help: 'Number of new story assignments dispatched to the engine',
  registers: [registry],
});

// ─── Implementation engine ───────────────────────────────────────────────────

export const implementTotal = new Counter({
  name: 'coding_implement_total',
  help: 'implement() call outcomes',
  labelNames: ['status'] as const,  // done | turn-limit | adapter-error
  registers: [registry],
});

export const implementTurns = new Histogram({
  name: 'coding_implement_turns',
  help: 'LLM turns consumed per implement() call',
  buckets: [1, 2, 3, 5, 7, 10],
  registers: [registry],
});

export const implementDurationMs = new Histogram({
  name: 'coding_implement_duration_ms',
  help: 'implement() wall-clock duration in milliseconds',
  buckets: [1_000, 5_000, 15_000, 60_000, 180_000, 600_000],
  registers: [registry],
});

export const applyFixTotal = new Counter({
  name: 'coding_apply_fix_total',
  help: 'applyFix() call outcomes',
  labelNames: ['status'] as const,  // fix-applied | turn-limit | adapter-error
  registers: [registry],
});

export const applyFixTurns = new Histogram({
  name: 'coding_apply_fix_turns',
  help: 'LLM turns consumed per applyFix() call',
  buckets: [1, 2, 3],
  registers: [registry],
});

export const llmTokensTotal = new Counter({
  name: 'coding_llm_tokens_total',
  help: 'Cumulative LLM tokens consumed by the Coding Agent',
  labelNames: ['kind'] as const,  // input | output
  registers: [registry],
});

// ─── Test runner ─────────────────────────────────────────────────────────────

export const testRunsTotal = new Counter({
  name: 'coding_test_runs_total',
  help: 'Local test phase outcomes',
  labelNames: ['phase', 'outcome'] as const,  // phase: unit|integration; outcome: passed|failed
  registers: [registry],
});

export const testDurationMs = new Histogram({
  name: 'coding_test_duration_ms',
  help: 'Local test phase wall-clock duration in milliseconds',
  labelNames: ['phase'] as const,
  buckets: [1_000, 5_000, 15_000, 60_000, 180_000, 600_000],
  registers: [registry],
});

// ─── DoD self-check ──────────────────────────────────────────────────────────

export const dodChecksTotal = new Counter({
  name: 'coding_dod_checks_total',
  help: 'Individual DoD check outcomes',
  labelNames: ['check_id', 'outcome'] as const,  // outcome: passed | failed
  registers: [registry],
});

export const dodTotal = new Counter({
  name: 'coding_dod_total',
  help: 'Overall DoD runAll() outcomes',
  labelNames: ['outcome'] as const,  // passed | failed
  registers: [registry],
});
