/**
 * @caia/ea-dispatcher — public surface.
 */

export { Dispatcher, dispatch, DISPATCHER_AGENT_ID } from './dispatcher.js';
export type { DispatcherDeps } from './dispatcher.js';

export type {
  DispatchInput,
  DispatchResult,
  DispatcherOptions,
  DispatchTelemetry,
  ArchitectCallRecord,
  ConflictRecord,
  StateMachineAdapter,
  ArchitectInvoker,
  TelemetrySink,
  Clock,
} from './types.js';
export { DEFAULT_DISPATCHER_OPTIONS } from './types.js';

export {
  composeArchitectOutputs,
  composeArchitectOutputsLenient,
  CompositionError,
} from './composer.js';
export type { ComposeResult, ComposeCollision } from './composer.js';

export {
  SEMANTIC_CONFLICT_RULES,
  detectConflicts,
  getPath,
} from './conflict-rules.js';
export type { SemanticConflictRule, FiredRule } from './conflict-rules.js';

export {
  resolveConflicts,
  annotateDissent,
  fieldBelongsTo,
  winnerOf,
} from './precedence-resolver.js';

export { partitionByApplies, selectByName } from './applies.js';
export type { AppliesPartition } from './applies.js';

export {
  DefaultArchitectInvoker,
  InMemoryTelemetrySink,
  NoopStateMachine,
  SystemClock,
  FrozenClock,
} from './invoker.js';
