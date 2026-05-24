/**
 * Solution-lifecycle states for the Real Definition-of-Done state machine.
 *
 * Sourced from:
 *   - operator prompt (state-machine-solution-lifecycle 2026-05-24)
 *   - `agent-memory/feedback_real_definition_of_done.md` (the canonical
 *     vocabulary that the operator typed)
 *   - `research/real_definition_of_done_enforcement_2026.md` §6.1 (the
 *     longer-form canonical lifecycle; we use the operator vocabulary on
 *     the wire but document the canonical synonyms here so cross-package
 *     readers can join the two).
 *
 * Operator vocabulary  ↔ canonical-doc vocabulary
 * ────────────────────────────────────────────────────────────────
 * approved             ↔ plan-approved
 * implemented          ↔ code-written
 * merged               ↔ pr-merged          (pr-opened is folded in,
 *                                            since the existing project
 *                                            FSM tracks PR-opened already)
 * deployed             ↔ deployed
 * imported             ↔ built-into-active-app + imported (collapsed)
 * called-in-test       ↔ called-in-test
 * called-in-prod       ↔ called-in-prod
 * producing-metrics    ↔ producing-metrics  (terminal-success in the
 *                                            canonical doc; here it is
 *                                            a holdover state — see
 *                                            `done` below)
 * done                 ↔ producing-metrics held for ≥24h consecutive
 *                       (per canonical §6.3)
 *
 * Failure-side vocabulary follows the existing `@caia/state-machine`
 * `*-failed` pattern (every "doing" state has a `*-failed` variant) plus
 * `*-rolled-back` for post-deployment regressions. This matches the
 * operator prompt exactly. The canonical doc's `degraded` ≈ currently
 * in a `*-rolled-back` state; `abandoned` is preserved verbatim;
 * `sunset` is operator-driven and reuses `abandoned` with a documented
 * `reason: 'sunset'`.
 */

/** Forward path (9 states). DONE is reached only when the lifecycle has
 * spent ≥24 consecutive hours in `producing-metrics` (per canonical §6.3). */
export const SOLUTION_FORWARD_STATES = [
  'approved',
  'implemented',
  'merged',
  'deployed',
  'imported',
  'called-in-test',
  'called-in-prod',
  'producing-metrics',
  'done',
] as const;

/** Failure variants — one per non-initial forward state.
 *
 * `<state>-failed` means the *transition into* `<state>` was attempted
 * and failed, OR `<state>` was reached and its attestation later went
 * red within the per-state freshness window. Recovery: re-attempt by
 * advancing to the corresponding forward state, OR abandon.
 */
export const SOLUTION_FAILED_STATES = [
  'implemented-failed',
  'merged-failed',
  'deployed-failed',
  'imported-failed',
  'called-in-test-failed',
  'called-in-prod-failed',
  'producing-metrics-failed',
] as const;

/** Post-deployment regression variants. Reached when a previously-green
 * post-deploy attestation goes red (drift). Recovery: re-enter the
 * forward state once the steward re-greens it, OR abandon. */
export const SOLUTION_ROLLED_BACK_STATES = [
  'deployed-rolled-back',
  'imported-rolled-back',
  'called-in-test-rolled-back',
  'called-in-prod-rolled-back',
  'producing-metrics-rolled-back',
] as const;

/** Control / terminal states. */
export const SOLUTION_CONTROL_STATES = [
  /** Orthogonal: reachable from any non-terminal state. `resumeSolution`
   * restores `prior_state`. */
  'paused',
  /** Terminal-failure. Operator-driven. */
  'abandoned',
] as const;

export const ALL_SOLUTION_STATES = [
  ...SOLUTION_FORWARD_STATES,
  ...SOLUTION_FAILED_STATES,
  ...SOLUTION_ROLLED_BACK_STATES,
  ...SOLUTION_CONTROL_STATES,
] as const;

export type SolutionForwardState = (typeof SOLUTION_FORWARD_STATES)[number];
export type SolutionFailedState = (typeof SOLUTION_FAILED_STATES)[number];
export type SolutionRolledBackState = (typeof SOLUTION_ROLLED_BACK_STATES)[number];
export type SolutionControlState = (typeof SOLUTION_CONTROL_STATES)[number];
export type SolutionState =
  | SolutionForwardState
  | SolutionFailedState
  | SolutionRolledBackState
  | SolutionControlState;

const FORWARD_SET = new Set<string>(SOLUTION_FORWARD_STATES);
const FAILED_SET = new Set<string>(SOLUTION_FAILED_STATES);
const ROLLED_BACK_SET = new Set<string>(SOLUTION_ROLLED_BACK_STATES);
const CONTROL_SET = new Set<string>(SOLUTION_CONTROL_STATES);
const ALL_SET = new Set<string>(ALL_SOLUTION_STATES);

export function isSolutionState(value: unknown): value is SolutionState {
  return typeof value === 'string' && ALL_SET.has(value);
}

