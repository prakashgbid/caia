/**
 * `@caia/atlas-prompt-router` — public entry point.
 */

export { createRouter } from './router.js';

export {
  createAtlasPromptApiHandler,
  statusForKind,
  type ApiHandlerErrorBody,
  type ApiHandlerRequest,
  type ApiHandlerResponse,
  type AtlasPromptApiHandler,
} from './api.js';

export {
  validateBody,
  asAtlasSubmitPromptRequest,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_MIN_PROMPT_CHARS,
  DEFAULT_MAX_SELECTION,
  DEFAULT_MAX_TICKET_ID_CHARS,
  DEFAULT_MAX_PROMPT_GROUP_ID_CHARS,
  type ValidatedBody,
  type ValidationFailure,
  type ValidationResult,
} from './validation.js';

export {
  makeHeuristicClassifier,
  makeClaudeIntentClassifier,
  makeClaudeExpectedChangeWriter,
  makeNoopExpectedChangeWriter,
  parseScopeClassification,
  type LlmInvoker,
} from './scope-resolver.js';

export {
  systemClock,
  frozenClockFrom,
  steppingClockFrom,
  type Clock,
} from './clock.js';

export { counterIdGen, randomIdGen, type IdGen } from './id.js';

export type {
  AtlasPromptRouter,
  AtlasSubmitPromptRequest,
  AtlasSubmitPromptResponse,
  DispatcherPort,
  DispatchInput,
  DispatchResult,
  ExpectedChangeWriter,
  ExpectedChangeWriterInput,
  IntentClassifier,
  IntentClassifierInput,
  MapperPort,
  MapperTicket,
  RouterDeps,
  RouterErrorDetail,
  RouterErrorKind,
  RouterOptions,
  ScopeClassification,
  ScopeKind,
  StateMachinePort,
  SubmitPromptInput,
  TicketState,
  TicketTransitionInput,
  TicketVersionInsert,
  TriggeredByOperator,
  VersionStorePort,
} from './types.js';

export { RouterError } from './types.js';
