/**
 * `SolutionStore` is the backend-agnostic storage contract for the
 * Solution lifecycle FSM. Two implementations ship in this package:
 *
 *   - `InMemorySolutionStore` — fast, deterministic, used in tests.
 *   - `PgSolutionStore` — wraps a `pg.Pool` against `caia_meta.solution_lifecycle`.
 *
 * Same atomicity contract as the project FSM's `StateStore`: a single
 * `advanceAtomic()` call MUST read current state + apply transition +
 * write history in one durable step. Per-solution advisory locks +
 * optimistic-`version` checks guard against the multi-steward race.
 */

import type { SolutionState } from './solution-states.js';
import type {
  ApprovedPlanInput,
  SolutionActorKind,
  SolutionHistoryRow,
  SolutionRow,
  StuckSolution,
} from './solution-types.js';

export interface SolutionAdvanceAtomicInput {
  solutionId: string;
  expectedVersion: number;
  expectedStatus: SolutionState;
  toState: SolutionState;
  reason: string;
  actorKind: SolutionActorKind;
  actorId: string;
  agentRunId: string | null;
  attestation: Record<string, unknown>;
  evidence: Record<string, unknown>;
  payload: Record<string, unknown>;
  payloadHash: string;
  idempotencyWindowMs: number;
  /** Clock for the transition timestamp — passed by the machine so mocked clocks in tests match the snapshot ageHoursInState math. */
  now: Date;
}

export interface SolutionAdvanceAtomicResult {
  applied: boolean;
  newVersion: number;
  historyId: number | null;
  /** True iff the call collided with an existing history row by hash
   * (the canonical "idempotent replay" success-shape). */
  idempotentReplay: boolean;
}

export interface ListStuckOpts {
  /** Per-state thresholds in hours. Required (the machine passes the
   * resolved-after-defaults map). */
  thresholdsHours: Partial<Record<SolutionState, number>>;
  /** Clock — caller passes a Date so the store does not need its own. */
  now: Date;
}

export interface SolutionStore {
  /** Apply migrations (idempotent). */
  init(): Promise<void>;

  /** Test/admin helper — wipes all state. */
  reset?(): Promise<void>;

  /** Insert the solution row. Throws DuplicateSolutionIdError on
   * UNIQUE(solution_id) collision. */
  registerSolution(input: ApprovedPlanInput, now: Date): Promise<SolutionRow>;

  getSolution(solutionId: string): Promise<SolutionRow | null>;

  listActiveSolutions(): Promise<SolutionRow[]>;

  /** Sets paused=true and preserves `prior_state`. */
  setPaused(solutionId: string, by: string, now: Date): Promise<SolutionRow | null>;

  /** Sets paused=false, returns the saved `prior_state` (caller advances
   * back via advanceAtomic). */
  setResumed(solutionId: string, now: Date): Promise<SolutionRow | null>;

  advanceAtomic(input: SolutionAdvanceAtomicInput): Promise<SolutionAdvanceAtomicResult>;

  listHistory(
    solutionId: string,
    opts?: { limit?: number; afterId?: number; toState?: SolutionState },
  ): Promise<SolutionHistoryRow[]>;

  /** Solutions whose `statusSince` is older than the per-state threshold.
   * Terminal solutions and paused solutions are excluded. */
  listStuck(opts: ListStuckOpts): Promise<StuckSolution[]>;

  /** Realtime LISTEN/NOTIFY subscription on a per-solution channel. */
  subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<() => Promise<void>>;
}
