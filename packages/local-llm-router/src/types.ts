// Core types for @chiefaia/local-llm-router

export type LLMProvider = 'local' | 'claude';

export interface LLMRequest {
  /** The logical task type used to select the routing rule */
  taskType: string;
  /** The full prompt to send to the model */
  prompt: string;
  /** Optional system prompt */
  systemPrompt?: string;
  /** Hard token limit for the response (overrides routing-config default) */
  maxTokens?: number;
  /** Temperature (0–1). Defaults to 0.2 for deterministic tasks. */
  temperature?: number;
}

export interface LLMResponse {
  /** The generated text */
  response: string;
  /** The actual model name that produced the response */
  model: string;
  /** Which provider was used */
  provider: LLMProvider;
  /** Wall-clock time in milliseconds */
  durationMs: number;
  /** Token usage, if available */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface RouterOptions {
  /** Force routing to the local Ollama model regardless of the routing rule */
  forceLocal?: boolean;
  /** Force routing to Claude API regardless of the routing rule */
  forceClaude?: boolean;
  /** If the primary provider fails, automatically retry with the other */
  fallbackOnError?: boolean;
  /**
   * Optional cache lookup. If supplied AND returns a non-null response,
   * route() returns it without dispatching to a provider. The emitted
   * span sets caia.cache_hit=true and gen_ai.system='cache'.
   *
   * This is the seam the LLM cache (and any DSPy-recompiled-cache
   * variant) uses to short-circuit the route. Keeping it as an option
   * rather than a hard dep keeps @chiefaia/local-llm-router free of
   * the cache package as a runtime requirement.
   */
  cacheLookup?: (
    taskType: string,
    prompt: string,
  ) => Promise<LLMResponse | null> | LLMResponse | null;
}

interface OllamaCommonOptions {
  temperature?: number;
  num_predict?: number;
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  stream: boolean;
  /** Go duration string ("10m", "1h", "-1" for forever). Default Ollama is 5m. */
  keep_alive?: string;
  options?: OllamaCommonOptions;
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  /** Suppress chain-of-thought emission for thinking-mode models (Qwen3). */
  think?: boolean;
  /** Go duration string for how long to keep the model loaded after this request. */
  keep_alive?: string;
  options?: OllamaCommonOptions;
}

export interface OllamaChatResponse {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ClaudeMessage[];
  temperature?: number;
}

export interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
