/**
 * `SolutionLifecycleMachine` — the public API for the Real
 * Definition-of-Done state machine, exposed at the same level of
 * `@caia/state-machine` as the existing `StateMachine`.
 *
 * Methods named per the operator prompt:
 *   - registerSolution(plan)          — invoked by EA Agent on plan approval
 *   - advanceSolution(id, to, opts)   — invoked by each steward on green attestation
 *   - getSolutionLifecycle(id)        — snapshot + history
 *   - getStuckSolutions(thresholds?)  — for the lifecycle-conductor's cron
 *   - pauseSolution / resumeSolution  — operator controls
 *   - abandonSolution                 — operator-driven terminal-failure
 *   - subscribeToSolution             — LISTEN/NOTIFY for realtime
 *
 * Concurrency contract: every `advanceSolution` call runs under a
 * per-solution advisory lock + optimistic-version check. If two
 * stewards race to advance the same solution, exactly one wins; the
 * other sees `InvalidSolutionTransitionError` because the prerequisite
 * forward state was not yet reached.
 */

import { hashPayload } from '../hash.js';
import {
  DuplicateSolutionIdError,
  InvalidSolutionTransitionError,
  SolutionNotFoundError,
  SolutionTransitionRetryExhaustedError,
  StaleSolutionVersionError,
} from './solution-errors.js';
import {
  ALL_SOLUTION_STATES,
  DEFAULT_STUCK_THRESHOLDS_HOURS,
  isSolutionState,
  isSolutionTerminal,
  type SolutionState,
} from './solution-states.js';
import type { SolutionStore } from './solution-store.js';
import {
  availableSolutionTransitions,
  checkSolutionTransition,
  canSolutionTransition,
  validNextSolutionStates,
} from './solution-transitions.js';
import type {
  ApprovedPlanInput,
  RegisteredSolution,
  SolutionEvent,
  SolutionHistoryRow,
  SolutionLifecycleSnapshot,
  SolutionMachineOptions,
  SolutionRow,
  SolutionTransitionOpts,
  SolutionTransitionResult,
  StewardAttestation,
  StuckSolution,
} from './solution-types.js';

/** Local handler signature for the in-process event bus mirror that
 * `subscribeToSolutionEvents` exposes. (DB-level LISTEN/NOTIFY is also
 * available via `subscribeToSolution`; the in-process one is for
 * same-runtime consumers like the pipeline-conductor when colocated.) */
export type SolutionEventHandler = (event: SolutionEvent) => void | Promise<void>;

export class SolutionLifecycleMachine {
  private readonly nowFn: () => Date;
  private readonly idempotencyWindowMs: number;
  private readonly defaultRetries: number;
  private readonly stuckThresholds: Partial<Record<SolutionState, number>>;
  private readonly eventHandlers = new Set<SolutionEventHandler>();
  /** Per-type subscription map, populated lazily. */
  private readonly typedHandlers = new Map<SolutionEvent['type'], Set<SolutionEventHandler>>();

