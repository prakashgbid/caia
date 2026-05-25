/**
 * @caia/test-reviewer — public surface.
 *
 * Stage 11 of the canonical CAIA pipeline. Audits `ticket.testCases` from
 * the Test Author against the Testing Architect's strategy declarations
 * and emits the state-machine transitions that gate the ticket through
 * `tests-reviewed`.
 */

// -- Reviewer class + functional flavour -----------------------------------
export { TestReviewer, review, REVIEWER_AGENT_ID } from './reviewer.js';
export type { ReviewerDeps } from './reviewer.js';

// -- Orchestrator-facing entrypoint ----------------------------------------
export { reviewTicket } from './api.js';
export type {
  ReviewTicketDeps,
  ReviewTicketOptions,
} from './api.js';

// -- Critic adapters (correctness-lens DI seam) ----------------------------
export {
  HeuristicCriticAdapter,
  NullCriticAdapter,
  FixedCriticAdapter,
} from './critic.js';

// -- Individual lenses (exported so callers can run them in isolation) -----
export { runAcCoverageLens } from './lenses/ac-coverage.js';
export type { AcCoverageInput } from './lenses/ac-coverage.js';

export { runPyramidLens, resolveMix } from './lenses/pyramid.js';
export type { PyramidInput } from './lenses/pyramid.js';

export { runEdgeLens } from './lenses/edge.js';
export type { EdgeInput } from './lenses/edge.js';

export { runErrorLens } from './lenses/error.js';
export type { ErrorInput } from './lenses/error.js';

// -- Types -----------------------------------------------------------------
export type {
  // input/output envelopes
  ReviewerInput,
  ReviewerDecision,
  ReviewerFindings,
  ReviewerTicket,
  ReviewerOptions,
  ReviewOutcome,
  // findings
  AcCoverageFinding,
  PyramidFinding,
  EdgeFinding,
  ErrorFinding,
  CorrectnessFinding,
  // directives + advisories
  RerunDirective,
  Advisory,
  LensName,
  // adapters
  CriticAdapter,
  StateMachineAdapter,
  TicketStore,
  ArchitectureStore,
  // primitives
  Severity,
  PassFinalState,
  FailFinalState,
} from './types.js';

export {
  DEFAULT_REVIEWER_OPTIONS,
  REVIEWER_PRE_STATE,
  REVIEWER_PASS_STATE,
  REVIEWER_FAIL_INTERMEDIATE_STATE,
  REVIEWER_FAIL_STATE,
} from './types.js';
