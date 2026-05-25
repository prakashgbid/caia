/**
 * @caia/lifecycle-conductor — aggregator.
 *
 * Subscribes to the five stewards' attestation streams and maintains an
 * in-memory accumulator per solution. On every attestation:
 *
 *   1. Update the per-solution row matrix.
 *   2. Re-run `DefaultFsmDriver.evaluate(rows, freshness, now)`.
 *   3. Re-run `DefaultFsmDriver.decide(...)` to pick the new composite state.
 *   4. If the new composite state differs from current, fire the
 *      onCompositeStateChanged hook AND (when an underlying
 *      `SolutionLifecycleMachine` is provided) drive the operator-vocab
 *      FSM forward via repeated `advanceSolution` calls until the
 *      FSM's status matches the composite target.
 *
 * Subscription-only. The aggregator NEVER polls a steward. The five
 * stewards push attestations into the conductor via:
 *
 *   - the in-process `EventBus` (default — sibling packages all share
 *     `@chiefaia/event-bus-internal`'s `eventBus` singleton), OR
 *   - direct calls to `aggregator.ingest(att)` (used by tests and by
 *     the daemon's stdin loop when a steward is configured to spawn
 *     the conductor with attestations on stdin).
 *
 * The aggregator is decoupled from the underlying FSM: provide
 * `solutionMachine` to drive the operator-vocab FSM, or leave it null
 * to run in stand-alone composite-state-only mode (useful for
 * pre-Postgres bootstrapping and for unit tests).
 */

import { DefaultFsmDriver, FORWARD_STATE_ORDINAL } from './fsm.js';
import type { FsmDriver } from './fsm.js';
import {
  ALL_COMPOSITE_STATES,
  DEFAULT_FRESHNESS_HOURS,
  PRODUCING_METRICS_HOLDOVER_HOURS,
  STEWARD_NAMES,
  isStewardName,
  resolveFreshnessHours,
  type CompositeState,
  type CompositeStateChangedEvent,
  type DodStatus,
  type ForwardCompositeState,
  type LifecycleConductorOptions,
  type SolutionAccumulator,
  type StewardAttestation,
  type StewardName,
} from './types.js';

/**
 * Minimal interface the aggregator needs from an underlying
 * `SolutionLifecycleMachine`. We type it structurally so the conductor
 * doesn't have to import the full state-machine package surface in
 * codepaths that don't use the FSM (e.g. unit tests of the aggregator).
 */
export interface SolutionMachineLike {
  getSolution(solutionId: string): Promise<{
    status: string;
    solutionId: string;
    version: number;
  } | null>;
  advanceSolution(
    solutionId: string,
    toState: string,
    opts: {
      reason: string;
      triggeredBy: { kind: string; id: string };
      attestation?: {
        steward: string;
        id: string;
        status: 'green' | 'amber' | 'red';
        at: string;
        evidence?: Record<string, unknown>;
      };
      evidence?: Record<string, unknown>;
      payload?: Record<string, unknown>;
    },
  ): Promise<{ applied: boolean; toState: string }>;
}

/**
 * Minimal interface the aggregator needs from a steward event source.
 * Mirrors the `EventEmitter`-style API exposed by
 * `@chiefaia/event-bus-internal` AND the in-process `SolutionLifecycle
 * Machine.on()`. Either source works.
 *
 * The aggregator subscribes to ANY message whose payload contains a
 * `StewardAttestation` envelope; the source need not filter by event
 * type. The aggregator drops messages whose envelope fails the type
 * guard.
 */
export interface AttestationEventSource {
  subscribe(handler: (envelope: { payload: unknown }) => void): () => void;
}

