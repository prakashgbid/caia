/**
 * `@caia/full-stack-engineer/work-claimer` — atomic ticket claim.
 *
 * Stage 13 begins by claiming a `scheduled` ticket from the pool. The
 * claim is a TWO-step operation, both wrapped here for atomicity:
 *
 *   1. `sm.tryAssignWork(projectId, workerId)` — only one worker wins
 *      per project; losers see `claimed=false` and short-circuit.
 *   2. `sm.transition(projectId, 'coding-in-progress', …)` — moves the
 *      canonical FSM from `scheduled` to `coding-in-progress`. Idempotent
 *      on re-entry (already-in-progress claims surface as
 *      `reason: 'already-in-progress'` and `claimed: true`).
 *
 * The worker-local `WorkerSubState` is bookkeeping ONLY; it never
 * appears as a project-FSM state.
 */

import {
  InvalidTransitionError,
  ProjectNotFoundError,
} from '@caia/state-machine';
import type {
  ProjectState,
  StateMachine,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';

import type {
  ClaimOutcome,
  ClaimTransitionOutcome,
} from './types.js';

const SOURCE_STATE: ProjectState = 'scheduled';
const TARGET_STATE: ProjectState = 'coding-in-progress';

export interface ClaimTicketInput {
  ticketId: string;
  projectId: string;
  workerId: string;
  stateMachine: StateMachine;
  triggeredBy?: TriggeredBy;
  /** Override the assignment TTL in seconds. */
  ttlSeconds?: number;
  /** Skip the FSM transition entirely (test-only). */
  skipStateMachine?: boolean;
}

/**
 * Atomically claim a scheduled ticket and move it into
 * `coding-in-progress`. Returns a structured `ClaimOutcome` describing
 * what happened. Never throws on lost-race or wrong-state; only throws
 * for unexpected backend errors (which the caller's outer try-catch
 * should turn into a `coding-failed` transition).
 */
export async function claimTicket(input: ClaimTicketInput): Promise<ClaimOutcome> {
  const triggeredBy: TriggeredBy =
    input.triggeredBy ?? { kind: 'agent', id: input.workerId };

  // ─── Read the current project state first ────────────────────────────
  let project;
  try {
    project = await input.stateMachine.getProject(input.projectId);
  } catch (err) {
    return {
      claimed: false,
      reason: `getProject failed: ${err instanceof Error ? err.message : String(err)}`,
      workerId: input.workerId,
      ticketId: input.ticketId,
      projectId: input.projectId,
    };
  }

  if (!project) {
    return {
      claimed: false,
      reason: `project ${input.projectId} not found`,
      workerId: input.workerId,
      ticketId: input.ticketId,
      projectId: input.projectId,
    };
  }

  // ─── Idempotent re-entry: project already in coding-in-progress ──────
  if (project.status === TARGET_STATE) {
    const assignment = await tryAssign(input);
    return {
      claimed: assignment.claimed,
      reason: assignment.claimed ? 'already-in-progress' : assignment.reason,
      workerId: input.workerId,
      ticketId: input.ticketId,
      projectId: input.projectId,
      ...(assignment.ttlSeconds !== undefined ? { ttlSeconds: assignment.ttlSeconds } : {}),
    };
  }

  // ─── Wrong source state — refuse without throwing ────────────────────
  if (project.status !== SOURCE_STATE) {
    return {
      claimed: false,
      reason: `project status is '${project.status}', expected '${SOURCE_STATE}'`,
      workerId: input.workerId,
      ticketId: input.ticketId,
      projectId: input.projectId,
    };
  }

  // ─── Try to win the worker-assignment race ───────────────────────────
  const assignment = await tryAssign(input);
  if (!assignment.claimed) {
    return {
      claimed: false,
      reason: assignment.reason,
      workerId: input.workerId,
      ticketId: input.ticketId,
      projectId: input.projectId,
    };
  }

  // ─── Drive the canonical FSM transition ──────────────────────────────
  if (input.skipStateMachine === true) {
    return {
      claimed: true,
      reason: 'claimed-skipped-fsm',
      workerId: input.workerId,
      ticketId: input.ticketId,
      projectId: input.projectId,
      ...(assignment.ttlSeconds !== undefined ? { ttlSeconds: assignment.ttlSeconds } : {}),
    };
  }

  let transition: ClaimTransitionOutcome;
  try {
    const transitionResult: TransitionResult = await input.stateMachine.transition(
      input.projectId,
      TARGET_STATE,
      {
        reason: `full-stack-engineer.claimed (worker=${input.workerId}, ticket=${input.ticketId})`,
        triggeredBy,
        payload: {
          ticketId: input.ticketId,
          workerId: input.workerId,
          subState: 'claimed',
        },
      },
    );
    transition = {
      attempted: true,
      fromState: SOURCE_STATE,
      toState: TARGET_STATE,
      applied: transitionResult.applied,
      reason: transitionResult.applied ? 'transition-applied' : 'idempotent-no-op',
      transitionResult,
    };
  } catch (err) {
    const reason = formatTransitionError(err);
    transition = {
      attempted: true,
      fromState: project.status,
      toState: TARGET_STATE,
      applied: false,
      reason,
      transitionResult: {
        applied: false,
        projectId: input.projectId,
        fromState: project.status,
        toState: TARGET_STATE,
        newVersion: project.version,
        historyId: null,
        payloadHash: '',
        retries: 0,
      },
    };
    // Release the claim so a fresh worker can retry.
    await tryRelease(input);
    return {
      claimed: false,
      reason,
      workerId: input.workerId,
      ticketId: input.ticketId,
      projectId: input.projectId,
      transition,
    };
  }

  return {
    claimed: true,
    reason: transition.applied ? 'claimed' : 'already-in-progress',
    workerId: input.workerId,
    ticketId: input.ticketId,
    projectId: input.projectId,
    ...(assignment.ttlSeconds !== undefined ? { ttlSeconds: assignment.ttlSeconds } : {}),
    transition,
  };
}

interface AssignmentResult {
  claimed: boolean;
  reason: string;
  ttlSeconds?: number;
}

async function tryAssign(input: ClaimTicketInput): Promise<AssignmentResult> {
  try {
    const result = await input.stateMachine.tryAssignWork(
      input.projectId,
      input.workerId,
      input.ttlSeconds !== undefined ? { ttlSeconds: input.ttlSeconds } : {},
    );
    if (result.claimed) {
      return {
        claimed: true,
        reason: 'assignment-acquired',
        ttlSeconds: result.ttl,
      };
    }
    return {
      claimed: false,
      reason: result.claimedBy
        ? `assignment already held by '${result.claimedBy}'`
        : 'assignment lost-race',
    };
  } catch (err) {
    return {
      claimed: false,
      reason: `assignment failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function tryRelease(input: ClaimTicketInput): Promise<void> {
  try {
    await input.stateMachine.completeWork(input.workerId);
  } catch {
    // Best-effort release; janitor will sweep stale assignments.
  }
}

function formatTransitionError(err: unknown): string {
  if (err instanceof InvalidTransitionError) {
    return `invalid-transition: ${err.message}`;
  }
  if (err instanceof ProjectNotFoundError) {
    return `project-not-found: ${err.message}`;
  }
  return `transition-error: ${err instanceof Error ? err.message : String(err)}`;
}
