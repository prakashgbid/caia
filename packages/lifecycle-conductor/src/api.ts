/**
 * @caia/lifecycle-conductor — public API surface.
 *
 * Three methods per the operator brief:
 *   - getSolutionLifecycle(solutionId)
 *   - listIncompleteSolutions()
 *   - getDodStatus(solutionId)
 *
 * The API delegates accumulator math to the aggregator (which holds
 * the per-solution in-memory state) and FSM history fetches to the
 * underlying `SolutionLifecycleMachine` (optional — when absent, the
 * lifecycle history is sourced purely from the aggregator's
 * accumulator).
 */

import type { LifecycleAggregator } from './aggregator.js';
import { STEWARD_NAMES } from './types.js';
import type {
  CompositeState,
  DodStatus,
  StewardAttestation,
  StewardName,
  SolutionAccumulator,
} from './types.js';

/**
 * Structural match for `SolutionLifecycleMachine.getSolutionLifecycle`.
 * Kept intentionally minimal so the API can be wired against the real
 * FSM in production AND against a no-op stub in tests.
 */
export interface LifecycleHistoryReader {
  getSolutionLifecycle(solutionId: string): Promise<{
    solution: {
      solutionId: string;
      title: string;
      status: string;
      statusSince: Date;
      createdAt: Date;
      doneAt: Date | null;
      abandonedAt: Date | null;
    };
    history: Array<{
      id: number;
      fromState: string | null;
      toState: string;
      reason: string;
      actorId: string;
      at: Date;
    }>;
    ageHoursInState: number;
  }>;
  listActiveSolutions?(): Promise<
    Array<{ solutionId: string; status: string; title: string }>
  >;
}

export interface SolutionLifecycleView {
  solutionId: string;
  /** Composite (conductor) state — the canonical-doc vocabulary. */
  compositeState: CompositeState;
  /** Underlying FSM state — the operator-vocab. `null` if the FSM is
   * not wired into the conductor in this deployment. */
  fsmState: string | null;
  /** Per-steward most-recent attestation (or null if unobserved). */
  rows: Record<StewardName, StewardAttestation | null>;
  /** Number of consecutive all-five-green-and-fresh ticks. Used by the
   * dashboard to render the holdover progress bar. */
  consecutiveGreensAcrossAllStewards: number;
  /** ISO timestamp when the solution last entered producing-metrics
   * (null if never). */
  producingMetricsSince: string | null;
  /** True iff a `degraded` transition fired during the current
   * holdover. */
  driftDuringHoldover: boolean;
  /** DoD math snapshot. */
  dod: DodStatus;
  /** Last decision trigger. */
  lastTrigger: string;
  /** Optional FSM-level history (most-recent first), capped at 100.
   * Empty array if the FSM is not wired in. */
  history: Array<{
    id: number;
    fromState: string | null;
    toState: string;
    reason: string;
    actorId: string;
    at: string;
  }>;
  /** Title from the FSM row (null if FSM not wired). */
  title: string | null;
  /** When the solution was registered (ISO; null if FSM not wired). */
  createdAt: string | null;
  /** When the solution reached done (ISO; null if not done). */
  doneAt: string | null;
}

export interface ListIncompleteEntry {
  solutionId: string;
  compositeState: CompositeState;
  fsmState: string | null;
  dod: DodStatus;
  /** Hours the solution has been in its current composite state. */
  ageHoursInState: number | null;
}

export class LifecycleConductorApi {
  private readonly aggregator: LifecycleAggregator;
  private readonly machine: LifecycleHistoryReader | null;
  private readonly nowFn: () => Date;

  constructor(
    aggregator: LifecycleAggregator,
    machine?: LifecycleHistoryReader,
    nowFn?: () => Date,
  ) {
    this.aggregator = aggregator;
    this.machine = machine ?? null;
    this.nowFn = nowFn ?? ((): Date => new Date());
  }

  /**
   * Full lifecycle view for one solution. Combines the conductor's
   * in-memory composite-state with (optionally) the FSM's persistent
   * history.
   */
  async getSolutionLifecycle(solutionId: string): Promise<SolutionLifecycleView | null> {
    const snap = this.aggregator.snapshot(solutionId);
    if (snap === null) {
      // The solution might exist in the FSM but never have been
      // observed by the aggregator (no attestations yet). Fall back
      // to FSM-only view if available.
      if (this.machine === null) return null;
      try {
        const lifecycle = await this.machine.getSolutionLifecycle(solutionId);
        return projectFromFsmOnly(lifecycle);
      } catch {
        return null;
      }
    }

    const dod = this.aggregator.getDodStatus(solutionId);
    if (dod === null) return null; // Should not happen given snap !== null.

    let fsmState: string | null = null;
    let title: string | null = null;
    let createdAt: string | null = null;
    let doneAt: string | null = null;
    let history: SolutionLifecycleView['history'] = [];

    if (this.machine !== null) {
      try {
        const lc = await this.machine.getSolutionLifecycle(solutionId);
        fsmState = lc.solution.status;
        title = lc.solution.title;
        createdAt = lc.solution.createdAt.toISOString();
        doneAt =
          lc.solution.doneAt !== null ? lc.solution.doneAt.toISOString() : null;
        history = lc.history
          .slice(-100)
          .reverse()
          .map((h) => ({
            id: h.id,
            fromState: h.fromState,
            toState: h.toState,
            reason: h.reason,
            actorId: h.actorId,
            at: h.at.toISOString(),
          }));
      } catch {
        // Solution not in FSM — fall through with composite-only view.
      }
    }

    return {
      solutionId,
      compositeState: snap.compositeState,
      fsmState,
      rows: snap.rows,
      consecutiveGreensAcrossAllStewards: snap.consecutiveGreensAcrossAllStewards,
      producingMetricsSince:
        snap.producingMetricsSinceMs !== null
          ? new Date(snap.producingMetricsSinceMs).toISOString()
          : null,
      driftDuringHoldover: snap.driftDuringHoldover,
      dod,
      lastTrigger: snap.lastTrigger,
      history,
      title,
      createdAt,
      doneAt,
    };
  }