export interface LifecycleAggregatorOptions extends LifecycleConductorOptions {
  /** If provided, the aggregator drives this FSM via `advanceSolution`
   * on every composite-state change. */
  solutionMachine?: SolutionMachineLike;
  /** If provided, the aggregator subscribes to it on construction.
   * Multiple sources are supported (e.g. one per steward). */
  eventSources?: AttestationEventSource[];
  /** Override the FSM driver in tests. */
  driver?: FsmDriver;
  /** Initial composite-state for solutions the aggregator first sees
   * via an attestation. Default 'plan-approved'. */
  initialCompositeState?: CompositeState;
}

/**
 * The operator-vocab FSM walks one forward edge at a time. The map
 * below tells the aggregator which composite-state target corresponds
 * to which operator-vocab state, so the walker knows when to stop.
 *
 * Mapping rules (canonical-doc → operator-vocab, per
 * SOLUTION_STATE_CANONICAL_SYNONYM in @caia/state-machine):
 *   plan-approved          → approved
 *   pr-merged              → merged
 *   deployed               → deployed
 *   built-into-active-app  → imported   (canonical doc folds these two)
 *   called-in-test         → called-in-test
 *   producing-metrics      → producing-metrics
 *
 * `degraded` and `sunset` do not have direct operator-vocab analogs
 * — the aggregator maps them to the rolled-back / abandoned variant
 * of the current FSM state at the time of the transition.
 */
const COMPOSITE_TO_OPERATOR_TARGET: Readonly<Record<ForwardCompositeState, string>> =
  Object.freeze({
    'plan-approved': 'approved',
    'pr-merged': 'merged',
    deployed: 'deployed',
    'built-into-active-app': 'imported',
    'called-in-test': 'called-in-test',
    'producing-metrics': 'producing-metrics',
  });

/** Operator-vocab forward-state ordinals — used by `walkFsmForward`
 * to choose the next single-step edge on the path to a target. */
const OPERATOR_FORWARD_STATE_ORDINAL: Readonly<Record<string, number>> = Object.freeze({
  approved: 1,
  implemented: 2,
  merged: 3,
  deployed: 4,
  imported: 5,
  'called-in-test': 6,
  'called-in-prod': 7,
  'producing-metrics': 8,
  done: 9,
});

/** Reverse lookup so the walker can find the next state by ordinal. */
const OPERATOR_FORWARD_BY_ORDINAL: Readonly<Record<number, string>> = Object.freeze({
  1: 'approved',
  2: 'implemented',
  3: 'merged',
  4: 'deployed',
  5: 'imported',
  6: 'called-in-test',
  7: 'called-in-prod',
  8: 'producing-metrics',
  9: 'done',
});

export class LifecycleAggregator {
  private readonly nowFn: () => Date;
  private readonly freshnessHours: Record<StewardName, number>;
  private readonly degradedClearThreshold: number;
  private readonly onCompositeStateChanged?: (e: CompositeStateChangedEvent) => void;
  private readonly machine: SolutionMachineLike | null;
  private readonly driver: FsmDriver;
  private readonly initialCompositeState: CompositeState;
  private readonly unsubFns: Array<() => void> = [];
  private readonly accumulators = new Map<string, SolutionAccumulator>();

  /** Diagnostic counters — useful for the daemon's `stats` log. */
  public attestationsIngested = 0;
  public compositeStateChanges = 0;
  public fsmAdvancesIssued = 0;
  public ignoredEnvelopes = 0;

  constructor(opts: LifecycleAggregatorOptions = {}) {
    this.nowFn = opts.now ?? ((): Date => new Date());
    this.freshnessHours = resolveFreshnessHours(opts.freshnessHoursOverride);
    this.degradedClearThreshold = opts.degradedClearThreshold ?? 3;
    if (opts.onCompositeStateChanged !== undefined) {
      this.onCompositeStateChanged = opts.onCompositeStateChanged;
    }
    this.machine = opts.solutionMachine ?? null;
    this.driver = opts.driver ?? DefaultFsmDriver;
    this.initialCompositeState = opts.initialCompositeState ?? 'plan-approved';
    for (const src of opts.eventSources ?? []) {
      this.attachSource(src);
    }
  }

