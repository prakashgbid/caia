/**
 * @caia/info-architect — orchestrator (`runInformationArchitecture`).
 *
 * Drives the canonical FSM chain per IA spec §6.2 (ratified 2026-05-25
 * in ADR-024):
 *
 *   interview-complete
 *     → information-architecture-in-progress
 *     → information-architecture-complete
 *
 * Failure on any leg routes the project to
 * `information-architecture-failed`. The caller is responsible for the
 * recovery (`information-architecture-failed → interview-complete |
 * information-architecture-in-progress`, per the transitions table).
 */

import type { ProjectState } from '@caia/state-machine';

import { InfoArchitectError, isInfoArchitectError } from './errors.js';
import type {
  FsmTransition,
  IaAgent,
  IaOutput,
  IaPersistence,
  IaStateMachineAdapter,
} from './types.js';

export interface RunInfoArchitectureDeps {
  readonly agent: IaAgent;
  readonly persistence: IaPersistence;
  readonly stateMachine: IaStateMachineAdapter;
  /** Inject a clock for deterministic tests. */
  readonly clock?: () => Date;
  /** Triggered-by id stamped onto FSM history rows. */
  readonly triggeredById?: string;
}

export interface RunInfoArchitectureResult {
  readonly projectId: string;
  readonly iaRevisionId: string;
  readonly output: IaOutput;
  readonly fsmTransitions: readonly FsmTransition[];
  readonly writtenAtIso: string;
}

const REQUIRED_ENTRY_STATE: ProjectState = 'interview-complete';
const IN_PROGRESS_STATE: ProjectState = 'information-architecture-in-progress';
const COMPLETE_STATE: ProjectState = 'information-architecture-complete';
const FAILED_STATE: ProjectState = 'information-architecture-failed';

/**
 * Top-level entrypoint. Drives the canonical FSM chain and writes the
 * three artifacts atomically. Throws `InfoArchitectError` on any
 * failure; the FSM will be in `information-architecture-failed` when
 * the throw lands.
 */
export async function runInformationArchitecture(
  projectId: string,
  deps: RunInfoArchitectureDeps,
): Promise<RunInfoArchitectureResult> {
  const triggeredById = deps.triggeredById ?? '@caia/info-architect';
  const transitions: FsmTransition[] = [];

  // 1. Read current FSM state.
  let currentState: ProjectState;
  try {
    currentState = await deps.stateMachine.currentState(projectId);
  } catch (err) {
    throw new InfoArchitectError(
      'fsm_transition_failed',
      `failed to read current FSM state for project ${projectId}`,
      err,
      { projectId },
    );
  }

  // 2. Validate entry state.
  if (currentState !== REQUIRED_ENTRY_STATE) {
    throw new InfoArchitectError(
      'project_state_invalid',
      `runInformationArchitecture requires '${REQUIRED_ENTRY_STATE}'; project is in '${currentState}'`,
      undefined,
      { projectId, currentState },
    );
  }

  // 3. Read IA input.
  const input = await deps.persistence.readInput(projectId);
  if (input === null) {
    await tryFail(deps, projectId, triggeredById, 'no IA input found');
    throw new InfoArchitectError(
      'persistence_failed',
      `no IA input persisted for project ${projectId}`,
      undefined,
      { projectId },
    );
  }
  if (input.projectId !== projectId) {
    await tryFail(deps, projectId, triggeredById, 'input projectId mismatch');
    throw new InfoArchitectError(
      'validation_failed',
      `IA input.projectId (${input.projectId}) does not match runtime projectId (${projectId})`,
    );
  }

  // 4. interview-complete → information-architecture-in-progress
  try {
    const t = await deps.stateMachine.transition(projectId, IN_PROGRESS_STATE, {
      reason: 'ia-run-start',
      triggeredById,
      payload: { businessPlanRevisionId: input.businessPlan.revisionId },
    });
    transitions.push(t);
  } catch (err) {
    throw new InfoArchitectError(
      'fsm_transition_failed',
      `failed to advance ${REQUIRED_ENTRY_STATE} -> ${IN_PROGRESS_STATE}`,
      err,
      { projectId, from: REQUIRED_ENTRY_STATE, to: IN_PROGRESS_STATE },
    );
  }

  // 5. Run the agent.
  let output: IaOutput;
  try {
    output = await deps.agent.design(input);
  } catch (err) {
    await tryFail(deps, projectId, triggeredById, 'agent design() threw');
    if (isInfoArchitectError(err)) throw err;
    throw new InfoArchitectError(
      'llm_call_failed',
      `IA agent design() threw: ${(err as Error).message}`,
      err,
      { projectId },
    );
  }

  // 6. Persist artifacts.
  let writeResult: { revisionId: string; writtenAt: string };
  try {
    writeResult = await deps.persistence.writeArtifacts(projectId, output);
  } catch (err) {
    await tryFail(deps, projectId, triggeredById, 'persistence.writeArtifacts threw');
    if (isInfoArchitectError(err)) throw err;
    throw new InfoArchitectError(
      'persistence_failed',
      `failed to write IA artifacts: ${(err as Error).message}`,
      err,
      { projectId },
    );
  }

  // 7. information-architecture-in-progress → information-architecture-complete
  try {
    const t = await deps.stateMachine.transition(projectId, COMPLETE_STATE, {
      reason: 'ia-run-complete',
      triggeredById,
      payload: {
        iaRevisionId: writeResult.revisionId,
        pagesCatalogueId: output.pagesCatalogue.revisionId,
        designSystemId: output.designSystem.revisionId,
        componentsLibraryId: output.componentsLibrary.revisionId,
      },
    });
    transitions.push(t);
  } catch (err) {
    throw new InfoArchitectError(
      'fsm_transition_failed',
      `failed to advance ${IN_PROGRESS_STATE} -> ${COMPLETE_STATE}`,
      err,
      { projectId, from: IN_PROGRESS_STATE, to: COMPLETE_STATE },
    );
  }

  return {
    projectId,
    iaRevisionId: writeResult.revisionId,
    output,
    fsmTransitions: transitions,
    writtenAtIso: writeResult.writtenAt,
  };
}

/**
 * Best-effort transition into `information-architecture-failed`. We
 * swallow exceptions from the FSM call here because the original
 * failure (which the caller is about to throw) is more interesting
 * than a failure-on-failure.
 */
async function tryFail(
  deps: RunInfoArchitectureDeps,
  projectId: string,
  triggeredById: string,
  reason: string,
): Promise<void> {
  try {
    const current = await deps.stateMachine.currentState(projectId);
    if (current === FAILED_STATE) return;
    if (current !== IN_PROGRESS_STATE && current !== REQUIRED_ENTRY_STATE) return;
    await deps.stateMachine.transition(projectId, FAILED_STATE, {
      reason: `ia-run-failed: ${reason}`,
      triggeredById,
    });
  } catch {
    // best-effort
  }
}