  constructor(
    private readonly store: SolutionStore,
    opts: SolutionMachineOptions = {},
  ) {
    this.nowFn = opts.now ?? ((): Date => new Date());
    this.idempotencyWindowMs = opts.idempotencyWindowMs ?? 1_000;
    this.defaultRetries = opts.defaultRetries ?? 3;
    this.stuckThresholds = {
      ...DEFAULT_STUCK_THRESHOLDS_HOURS,
      ...(opts.stuckThresholdsHours ?? {}),
    };
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  /**
   * Register an approved plan as a new Solution. Returns the freshly
   * created `{ solutionId, currentState: 'approved' }`.
   *
   * Invoked by the EA Architect Agent on `ea-review-approved` (or
   * `ea-review-conditional-approval`).
   */
  async registerSolution(plan: ApprovedPlanInput): Promise<RegisteredSolution> {
    if (
      plan.initialState !== undefined &&
      !isSolutionState(plan.initialState)
    ) {
      throw new InvalidSolutionTransitionError(
        'approved',
        plan.initialState as SolutionState,
        'unknown initial state',
      );
    }
    const now = this.nowFn();
    const row = await this.store.registerSolution(plan, now);
    // Emit a synthetic solution.advanced{from:null,to:'approved'} so the
    // event-feed history matches the persistent history. The DB tracks
    // history rows on every transition; the "register" step has no
    // history row, so this is purely an in-process notification.
    this.emit({
      type: 'solution.advanced',
      canonicalType: 'solution.state-transitioned',
      namespace: 'solution-lifecycle',
      envelopeVersion: 1,
      at: now.toISOString(),
      payload: {
        solutionId: row.solutionId,
        fromState: null,
        toState: row.status,
        historyId: null,
        trigger: 'registerSolution',
        actor: { kind: 'agent', id: 'ea-architect-agent' },
      },
    });
    return {
      solutionId: row.solutionId,
      currentState: row.status,
      version: row.version,
      createdAt: row.createdAt,
    };
  }

  async getSolution(solutionId: string): Promise<SolutionRow | null> {
    return this.store.getSolution(solutionId);
  }

  async listActiveSolutions(): Promise<SolutionRow[]> {
    return this.store.listActiveSolutions();
  }

  /**
   * Advance a solution to a new state. Idempotent under the
   * payload-hash unique index; concurrent callers retry up to the
   * `defaultRetries` budget. Throws:
   *  - `SolutionNotFoundError` if `solutionId` doesn't exist
   *  - `InvalidSolutionTransitionError` if the (from, to) edge is not in the matrix
   *    (this is the case the two-steward race hits — the loser sees this)
   *  - `StaleSolutionVersionError` if `expectedVersion` is set + mismatched
   *  - `SolutionTransitionRetryExhaustedError` if optimistic-lock retries
   *    cannot reach a stable read
   */
  async advanceSolution(
    solutionId: string,
    toState: SolutionState,
    opts: SolutionTransitionOpts,
  ): Promise<SolutionTransitionResult> {
    if (!isSolutionState(toState)) {
      throw new InvalidSolutionTransitionError(
        'approved',
        toState,
        'unknown to-state',
      );
    }

    const payload = opts.payload ?? {};
    const payloadHash = hashPayload(payload);
    const maxRetries = opts.retries ?? this.defaultRetries;
    const attestation = opts.attestation
      ? attestationToJson(opts.attestation)
      : {};
    const evidence = opts.evidence ?? {};

    let attempt = 0;
    let lastReadVersion = -1;

    while (attempt <= maxRetries) {
      const sol = await this.store.getSolution(solutionId);
      if (!sol) throw new SolutionNotFoundError(solutionId);

      // Idempotent self-call: status already at toState + same payload hash.
      if (sol.status === toState) {
        const recent = await this.store.listHistory(solutionId, {
          toState,
          limit: 50,
        });
        const dup = recent.find((h) => h.payloadHash === payloadHash);
        if (dup) {
          return {
            applied: false,
            solutionId,
            fromState: sol.status,
            toState,
            newVersion: sol.version,
            historyId: dup.id,
            payloadHash,
            retries: attempt,
          };
        }
        throw new InvalidSolutionTransitionError(
          sol.status,
          toState,
          'self-transition is a no-op',
        );
      }

      const check = checkSolutionTransition(sol.status, toState);
      if (!check.ok) {
        throw new InvalidSolutionTransitionError(
          sol.status,
          toState,
          check.reason ?? 'illegal transition',
        );
      }

      if (
        opts.expectedVersion !== undefined &&
        opts.expectedVersion !== sol.version
      ) {
        throw new StaleSolutionVersionError(solutionId, opts.expectedVersion);
      }

      if (lastReadVersion === sol.version && attempt > 0) {
        lastReadVersion = -1;
      }
      lastReadVersion = sol.version;

      const result = await this.store.advanceAtomic({
        solutionId,
        expectedVersion: sol.version,
        expectedStatus: sol.status,
        toState,
        reason: opts.reason,
        actorKind: opts.triggeredBy.kind,
        actorId: opts.triggeredBy.id,
        agentRunId: opts.triggeredBy.agentRunId ?? null,
        attestation,
        evidence,
        payload,
        payloadHash,
        idempotencyWindowMs: this.idempotencyWindowMs,
        now: this.nowFn(),
      });

      if (result.applied) {
        const now = this.nowFn();
        this.emit({
          type: 'solution.advanced',
          canonicalType: 'solution.state-transitioned',
          namespace: 'solution-lifecycle',
          envelopeVersion: 1,
          at: now.toISOString(),
          payload: {
            solutionId,
            fromState: sol.status,
            toState,
            historyId: result.historyId,
            trigger: opts.reason,
            actor: { kind: opts.triggeredBy.kind, id: opts.triggeredBy.id },
            ...(opts.attestation !== undefined ? { attestation: opts.attestation } : {}),
            ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
          },
        });
        if (toState === 'done') {
          this.emit({
            type: 'solution.completed',
            canonicalType: 'solution.done',
            namespace: 'solution-lifecycle',
            envelopeVersion: 1,
            at: now.toISOString(),
            payload: {
              solutionId,
              fromState: sol.status,
              toState: 'done',
              historyId: result.historyId,
              trigger: opts.reason,
              actor: { kind: opts.triggeredBy.kind, id: opts.triggeredBy.id },
              ...(opts.attestation !== undefined ? { attestation: opts.attestation } : {}),
            },
          });
        }
        return {
          applied: true,
          solutionId,
          fromState: sol.status,
          toState,
          newVersion: result.newVersion,
          historyId: result.historyId,
          payloadHash,
          retries: attempt,
        };
      }

      if (result.idempotentReplay && result.historyId !== null) {
        return {
          applied: false,
          solutionId,
          fromState: sol.status,
          toState,
          newVersion: result.newVersion,
          historyId: result.historyId,
          payloadHash,
          retries: attempt,
        };
      }

      // Optimistic-conflict — retry.
      attempt += 1;
      if (attempt > maxRetries) {
        throw new SolutionTransitionRetryExhaustedError(solutionId, attempt);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(10, attempt * 2)));
    }

    throw new SolutionTransitionRetryExhaustedError(solutionId, attempt);
  }