  /** Wire an additional event source after construction. */
  attachSource(source: AttestationEventSource): void {
    const unsub = source.subscribe((envelope) => {
      const att = coerceAttestation(envelope.payload);
      if (att === null) {
        this.ignoredEnvelopes += 1;
        return;
      }
      // Fire-and-forget — the aggregator never blocks the event source.
      void this.ingest(att);
    });
    this.unsubFns.push(unsub);
  }

  /** Tear down all subscriptions. */
  stop(): void {
    while (this.unsubFns.length > 0) {
      const fn = this.unsubFns.pop();
      try {
        fn?.();
      } catch {
        /* swallow */
      }
    }
  }

  /** Direct ingest path used by tests and by the daemon's stdin loop. */
  async ingest(att: StewardAttestation): Promise<void> {
    this.attestationsIngested += 1;
    const acc = this.accumulatorFor(att.solutionId);
    acc.rows[att.steward] = att;

    const evaluation = this.driver.evaluate(acc.rows, this.freshnessHours, this.nowFn());

    // Maintain the consecutive-greens counter. We consider a "tick" to
    // be all-green-and-fresh iff every steward (1) has an attestation
    // and (2) passes its gate. Counting attestation arrivals
    // (rather than synthetic cron ticks) is the right cadence because
    // the conductor is subscription-only — there is no other clock.
    const allFiveFresh = STEWARD_NAMES.every(
      (s) => evaluation.perStewardPass[s] === true,
    );
    if (allFiveFresh && !evaluation.anyRed && !evaluation.anyStale) {
      acc.consecutiveGreensAcrossAllStewards += 1;
    } else {
      acc.consecutiveGreensAcrossAllStewards = 0;
    }

    const decision = this.driver.decide({
      currentState: acc.compositeState,
      evaluation,
      consecutiveGreensAcrossAllStewards: acc.consecutiveGreensAcrossAllStewards,
      degradedClearThreshold: this.degradedClearThreshold,
    });

    acc.lastTrigger = decision.trigger;

    if (decision.newState === acc.compositeState) {
      // No transition. But: if we're sitting in producing-metrics and
      // still all-green, do nothing — the holdover is being tracked
      // separately on the accumulator (see below).
      return;
    }

    const fromState = acc.compositeState;
    acc.compositeState = decision.newState;
    this.compositeStateChanges += 1;

    // Track holdover for the producing-metrics → DONE rule.
    if (decision.newState === 'producing-metrics') {
      acc.producingMetricsSinceMs = this.nowFn().getTime();
      acc.driftDuringHoldover = false;
    } else if (fromState === 'producing-metrics') {
      // Left producing-metrics — reset holdover (caller can re-enter).
      acc.producingMetricsSinceMs = null;
      acc.driftDuringHoldover = decision.isDrift || acc.driftDuringHoldover;
    }
    // If we drifted to degraded during a producing-metrics holdover,
    // mark it. (The state will have already moved out of
    // producing-metrics, so the previous branch already records this.
    // The explicit check below covers the case where we drift to
    // degraded from a non-producing-metrics state but we *had* a
    // recent producing-metrics holdover that hasn't been cleared yet.)
    if (decision.isDrift) {
      acc.driftDuringHoldover = true;
    }

    const at = this.nowFn().toISOString();
    const rowsSnapshot = cloneRows(acc.rows);

    if (this.onCompositeStateChanged) {
      try {
        this.onCompositeStateChanged({
          solutionId: acc.solutionId,
          fromState,
          toState: decision.newState,
          trigger: decision.trigger,
          rowsSnapshot,
          at,
        });
      } catch {
        /* swallow hook errors */
      }
    }

    if (this.machine !== null) {
      try {
        await this.driveFsm(acc.solutionId, decision.newState, att, decision.trigger);
      } catch (err) {
        // The aggregator never throws to the event source — log and
        // continue. The daemon's stats logger reports these via
        // `compositeStateChanges - fsmAdvancesIssued` if it cares.
        // eslint-disable-next-line no-console
        console.error(
          `[lifecycle-conductor] FSM drive failed for ${acc.solutionId}:`,
          (err as Error).message,
        );
      }
    }
  }