  /**
   * List every solution whose DoD has not yet been achieved.
   *
   * Includes: every solution in a forward state strictly below
   * `producing-metrics`, every solution in `degraded`, AND every
   * solution in `producing-metrics` whose 24h holdover is incomplete.
   *
   * Excludes: solutions in `sunset` (terminal). Excludes solutions
   * whose DoD is achieved (`dod.done === true`).
   */
  async listIncompleteSolutions(): Promise<ListIncompleteEntry[]> {
    const out: ListIncompleteEntry[] = [];
    const seen = new Set<string>();
    for (const id of this.aggregator.listSolutionIds()) {
      seen.add(id);
      const entry = this.toIncompleteEntry(id);
      if (entry !== null) out.push(entry);
    }
    // Augment with FSM-tracked solutions the aggregator has never
    // observed (registered but no attestations).
    if (this.machine?.listActiveSolutions) {
      try {
        const active = await this.machine.listActiveSolutions();
        for (const a of active) {
          if (seen.has(a.solutionId)) continue;
          out.push({
            solutionId: a.solutionId,
            compositeState: 'plan-approved',
            fsmState: a.status,
            dod: zeroDod(a.solutionId),
            ageHoursInState: null,
          });
        }
      } catch {
        /* swallow; degrade to aggregator-only list */
      }
    }
    // Sort: degraded first (highest urgency), then forward-states by
    // ascending ordinal (further from DoD first). Stable-sort by
    // solutionId within each bucket for determinism.
    out.sort(rankIncomplete);
    return out;
  }

  /** Pure passthrough; the aggregator owns the DoD math. */
  getDodStatus(solutionId: string): DodStatus | null {
    return this.aggregator.getDodStatus(solutionId);
  }

  private toIncompleteEntry(solutionId: string): ListIncompleteEntry | null {
    const snap = this.aggregator.snapshot(solutionId);
    if (snap === null) return null;
    const dod = this.aggregator.getDodStatus(solutionId);
    if (dod === null) return null;
    if (dod.done) return null;
    if (snap.compositeState === 'sunset') return null;
    return {
      solutionId,
      compositeState: snap.compositeState,
      fsmState: null,
      dod,
      ageHoursInState: ageHoursFromSnap(snap, this.nowFn()),
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function zeroDod(solutionId: string): DodStatus {
  return {
    solutionId,
    done: false,
    compositeState: 'plan-approved',
    holdoverHoursRemaining: null,
    missing: {
      deploy: 'missing',
      usage: 'missing',
      activation: 'missing',
      outcome: 'missing',
      'future-incoming': 'missing',
    },
    driftDuringHoldover: false,
  };
}

function projectFromFsmOnly(
  lifecycle: Awaited<ReturnType<LifecycleHistoryReader['getSolutionLifecycle']>>,
): SolutionLifecycleView {
  return {
    solutionId: lifecycle.solution.solutionId,
    compositeState: 'plan-approved',
    fsmState: lifecycle.solution.status,
    rows: {
      deploy: null,
      usage: null,
      activation: null,
      outcome: null,
      'future-incoming': null,
    },
    consecutiveGreensAcrossAllStewards: 0,
    producingMetricsSince: null,
    driftDuringHoldover: false,
    dod: zeroDod(lifecycle.solution.solutionId),
    lastTrigger: 'fsm-only',
    history: lifecycle.history
      .slice(-100)
      .reverse()
      .map((h) => ({
        id: h.id,
        fromState: h.fromState,
        toState: h.toState,
        reason: h.reason,
        actorId: h.actorId,
        at: h.at.toISOString(),
      })),
    title: lifecycle.solution.title,
    createdAt: lifecycle.solution.createdAt.toISOString(),
    doneAt:
      lifecycle.solution.doneAt !== null
        ? lifecycle.solution.doneAt.toISOString()
        : null,
  };
}

/**
 * Compute age-in-state from accumulator data. We don't persist a
 * "compositeStateSince" timestamp on the accumulator yet (FSM tracks
 * the operator-vocab equivalent already), so we approximate via
 * producingMetricsSinceMs when the state is producing-metrics, else
 * return null. Future enhancement: extend accumulator with a per
 * -composite-state entered-at timestamp.
 */
function ageHoursFromSnap(snap: SolutionAccumulator, now: Date): number | null {
  if (snap.compositeState === 'producing-metrics' && snap.producingMetricsSinceMs !== null) {
    return (now.getTime() - snap.producingMetricsSinceMs) / 3_600_000;
  }
  return null;
}

function rankIncomplete(a: ListIncompleteEntry, b: ListIncompleteEntry): number {
  const ranka = stateUrgencyRank(a.compositeState);
  const rankb = stateUrgencyRank(b.compositeState);
  if (ranka !== rankb) return ranka - rankb;
  return a.solutionId.localeCompare(b.solutionId);
}

function stateUrgencyRank(s: CompositeState): number {
  switch (s) {
    case 'degraded':
      return 0;
    case 'plan-approved':
      return 1;
    case 'pr-merged':
      return 2;
    case 'deployed':
      return 3;
    case 'built-into-active-app':
      return 4;
    case 'called-in-test':
      return 5;
    case 'producing-metrics':
      return 6;
    case 'sunset':
      return 7;
  }
}

export { STEWARD_NAMES };
