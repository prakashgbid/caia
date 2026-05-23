/**
 * Canonical CAIA pipeline states.
 *
 * Sourced from `research/state_machine_handoff_spec_2026.md` §1.2 + §1.3.
 *
 * Every "doing" state has an explicit `*-failed` variant. Plus `paused` and
 * `revision-pending` as orthogonal flags-as-states. `archived` is terminal.
 */

/** Happy-path states. Linear unless commented otherwise. */
export const HAPPY_STATES = [
  'onboarding',
  'idea-captured',
  'interviewing',
  'interview-complete',
  'proposal-generated',
  'awaiting-external-design',
  'design-uploaded',
  'ticket-tree-generated',
  'atlas-ready',
  'change-requested',
  'ea-dispatching',
  'ea-complete',
  'tests-authored',
  'tests-reviewed',
  'scheduled',
  'coding-in-progress',
  'code-complete',
  'per-story-tested',
  'e2e-tested',
  'deploying',
  'deployed',
  'verified',
  'done',
] as const;

/** Failure-side variants. */
export const FAILED_STATES = [
  'onboarding-failed',
  'interviewing-failed',
  'proposal-failed',
  'design-ingest-failed',
  'atlas-decompose-failed',
  'ea-dispatching-failed',
  'ea-review-failed',
  'tests-authoring-failed',
  'tests-review-failed',
  'scheduling-failed',
  'coding-failed',
  'per-story-test-failed',
  'e2e-failed',
  'deploy-failed',
  'verify-failed',
] as const;

/** Orthogonal "control" states the operator can request. */
export const CONTROL_STATES = [
  // Paused is set on a doing-state; the dedicated `paused` value here
  // exists for the rare case where a caller needs to set status to literal
  // paused (eg fresh-from-fork projects parked until the operator nudges).
  'paused',
  // Revision-pending fires when an upstream artifact changed and the
  // orchestrator is about to recompute. Sits between change-requested and
  // the proposed-resume-state target.
  'revision-pending',
  'archived',
] as const;

export const ALL_STATES = [
  ...HAPPY_STATES,
  ...FAILED_STATES,
  ...CONTROL_STATES,
] as const;

const HAPPY_SET = new Set<string>(HAPPY_STATES);
const FAILED_SET = new Set<string>(FAILED_STATES);
const CONTROL_SET = new Set<string>(CONTROL_STATES);
const ALL_SET = new Set<string>(ALL_STATES);

export type HappyState = (typeof HAPPY_STATES)[number];
export type FailedState = (typeof FAILED_STATES)[number];
export type ControlState = (typeof CONTROL_STATES)[number];
export type ProjectState = HappyState | FailedState | ControlState;

export function isProjectState(value: unknown): value is ProjectState {
  return typeof value === 'string' && ALL_SET.has(value);
}

export function isHappyState(value: ProjectState): value is HappyState {
  return HAPPY_SET.has(value);
}

export function isFailedState(value: ProjectState): value is FailedState {
  return FAILED_SET.has(value);
}

export function isControlState(value: ProjectState): value is ControlState {
  return CONTROL_SET.has(value);
}

/**
 * Terminal states - no outgoing transitions. `done` is the happy terminal;
 * `archived` is the operator-abandoned terminal.
 */
export const TERMINAL_STATES: readonly ProjectState[] = ['done', 'archived'];

/** Set membership helper for callers that compare against literals. */
export function isTerminal(state: ProjectState): boolean {
  return TERMINAL_STATES.includes(state);
}