  /** Read-only snapshot of the in-memory accumulator for a solution.
   * Used by the API surface in `api.ts`. */
  snapshot(solutionId: string): SolutionAccumulator | null {
    const acc = this.accumulators.get(solutionId);
    if (!acc) return null;
    return cloneAccumulator(acc);
  }

  /** List every solution the aggregator has ingested at least one
   * attestation for. */
  listSolutionIds(): string[] {
    return [...this.accumulators.keys()];
  }

  /** Compute the DoD status for a solution. Pure read; does not
   * mutate the accumulator. */
  getDodStatus(solutionId: string): DodStatus | null {
    const acc = this.accumulators.get(solutionId);
    if (!acc) return null;
    return computeDod(acc, this.freshnessHours, this.nowFn());
  }

  /** Internal accumulator accessor; creates on first reference. */
  private accumulatorFor(solutionId: string): SolutionAccumulator {
    let acc = this.accumulators.get(solutionId);
    if (!acc) {
      acc = {
        solutionId,
        rows: {
          deploy: null,
          usage: null,
          activation: null,
          outcome: null,
          'future-incoming': null,
        },
        compositeState: this.initialCompositeState,
        consecutiveGreensAcrossAllStewards: 0,
        producingMetricsSinceMs: null,
        driftDuringHoldover: false,
        lastTrigger: 'initial',
      };
      this.accumulators.set(solutionId, acc);
    }
    return acc;
  }

  /** Walk the underlying FSM forward one edge at a time toward the
   * operator-vocab equivalent of the composite target. Each call
   * issues at most one `advanceSolution` per edge; we tolerate
   * intermediate FSM errors (e.g. duplicate idempotent advances).
   *
   * For `degraded` and `sunset`, we map to the operator-vocab
   * rolled-back / abandoned variant of the current FSM state.
   */
  private async driveFsm(
    solutionId: string,
    target: CompositeState,
    attestation: StewardAttestation,
    trigger: string,
  ): Promise<void> {
    if (this.machine === null) return;

    const current = await this.machine.getSolution(solutionId);
    if (!current) {
      // FSM hasn't registered this solution yet — the conductor is
      // not the registration authority (the EA Architect Agent is).
      // Skip silently.
      return;
    }

    if (target === 'sunset') {
      // Operator-vocab terminal-failure is `abandoned`. Reuse here
      // per the canonical-doc note (synonyms map in solution-states.ts).
      if (current.status === 'abandoned') return;
      await this.advance(solutionId, 'abandoned', attestation, `sunset:${trigger}`);
      return;
    }

    if (target === 'degraded') {
      const rolledBack = mapToRolledBack(current.status);
      if (rolledBack === null) return; // pre-deploy states have no
      // rolled-back analog — leave the FSM where it is and rely on
      // the composite-state-only signal.
      if (current.status === rolledBack) return;
      await this.advance(
        solutionId,
        rolledBack,
        attestation,
        `degraded-drift:${trigger}`,
      );
      return;
    }

    // Forward target. Walk one edge at a time until the FSM's status
    // matches the operator-vocab equivalent of `target`.
    const targetOperator = COMPOSITE_TO_OPERATOR_TARGET[target];
    const targetOrdinal = OPERATOR_FORWARD_STATE_ORDINAL[targetOperator];
    if (targetOrdinal === undefined) return;

    // Safety bound: there are 9 forward states, so 16 iterations is
    // generous. Avoids infinite loops on malformed FSMs.
    for (let step = 0; step < 16; step += 1) {
      const refreshed = await this.machine.getSolution(solutionId);
      if (!refreshed) return;
      const refreshedOrdinal = OPERATOR_FORWARD_STATE_ORDINAL[refreshed.status];
      if (refreshedOrdinal === undefined) {
        // FSM is in a paused/failed/rolled-back state. Try to advance
        // to the corresponding forward state — but only if the
        // operator-vocab transition table allows it. We rely on
        // checkSolutionTransition inside the FSM to enforce legality.
        const forwardSibling = stripSuffix(refreshed.status);
        if (forwardSibling !== null && forwardSibling !== refreshed.status) {
          await this.advance(
            solutionId,
            forwardSibling,
            attestation,
            `recover-from-${refreshed.status}:${trigger}`,
          );
          continue;
        }
        return;
      }
      if (refreshedOrdinal >= targetOrdinal) return; // we've reached or passed it.
      const nextOrdinal = refreshedOrdinal + 1;
      const nextState = OPERATOR_FORWARD_BY_ORDINAL[nextOrdinal];
      if (nextState === undefined) return;
      await this.advance(
        solutionId,
        nextState,
        attestation,
        `forward-step-${refreshed.status}->${nextState}:${trigger}`,
      );
    }
  }

