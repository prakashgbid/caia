/**
 * `@caia/full-stack-engineer/api` — public entry point.
 *
 * `runFullStackEngineer(ticketId, config)` is the single function Stage
 * 13 consumers call. It orchestrates the four-step pipeline:
 *
 *   1. work-claimer    →  scheduled → coding-in-progress (FSM)
 *   2. spec-reader     →  ticket.architecture + ticket.testCases → ImplementationBrief
 *   3. code-emitter    →  brief → EmittedFiles  (frontend / backend / database / tests)
 *   4. pr-opener       →  local gate → commit → push → PR
 *
 *   Then drives the second FSM transition:
 *     - pr-opened (with green local gate) → coding-in-progress → code-complete
 *     - emitter / pr-opener failure       → coding-in-progress → coding-failed
 *
 * The worker is idempotent: re-spawning it for a ticket already in
 * `coding-in-progress` with an existing PR for the branch short-circuits
 * to a `idempotent-noop` result without re-opening the PR.
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

import { EmitterError } from './code-emitter.js';
import { PrOpenerError, openPr } from './pr-opener.js';
import { readSpec } from './spec-reader.js';
import { claimTicket } from './work-claimer.js';
import type {
  ClaimOutcome,
  ClaimTransitionOutcome,
  EmittedFiles,
  EngineerResult,
  FullStackEngineerConfig,
  ImplementationBrief,
  LoadedTicket,
  PrOutcome,
  WorkerSubState,
} from './types.js';

const SOURCE_STATE_IMPL: ProjectState = 'coding-in-progress';
const SUCCESS_STATE: ProjectState = 'code-complete';
const FAILURE_STATE: ProjectState = 'coding-failed';

export async function runFullStackEngineer(
  ticketId: string,
  config: FullStackEngineerConfig,
): Promise<EngineerResult> {
  const clock = config.clock ?? ((): Date => new Date());
  const startedAtIso = clock().toISOString();

  // ─── Load the ticket up-front so we know the projectId ──────────────
  const loaded = await config.store.loadTicket(ticketId);
  const workerId = config.workerId ?? defaultWorkerId(ticketId, config.nonce);

  // ─── Claim ──────────────────────────────────────────────────────────
  let claim: ClaimOutcome = {
    claimed: true,
    reason: 'fsm-skipped',
    workerId,
    ticketId,
    projectId: loaded.projectId,
  };
  if (config.skipStateMachine !== true && config.stateMachine) {
    claim = await claimTicket({
      ticketId,
      projectId: loaded.projectId,
      workerId,
      stateMachine: config.stateMachine,
      ...(config.triggeredBy !== undefined ? { triggeredBy: config.triggeredBy } : {}),
    });
    if (!claim.claimed) {
      const finishedAtIso = clock().toISOString();
      const result: EngineerResult = {
        ticketId,
        projectId: loaded.projectId,
        workerId,
        branchName: loaded.branchName,
        worktreePath: loaded.repoPath,
        subState: 'unclaimed',
        emittedFiles: { frontend: [], backend: [], database: [], tests: [] },
        failureReason: claim.reason,
        startedAtIso,
        finishedAtIso,
      };
      if (claim.transition) result.claimTransition = claim.transition;
      return result;
    }
  }

  // ─── Idempotent re-entry: PR already exists for this branch ─────────
  const existingPr = await config.git.prExists({
    repoPath: loaded.repoPath,
    branchName: loaded.branchName,
  });
  if (existingPr) {
    const finishedAtIso = clock().toISOString();
    const result: EngineerResult = {
      ticketId,
      projectId: loaded.projectId,
      workerId,
      branchName: loaded.branchName,
      worktreePath: loaded.repoPath,
      subState: 'idempotent-noop',
      emittedFiles: { frontend: [], backend: [], database: [], tests: [] },
      pr: {
        prNumber: existingPr.prNumber,
        prUrl: existingPr.prUrl,
        commitSha: '',
        localGate: { passed: true, durationMs: 0, failures: [] },
      },
      startedAtIso,
      finishedAtIso,
    };
    if (claim.transition) result.claimTransition = claim.transition;
    return result;
  }

  // ─── Spec read ──────────────────────────────────────────────────────
  const brief = readSpec(loaded);

  // ─── Emit ───────────────────────────────────────────────────────────
  let emitted: EmittedFiles;
  try {
    emitted = await config.emitter.emit(brief);
  } catch (err) {
    return finalizeFailure({
      ticketId,
      loaded,
      workerId,
      claim,
      reason: err instanceof EmitterError ? `${err.code}: ${err.message}` : `emit-failed: ${err instanceof Error ? err.message : String(err)}`,
      brief,
      config,
      startedAtIso,
      finishedAtIso: clock().toISOString(),
    });
  }

  // ─── Open PR (also runs local gate inside) ──────────────────────────
  let pr: PrOutcome;
  try {
    pr = await openPr({
      brief,
      emitted,
      repoPath: loaded.repoPath,
      branchName: loaded.branchName,
      commitScope: loaded.commitScope,
      ...(config.prBaseBranch !== undefined ? { prBaseBranch: config.prBaseBranch } : {}),
      git: config.git,
      localGate: config.localGate,
      ...(config.skipLocalGate !== undefined ? { skipLocalGate: config.skipLocalGate } : {}),
    });
  } catch (err) {
    return finalizeFailure({
      ticketId,
      loaded,
      workerId,
      claim,
      emitted,
      reason: err instanceof PrOpenerError ? `${err.code}: ${err.message}` : `pr-open-failed: ${err instanceof Error ? err.message : String(err)}`,
      brief,
      config,
      startedAtIso,
      finishedAtIso: clock().toISOString(),
    });
  }

  // ─── Drive the success transition: coding-in-progress → code-complete ─
  let completionTransition: ClaimTransitionOutcome | undefined;
  if (config.skipStateMachine !== true && config.stateMachine) {
    completionTransition = await driveTransition({
      stateMachine: config.stateMachine,
      projectId: loaded.projectId,
      targetState: SUCCESS_STATE,
      reason: `full-stack-engineer.pr-opened (worker=${workerId}, ticket=${ticketId}, pr=#${pr.prNumber})`,
      ...(config.triggeredBy !== undefined ? { triggeredBy: config.triggeredBy } : {}),
      payload: {
        ticketId,
        workerId,
        subState: 'pr-opened',
        prNumber: pr.prNumber,
        prUrl: pr.prUrl,
        commitSha: pr.commitSha,
      },
    });
  }

  const finishedAtIso = clock().toISOString();
  const result: EngineerResult = {
    ticketId,
    projectId: loaded.projectId,
    workerId,
    branchName: loaded.branchName,
    worktreePath: loaded.repoPath,
    subState: 'pr-opened',
    emittedFiles: emitted,
    pr,
    startedAtIso,
    finishedAtIso,
  };
  if (claim.transition) result.claimTransition = claim.transition;
  if (completionTransition) result.completionTransition = completionTransition;
  return result;
}

// ─── Failure path ─────────────────────────────────────────────────────────

interface FinalizeFailureInput {
  ticketId: string;
  loaded: LoadedTicket;
  workerId: string;
  claim: ClaimOutcome;
  emitted?: EmittedFiles;
  reason: string;
  brief: ImplementationBrief;
  config: FullStackEngineerConfig;
  startedAtIso: string;
  finishedAtIso: string;
}

async function finalizeFailure(input: FinalizeFailureInput): Promise<EngineerResult> {
  let completionTransition: ClaimTransitionOutcome | undefined;
  if (input.config.skipStateMachine !== true && input.config.stateMachine) {
    completionTransition = await driveTransition({
      stateMachine: input.config.stateMachine,
      projectId: input.loaded.projectId,
      targetState: FAILURE_STATE,
      reason: `full-stack-engineer.implementation-failed (worker=${input.workerId}, ticket=${input.ticketId}, reason=${input.reason.slice(0, 200)})`,
      ...(input.config.triggeredBy !== undefined ? { triggeredBy: input.config.triggeredBy } : {}),
      payload: {
        ticketId: input.ticketId,
        workerId: input.workerId,
        subState: 'implementation-failed' as WorkerSubState,
        failureReason: input.reason,
      },
    });
  }

  const result: EngineerResult = {
    ticketId: input.ticketId,
    projectId: input.loaded.projectId,
    workerId: input.workerId,
    branchName: input.loaded.branchName,
    worktreePath: input.loaded.repoPath,
    subState: 'implementation-failed',
    emittedFiles: input.emitted ?? { frontend: [], backend: [], database: [], tests: [] },
    failureReason: input.reason,
    startedAtIso: input.startedAtIso,
    finishedAtIso: input.finishedAtIso,
  };
  if (input.claim.transition) result.claimTransition = input.claim.transition;
  if (completionTransition) result.completionTransition = completionTransition;
  return result;
}

// ─── State-machine driver ─────────────────────────────────────────────────

interface DriveTransitionInput {
  stateMachine: StateMachine;
  projectId: string;
  targetState: ProjectState;
  reason: string;
  triggeredBy?: TriggeredBy;
  payload: Record<string, unknown>;
}

async function driveTransition(input: DriveTransitionInput): Promise<ClaimTransitionOutcome> {
  const triggeredBy: TriggeredBy =
    input.triggeredBy ?? { kind: 'agent', id: '@caia/full-stack-engineer' };

  let fromState: ProjectState;
  try {
    fromState = await input.stateMachine.currentState(input.projectId);
  } catch (err) {
    return {
      attempted: true,
      fromState: SOURCE_STATE_IMPL,
      toState: input.targetState,
      applied: false,
      reason: `currentState failed: ${err instanceof Error ? err.message : String(err)}`,
      transitionResult: {
        applied: false,
        projectId: input.projectId,
        fromState: SOURCE_STATE_IMPL,
        toState: input.targetState,
        newVersion: 0,
        historyId: null,
        payloadHash: '',
        retries: 0,
      },
    };
  }

  try {
    const transitionResult: TransitionResult = await input.stateMachine.transition(
      input.projectId,
      input.targetState,
      {
        reason: input.reason,
        triggeredBy,
        payload: input.payload,
      },
    );
    return {
      attempted: true,
      fromState,
      toState: input.targetState,
      applied: transitionResult.applied,
      reason: transitionResult.applied ? 'transition-applied' : 'idempotent-no-op',
      transitionResult,
    };
  } catch (err) {
    const reason =
      err instanceof InvalidTransitionError
        ? `invalid-transition: ${err.message}`
        : err instanceof ProjectNotFoundError
          ? `project-not-found: ${err.message}`
          : `transition-error: ${err instanceof Error ? err.message : String(err)}`;
    return {
      attempted: true,
      fromState,
      toState: input.targetState,
      applied: false,
      reason,
      transitionResult: {
        applied: false,
        projectId: input.projectId,
        fromState,
        toState: input.targetState,
        newVersion: 0,
        historyId: null,
        payloadHash: '',
        retries: 0,
      },
    };
  }
}

// ─── Worker id default ────────────────────────────────────────────────────

function defaultWorkerId(ticketId: string, nonce?: string): string {
  const n = nonce ?? Date.now().toString(36);
  return `full-stack-engineer-${ticketId}-${n}`;
}
