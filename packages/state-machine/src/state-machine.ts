import { createTracer } from '@chiefaia/tracing';
import {
  InvalidTransitionError,
  ProjectNotFoundError,
  StaleProjectVersionError,
  TransitionRetryExhaustedError,
} from './errors.js';
import { hashPayload } from './hash.js';
import { isProjectState, type ProjectState } from './states.js';

/**
 * OTel tracer for the state machine. Each `transition()` call emits a
 * `caia.state-machine.transition` span carrying the project id,
 * from-state, to-state, and the number of optimistic-lock retries the
 * call needed. Spans link back to the caller's root trace when
 * tracing has been bootstrapped via `@chiefaia/tracing`'s
 * `initTracing()`; otherwise they degrade to no-ops.
 */
const tracer = createTracer('@caia/state-machine');
import type {
  StateStore,
} from './store.js';
import {
  availableTransitions,
  canTransition,
  checkTransition,
  validNextStates,
} from './transitions.js';
import type {
  ActorKind,
  ClaimResult,
  JanitorResult,
  NewProjectInput,
  ProjectRow,
  StateMachineOptions,
  StateTransitionRow,
  TransitionOpts,
  TransitionResult,
  TriggeredBy,
} from './types.js';

export interface ProjectEvent {
  kind: 'state-transition';
  history_id: number;
  from_state: ProjectState | null;
  to_state: ProjectState;
  reason: string;
  actor_kind: 'system' | 'operator' | 'agent';
  actor_id: string;
  at: string;
}

export interface TicketEvent {
  kind: 'ticket-claimed' | 'ticket-released' | 'ticket-heartbeat' | 'ticket-updated';
  ticket_id: string;
  claimed_by?: string | null;
  heartbeat_at?: string | null;
  final_status?: string | null;
}

/**
 * Main entrypoint. Provides the typed API the orchestrator calls.
 *
 *   - `transition(projectId, to, opts)`           atomic, idempotent, retries on conflict
 *   - `currentState(projectId)`                   read-only
 *   - `replayHistory(projectId, opts?)`           audit
 *   - `validNextStates(state)` / `availableTransitions(state)` picker
 *   - `tryAssignWork(projectId, workerId)`        atomic worker assignment
 *   - `recordWorkerHeartbeat(workerId)`           lifecycle ping
 *   - `completeWork(workerId, finalState)`        release + optional transition
 *   - `expireInactiveWorkers()`                   90s stale-claim sweep
 *   - `subscribeToProject(projectId, cb)`         SSE feed
 *   - `whatsNext(projectId)`                      next-step (re-exported in `./whats-next`)
 */
export class StateMachine {
  private readonly nowFn: () => Date;
  private readonly idempotencyWindowMs: number;
  private readonly defaultRetries: number;
  private readonly workerTtlSeconds: number;
  /** worker_id -> set of ticketIds it has claimed. Used by recordWorkerHeartbeat / completeWork. */
  private readonly workerAssignments = new Map<string, Set<string>>();

