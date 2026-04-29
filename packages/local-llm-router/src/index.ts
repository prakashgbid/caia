// Public API for @chiefaia/local-llm-router

export { route, __setAdapters, __resetBreakers, getBreakerStates, TimeoutError, BreakerOpenError } from './router.js';
export { withTimeout, withRetry, CircuitBreaker } from './resilience.js';
export type { BreakerState, BreakerOptions, RetryOptions } from './resilience.js';
export { OllamaAdapter } from './ollama-adapter.js';
export { ClaudeAdapter } from './claude-adapter.js';
export { getRoute, ROUTING_RULES, COST_ANALYSIS } from './routing-config.js';
export {
  MODEL_CATALOG,
  getModel,
  modelsByRole,
  totalRuntimeRamGB,
  M1_PRO_USABLE_MODEL_RAM_GB,
} from './model-catalog.js';
export {
  LlmMetricsTracker,
  llmMetrics,
  perCallCostFromRuleString,
} from './llm-metrics.js';
export type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  RouterOptions,
} from './types.js';

export type { RoutingRule } from './routing-config.js';
export type {
  LocalModel,
  ModelRole,
  EndpointKind,
} from './model-catalog.js';
export type {
  LlmCallRecord,
  LlmMetricsProvider,
  LlmMetricsSnapshot,
  LlmMetricsSnapshotTask,
} from './llm-metrics.js';
