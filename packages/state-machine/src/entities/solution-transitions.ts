/**
 * Solution-lifecycle valid transitions.
 *
 * The transition table is derived programmatically from the state lists
 * in `./solution-states.ts` so that adding/removing a state automatically
 * extends/contracts the matrix in lock-step. The shape mirrors the
 * existing project FSM's `transitions.ts`:
 *
 *   from -> readonly [to1, to2, ...]
 *
 * Rules (encoded below):
 *   1. Forward path: each forward state F_i -> F_{i+1} ∪ {F_i-failed?, F_i-rolled-back?, paused, abandoned}
 *      Initial state `approved` has no `*-failed` (you can't fail to approve), but it
 *      does have `implemented-failed` as a reachable next state (the implementation
 *      attempt failed before reaching `implemented`).
 *   2. `*-failed` -> {forward-state-they-failed-to-reach, abandoned}
 *      A failed solution can be retried by re-attempting the same forward state.
 *   3. `*-rolled-back` -> {forward-state-they-regressed-from, abandoned}
 *      A rolled-back solution can re-green and re-enter the forward state.
 *   4. `paused` -> any non-`paused`, non-`done`, non-`abandoned` state
 *      (resume restores prior_state via the API; the matrix is permissive to allow
 *      operator-fork patterns).
 *   5. `done`, `abandoned` -> ∅ (terminal).
 */

import {
  ALL_SOLUTION_STATES,
  FAILED_OF,
  FORWARD_OF_FAILED,
  FORWARD_OF_ROLLED_BACK,
  ROLLED_BACK_OF,
  SOLUTION_FORWARD_STATES,
  isSolutionTerminal,
  type SolutionState,
} from './solution-states.js';

/** Build the raw transition table from the state declarations. */
function buildTransitionTable(): Readonly<Record<SolutionState, readonly SolutionState[]>> {
  const table: Record<SolutionState, SolutionState[]> = {} as Record<
    SolutionState,
    SolutionState[]
  >;
  // Initialise every state with an empty list.
  for (const state of ALL_SOLUTION_STATES) {
    table[state] = [];
  }

  // -- Forward transitions ------------------------------------------------
  for (let i = 0; i < SOLUTION_FORWARD_STATES.length; i++) {
    const from = SOLUTION_FORWARD_STATES[i] as SolutionState;
    if (isSolutionTerminal(from)) continue; // skip `done`
    const next = SOLUTION_FORWARD_STATES[i + 1];
    if (next !== undefined) table[from].push(next);

    // The "tried to advance and failed" edge: from F_i, you can land in
    // the next state's `*-failed` variant (the transition attempt itself
    // failed). E.g. approved -> implemented-failed (couldn't write code).
    if (next !== undefined && next !== 'done') {
      const failedNext = FAILED_OF[next as keyof typeof FAILED_OF];
      if (failedNext !== undefined) table[from].push(failedNext);
    }

    // The "currently in this state and a re-attestation went red" edge:
    // from F_i, you can also land in F_i's own `*-rolled-back` (drift).
    const rolledBack = ROLLED_BACK_OF[from as keyof typeof ROLLED_BACK_OF];
    if (rolledBack !== undefined) table[from].push(rolledBack);

    // Control + abandon are reachable from every forward non-terminal.
    table[from].push('paused', 'abandoned');
  }

  // -- `*-failed` -> recovery target or abandon --------------------------
  for (const failed of Object.keys(FORWARD_OF_FAILED) as Array<
    keyof typeof FORWARD_OF_FAILED
  >) {
    const forward = FORWARD_OF_FAILED[failed];
    table[failed].push(forward, 'paused', 'abandoned');
  }

  // -- `*-rolled-back` -> re-enter forward or abandon --------------------
  for (const rb of Object.keys(FORWARD_OF_ROLLED_BACK) as Array<
    keyof typeof FORWARD_OF_ROLLED_BACK
  >) {
    const forward = FORWARD_OF_ROLLED_BACK[rb];
    table[rb].push(forward, 'paused', 'abandoned');
  }

  // -- paused -> any non-paused, non-terminal -----------------------------
  // (resume restores prior_state via the API, but the matrix is permissive
  //  so operator-driven fork patterns are allowed.)
  for (const state of ALL_SOLUTION_STATES) {
    if (state === 'paused') continue;
    if (isSolutionTerminal(state)) continue;
    table.paused.push(state);
  }
  // Plus 'abandoned' itself is allowed from paused (operator can abandon
  // a paused solution outright).
  table.paused.push('abandoned');

  // Terminal: empty.
  // table.done and table.abandoned remain [].

  // Freeze.
  const frozen: Record<SolutionState, readonly SolutionState[]> = {} as Record<
    SolutionState,
    readonly SolutionState[]
  >;
  for (const key of Object.keys(table) as SolutionState[]) {
    frozen[key] = Object.freeze([...table[key]]);
  }
  return Object.freeze(frozen);
}

export const VALID_SOLUTION_TRANSITIONS: Readonly<
  Record<SolutionState, readonly SolutionState[]>
> = buildTransitionTable();

export interface SolutionTransitionCheck {
  ok: boolean;
  reason?: string;
}

export function canSolutionTransition(
  from: SolutionState,
  to: SolutionState,
): boolean {
  if (from === to) return false;
  if (isSolutionTerminal(from)) return false;
  return VALID_SOLUTION_TRANSITIONS[from].includes(to);
}

export function checkSolutionTransition(
  from: SolutionState,
  to: SolutionState,
): SolutionTransitionCheck {
  if (from === to) {
    return { ok: false, reason: 'self-transition is a no-op' };
  }
  if (isSolutionTerminal(from)) {
    return { ok: false, reason: `${from} is a terminal state` };
  }
  const allowed = VALID_SOLUTION_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `${from} -> ${to} is not in the solution-lifecycle transition table`,
    };
  }
  return { ok: true };
}

export function availableSolutionTransitions(
  from: SolutionState,
): readonly SolutionState[] {
  return VALID_SOLUTION_TRANSITIONS[from];
}

export function validNextSolutionStates(
  from: SolutionState,
): readonly SolutionState[] {
  return VALID_SOLUTION_TRANSITIONS[from];
}

/** Every (from,to) edge in the FSM. Used by tests + static analysis. */
export function allSolutionEdges(): { from: SolutionState; to: SolutionState }[] {
  const out: { from: SolutionState; to: SolutionState }[] = [];
  for (const from of ALL_SOLUTION_STATES) {
    for (const to of VALID_SOLUTION_TRANSITIONS[from]) {
      out.push({ from, to });
    }
  }
  return out;
}