  constructor(
    private readonly store: StateStore,
    opts: StateMachineOptions = {},
  ) {
    this.nowFn = opts.now ?? ((): Date => new Date());
    this.idempotencyWindowMs = opts.idempotencyWindowMs ?? 1_000;
    this.defaultRetries = opts.defaultRetries ?? 3;
    this.workerTtlSeconds = opts.workerTtlSeconds ?? 90;
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  async createProject(input: NewProjectInput): Promise<ProjectRow> {
    if (input.initialState && !isProjectState(input.initialState)) {
      throw new InvalidTransitionError(
        'onboarding',
        input.initialState as ProjectState,
        'unknown initialState',
      );
    }
    return this.store.createProject(input);
  }

  async currentState(projectId: string): Promise<ProjectState> {
    const proj = await this.store.getProject(projectId);
    if (!proj) throw new ProjectNotFoundError(projectId);
    return proj.status;
  }

  async getProject(projectId: string): Promise<ProjectRow | null> {
    return this.store.getProject(projectId);
  }

  /**
   * Atomic transition. Supports two call styles:
   *
   *   sm.transition(projectId, to, { reason, triggeredBy, payload?, expectedVersion? })
   *   sm.transition(projectId, to, reason, triggeredBy)   // positional shortcut
   */
  async transition(
    projectId: string,
    toState: ProjectState,
    opts: TransitionOpts,
  ): Promise<TransitionResult>;
  async transition(
    projectId: string,
    toState: ProjectState,
    reason: string,
    triggeredBy: TriggeredBy | string,
  ): Promise<TransitionResult>;
  async transition(
    projectId: string,
    toState: ProjectState,
    optsOrReason: TransitionOpts | string,
    maybeTriggeredBy?: TriggeredBy | string,
  ): Promise<TransitionResult> {
    return tracer.withSpan('caia.state-machine.transition', async (span) => {
      span.setAttribute('caia.project.id', projectId);
      span.setAttribute('caia.state.to', toState);
      const result = await this._transitionImpl(
        projectId,
        toState,
        optsOrReason,
        maybeTriggeredBy,
      );
      span.setAttribute('caia.state.from', result.fromState);
      span.setAttribute('caia.transition.applied', result.applied);
      span.setAttribute('caia.transition.retries', result.retries);
      span.setAttribute('caia.transition.new_version', result.newVersion);
      return result;
    });
  }

  private async _transitionImpl(
    projectId: string,
    toState: ProjectState,
    optsOrReason: TransitionOpts | string,
    maybeTriggeredBy?: TriggeredBy | string,
  ): Promise<TransitionResult> {
    const opts = normalizeTransitionArgs(optsOrReason, maybeTriggeredBy);

    if (!isProjectState(toState)) {
      throw new InvalidTransitionError(
        'onboarding',
        toState,
        'unknown to-state',
      );
    }

    const payload = opts.payload ?? {};
    const payloadHash = hashPayload(payload);
    const maxRetries = opts.retries ?? this.defaultRetries;

    let attempt = 0;
    let lastReadVersion = -1;
    // Snapshot fromState across retries for the result's `fromState`.
    let firstFromState: ProjectState | null = null;

    while (attempt <= maxRetries) {
      const proj = await this.store.getProject(projectId);
      if (!proj) throw new ProjectNotFoundError(projectId);
      if (firstFromState === null) firstFromState = proj.status;

      // Idempotent self-call: status already at toState + same payload hash.
      if (proj.status === toState) {
        const recent = await this.store.listHistory(projectId, {
          toState,
          limit: 50,
        });
        const dup = recent.find((h) => h.payloadHash === payloadHash);
        if (dup) {
          return {
            applied: false,
            projectId,
            fromState: proj.status,
            toState,
            newVersion: proj.version,
            historyId: dup.id,
            payloadHash,
            retries: attempt,
          };
        }
        throw new InvalidTransitionError(
          proj.status,
          toState,
          'self-transition is a no-op',
        );
      }

      const check = checkTransition(proj.status, toState);
      if (!check.ok) {
        throw new InvalidTransitionError(proj.status, toState, check.reason);
      }

      if (
        opts.expectedVersion !== undefined &&
        opts.expectedVersion !== proj.version
      ) {
        throw new StaleProjectVersionError(projectId, opts.expectedVersion);
      }

      if (lastReadVersion === proj.version && attempt > 0) {
        // Unchanged after retry — caller didn't make progress, but the
        // db reported a conflict. Treat the next loop as a fresh read.
        lastReadVersion = -1;
      }
      lastReadVersion = proj.version;

      const result = await this.store.transitionAtomic({
        projectId,
        expectedVersion: proj.version,
        expectedStatus: proj.status,
        toState,
        reason: opts.reason,
        actorKind: opts.triggeredBy.kind,
        actorId: opts.triggeredBy.id,
        agentRunId: opts.triggeredBy.agentRunId ?? null,
        payload,
        payloadHash,
        idempotencyWindowMs: this.idempotencyWindowMs,
      });

      if (result.applied) {
        return {
          applied: true,
          projectId,
          fromState: proj.status,
          toState,
          newVersion: result.newVersion,
          historyId: result.historyId,
          payloadHash,
          retries: attempt,
        };
      }

      if (result.historyId !== null) {
        // Idempotent no-op (matched existing history). The transition
        // was already applied in a prior call; return success-shape.
        return {
          applied: false,
          projectId,
          fromState: proj.status,
          toState,
          newVersion: result.newVersion,
          historyId: result.historyId,
          payloadHash,
          retries: attempt,
        };
      }

      // Optimistic-concurrency conflict — retry.
      attempt += 1;
      if (attempt > maxRetries) {
        throw new TransitionRetryExhaustedError(projectId, attempt);
      }
      // Light jitter to avoid tight-loop starvation in tests.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10, attempt * 2)),
      );
    }

    throw new TransitionRetryExhaustedError(projectId, attempt);
  }