  private async advance(
    solutionId: string,
    toState: string,
    attestation: StewardAttestation,
    reason: string,
  ): Promise<void> {
    if (this.machine === null) return;
    this.fsmAdvancesIssued += 1;
    // The payload carries a unique-per-call advance id so the FSM's
    // (solutionId, toState, payloadHash) idempotency index does not
    // collide with a previous transition to the same state. (E.g.,
    // when a solution goes producing-metrics -> rolled-back ->
    // producing-metrics, both forward transitions must be recorded
    // as distinct history rows.)
    const advanceId =
      `${attestation.steward}:${attestation.observedAt}:${this.fsmAdvancesIssued}`;
    await this.machine.advanceSolution(solutionId, toState, {
      reason,
      triggeredBy: {
        kind: 'steward',
        id: `${attestation.steward}-steward`,
      },
      attestation: {
        steward: attestation.steward,
        id: attestation.runId ?? `${attestation.steward}-${attestation.observedAt}`,
        status: attestation.status,
        at: attestation.observedAt,
        ...(attestation.evidence !== undefined ? { evidence: attestation.evidence } : {}),
      },
      ...(attestation.evidence !== undefined ? { evidence: attestation.evidence } : {}),
      payload: {
        advanceId,
        compositeTrigger: reason,
      },
    });
  }
}

// ─── DoD math ───────────────────────────────────────────────────────────────

