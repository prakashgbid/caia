/**
 * @caia/state-machine — typed pipeline status manager backed by Postgres.
 *
 * Public surface. Everything else stays internal.
 */

export {
  ALL_STATES,
  HAPPY_STATES,
  FAILED_STATES,
  CONTROL_STATES,
  TERMINAL_STATES,
  isProjectState,
  isHappyState,
  isFailedState,
  isControlState,
  isTerminal,
} from './states.js';
export type {
  HappyState,
  FailedState,
  ControlState,
  ProjectState,
} from './states.js';

export {
  VALID_TRANSITIONS,
  canTransition,
  checkTransition,
  availableTransitions,
  validNextStates,
  allEdges,
  reachableTerminals,
} from './transitions.js';
export type { TransitionCheck } from './transitions.js';

export {
  InvalidTransitionError,
  StaleProjectVersionError,
  ProjectNotFoundError,
  AdvisoryLockHeldError,
  TicketAlreadyClaimedError,
  TransitionRetryExhaustedError,
} from './errors.js';

export { hashPayload } from './hash.js';

export { StateMachine } from './state-machine.js';
export type { ProjectEvent, TicketEvent } from './state-machine.js';

export { InMemoryStateStore } from './in-memory-store.js';
export { PgStateStore } from './pg-store.js';
export type { PgStateStoreOptions } from './pg-store.js';

export type {
  StateStore,
  TransitionAtomicInput,
  TransitionAtomicResult,
} from './store.js';

export type {
  ActorKind,
  ClaimResult,
  JanitorResult,
  NewProjectInput,
  ProjectRow,
  StateMachineOptions,
  StateTransitionRow,
  TransitionOpts,
  TransitionResult,
  TriggeredBy,
} from './types.js';

export { handleProjectSse, SseConnection } from './realtime.js';
export type { SseHandlerOptions } from './realtime.js';

export { whatsNext, resumePoint } from './whats-next.js';
export type {
  AgentSpec,
  ResumePoint,
  WaitingReason,
  WhatsNextResult,
} from './whats-next.js';
