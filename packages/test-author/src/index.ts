/**
 * @caia/test-author — public surface.
 *
 * Stage 10 of CAIA's canonical pipeline. The Test Author Agent reads
 * each EA-approved ticket (composed `tickets.architecture` JSONB
 * populated by the 17 specialist architects) and emits the per-story
 * `ticket.testCases` array plus `ticket.testDesign` metadata.
 *
 * Distinct from `@caia/testing-architect` (PR #565, sets strategy) and
 * `@caia/test-reviewer` (PR #573, audits the case set). This package
 * writes the cases.
 *
 * Subscription-only LLM via `@chiefaia/claude-spawner`. No API-key
 * billing.
 */

// -- Agent ----------------------------------------------------------------
export { TestAuthorAgent, AUTHOR_NAME, DEFAULT_BUDGET } from './agent.js';
export type { TestAuthorAgentConfig } from './agent.js';

// -- Orchestrator entrypoint ---------------------------------------------
export { authorTests } from './api.js';
export type { AuthorTestsConfig } from './api.js';

// -- Contract -------------------------------------------------------------
export {
  AUTHOR_AGENT_ID,
  AUTHOR_PRE_STATE,
  AUTHOR_PASS_STATE,
  AUTHOR_FAIL_INTERMEDIATE_STATE,
  AUTHOR_FAIL_STATE,
  AUTHOR_CONTRACT_ID,
  AUTHOR_OWNED_SECTIONS,
  AUTHOR_OWNED_FIELD_PATHS,
  AUTHOR_HARD_BOUNDS,
  DEFAULT_MIX_PERCENTAGES,
  MIX_AXIS_TO_LAYER,
  MIX_AXIS_TO_CATEGORY,
  TestAuthorSectionContract
} from './contract.js';
export type { AuthorSectionSpec } from './contract.js';

// -- Spawner --------------------------------------------------------------
export { createDefaultSpawner, modelTagFor, buildSpawnPrompt } from './spawner.js';
export type { AuthorSpawnerFn, AuthorSpawnInput, AuthorSpawnOutput } from './spawner.js';

// -- System prompt -------------------------------------------------------
export { buildTestAuthorSystemPrompt } from './system-prompt.js';

// -- Validation ---------------------------------------------------------
export { validateAuthorOutput, stripFences } from './validation.js';
export type { ValidationResult, ValidationError } from './validation.js';

// -- Persistence --------------------------------------------------------
export { persistAuthorOutput, InMemoryTicketStore } from './persistence.js';
export type { PersistInput, PersistOutcome } from './persistence.js';

// -- Types -------------------------------------------------------------
export type {
  AuthorBudget,
  AuthorInput,
  AuthorOutcome,
  AuthorOutput,
  AuthorOptions,
  AuthorSpend,
  AuthorTicket,
  AuthorToolCall,
  ArchitectureStore,
  FailFinalState,
  PassFinalState,
  ReviewerFeedback,
  Severity,
  StateMachineAdapter,
  TestDesign,
  TicketStore
} from './types.js';

export { DEFAULT_AUTHOR_OPTIONS } from './types.js';
