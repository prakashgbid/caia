/**
 * EA Review Entity — first-class state machine for plan-submission
 * lifecycle through the multi-sub-agent Coordinator.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §7.
 *
 * This module defines the per-submission FSM that absorbs (and extends)
 * the in-package FSM previously living in @caia/ea-architect/src/state.ts.
 * The existing six EA-review states stay; the framework adds seven new
 * Coordinator-flow states.
 *
 * The state set is kept separate from the canonical project FSM in
 * `states.ts` because plan submissions are a different entity type — many
 * plan submissions exist per project, with their own lifecycle.
 */

/** All EA review states — the expanded form per spec §7.1. */
export const EA_REVIEW_STATES = [
  // Coordinator-level orchestration states.
  'ea-coordinator-routing',
  'ea-plan-review-pending',
  'ea-ticket-audit-pending',
  'ea-research-dispatching',
  'ea-doc-stewardship-running',
  'ea-drift-sentinel-checking',
  // Defender iteration states.
  'ea-defender-iteration-1',
  'ea-defender-iteration-2',
  'ea-defender-iteration-3',
  'ea-defender-iteration-4',
  'ea-defender-iteration-5',
  // Aggregation + sign-off.
  'ea-coordinator-aggregating',
  'ea-signoff-ready',
  // Terminal states.
  'ea-approved',
  'ea-conditional',
  'ea-rejected',
  'ea-escalated-to-operator',
  // Existing legacy states (kept for backwards compat with @caia/ea-architect).
  'ea-review-pending',
  'ea-review-revisions-requested',
  'ea-review-approved',
  'ea-review-conditional-approval',
  'ea-review-rejected',
  'ea-review-escalated-to-operator'
] as const;

export type EaReviewState = (typeof EA_REVIEW_STATES)[number];

const EA_STATE_SET = new Set<string>(EA_REVIEW_STATES);

export function isEaReviewState(value: unknown): value is EaReviewState {
  return typeof value === 'string' && EA_STATE_SET.has(value);
}

/** Valid transitions per spec §7.2. */
const VALID_TRANSITIONS: Record<EaReviewState, readonly EaReviewState[]> = {
  // Entry → routing.
  'ea-coordinator-routing': [
    'ea-plan-review-pending',
    'ea-ticket-audit-pending',
    'ea-research-dispatching',
    'ea-doc-stewardship-running',
    'ea-drift-sentinel-checking'
  ],
  // Plan-review path → Defender iteration loop.
  'ea-plan-review-pending': ['ea-defender-iteration-1', 'ea-coordinator-aggregating'],
  'ea-ticket-audit-pending': ['ea-coordinator-aggregating'],
  'ea-research-dispatching': ['ea-coordinator-aggregating'],
  'ea-doc-stewardship-running': ['ea-coordinator-aggregating'],
  'ea-drift-sentinel-checking': ['ea-coordinator-aggregating'],
  // Defender rounds.
  'ea-defender-iteration-1': [
    'ea-defender-iteration-2',
    'ea-coordinator-aggregating',
    'ea-escalated-to-operator'
  ],
  'ea-defender-iteration-2': [
    'ea-defender-iteration-3',
    'ea-coordinator-aggregating',
    'ea-escalated-to-operator'
  ],
  'ea-defender-iteration-3': [
    'ea-defender-iteration-4',
    'ea-coordinator-aggregating',
    'ea-escalated-to-operator'
  ],
  'ea-defender-iteration-4': [
    'ea-defender-iteration-5',
    'ea-coordinator-aggregating',
    'ea-escalated-to-operator'
  ],
  // Cap at round 5 — must terminate.
  'ea-defender-iteration-5': [
    'ea-coordinator-aggregating',
    'ea-escalated-to-operator'
  ],
  // Aggregation → sign-off.
  'ea-coordinator-aggregating': ['ea-signoff-ready'],
  // Sign-off → terminal.
  'ea-signoff-ready': [
    'ea-approved',
    'ea-conditional',
    'ea-rejected',
    'ea-escalated-to-operator'
  ],
  // Terminal states (no outgoing transitions).
  'ea-approved': [],
  'ea-conditional': [],
  'ea-rejected': [],
  'ea-escalated-to-operator': [],
  // Legacy states (kept for backwards compat).
  'ea-review-pending': [
    'ea-review-revisions-requested',
    'ea-review-approved',
    'ea-review-conditional-approval',
    'ea-review-rejected',
    'ea-review-escalated-to-operator',
    'ea-coordinator-routing' // migration bridge
  ],
  'ea-review-revisions-requested': ['ea-review-pending', 'ea-review-rejected'],
  'ea-review-approved': [],
  'ea-review-conditional-approval': [],
  'ea-review-rejected': [],
  'ea-review-escalated-to-operator': []
};

Object.freeze(VALID_TRANSITIONS);
export const EA_VALID_TRANSITIONS = VALID_TRANSITIONS;

/** Terminal states — no further transitions. */
export const EA_TERMINAL_STATES: readonly EaReviewState[] = [
  'ea-approved',
  'ea-conditional',
  'ea-rejected',
  'ea-escalated-to-operator',
  'ea-review-approved',
  'ea-review-conditional-approval',
  'ea-review-rejected',
  'ea-review-escalated-to-operator'
];

export function isEaTerminal(state: EaReviewState): boolean {
  return EA_TERMINAL_STATES.includes(state);
}

export function canEaTransition(from: EaReviewState, to: EaReviewState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/** All edges, for visualisation / tests. */
export function eaAllEdges(): Array<{ from: EaReviewState; to: EaReviewState }> {
  const out: Array<{ from: EaReviewState; to: EaReviewState }> = [];
  for (const from of EA_REVIEW_STATES) {
    for (const to of VALID_TRANSITIONS[from]) out.push({ from, to });
  }
  return out;
}

/** Event-type identifier per transition. */
export function eaEventTypeFor(state: EaReviewState): string {
  // ea-coordinator.* for new framework states, ea-architect.review.* for legacy.
  if (state.startsWith('ea-review-')) {
    return `ea-architect.review.${state.replace(/^ea-review-/, '')}`;
  }
  if (state.startsWith('ea-defender-iteration-')) {
    return 'ea-defender.iteration';
  }
  if (state === 'ea-signoff-ready') return 'ea-coordinator.signoff-ready';
  return `ea-coordinator.${state.replace(/^ea-/, '').replace(/^coordinator-/, '')}`;
}

/** Decide which Defender-iteration state corresponds to a round number. */
export function defenderIterationStateFor(round: number): EaReviewState {
  switch (round) {
    case 1:
      return 'ea-defender-iteration-1';
    case 2:
      return 'ea-defender-iteration-2';
    case 3:
      return 'ea-defender-iteration-3';
    case 4:
      return 'ea-defender-iteration-4';
    case 5:
      return 'ea-defender-iteration-5';
    default:
      throw new Error(`defenderIterationStateFor: round ${round} out of 1..5 range`);
  }
}