  async replayHistory(
    projectId: string,
    opts: { limit?: number; afterId?: number; toState?: ProjectState } = {},
  ): Promise<StateTransitionRow[]> {
    return this.store.listHistory(projectId, opts);
  }

  availableTransitions(currentState: ProjectState): readonly ProjectState[] {
    return availableTransitions(currentState);
  }

  /** Spec-friendly alias for `availableTransitions`. */
  validNextStates(currentState: ProjectState): readonly ProjectState[] {
    return validNextStates(currentState);
  }

  canTransition(from: ProjectState, to: ProjectState): boolean {
    return canTransition(from, to);
  }

  async pause(projectId: string, by: string): Promise<void> {
    const proj = await this.store.getProject(projectId);
    if (!proj) throw new ProjectNotFoundError(projectId);
    await this.store.setPaused(projectId, true, by);
  }

  async resume(projectId: string): Promise<void> {
    const proj = await this.store.getProject(projectId);
    if (!proj) throw new ProjectNotFoundError(projectId);
    await this.store.setPaused(projectId, false, null);
  }

  async abandon(
    projectId: string,
    by: string,
    reason = 'operator-abandoned',
  ): Promise<TransitionResult> {
    const proj = await this.store.getProject(projectId);
    if (!proj) throw new ProjectNotFoundError(projectId);
    return this.transition(projectId, 'archived', {
      reason,
      triggeredBy: { kind: 'operator', id: by },
    });
  }

  // -- Ticket-level claim API (kept for backwards compat) ------------------

  async claimTicketForAgent(
    ticketId: string,
    agentId: string,
    opts: { projectId?: string; ttlSeconds?: number } = {},
  ): Promise<ClaimResult> {
    return this.store.tryClaim({
      ticketId,
      projectId: opts.projectId ?? null,
      agentId,
      ttlSeconds: opts.ttlSeconds ?? this.workerTtlSeconds,
      now: this.nowFn(),
    });
  }

  async heartbeat(ticketId: string, agentId: string): Promise<void> {
    await this.store.heartbeat({
      ticketId,
      agentId,
      now: this.nowFn(),
    });
  }

  async releaseTicket(
    ticketId: string,
    agentId: string,
    finalStatus: 'done' | 'failed' | 'aborted' | string,
  ): Promise<{ ok: boolean }> {
    return this.store.releaseClaim({
      ticketId,
      agentId,
      finalStatus,
      now: this.nowFn(),
    });
  }

  async janitor(): Promise<JanitorResult> {
    return this.store.janitorSweep(this.nowFn());
  }

  // -- Spec-named job-queue helpers ----------------------------------------

  /**
   * Atomic find-and-update: tries to assign the project's work-slot to
   * the given worker. Only one worker wins per project; concurrent
   * losers see `claimed: false`.
   */
  async tryAssignWork(
    projectId: string,
    workerId: string,
    opts: { ttlSeconds?: number } = {},
  ): Promise<ClaimResult> {
    const ttlSeconds = opts.ttlSeconds ?? this.workerTtlSeconds;
    const result = await this.store.tryClaim({
      ticketId: assignmentKey(projectId),
      projectId,
      agentId: workerId,
      ttlSeconds,
      now: this.nowFn(),
    });
    if (result.claimed) {
      let set = this.workerAssignments.get(workerId);
      if (!set) {
        set = new Set();
        this.workerAssignments.set(workerId, set);
      }
      set.add(projectId);
    }
    return result;
  }

  /**
   * Heartbeat for an entire worker: pings every project the worker is
   * currently assigned to. Safe to call every 30s; the janitor only
   * unassigns work whose last heartbeat is older than 90s.
   */
  async recordWorkerHeartbeat(workerId: string): Promise<{
    ok: boolean;
    refreshed: string[];
  }> {
    const set = this.workerAssignments.get(workerId);
    if (!set || set.size === 0) return { ok: false, refreshed: [] };
    const refreshed: string[] = [];
    for (const projectId of [...set]) {
      const r = await this.store.heartbeat({
        ticketId: assignmentKey(projectId),
        agentId: workerId,
        now: this.nowFn(),
      });
      if (r.ok) {
        refreshed.push(projectId);
      } else {
        // worker was already kicked off this project — clean up our local
        // bookkeeping so subsequent heartbeats are accurate.
        set.delete(projectId);
      }
    }
    if (set.size === 0) this.workerAssignments.delete(workerId);
    return { ok: refreshed.length > 0, refreshed };
  }

