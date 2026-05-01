/**
 * @chiefaia/capability-broker — public surface.
 */

export * from './types.js';
export * from './signing.js';
export * from './registry.js';
export * from './ledger.js';
export {
  CapabilityBroker,
  CapabilityBrokerError,
  type BrokerOptions,
  type BrokerDecision,
  type BrokerClock,
} from './broker.js';
export {
  CapabilityExecutor,
  type CapabilityHandler,
  type ExecutorOptions,
  type HandlerContext,
} from './executor.js';
export {
  assertCapabilityForCommand,
  guardContextFromTokens,
  CapabilityGuardError,
  DEFAULT_GUARD_RULES,
  type GuardRule,
  type GuardContext,
} from './runtime-guard.js';
export {
  IrreversibleDelay,
  type IrreversibleDelayEvent,
  type IrreversibleDelayListener,
  type IrreversibleDelayOptions,
} from './irreversible-delay.js';
export {
  HookControlledMode,
  type HookPreToolUseInput,
  type HookPreToolUseOutput,
  type HookPostToolUseInput,
  type HookPostToolUseOutput,
  type HookControlledOptions,
} from './hook-controlled.js';
export {
  BrokerSocketServer,
  type BrokerSocketServerOptions,
  type BrokerWireFrame,
} from './socket-server.js';
export {
  callBrokerSocket,
  type BrokerSocketClientOptions,
  type BrokerSocketClientFailure,
} from './socket-client.js';
export { CapabilityBrokerMetrics } from './metrics.js';
