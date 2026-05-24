/**
 * State-machine integration.
 *
 * The EA Architect Agent emits transitions during the review cycle:
 *
 *   ea-review-pending
 *   → ea-review-revisions-requested  (status="approved-with-modifications" | "needs-clarification")
 *   → ea-review-pending              (caller resubmits)
 *   → ea-review-approved             (status="approved")
 *   → ea-review-conditional-approval (status="approved-with-modifications", no further iteration)
 *   → ea-review-rejected             (status="rejected")
 *   → ea-review-escalated-to-operator (escalation_to_operator set)
 *
 * These states are not part of the canonical @caia/state-machine project
 * FSM (that FSM is project-level; this is per-submission EA review state).
 * We model them as an in-package mini-FSM that emits events on every
 * transition. The bridge to @caia/state-machine is event-based: every
 * transition emits an `ea-architect.review.<state>` event that callers
 * subscribe to.
 *
 * If the @caia/state-machine package later gains plan-submission as a
 * first-class entity, this module's `EaReviewStateMachine` can be
 * deprecated in favour of registering the new states + transitions
 * upstream.
 */

import type {
  EaEventBus,
  EaReviewEvent,
  EaReviewEventHandler,
  EaReviewState,
  PlanType,
  ReviewOutcome,
  ReviewStatus
} from './types.js';

/** Valid transitions inside the per-submission EA review FSM. */
export const EA_REVIEW_VALID_TRANSITIONS: Record<EaReviewState, readonly EaReviewState[]> = {
  'ea-review-pending': [
    'ea-review-revisions-requested',
    'ea-review-approved',
    'ea-review-conditional-approval',
    'ea-review-rejected',
    'ea-review-escalated-to-operator'
  ],
  'ea-review-revisions-requested': ['ea-review-pending', 'ea-review-rejected'],
  // Terminal states (no further transitions inside this FSM).
  'ea-review-approved': [],
  'ea-review-conditional-approval': [],
  'ea-review-rejected': [],
  'ea-review-escalated-to-operator': []
};

export function canEaReviewTransition(from: EaReviewState, to: EaReviewState): boolean {
  return EA_REVIEW_VALID_TRANSITIONS[from].includes(to);
}

export const EA_REVIEW_TERMINAL_STATES: readonly EaReviewState[] = [
  'ea-review-approved',
  'ea-review-conditional-approval',
  'ea-review-rejected',
  'ea-review-escalated-to-operator'
];

export function isEaReviewTerminal(state: EaReviewState): boolean {
  return EA_REVIEW_TERMINAL_STATES.includes(state);
}

/** Pick the target state given a review outcome. */
export function chooseTargetState(
  status: ReviewStatus,
  isFinalIteration: boolean,
  escalating: boolean
): EaReviewState {
  if (escalating) return 'ea-review-escalated-to-operator';
  if (status === 'approved') return 'ea-review-approved';
  if (status === 'rejected') return 'ea-review-rejected';
  if (status === 'needs-clarification') return 'ea-review-revisions-requested';
  // approved-with-modifications: if the caller wants a final verdict (no
  // more iterations) we land on conditional-approval; otherwise revisions.
  if (status === 'approved-with-modifications') {
    return isFinalIteration ? 'ea-review-conditional-approval' : 'ea-review-revisions-requested';
  }
  return 'ea-review-revisions-requested';
}

/**
 * Build the event-type identifier for a transition.
 *
 * Format: `ea-architect.review.<state>` — dot-namespaced per the
 * `@chiefaia/events-taxonomy-internal` convention (57 event types
 * across 15 namespaces; this is the new "ea-architect.review" namespace).
 */
export function eventTypeFor(state: EaReviewState): string {
  return `ea-architect.review.${state.replace(/^ea-review-/, '')}`;
}

export interface EmitTransitionInput {
  submissionId: string;
  callerAgentId: string;
  planType: PlanType;
  iteration: number;
  fromState: EaReviewState | null;
  toState: EaReviewState;
  outcome: ReviewOutcome;
  at: Date;
}

/** Compose the event envelope. */
export function buildEvent(input: EmitTransitionInput): EaReviewEvent {
  return {
    type: eventTypeFor(input.toState),
    submissionId: input.submissionId,
    callerAgentId: input.callerAgentId,
    planType: input.planType,
    iteration: input.iteration,
    fromState: input.fromState,
    toState: input.toState,
    outcome: input.outcome,
    at: input.at.toISOString()
  };
}

/** Minimal in-process event bus. */
export class InProcessEventBus implements EaEventBus {
  private readonly handlers = new Map<string, Set<EaReviewEventHandler>>();
  private readonly wildcard = new Set<EaReviewEventHandler>();

  on(type: string, handler: EaReviewEventHandler): () => void {
    if (type === '*' || type === '') {
      this.wildcard.add(handler);
      return () => this.wildcard.delete(handler);
    }
    let set = this.handlers.get(type);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  async emit(event: EaReviewEvent): Promise<void> {
    const exact = this.handlers.get(event.type) ?? new Set();
    const all = [...exact, ...this.wildcard];
    await Promise.all(all.map((h) => h(event)));
  }
}
