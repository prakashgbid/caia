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
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
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
