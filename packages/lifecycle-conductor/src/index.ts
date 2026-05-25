/**
 * @caia/lifecycle-conductor — public surface.
 *
 * Spec: research/real_definition_of_done_enforcement_2026.md §4.4 + §6 + Task A9.
 * Boundary: ADR-063 — exactly 4 stewards + the orthogonal
 *           `ea-review-approved` state. PR #580's 5th steward
 *           `future-incoming` retired 2026-05-25.
 */

export * from './types.js';

export {
  DefaultFsmDriver,
  STEWARD_GATE_ORDINAL,
  FORWARD_STATE_ORDINAL,
  decideTransition,
  evaluateForwardChain,
  type FsmDriver,
  type ForwardChainEvaluation,
  type DecideTransitionInput,
  type TransitionDecision,
} from './fsm.js';

export {
  LifecycleAggregator,
  coerceAttestation,
  coerceEaReviewState,
  type AttestationEventSource,
  type LifecycleAggregatorOptions,
  type SolutionMachineLike,
} from './aggregator.js';

export {
  LifecycleConductorApi,
  type LifecycleHistoryReader,
  type SolutionLifecycleView,
  type ListIncompleteEntry,
} from './api.js';

export {
  projectToSse,
  createSseFanout,
  SseConnection,
  type ProjectToSseOptions,
  type SseFanoutHandle,
} from './dashboard-projector.js';

export {
  reportRegressionToInbox,
  reportStuckToInbox,
  reportDodToInbox,
  reportDodCompletedToInbox,
  HEADING_REGRESSION,
  HEADING_STUCK,
  HEADING_DOD,
  type InboxReportResult,
} from './reporter.js';

export {
  startDaemon,
  type DaemonConfig,
  type RunningDaemon,
} from './daemon.js';
