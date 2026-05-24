/**
 * @caia/state-machine — typed pipeline status manager backed by Postgres.
 *
 * Public surface. Everything else stays internal.
 *
 * The package now hosts TWO entity FSMs:
 *   1. `StateMachine` (the original project FSM, project-state-centric)
 *   2. `SolutionLifecycleMachine` (the Real Definition-of-Done FSM
 *      for the solution-lifecycle described in
 *      `research/real_definition_of_done_enforcement_2026.md`).
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

// -- EA Review Entity (per research/ea_agent_operational_framework_2026.md §7) ---
export {
  EA_REVIEW_STATES,
  EA_VALID_TRANSITIONS,
  EA_TERMINAL_STATES,
  isEaReviewState,
  isEaTerminal,
  canEaTransition,
  eaAllEdges,
  eaEventTypeFor,
  defenderIterationStateFor
} from './ea-review-entity.js';
export type { EaReviewState } from './ea-review-entity.js';

