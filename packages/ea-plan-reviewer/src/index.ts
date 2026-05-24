/**
 * @caia/ea-plan-reviewer — public surface.
 *
 * Primary EA review sub-agent. Reads a submitted plan against the EA
 * Repository, iterates with the @caia/plan-defender via the Coordinator-
 * supplied spawner, and emits a structured PlanReviewVerdict.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §4.2.
 */

export { EaPlanReviewer } from './reviewer.js';

export type {
  PlanReviewerInput,
  PlanReviewVerdict,
  PlanReviewerConfig,
  RoundOneInput,
  RoundOneOutput,
  RoundOneReviewerAdapter,
  VerdictRefinerInput,
  VerdictRefinerOutput,
  VerdictRefinerAdapter
} from './types.js';

export {
  PLAN_REVIEWER_MULTI_TURN_INSTRUCTIONS,
  buildPlanReviewerSystemPrompt
} from './system-prompt.js';

export {
  createCriticBackedRoundOne,
  StubRoundOneAdapter,
  type CriticBackedRoundOneConfig
} from './round-one-adapter.js';

export {
  HeuristicVerdictRefiner,
  StubVerdictRefiner
} from './verdict-refiner.js';