  /** Snapshot + full history + age-in-state. */
  async getSolutionLifecycle(
    solutionId: string,
  ): Promise<SolutionLifecycleSnapshot> {
    const sol = await this.store.getSolution(solutionId);
    if (!sol) throw new SolutionNotFoundError(solutionId);
    const history = await this.store.listHistory(solutionId);
    const ageHoursInState =
      (this.nowFn().getTime() - sol.statusSince.getTime()) / 3_600_000;
    return { solution: sol, history, ageHoursInState };
  }

  /**
   * Solutions stuck in a non-terminal state past the threshold.
   *
   * `thresholds` may be:
   *  - omitted: use machine defaults
   *  - a number: use as a uniform threshold for every non-terminal state
   *  - an object: per-state override; missing entries fall back to defaults
   *
   * Side effect: emits `solution.stuck` for every result on this call.
   * This is the wire the lifecycle-conductor + pipeline-conductor
   * subscribe to in order to surface INBOX entries.
   */
  async getStuckSolutions(
    thresholdsHours?: number | Partial<Record<SolutionState, number>>,
  ): Promise<StuckSolution[]> {
    const resolved = this.resolveThresholds(thresholdsHours);
    const now = this.nowFn();
    const stuck = await this.store.listStuck({
      thresholdsHours: resolved,
      now,
    });
    for (const item of stuck) {
      this.emit({
        type: 'solution.stuck',
        canonicalType: 'solution.stuck',
        namespace: 'solution-lifecycle',
        envelopeVersion: 1,
        at: now.toISOString(),
        payload: {
          solutionId: item.solution.solutionId,
          fromState: item.solution.status,
          toState: item.solution.status, // stays in place; "stuck" is not a transition
          historyId: null,
          trigger: 'getStuckSolutions',
          actor: { kind: 'system', id: 'solution-lifecycle-machine' },
          stuck: {
            currentState: item.solution.status,
            since: item.solution.statusSince.toISOString(),
            ageHoursInState: item.ageHoursInState,
            thresholdHours: item.thresholdHours,
            nextExpectedState: item.nextExpectedState,
          },
        },
      });
    }
    return stuck;
  }

  async pauseSolution(solutionId: string, by: string): Promise<void> {
    const before = await this.store.getSolution(solutionId);
    if (!before) throw new SolutionNotFoundError(solutionId);
    if (isSolutionTerminal(before.status)) {
      throw new InvalidSolutionTransitionError(
        before.status,
        'paused',
        `${before.status} is a terminal state`,
      );
    }
    const updated = await this.store.setPaused(solutionId, by, this.nowFn());
    if (!updated) throw new SolutionNotFoundError(solutionId);
  }

  async resumeSolution(solutionId: string): Promise<void> {
    const before = await this.store.getSolution(solutionId);
    if (!before) throw new SolutionNotFoundError(solutionId);
    const updated = await this.store.setResumed(solutionId, this.nowFn());
    if (!updated) throw new SolutionNotFoundError(solutionId);
  }

