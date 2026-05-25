/**
 * @caia/grand-idea — state-machine integration.
 *
 * Thin wrapper around `@caia/state-machine` that fires the
 * `onboarding → idea-captured` transition. The wrapper is idempotent:
 * if the project is already in `idea-captured`, it no-ops cleanly.
 *
 * The FSM transition is enumerated in
 * `packages/state-machine/src/transitions.ts` (the existing canonical
 * edge `onboarding -> idea-captured`). This package is the authoritative
 * caller for that transition.
 */

import {
  InvalidTransitionError,
  type ProjectState,
  type StateMachine,
  type TransitionResult,
} from '@caia/state-machine';

import { GrandIdeaError } from './errors.js';

export interface AdvanceToIdeaCapturedInput {
  projectId: string;
  /** Operator email / agent id (matches `captured_by`). */
  triggeredById: string;
  /** Default: 'operator'. Set 'agent' or 'system' for automated callers. */
  triggeredByKind?: 'operator' | 'agent' | 'system';
  /** Optional payload merged into the FSM history row. */
  payload?: Record<string, unknown>;
}

export interface AdvanceToIdeaCapturedResult {
  /** True when the FSM moved; false on idempotent no-op (already in idea-captured). */
  applied: boolean;
  /** The state BEFORE this call (or the current state on no-op). */
  fromState: ProjectState;
  /** Always 'idea-captured' on a successful call. */
  toState: 'idea-captured';
  /** Underlying FSM result (only present when `applied=true`). */
  transition?: TransitionResult;
}

/**
 * Advance the project FSM `onboarding → idea-captured`. Idempotent on
 * a project already in `idea-captured`. Bubbles every other FSM error
 * as a `GrandIdeaError('fsm_transition_failed')`.
 */
export async function advanceToIdeaCaptured(
  stateMachine: StateMachine,
  input: AdvanceToIdeaCapturedInput,
): Promise<AdvanceToIdeaCapturedResult> {
  const kind = input.triggeredByKind ?? 'operator';
  let currentState: ProjectState;
  try {
    currentState = await stateMachine.currentState(input.projectId);
  } catch (err) {
    throw new GrandIdeaError(
      'fsm_transition_failed',
      `failed to read current FSM state for project ${input.projectId}`,
      err,
      { projectId: input.projectId },
    );
  }

  // Idempotent: already in idea-captured (re-capture path).
  if (currentState === 'idea-captured') {
    return {
      applied: false,
      fromState: 'idea-captured',
      toState: 'idea-captured',
    };
  }

  // Only allowed from 'onboarding'.
  if (currentState !== 'onboarding') {
    throw new GrandIdeaError(
      'project_state_invalid',
      `cannot capture grand-idea from state '${currentState}'; required 'onboarding'`,
      undefined,
      { projectId: input.projectId, currentState },
    );
  }

  try {
    const result = await stateMachine.transition(input.projectId, 'idea-captured', {
      reason: 'grand-idea-captured',
      triggeredBy: { kind, id: input.triggeredById },
      payload: input.payload ?? {},
    });
    return {
      applied: result.applied,
      fromState: 'onboarding',
      toState: 'idea-captured',
      transition: result,
    };
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      throw new GrandIdeaError(
        'project_state_invalid',
        err.message,
        err,
        { projectId: input.projectId },
      );
    }
    throw new GrandIdeaError(
      'fsm_transition_failed',
      `FSM transition onboarding -> idea-captured failed for project ${input.projectId}`,
      err,
      { projectId: input.projectId },
    );
  }
}
