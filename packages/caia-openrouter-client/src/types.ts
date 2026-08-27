/**
 * Types for the CAIA OpenRouter client — the single choke point for every
 * AI/LLM call in CAIA per [[openrouter-only]] memory rule.
 *
 * Every AI call site (Interviewer, Research, Startup Package generator,
 * MVP Scope planner, Click-through generator, CAIA orchestrator itself)
 * calls `callOpenRouter(opts)` with an ORCallOptions. The client resolves
 * the right API key (per tenant, BYOK-first per [[byok-first-ai]]), picks
 * a model tier, retries with a fallback ladder on 429/5xx, tracks cost +
 * latency, and returns a normalized ORCallResult.
 */

/**
 * Purpose label used for audit and observability. Convention:
 * `<stage>.<step>` — e.g. 'interview.question', 'research.market',
 * 'startup-package.summary', 'mvp-scope.slice-selector'.
 */
export type ORPurpose = string;

/**
 * Model selection strategy.
 *
 * - `'free'`   — walk the free-tier ladder in order. Zero marginal cost.
 * - `'auto'`   — pick a paid tier based on task complexity heuristics.
 * - `<string>` — pin an explicit OpenRouter model id.
 */
export type ORModelSelection = 'free' | 'auto' | string;

export type ORResponseFormat = 'text' | 'json';

export interface ORCallOptions {
  /** Audit label. Required. */
  purpose: ORPurpose;
  /** Model selection strategy. Defaults to 'free'. */
  model?: ORModelSelection;
  /** Tenant id for BYOK key resolution + audit. */
  tenantId?: string | null;
  /** Optional system prompt prepended as role:system. */
  systemPrompt?: string;
  /** The user message. Required. */
  userPrompt: string;
  /** Max tokens for the response. Defaults to 1024. */
  maxTokens?: number;
  /**
   * Response format. 'json' sets response_format on the API call. The client
   * also extracts JSON from fenced blocks / brace-matched substrings before
   * parsing (models sometimes ignore response_format).
   */
  responseFormat?: ORResponseFormat;
  /** Overall timeout for this call. Defaults to 60_000ms. */
  timeoutMs?: number;
  /** If true, adds HTTP-Referer + X-Title headers. Defaults to true. */
  attributeTraffic?: boolean;
  /**
   * If provided, this task_type is used to pick a preferred model from
   * FREE_TIER_TASK_MAP (or PAID_TIER_TASK_MAP when model=auto). Ignored
   * when model is an explicit model id.
   */
  taskType?: 'reasoning' | 'code_gen' | 'code_review' | 'summarize' | 'json_extract' | 'long_context' | 'fast_chat' | 'safety_check';
  /**
   * Session-model stickiness. When set, this model is tried first (before
   * any other selection logic) so a multi-turn conversation stays with the
   * same model that answered turn 1, keeping tone/style consistent. Only
   * falls through the ladder if the sticky model is currently down.
   *
   * The caller reads `result.model` from turn 1 and passes it back as
   * `stickyModel` on turn 2+. Simple, stateless, works across restarts.
   */
  stickyModel?: string;
  /**
   * If true, includes a paid guarantee model as the last fallback slot
   * (never a free model). Reliability > cost. Defaults to true.
   * Set false for interior orchestrator calls where a 502 is fine to
   * bubble up and the caller retries later.
   */
  paidFallback?: boolean;
}

export interface ORCallSuccess {
  ok: true;
  model: string;
  text: string;
  json?: unknown;
  costUsd: number;
  latencyMs: number;
  responseId: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  attempts: number;
}

export interface ORCallFailure {
  ok: false;
  error: string;
  retryable: boolean;
  modelsAttempted: string[];
  latencyMs: number;
  attempts: number;
}

export type ORCallResult = ORCallSuccess | ORCallFailure;

/**
 * Resolves the API key for a request. Called once per callOpenRouter().
 * Default implementation reads env `OPENROUTER_API_KEY`. Production
 * should look up BYOK keys from the tenant record (Vault-backed) and
 * fall back to the CAIA-provided env key.
 */
export type KeyResolver = (tenantId: string | null | undefined) => Promise<string> | string;