  /** Operator-driven terminal-failure transition. Records a history row. */
  async abandonSolution(
    solutionId: string,
    by: string,
    reason = 'operator-abandoned',
    triggeredBy: { kind: 'operator' | 'agent'; id: string } = {
      kind: 'operator',
      id: by,
    },
  ): Promise<SolutionTransitionResult> {
    return this.advanceSolution(solutionId, 'abandoned', {
      reason,
      triggeredBy,
    });
  }

  // -- Pure helpers (re-exported for callers / dashboards) ---------------

  availableTransitions(from: SolutionState): readonly SolutionState[] {
    return availableSolutionTransitions(from);
  }

  validNextStates(from: SolutionState): readonly SolutionState[] {
    return validNextSolutionStates(from);
  }

  canTransition(from: SolutionState, to: SolutionState): boolean {
    return canSolutionTransition(from, to);
  }

  // -- Realtime ----------------------------------------------------------

  /** In-process subscription to ALL solution events (or a specific type). */
  on(handler: SolutionEventHandler): () => void;
  on(type: SolutionEvent['type'], handler: SolutionEventHandler): () => void;
  on(
    typeOrHandler: SolutionEvent['type'] | SolutionEventHandler,
    maybeHandler?: SolutionEventHandler,
  ): () => void {
    if (typeof typeOrHandler === 'function') {
      this.eventHandlers.add(typeOrHandler);
      return () => {
        this.eventHandlers.delete(typeOrHandler);
      };
    }
    if (maybeHandler === undefined) {
      throw new TypeError('on(type, handler) requires both arguments');
    }
    const handler = maybeHandler;
    const type = typeOrHandler;
    let set = this.typedHandlers.get(type);
    if (!set) {
      set = new Set();
      this.typedHandlers.set(type, set);
    }
    set.add(handler);
    return () => {
      const s = this.typedHandlers.get(type);
      if (s) s.delete(handler);
    };
  }

  /** DB-level (LISTEN/NOTIFY for PgSolutionStore; in-process for memory store). */
  async subscribeToSolution(
    solutionId: string,
    handler: (event: SolutionAdvancedNotifyPayload) => void,
  ): Promise<() => Promise<void>> {
    return this.store.subscribe('caia_solution_' + solutionId, (payload) => {
      try {
        const parsed = JSON.parse(payload) as SolutionAdvancedNotifyPayload;
        handler(parsed);
      } catch {
        /* ignore malformed payload */
      }
    });
  }

  // -- Internals ---------------------------------------------------------

  private resolveThresholds(
    thresholds?: number | Partial<Record<SolutionState, number>>,
  ): Partial<Record<SolutionState, number>> {
    if (thresholds === undefined) {
      return this.stuckThresholds;
    }
    if (typeof thresholds === 'number') {
      const out: Partial<Record<SolutionState, number>> = {};
      for (const state of ALL_SOLUTION_STATES) {
        if (isSolutionTerminal(state)) continue;
        if (state === 'paused') continue;
        out[state] = thresholds;
      }
      return out;
    }
    // Object override merged on top of defaults.
    return { ...this.stuckThresholds, ...thresholds };
  }

  private emit(event: SolutionEvent): void {
    // Fire-and-forget. Errors in one handler must not break others.
    for (const h of [...this.eventHandlers]) {
      try {
        const result = h(event);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {
            /* swallow */
          });
        }
      } catch {
        /* swallow */
      }
    }
    const typed = this.typedHandlers.get(event.type);
    if (typed) {
      for (const h of [...typed]) {
        try {
          const result = h(event);
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch(() => {
              /* swallow */
            });
          }
        } catch {
          /* swallow */
        }
      }
    }
  }
}

/** Shape of the LISTEN/NOTIFY payload emitted by the Pg trigger. */
export interface SolutionAdvancedNotifyPayload {
  kind: 'solution-advanced';
  history_id: number;
  from_state: SolutionState | null;
  to_state: SolutionState;
  reason: string;
  actor_kind: string;
  actor_id: string;
  at: string;
}

function attestationToJson(att: StewardAttestation): Record<string, unknown> {
  // Persist as a plain object so the store's JSON serialization is
  // stable (Date/undefined would round-trip differently).
  return {
    steward: att.steward,
    id: att.id,
    status: att.status,
    at: att.at,
    ...(att.evidence !== undefined ? { evidence: att.evidence } : {}),
  };
}

// Re-export DuplicateSolutionIdError so callers can catch it without
// reaching into the errors module.
export { DuplicateSolutionIdError };
