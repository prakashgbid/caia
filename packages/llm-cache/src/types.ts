// Core types for @chiefaia/llm-cache

/**
 * Pluggable embedding backend. Caller provides the embedding function;
 * we don't depend on Ollama (or any specific transport) directly so this
 * package stays independent of @chiefaia/local-rag (which provides one)
 * and @chiefaia/local-llm-router.
 */
export interface EmbeddingFn {
  (text: string): Promise<Float32Array>;
}

/**
 * The minimum shape we cache. Mirrors @chiefaia/local-llm-router's
 * LLMResponse but we don't import that package — keeping deps one-way.
 */
export interface CachedResponse {
  response: string;
  model: string;
  /** 'local' | 'claude' — kept as string so we don't pin to that enum */
  provider: string;
  /** Original wall-clock ms of the call we're caching */
  durationMs: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface CacheLookupKey {
  /** Logical bucket (e.g. taskType from the router); namespaces the cache. */
  namespace: string;
  /** Model tag the response was produced by; namespaces alongside namespace. */
  model: string;
  /** Optional system prompt (folded into the exact-match hash). */
  systemPrompt?: string;
  /** The user prompt being looked up. */
  prompt: string;
}

export interface CacheHit {
  /** 'exact' (hash match) or 'semantic' (cosine similarity match) */
  kind: 'exact' | 'semantic';
  /** The cached value */
  value: CachedResponse;
  /** Cosine similarity for semantic hits; 1 for exact. */
  similarity: number;
  /** When the entry was created (epoch ms). */
  createdAt: number;
}

export interface SemanticCacheOptions {
  /**
   * Minimum cosine similarity to count as a semantic hit. Research
   * suggests 0.95 is a production-safe default — false positives are
   * near-zero and ~25-30% blended hit rate on representative workloads.
   */
  threshold?: number;
  /**
   * Hard ceiling on rows scanned per lookup. We do brute-force cosine; for
   * a typical orchestrator workload this is fine, but a runaway insertion
   * pattern (millions of rows) needs a guardrail.
   */
  maxRowsScanned?: number;
}

export interface CacheStats {
  exactHits: number;
  semanticHits: number;
  misses: number;
  /** Total entries currently stored. */
  size: number;
}