export function isSolutionForwardState(
  state: SolutionState,
): state is SolutionForwardState {
  return FORWARD_SET.has(state);
}

export function isSolutionFailedState(
  state: SolutionState,
): state is SolutionFailedState {
  return FAILED_SET.has(state);
}

export function isSolutionRolledBackState(
  state: SolutionState,
): state is SolutionRolledBackState {
  return ROLLED_BACK_SET.has(state);
}

export function isSolutionControlState(
  state: SolutionState,
): state is SolutionControlState {
  return CONTROL_SET.has(state);
}

/** Terminal states have no outbound transitions.
 *
 * - `done` is the happy terminal (Definition-of-Done achieved).
 * - `abandoned` is the operator-abandoned / sunset terminal. */
export const SOLUTION_TERMINAL_STATES: readonly SolutionState[] = [
  'done',
  'abandoned',
] as const;

export function isSolutionTerminal(state: SolutionState): boolean {
  return SOLUTION_TERMINAL_STATES.includes(state);
}

/** The state a fresh registerSolution() lands in. */
export const SOLUTION_INITIAL_STATE: SolutionState = 'approved';

/** Map each forward state (except `approved`) to its `<state>-failed`
 * sibling. Used for symmetric transition-table generation. */
export const FAILED_OF: Readonly<
  Partial<Record<SolutionForwardState, SolutionFailedState>>
> = {
  implemented: 'implemented-failed',
  merged: 'merged-failed',
  deployed: 'deployed-failed',
  imported: 'imported-failed',
  'called-in-test': 'called-in-test-failed',
  'called-in-prod': 'called-in-prod-failed',
  'producing-metrics': 'producing-metrics-failed',
};

/** Map each post-deployment forward state to its `<state>-rolled-back`
 * sibling. */
export const ROLLED_BACK_OF: Readonly<
  Partial<Record<SolutionForwardState, SolutionRolledBackState>>
> = {
  deployed: 'deployed-rolled-back',
  imported: 'imported-rolled-back',
  'called-in-test': 'called-in-test-rolled-back',
  'called-in-prod': 'called-in-prod-rolled-back',
  'producing-metrics': 'producing-metrics-rolled-back',
};

/** Map each `*-failed` back to the forward state it failed to reach. */
export const FORWARD_OF_FAILED: Readonly<Record<SolutionFailedState, SolutionForwardState>> = {
  'implemented-failed': 'implemented',
  'merged-failed': 'merged',
  'deployed-failed': 'deployed',
  'imported-failed': 'imported',
  'called-in-test-failed': 'called-in-test',
  'called-in-prod-failed': 'called-in-prod',
  'producing-metrics-failed': 'producing-metrics',
};

/** Map each `*-rolled-back` back to the forward state it regressed from. */
export const FORWARD_OF_ROLLED_BACK: Readonly<
  Record<SolutionRolledBackState, SolutionForwardState>
> = {
  'deployed-rolled-back': 'deployed',
  'imported-rolled-back': 'imported',
  'called-in-test-rolled-back': 'called-in-test',
  'called-in-prod-rolled-back': 'called-in-prod',
  'producing-metrics-rolled-back': 'producing-metrics',
};

/** Canonical-doc synonyms exposed as a constant so cross-package readers
 * (e.g. `@chiefaia/events-taxonomy-internal`) can register both
 * vocabularies in the event registry. */
export const SOLUTION_STATE_CANONICAL_SYNONYM: Readonly<
  Partial<Record<SolutionState, string>>
> = {
  approved: 'plan-approved',
  implemented: 'code-written',
  merged: 'pr-merged',
  imported: 'built-into-active-app',
};

/** Default per-state thresholds (in hours) for the "stuck" heuristic.
 *
 * Numbers come from `real_definition_of_done_enforcement_2026.md` §5
 * (the per-solution manifest's `verifier_freshness_thresholds`) and
 * §6.3 (the 24h holdover in `producing-metrics` before DONE).
 *
 * The threshold is interpreted as "if the solution has been in this
 * state for longer than N hours, it is stuck and a `solution.stuck`
 * event should be emitted". Terminal states are not stuck-able. */
export const DEFAULT_STUCK_THRESHOLDS_HOURS: Readonly<
  Partial<Record<SolutionState, number>>
> = {
  approved: 24, // EA-approved but no code yet — should start within a day
  implemented: 24, // code written but not yet PR-merged
  merged: 2, // canonical: deploy_steward_max_age_hours = 2
  deployed: 4, // canonical: usage_steward_max_age_hours = 4
  imported: 6, // canonical: activation_steward_max_age_hours = 6 (test phase)
  'called-in-test': 24, // generous: prod activation may take a release cycle
  'called-in-prod': 24, // canonical: outcome_steward_max_age_hours = 24
  'producing-metrics': 24, // canonical §6.3: ≥24h before DONE
};
