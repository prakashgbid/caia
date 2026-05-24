import type { ActorKind } from '../types.js';
import type { SolutionState } from './solution-states.js';

/** Distinguishes who/what advanced the solution.
 *
 * `steward` is added beyond the project FSM's `system|operator|agent`
 * because Solutions are predominantly driven by the four stewards
 * (deploy / usage / activation / outcome) and the lifecycle-conductor.
 * Keeping `steward` as its own kind makes audit + dashboards readable. */
export type SolutionActorKind = ActorKind | 'steward';

export interface SolutionTriggeredBy {
  kind: SolutionActorKind;
  /** Steward id (e.g. 'deploy-steward'), agent id, or operator user id. */
  id: string;
  /** Optional pointer to an agent_runs / steward_runs row. */
  agentRunId?: string;
}

/** Per-steward attestation envelope. Shape matches the canonical doc's
 * §A.8 event envelope (per-steward attestation block). */
export interface StewardAttestation {
  /** Steward id, e.g. 'deploy-steward'. */
  steward: string;
  /** Stable id for THIS attestation run (e.g. 'ds-1f0c'). */
  id: string;
  /** Status — typically 'green' on a forward transition. */
  status: 'green' | 'amber' | 'red';
  /** ISO timestamp the attestation was produced. */
  at: string;
  /** Optional metric, span count, etc. */
  evidence?: Record<string, unknown>;
}

/** Input to `registerSolution`. */
export interface ApprovedPlanInput {
  /** Canonical id, format `caia-YYYY-MM-DD-short-slug`. If omitted, a
   * UUID is generated and the caller is expected to record the mapping
   * separately. */
  solutionId?: string;
  /** Human-readable title. */
  title: string;
  /** Path to the approving plan markdown (e.g. research/foo.md). */
  planPath?: string;
  /** ADR id that captured the approval (e.g. 'ADR-068'). */
  approvedByAdr?: string;
  /** Pointer into the per-solution manifest yaml. */
  manifestPointer?: string;
  /** Free-form payload persisted on the solution row. */
  initialPayload?: Record<string, unknown>;
  /** Override the initial state. Defaults to 'approved'. Mostly for tests. */
  initialState?: SolutionState;
  /** ISO timestamp; defaults to now(). */
  approvedAt?: string;
}

export interface RegisteredSolution {
  solutionId: string;
  currentState: SolutionState;
  version: number;
  createdAt: Date;
}

export interface SolutionRow {
  /** UUID PK (separate from solution_id which is the human/cross-system join key). */
  id: string;
  /** Canonical caia-YYYY-MM-DD-slug. */
  solutionId: string;
  title: string;
  planPath: string | null;
  approvedByAdr: string | null;
  approvedAt: Date;
  status: SolutionState;
  /** When the current `status` was entered. Used by `getStuckSolutions`. */
  statusSince: Date;
  paused: boolean;
  pausedAt: Date | null;
  pausedBy: string | null;
  /** Saved on pause so `resumeSolution` can restore. */
  priorState: SolutionState | null;
  currentPayload: Record<string, unknown>;
  /** Most-recent attestation block (mirror of the last solution_history row). */
  lastAttestation: Record<string, unknown>;
  manifestPointer: string | null;
  abandonedAt: Date | null;
  doneAt: Date | null;
  version: number;
  createdAt: Date;
}

export interface SolutionTransitionOpts {
  reason: string;
  triggeredBy: SolutionTriggeredBy;
  /** Per-steward attestation envelope. Persisted on solution_history.attestation. */
  attestation?: StewardAttestation;
  /** Free-form supporting evidence (logs, screenshots, etc.). */
  evidence?: Record<string, unknown>;
  /** Free-form payload (also used for payload-hash idempotency). */
  payload?: Record<string, unknown>;
  /** When set, the transition is only applied if version matches. */
  expectedVersion?: number;
  /** Override per-call retry budget. Defaults to the machine's defaultRetries. */
  retries?: number;
}

export interface SolutionTransitionResult {
  /** True if this call actually moved state; false on idempotent no-op. */
  applied: boolean;
  solutionId: string;
  fromState: SolutionState;
  toState: SolutionState;
  newVersion: number;
  historyId: number | null;
  payloadHash: string;
  /** Number of optimistic-lock retries before the call resolved. */
  retries: number;
}

export interface SolutionHistoryRow {
  id: number;
  solutionId: string;
  fromState: SolutionState | null;
  toState: SolutionState;
  reason: string;
  actorKind: SolutionActorKind;
  actorId: string;
  attestation: Record<string, unknown>;
  evidence: Record<string, unknown>;
  payload: Record<string, unknown>;
  payloadHash: string;
  at: Date;
}

export interface SolutionLifecycleSnapshot {
  solution: SolutionRow;
  /** Full audit trail, oldest-first. */
  history: SolutionHistoryRow[];
  /** Hours the solution has been in `current_state`. */
  ageHoursInState: number;
}

export interface StuckSolution {
  solution: SolutionRow;
  /** Hours over the threshold for the current state. */
  ageHoursInState: number;
  thresholdHours: number;
  /** What the conductor expects to come next, derived from the
   * transition matrix (first non-failure forward edge). */
  nextExpectedState: SolutionState | null;
}

export interface SolutionMachineOptions {
  /** Clock for tests. */
  now?: () => Date;
  /** Idempotency window — same as project FSM. Defaults to 1000ms. */
  idempotencyWindowMs?: number;
  /** Default retry budget for `advanceSolution`. Defaults to 3. */
  defaultRetries?: number;
  /** Per-state stuck thresholds in hours. Defaults baked into
   * `DEFAULT_STUCK_THRESHOLDS_HOURS`. */
  stuckThresholdsHours?: Partial<Record<SolutionState, number>>;
}

/** Event envelope emitted on every solution transition. Mirrors the
 * canonical-doc §A.8 envelope, with our three event types
 * (`solution.advanced` | `solution.stuck` | `solution.completed`). */
export interface SolutionEvent {
  type: 'solution.advanced' | 'solution.stuck' | 'solution.completed';
  /** Canonical-doc alias for cross-package consumers. */
  canonicalType?: 'solution.state-transitioned' | 'solution.stuck' | 'solution.done';
  namespace: 'solution-lifecycle';
  envelopeVersion: 1;
  at: string;
  payload: {
    solutionId: string;
    fromState: SolutionState | null;
    toState: SolutionState;
    historyId: number | null;
    trigger: string;
    actor: { kind: SolutionActorKind; id: string };
    attestation?: StewardAttestation;
    evidence?: Record<string, unknown>;
    /** Populated on `solution.stuck`. */
    stuck?: {
      currentState: SolutionState;
      since: string;
      ageHoursInState: number;
      thresholdHours: number;
      nextExpectedState: SolutionState | null;
    };
  };
}
