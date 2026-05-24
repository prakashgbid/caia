/**
 * @caia/state-machine — typed pipeline status manager backed by Postgres.
 *
 * Public surface. Everything else stays internal.
 *
 * The package now hosts THREE entity FSMs:
 *   1. `StateMachine` (the original project FSM, project-state-centric)
 *   2. EA Review Entity (per research/ea_agent_operational_framework_2026.md §7)
 *   3. `SolutionLifecycleMachine` (the Real Definition-of-Done FSM
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

// -- Solution-lifecycle (Real Definition-of-Done) ----------------------

export {
  ALL_SOLUTION_STATES,
  SOLUTION_FORWARD_STATES,
  SOLUTION_FAILED_STATES,
  SOLUTION_ROLLED_BACK_STATES,
  SOLUTION_CONTROL_STATES,
  SOLUTION_TERMINAL_STATES,
  SOLUTION_INITIAL_STATE,
  SOLUTION_STATE_CANONICAL_SYNONYM,
  DEFAULT_STUCK_THRESHOLDS_HOURS,
  FAILED_OF,
  ROLLED_BACK_OF,
  FORWARD_OF_FAILED,
  FORWARD_OF_ROLLED_BACK,
  isSolutionState,
  isSolutionForwardState,
  isSolutionFailedState,
  isSolutionRolledBackState,
  isSolutionControlState,
  isSolutionTerminal,
} from './entities/solution-states.js';
export type {
  SolutionState,
  SolutionForwardState,
  SolutionFailedState,
  SolutionRolledBackState,
  SolutionControlState,
} from './entities/solution-states.js';

export {
  VALID_SOLUTION_TRANSITIONS,
  canSolutionTransition,
  checkSolutionTransition,
  availableSolutionTransitions,
  validNextSolutionStates,
  allSolutionEdges,
} from './entities/solution-transitions.js';
export type { SolutionTransitionCheck } from './entities/solution-transitions.js';

export {
  DuplicateSolutionIdError,
  InvalidSolutionTransitionError,
  SolutionNotFoundError,
  StaleSolutionVersionError,
  SolutionTransitionRetryExhaustedError,
} from './entities/solution-errors.js';

export { SolutionLifecycleMachine } from './entities/solution.js';
export type {
  SolutionEventHandler,
  SolutionAdvancedNotifyPayload,
} from './entities/solution.js';

export { InMemorySolutionStore } from './entities/in-memory-solution-store.js';
export { PgSolutionStore } from './entities/pg-solution-store.js';
export type { PgSolutionStoreOptions } from './entities/pg-solution-store.js';

export type {
  SolutionStore,
  SolutionAdvanceAtomicInput,
  SolutionAdvanceAtomicResult,
  ListStuckOpts,
} from './entities/solution-store.js';

export type {
  ApprovedPlanInput,
  RegisteredSolution,
  SolutionRow,
  SolutionTransitionOpts,
  SolutionTransitionResult,
  SolutionHistoryRow,
  SolutionLifecycleSnapshot,
  StuckSolution,
  SolutionMachineOptions,
  SolutionEvent,
  SolutionActorKind,
  SolutionTriggeredBy,
  StewardAttestation,
} from './entities/solution-types.js';
