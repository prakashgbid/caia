/**
 * @caia/test-reviewer — api.ts
 *
 * The orchestrator-facing entrypoint: `reviewTicket(ticketId)`. Loads
 * the ticket + composed architecture via DI seams, runs the reviewer,
 * emits the canonical state-machine transition(s), and returns a
 * `ReviewOutcome` envelope.
 *
 * State-machine emission (per `@caia/state-machine`'s transition table):
 *
 *   pass:
 *     tests-authored → tests-reviewed                  (one transition)
 *
 *   fail:
 *     tests-authored → tests-reviewed                  (intermediate)
 *     tests-reviewed → tests-review-failed             (terminal — the
 *                                                       Test Author then
 *                                                       re-runs via the
 *                                                       table's
 *                                                       tests-review-failed
 *                                                       → tests-authored
 *                                                       edge)
 *
 * The fail chain is required because the canonical transition table
 * doesn't allow `tests-authored → tests-review-failed` directly — the
 * reviewer must first land the ticket in `tests-reviewed` (it WAS
 * reviewed, just unfavourably) before flagging the failure. Each
 * intermediate row carries `payload.intermediate = true` so dashboards
 * can suppress it.
 */

import {
  REVIEWER_AGENT_ID,
  REVIEWER_FAIL_INTERMEDIATE_STATE,
  REVIEWER_FAIL_STATE,
  REVIEWER_PASS_STATE,
  REVIEWER_PRE_STATE,
  type ArchitectureStore,
  type CriticAdapter,
  type ReviewerOptions,
  type ReviewOutcome,
  type StateMachineAdapter,
  type TicketStore,
} from './types.js';
import { TestReviewer } from './reviewer.js';
import type { ProjectState } from '@caia/state-machine';

export interface ReviewTicketDeps {
  ticketStore: TicketStore;
  architectureStore?: ArchitectureStore;
  stateMachine: StateMachineAdapter;
  critic?: CriticAdapter;
}

export interface ReviewTicketOptions extends ReviewerOptions {
  /**
   * Override the pre-state. The reviewer only emits transitions from
   * `REVIEWER_PRE_STATE` (`tests-authored`); supply a different value
   * for tests that want to assert behaviour with a custom starting
   * state.
   */
  fromState?: ProjectState;
}

/**
 * The orchestrator-facing entrypoint. Loads the ticket + composed
 * architecture, runs the audit, emits the FSM transitions, returns the
 * outcome envelope.
 */
export async function reviewTicket(
  ticketId: string,
  deps: ReviewTicketDeps,
  opts: ReviewTicketOptions = {},
): Promise<ReviewOutcome> {
  const ticket = await deps.ticketStore.loadTicket(ticketId);

  // Resolve the composed architecture: prefer the explicit store, else
  // fall back to the ticket's own `architecture` field.
  let composedArchitecture: Record<string, unknown> = {};
  if (deps.architectureStore) {
    composedArchitecture =
      await deps.architectureStore.loadArchitecture(ticketId);
  } else if (
    ticket.architecture &&
    typeof ticket.architecture === 'object' &&
    !Array.isArray(ticket.architecture)
  ) {
    composedArchitecture = ticket.architecture as Record<string, unknown>;
  }

  // Build + invoke the reviewer.
  const reviewer = new TestReviewer(
    deps.critic ? { critic: deps.critic } : {},
    splitReviewerOptions(opts),
  );
  const decision = await reviewer.review({
    ticket,
    composedArchitecture,
  });

  const fromState: ProjectState = opts.fromState ?? REVIEWER_PRE_STATE;
  const emittedTransitions: Array<{ from: ProjectState; to: ProjectState; intermediate: boolean }> = [];

  if (decision.decision === 'pass') {
    // Single transition.
    await deps.stateMachine.transition({
      ticketId,
      from: fromState,
      to: REVIEWER_PASS_STATE,
      triggeredBy: { kind: 'agent', id: REVIEWER_AGENT_ID },
      payload: {
        decision: 'pass',
        findings: decision.findings,
        summary: decision.summary,
      },
    });
    emittedTransitions.push({
      from: fromState,
      to: REVIEWER_PASS_STATE,
      intermediate: false,
    });
  } else {
    // Chain: tests-authored → tests-reviewed (intermediate) → tests-review-failed.
    await deps.stateMachine.transition({
      ticketId,
      from: fromState,
      to: REVIEWER_FAIL_INTERMEDIATE_STATE,
      triggeredBy: { kind: 'agent', id: REVIEWER_AGENT_ID },
      payload: {
        intermediate: true,
        decision: 'fail',
        // Don't carry findings on the intermediate row — they'd be
        // duplicated on the terminal row below.
      },
    });
    emittedTransitions.push({
      from: fromState,
      to: REVIEWER_FAIL_INTERMEDIATE_STATE,
      intermediate: true,
    });

    await deps.stateMachine.transition({
      ticketId,
      from: REVIEWER_FAIL_INTERMEDIATE_STATE,
      to: REVIEWER_FAIL_STATE,
      triggeredBy: { kind: 'agent', id: REVIEWER_AGENT_ID },
      payload: {
        decision: 'fail',
        findings: decision.findings,
        summary: decision.summary,
      },
    });
    emittedTransitions.push({
      from: REVIEWER_FAIL_INTERMEDIATE_STATE,
      to: REVIEWER_FAIL_STATE,
      intermediate: false,
    });
  }

  return {
    ticketId,
    decision,
    emittedTransitions,
  };
}

/**
 * Strip the api-only `fromState` option before passing through to the
 * reviewer.
 */
function splitReviewerOptions(opts: ReviewTicketOptions): ReviewerOptions {
  const { fromState: _fromState, ...rest } = opts;
  return rest;
}
