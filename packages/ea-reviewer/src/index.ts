/**
 * @caia/ea-reviewer — public surface.
 */

export { Reviewer, review, REVIEWER_AGENT_ID } from './reviewer.js';
export type { ReviewerDeps } from './reviewer.js';

export type {
  Advisory,
  ArchitectAuditRow,
  CompletenessFinding,
  ConsistencyFinding,
  CorrectnessFinding,
  CriticAdapter,
  EscalationEntry,
  RerunDirective,
  ReviewerDecision,
  ReviewerFindings,
  ReviewerInput,
  ReviewerOptions,
  Severity,
} from './types.js';
export { DEFAULT_REVIEWER_OPTIONS } from './types.js';

export {
  HeuristicCriticAdapter,
  NullCriticAdapter,
  FixedCriticAdapter,
} from './critic.js';

export { runCompletenessLens } from './completeness.js';
export type { CompletenessInput } from './completeness.js';

export { REVIEWER_INVARIANTS, runConsistencyLens } from './invariants.js';
export type { Invariant } from './invariants.js';