function computeDod(
  acc: SolutionAccumulator,
  freshness: Record<StewardName, number>,
  now: Date,
): DodStatus {
  const missing: DodStatus['missing'] = {};
  const nowMs = now.getTime();
  for (const steward of STEWARD_NAMES) {
    const row = acc.rows[steward];
    if (row === null) {
      missing[steward] = 'missing';
      continue;
    }
    if (row.status === 'red') {
      missing[steward] = 'red';
      continue;
    }
    if (row.status === 'amber') {
      missing[steward] = 'amber';
      continue;
    }
    const observedMs = Date.parse(row.observedAt);
    const ageHours = (nowMs - observedMs) / 3_600_000;
    if (ageHours > freshness[steward]) {
      missing[steward] = 'stale';
    }
  }

  let holdoverHoursRemaining: number | null = null;
  if (acc.producingMetricsSinceMs !== null) {
    const elapsedHours = (nowMs - acc.producingMetricsSinceMs) / 3_600_000;
    holdoverHoursRemaining = Math.max(
      0,
      PRODUCING_METRICS_HOLDOVER_HOURS - elapsedHours,
    );
  }

  const done =
    acc.compositeState === 'producing-metrics' &&
    holdoverHoursRemaining !== null &&
    holdoverHoursRemaining === 0 &&
    !acc.driftDuringHoldover &&
    Object.keys(missing).length === 0;

  return {
    solutionId: acc.solutionId,
    done,
    compositeState: acc.compositeState,
    holdoverHoursRemaining,
    missing,
    driftDuringHoldover: acc.driftDuringHoldover,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Type-guard + extractor. Accepts either a bare StewardAttestation or
 * a wrapped envelope `{ steward, solutionId, status, observedAt, ... }`.
 * Returns null if the payload doesn't look like an attestation we
 * should ingest. (We intentionally do NOT coerce missing fields — a
 * malformed envelope is silently dropped to avoid corrupting the
 * accumulator with garbage.)
 */
export function coerceAttestation(payload: unknown): StewardAttestation | null {
  if (payload === null || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const steward = p['steward'];
  if (!isStewardName(steward)) return null;
  const solutionId = p['solutionId'] ?? p['solution_id'];
  if (typeof solutionId !== 'string' || solutionId.length === 0) return null;
  const status = p['status'];
  if (status !== 'green' && status !== 'amber' && status !== 'red') return null;
  const observedAt =
    typeof p['observedAt'] === 'string'
      ? p['observedAt']
      : typeof p['at'] === 'string'
        ? p['at']
        : typeof p['observed_at'] === 'string'
          ? p['observed_at']
          : null;
  if (observedAt === null) return null;
  const att: StewardAttestation = {
    steward,
    solutionId,
    status,
    observedAt,
  };
  if (typeof p['runId'] === 'string') att.runId = p['runId'];
  else if (typeof p['run_id'] === 'string') att.runId = p['run_id'];
  if (typeof p['note'] === 'string') att.note = p['note'];
  if (typeof p['evidence'] === 'object' && p['evidence'] !== null) {
    att.evidence = p['evidence'] as Record<string, unknown>;
  }
  return att;
}

function cloneRows(
  rows: Record<StewardName, StewardAttestation | null>,
): Record<StewardName, StewardAttestation | null> {
  return {
    deploy: rows.deploy === null ? null : { ...rows.deploy },
    usage: rows.usage === null ? null : { ...rows.usage },
    activation: rows.activation === null ? null : { ...rows.activation },
    outcome: rows.outcome === null ? null : { ...rows.outcome },
    'future-incoming':
      rows['future-incoming'] === null ? null : { ...rows['future-incoming'] },
  };
}

function cloneAccumulator(acc: SolutionAccumulator): SolutionAccumulator {
  return {
    ...acc,
    rows: cloneRows(acc.rows),
  };
}

/**
 * Map an operator-vocab post-deployment state to its `*-rolled-back`
 * variant. Returns null for pre-deployment states (which use
 * `*-failed` instead but the conductor does not drive those on drift —
 * an `implemented`-state regression should never be flagged because
 * code-written → deployed is steward-attested by the deploy steward
 * itself).
 */
function mapToRolledBack(status: string): string | null {
  switch (status) {
    case 'deployed':
      return 'deployed-rolled-back';
    case 'imported':
      return 'imported-rolled-back';
    case 'called-in-test':
      return 'called-in-test-rolled-back';
    case 'called-in-prod':
      return 'called-in-prod-rolled-back';
    case 'producing-metrics':
      return 'producing-metrics-rolled-back';
    default:
      return null;
  }
}

/** Strip the `-failed` / `-rolled-back` suffix from an operator-vocab
 * status, returning the corresponding forward state. Used when the
 * aggregator wants to walk a recovering solution back to the forward
 * happy-path. */
function stripSuffix(status: string): string | null {
  if (status.endsWith('-rolled-back')) {
    return status.slice(0, -'-rolled-back'.length);
  }
  if (status.endsWith('-failed')) {
    return status.slice(0, -'-failed'.length);
  }
  return null;
}

// Re-export the composite-state constant so consumers needing both can
// import from the aggregator surface without pulling fsm.ts.
export { ALL_COMPOSITE_STATES, FORWARD_STATE_ORDINAL, DEFAULT_FRESHNESS_HOURS };
