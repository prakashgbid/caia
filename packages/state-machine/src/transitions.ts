/**
 * Valid transitions for the CAIA project FSM.
 *
 * Sourced verbatim from `state_machine_handoff_spec_2026.md` §1.1 + §1.3 +
 * §1.4 + §1.5. Every transition is enumerated; anything else throws.
 */

import { ALL_STATES, isTerminal, type ProjectState } from './states.js';

/**
 * Map from a state to the set of states it may legally transition to.
 * Keys cover every non-terminal state in `ALL_STATES`. `done` and
 * `archived` have empty exits.
 */
const VALID_TRANSITIONS_RAW: Record<ProjectState, readonly ProjectState[]> = {
  // -- Happy path -----------------------------------------------------------
  onboarding: ['idea-captured', 'onboarding-failed', 'paused', 'archived'],
  'idea-captured': ['interviewing', 'paused', 'archived'],
  interviewing: [
    'interview-complete',
    'interviewing-failed',
    'paused',
    'archived',
  ],
  'interview-complete': [
    'proposal-generated',
    'proposal-failed',
    'paused',
    'archived',
  ],
  'proposal-generated': ['awaiting-external-design', 'paused', 'archived'],
  'awaiting-external-design': [
    'design-uploaded',
    'design-ingest-failed',
    'paused',
    'archived',
  ],
  'design-uploaded': [
    'ticket-tree-generated',
    'atlas-decompose-failed',
    'paused',
    'archived',
  ],
  'ticket-tree-generated': [
    'atlas-ready',
    'ea-dispatching',
    'paused',
    'archived',
  ],
  // Atlas-ready is the pivot. From here the operator either fires the
  // backend chain (ea-dispatching) or issues a change-request.
  'atlas-ready': ['ea-dispatching', 'change-requested', 'paused', 'archived'],
  // Change-requested is routed to one of several resume states by the
  // change-router (spec §1.4). We allow any of those resume targets.
  'change-requested': [
    'revision-pending',
    'ticket-tree-generated',
    'ea-dispatching',
    'tests-authored',
    'coding-in-progress',
    'idea-captured',
    'paused',
    'archived',
  ],
  // Revision-pending is the transient "router decided, orchestrator
  // hasn't executed yet" state. It only exits to the resume target.
  'revision-pending': [
    'ticket-tree-generated',
    'ea-dispatching',
    'tests-authored',
    'coding-in-progress',
    'idea-captured',
    'paused',
    'archived',
  ],
  'ea-dispatching': [
    'ea-complete',
    'ea-dispatching-failed',
    'paused',
    'archived',
  ],
  'ea-complete': ['tests-authored', 'ea-review-failed', 'paused', 'archived'],
  'tests-authored': [
    'tests-reviewed',
    'tests-authoring-failed',
    'paused',
    'archived',
  ],
  'tests-reviewed': [
    'scheduled',
    'tests-review-failed',
    'paused',
    'archived',
  ],
  scheduled: [
    'coding-in-progress',
    'scheduling-failed',
    'paused',
    'archived',
  ],
  'coding-in-progress': [
    'code-complete',
    'coding-failed',
    'paused',
    'archived',
  ],
  'code-complete': [
    'per-story-tested',
    'per-story-test-failed',
    'paused',
    'archived',
  ],
  'per-story-tested': ['e2e-tested', 'e2e-failed', 'paused', 'archived'],
  'e2e-tested': ['deploying', 'paused', 'archived'],
  deploying: ['deployed', 'deploy-failed', 'paused', 'archived'],
  deployed: ['verified', 'verify-failed', 'paused', 'archived'],
  verified: ['done', 'archived'],
  // -- Failed-side variants -> recover or abandon (spec §1.3) ---------------
  'onboarding-failed': ['onboarding', 'archived'],
  'interviewing-failed': ['interviewing', 'idea-captured', 'archived'],
  'proposal-failed': ['interview-complete', 'archived'],
  'design-ingest-failed': ['awaiting-external-design', 'archived'],
  'atlas-decompose-failed': ['design-uploaded', 'archived'],
  'ea-dispatching-failed': ['ticket-tree-generated', 'ea-dispatching', 'archived'],
  'ea-review-failed': ['ea-dispatching', 'archived'],
  'tests-authoring-failed': ['ea-complete', 'tests-authored', 'archived'],
  'tests-review-failed': ['tests-authored', 'archived'],
  'scheduling-failed': ['tests-reviewed', 'archived'],
  'coding-failed': ['scheduled', 'coding-in-progress', 'archived'],
  'per-story-test-failed': ['coding-in-progress', 'archived'],
  'e2e-failed': ['code-complete', 'per-story-tested', 'archived'],
  'deploy-failed': ['e2e-tested', 'deploying', 'archived'],
  'verify-failed': ['deployed', 'archived'],
  // -- Control -------------------------------------------------------------
  // Paused is structurally an in-flight state; it can resume into any
  // state. Practically, the orchestrator only ever transitions paused ->
  // the prior state via the `resume()` verb, but we accept any state so
  // the operator can also `restart`/`fork`.
  paused: ALL_STATES.filter((s) => s !== 'paused'),
  // Terminal - no exits.
  done: [],
  archived: [],
};

// Sanity: every state is keyed exactly once.
Object.freeze(VALID_TRANSITIONS_RAW);

export const VALID_TRANSITIONS: Readonly<
  Record<ProjectState, readonly ProjectState[]>
> = VALID_TRANSITIONS_RAW;

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}

/** Returns `true` if `from -> to` is in the transition table. */
export function canTransition(from: ProjectState, to: ProjectState): boolean {
  if (from === to) return false;
  if (isTerminal(from)) return false;
  const allowed = VALID_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Same as `canTransition` but returns a structured reason - useful for
 * propagating "why" into error messages and dashboard tooltips.
 */
export function checkTransition(
  from: ProjectState,
  to: ProjectState,
): TransitionCheck {
  if (from === to) return { ok: false, reason: 'self-transition is a no-op' };
  if (isTerminal(from))
    return { ok: false, reason: `${from} is a terminal state` };
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `${from} -> ${to} is not in the transition table`,
    };
  }
  return { ok: true };
}

/** Used by the dashboard to render the "next step" picker. */
export function availableTransitions(
  from: ProjectState,
): readonly ProjectState[] {
  return VALID_TRANSITIONS[from];
}

/** Spec-named alias for `availableTransitions`. */
export function validNextStates(
  from: ProjectState,
): readonly ProjectState[] {
  return VALID_TRANSITIONS[from];
}

/**
 * For tests / static analysis: returns every (from,to) edge in the FSM.
 */
export function allEdges(): { from: ProjectState; to: ProjectState }[] {
  const out: { from: ProjectState; to: ProjectState }[] = [];
  for (const from of ALL_STATES) {
    for (const to of VALID_TRANSITIONS[from]) {
      out.push({ from, to });
    }
  }
  return out;
}

/**
 * Convenience: which terminal states are reachable from `state`? Used by
 * resume logic to decide whether a project still has work to do.
 */
export function reachableTerminals(state: ProjectState): ProjectState[] {
  const visited = new Set<ProjectState>();
  const stack: ProjectState[] = [state];
  const out = new Set<ProjectState>();
  while (stack.length) {
    const cur = stack.pop() as ProjectState;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (isTerminal(cur)) {
      out.add(cur);
      continue;
    }
    for (const next of VALID_TRANSITIONS[cur]) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  return [...out];
}