  /**
   * Complete a worker's assignment. Releases the claim on every project
   * the worker is assigned to and, when `finalState` is provided,
   * transitions each project to that state.
   *
   * `triggeredBy` defaults to `{ kind: 'agent', id: workerId }`.
   */
  async completeWork(
    workerId: string,
    finalState?: ProjectState,
    opts: {
      reason?: string;
      triggeredBy?: TriggeredBy;
      payload?: Record<string, unknown>;
    } = {},
  ): Promise<{
    released: string[];
    transitioned: TransitionResult[];
  }> {
    const set = this.workerAssignments.get(workerId);
    const projects = set ? [...set] : [];
    const released: string[] = [];
    const transitioned: TransitionResult[] = [];
    for (const projectId of projects) {
      const r = await this.store.releaseClaim({
        ticketId: assignmentKey(projectId),
        agentId: workerId,
        finalStatus: finalState ?? 'done',
        now: this.nowFn(),
      });
      if (r.ok) released.push(projectId);
      if (finalState) {
        try {
          const result = await this.transition(projectId, finalState, {
            reason: opts.reason ?? 'work-completed',
            triggeredBy:
              opts.triggeredBy ?? { kind: 'agent' as ActorKind, id: workerId },
            payload: opts.payload ?? {},
          });
          transitioned.push(result);
        } catch (err) {
          // Surface the most informative error to the caller. The
          // claim is already released, so retry semantics are caller-
          // owned.
          if (projects.length === 1) throw err;
        }
      }
    }
    this.workerAssignments.delete(workerId);
    return { released, transitioned };
  }

  /**
   * Periodic cleanup: releases any assignment whose heartbeat is older
   * than the worker TTL (default 90s, matching the spec).
   *
   * The returned `releasedAssignments` lists the projectIds that lost
   * their assignment.
   */
  async expireInactiveWorkers(): Promise<{ releasedAssignments: string[] }> {
    const result = await this.store.janitorSweep(this.nowFn());
    const releasedAssignments = result.releasedClaims
      .filter((k) => k.startsWith(ASSIGNMENT_PREFIX))
      .map((k) => k.substring(ASSIGNMENT_PREFIX.length));
    // Drop in-process bookkeeping for any worker that lost an assignment.
    for (const [worker, set] of this.workerAssignments.entries()) {
      for (const projectId of [...set]) {
        if (releasedAssignments.includes(projectId)) {
          set.delete(projectId);
        }
      }
      if (set.size === 0) this.workerAssignments.delete(worker);
    }
    return { releasedAssignments };
  }

  // -- Real-time -----------------------------------------------------------

  async subscribeToProject(
    projectId: string,
    handler: (event: ProjectEvent) => void,
  ): Promise<() => Promise<void>> {
    return this.store.subscribe('caia_project_' + projectId, (payload) => {
      try {
        const parsed = JSON.parse(payload) as ProjectEvent;
        handler(parsed);
      } catch {
        // ignore malformed payload
      }
    });
  }

  async subscribeToTickets(
    projectId: string,
    handler: (event: TicketEvent) => void,
  ): Promise<() => Promise<void>> {
    return this.store.subscribe('caia_ticket_' + projectId, (payload) => {
      try {
        const parsed = JSON.parse(payload) as TicketEvent;
        handler(parsed);
      } catch {
        // ignore
      }
    });
  }
}

const ASSIGNMENT_PREFIX = 'project-assignment:';
function assignmentKey(projectId: string): string {
  return ASSIGNMENT_PREFIX + projectId;
}

function normalizeTransitionArgs(
  optsOrReason: TransitionOpts | string,
  maybeTriggeredBy: TriggeredBy | string | undefined,
): TransitionOpts {
  if (typeof optsOrReason === 'string') {
    if (maybeTriggeredBy === undefined) {
      throw new TypeError(
        'transition(): positional form requires (projectId, toState, reason, triggeredBy)',
      );
    }
    const triggeredBy: TriggeredBy =
      typeof maybeTriggeredBy === 'string'
        ? { kind: 'system', id: maybeTriggeredBy }
        : maybeTriggeredBy;
    return { reason: optsOrReason, triggeredBy };
  }
  return optsOrReason;
}
