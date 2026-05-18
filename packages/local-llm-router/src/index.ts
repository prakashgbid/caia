// Public API for @chiefaia/local-llm-router

export { route, __setAdapters } from './router.js';
export {
  classifyV2,
  loadRoutingRules,
  parseRoutingRulesYaml,
  parseClassifierV2Output,
  keywordPrepass,
  nextTier,
  intentRule,
  CLASSIFIER_V2_SYSTEM_PROMPT,
  __resetRulesCache,
} from './classifier-v2.js';
export type {
  IntentRule,
  IntentResultV2,
  RoutingRules,
  ClassifyV2Options,
} from './classifier-v2.js';
export { OllamaAdapter } from './ollama-adapter.js';
export {
  sanitizeUserInput,
  buildClassifierUserMessage,
} from './prompt-template.js';
export {
  ClaudeAdapter,
  ClaudeBinaryError,
  ClaudeRateLimitedError,
} from './claude-adapter.js';
export type { ClaudeAdapterOptions } from './claude-adapter.js';
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
// OTel obs-002 exports
export { __setTracer, CAIA_ATTR, GEN_AI, genAiSystemFor, getTracer, initRouterOtel, withSpan } from "./otel.js";
export type { GenAiSystem, InitOtelOptions, OtelHandle, RouteDecision, SpanContext } from "./otel.js";
export type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  OptimizerMetrics,
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

// P3 Adoption Audit v2 Section 5 #4 — canonical Ollama embeddings client
// for the CAIA stack. Consumers downstream of librarian/mentor-retrieval
// should adopt this rather than rolling their own /api/embeddings POST.
export {
  embedText,
  DEFAULT_OLLAMA_URL as EMBED_DEFAULT_OLLAMA_URL,
  DEFAULT_EMBED_MODEL,
} from './embed-client.js';
export type { EmbedTextOptions, EmbedTextResult } from './embed-client.js';
