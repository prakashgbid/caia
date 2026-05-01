import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const sentinelRegistry = new Registry();

collectDefaultMetrics({ register: sentinelRegistry, prefix: 'sentinel_process_' });

export const sweepsTotal = new Counter({
  name: 'sentinel_sweeps_total',
  help: 'Total completeness sweeps completed',
  labelNames: ['status'] as const,
  registers: [sentinelRegistry],
});

export const sweepDurationMs = new Histogram({
  name: 'sentinel_sweep_duration_ms',
  help: 'Wall-clock duration in ms for a full completeness sweep',
  buckets: [1_000, 5_000, 15_000, 60_000, 300_000, 900_000],
  registers: [sentinelRegistry],
});

export const entitiesCheckedTotal = new Counter({
  name: 'sentinel_entities_checked_total',
  help: 'Total entities checked by the completeness sentinel',
  labelNames: ['kind'] as const,
  registers: [sentinelRegistry],
});

export const checksTotal = new Counter({
  name: 'sentinel_checks_total',
  help: 'Total individual checks executed',
  labelNames: ['check_kind', 'result'] as const,
  registers: [sentinelRegistry],
});

export const findingsTotal = new Counter({
  name: 'sentinel_findings_total',
  help: 'Total failed checks (findings) detected',
  labelNames: ['severity', 'check_kind'] as const,
  registers: [sentinelRegistry],
});

export const entityCheckDurationMs = new Histogram({
  name: 'sentinel_entity_check_duration_ms',
  help: 'Duration in ms to check a single entity',
  labelNames: ['kind'] as const,
  buckets: [10, 50, 100, 500, 1_000, 5_000, 15_000],
  registers: [sentinelRegistry],
});

export const lastSweepScorePct = new Gauge({
  name: 'sentinel_last_sweep_score_avg_pct',
  help: 'Average completeness score (0-100) from the most recent sweep, by entity kind',
  labelNames: ['kind'] as const,
  registers: [sentinelRegistry],
});

export const lastSweepEntities = new Gauge({
  name: 'sentinel_last_sweep_entities_total',
  help: 'Number of entities checked in the most recent sweep, by kind',
  labelNames: ['kind'] as const,
  registers: [sentinelRegistry],
});
