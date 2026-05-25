/**
 * @caia/devops-runtime — Stage 15. Public surface.
 *
 * `deploy()` is the single entry point; everything else is exposed for
 * advanced callers (composing strategies, custom stewards, custom
 * adapter wrappers).
 */

export { deploy } from './api.js';
export {
  ENTRY_STATE_SUCCESS,
  TARGET_STATE_SUCCESS,
  TARGET_STATE_FAILED,
  TARGET_STATE_ROLLED_BACK,
} from './api.js';

export {
  dispatchStrategy,
  preflight,
  isRuntimeDeployStrategy,
  STRATEGY_INFRA_REQUIREMENTS,
} from './runner.js';
export type { RunnerOutcome, RunnerInput } from './runner.js';

export { runBlueGreen } from './blue-green.js';
export type { BlueGreenInput } from './blue-green.js';

export { runCanary } from './canary.js';
export type { CanaryInput } from './canary.js';

export { runRolling } from './rolling.js';
export type { RollingInput } from './rolling.js';

export { runRollback } from './rollback.js';
export type { RollbackInput } from './rollback.js';

export {
  FileStewardClient,
  InMemoryStewardClient,
  findLedgerRowSync,
  DEFAULT_STEWARD_LEDGER_PATH,
  DEFAULT_POLL_OPTS,
} from './steward.js';

export {
  RuntimeStateMachine,
  RUNTIME_STATES,
  RUNTIME_TERMINAL_STATES,
  RUNTIME_VALID_TRANSITIONS,
  canRuntimeTransition,
  isRuntimeTerminal,
  InvalidRuntimeTransitionError,
} from './state.js';
export type { RuntimeStateMachineOptions } from './state.js';

export {
  RUNTIME_DEPLOY_STRATEGIES,
  TARGET_ENVIRONMENTS,
  ROLLBACK_METHODS,
} from './types.js';

export type {
  ArchitectureDevopsSlice,
  ByocAdapter,
  CapabilityIssuer,
  DeployAdapterInput,
  DeployAdapterOutput,
  DeployConfig,
  DeployEvent,
  DeployEventType,
  DeployStrategyName,
  DeploymentResult,
  DeploymentStatus,
  HealthcheckSnapshot,
  LoadedDeployTicket,
  PhaseRecord,
  PollVerificationOpts,
  RollbackMethod,
  RollbackResult,
  RuntimeState,
  RuntimeStateEvent,
  SnapshotRestoreInput,
  SolutionState,
  SolutionTransitionResult,
  SolutionTriggeredBy,
  StateTransitionOutcome,
  StewardAttestation,
  StewardClient,
  StewardLedgerRow,
  StewardVerification,
  StrategyResult,
  TargetEnv,
  TicketStore,
} from './types.js';
