/**
 * @chiefaia/spend-guard — public surface.
 */

export {
  SpendCapScopeSchema,
  SpendCapSchema,
  SpendRecordSchema,
  SpendViaSchema,
  ModelCostSchema,
  AccountStateSchema,
  AccountPoolModeSchema,
  DEFAULT_MODEL_COSTS,
  DEFAULT_CAPS_USD,
  type SpendCapScope,
  type SpendCap,
  type SpendRecord,
  type SpendVia,
  type ModelCost,
  type AccountState,
  type AccountPoolMode,
} from './types.js';
export {
  computeCostUsd,
  estimateRequestCostUsd,
  type UsageBlock,
} from './cost.js';
export {
  type CapStore,
  InMemoryCapStore,
} from './cap-store.js';
export {
  SpendGuard,
  BudgetExceededError,
  InMemoryRecordSink,
  type PauseState,
  type SpendGuardOptions,
  type SpendRecordSink,
} from './spend-guard.js';
export {
  AccountPool,
  type AccountPoolOptions,
  type RouteDecision,
} from './account-pool.js';
