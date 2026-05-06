/**
 * Implementation of `coordinateApprenticeLoop()`.
 */

import type { ResolvedAIMLArchitectConfig } from './config.js';
import type {
  AdapterRegistryReader,
  CoordinateDecision,
  CostSignal,
  CuratorReader,
  FailureSignal,
  MentorReader,
  TrainingPlan
} from './types.js';

export interface CoordinateDeps {
  readonly cfg: ResolvedAIMLArchitectConfig;
  readonly mentor: MentorReader;
  readonly curator: CuratorReader;
  readonly adapterRegistry: AdapterRegistryReader;
  readonly clock: () => Date;
}

const MODEL_FAILURE_EVENT_TYPES = [
  'HallucinationFlagged',
  'EvidenceGateFailure',
  'RegressionDetected',
  'DoDViolation',
  'ToolMisuseFlagged'
] as const;

const ROLLBACK_TRIGGER_EVENT_TYPES = [
  'RegressionDetected',
  'DoDViolation'
] as const;

export function coordinateApprenticeLoop(
  deps: CoordinateDeps
): TrainingPlan {
  const now = deps.clock();
  const windowMs = deps.cfg.retrainTriggerWindowDays * 24 * 60 * 60 * 1000;
  const sinceMs = now.getTime() - windowMs;
  const last24hMs = now.getTime() - 24 * 60 * 60 * 1000;

  const events = deps.mentor.readSince(sinceMs, 500);
  const findings = deps.curator.readRecent(100);
  const adapters = deps.adapterRegistry.list();

  const failureCounts: Record<string, FailureSignal> = {};
  for (const e of events) {
    if (!(MODEL_FAILURE_EVENT_TYPES as ReadonlyArray<string>).includes(e.type)) {
      continue;
    }
    const existing = failureCounts[e.type];
    if (existing) {
      failureCounts[e.type] = {
        eventType: e.type,
        count: existing.count + 1,
        sinceMs: Math.min(existing.sinceMs, e.emittedAtMs)
      };
    } else {
      failureCounts[e.type] = {
        eventType: e.type,
        count: 1,
        sinceMs: e.emittedAtMs
      };
    }
  }
  const failureSignals = Object.values(failureCounts);

  const costSignals: CostSignal[] = findings
    .filter(
      (f) =>
        f.category === 'Subscription & Resource Efficiency' &&
        (f.severity === 'medium' ||
          f.severity === 'high' ||
          f.severity === 'critical')
    )
    .map((f) => ({
      dimension: f.dimension,
      severity: f.severity,
      detail: f.title
    }));

  const rollbackEvents = events.filter(
    (e) =>
      (ROLLBACK_TRIGGER_EVENT_TYPES as ReadonlyArray<string>).includes(e.type) &&
      e.emittedAtMs >= last24hMs
  );
  if (rollbackEvents.length >= 3) {
    return {
      decision: 'rollback' as CoordinateDecision,
      rationale:
        `${rollbackEvents.length} regression/DoD-violation events in the last 24h ` +
        '— rollback to base model recommended.',
      estimatedCostUsd: 0,
      eligibleSinceMs: last24hMs,
      failureSignals,
      costSignals
    };
  }

  const candidate = adapters.find(
    (a) =>
      typeof a.winRate === 'number' &&
      a.winRate >= deps.cfg.promotionWinRateThreshold &&
      (a.forgettingFlags ?? 0) === 0 &&
      a.blessedAtMs === undefined
  );
  if (candidate !== undefined) {
    return {
      decision: 'promote-canary' as CoordinateDecision,
      rationale:
        `Adapter "${candidate.name}" passes win-rate threshold ` +
        `(${candidate.winRate}, ≥${deps.cfg.promotionWinRateThreshold}) with zero ` +
        'forgetting flags. Recommend promote-canary.',
      candidateAdapterPath: candidate.path,
      estimatedCostUsd: 0,
      ...(candidate.blessedAtMs !== undefined
        ? { eligibleSinceMs: candidate.blessedAtMs }
        : {}),
      failureSignals,
      costSignals
    };
  }

  const totalFailures = failureSignals.reduce((acc, s) => acc + s.count, 0);
  if (totalFailures >= deps.cfg.retrainTriggerThreshold) {
    return {
      decision: 'retrain' as CoordinateDecision,
      rationale:
        `${totalFailures} model-attributable failures in the last ` +
        `${deps.cfg.retrainTriggerWindowDays} days (threshold ` +
        `${deps.cfg.retrainTriggerThreshold}). Recommend retrain cycle.`,
      estimatedCostUsd: deps.cfg.retrainCostBudgetUsd,
      eligibleSinceMs: sinceMs,
      failureSignals,
      costSignals
    };
  }

  return {
    decision: 'hold' as CoordinateDecision,
    rationale:
      `No rollback signal, no promotion candidate, ${totalFailures} ` +
      `model-attributable failures (below ${deps.cfg.retrainTriggerThreshold} threshold). ` +
      'Hold position; re-evaluate next cycle.',
    estimatedCostUsd: 0,
    failureSignals,
    costSignals
  };
}
