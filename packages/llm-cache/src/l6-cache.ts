// L6 cascade-tier preset.
//
// In the canonical local-LLM-first cascade ladder (see
// `local_llm_first_canonical_2026-05-11.md`), tier L6 is "semantic cache":
// before invoking a classifier or model, check whether a near-duplicate
// prompt has been answered recently and return that. The operator-spec
// values are 0.92 cosine similarity threshold and 24h TTL — tuned to be
// aggressive enough to actually fire on autonomous-loop workloads (the
// same lint/format/triage prompts repeat dozens of times per hour with
// minor variations) while staying tight enough to avoid cross-task
// contamination.
//
// This module is purely a preset — it doesn't change the underlying
// PromptCache; it just wires it up with the L6 defaults and the
// canonical nomic-embed-text embedder. Callers who want non-L6
// behavior should construct PromptCache directly.

import { PromptCache, type PromptCacheOptions } from './cache.js';
import {
  createNomicEmbedder,
  type NomicEmbedderOptions,
} from './embedders/nomic.js';
import type { EmbeddingFn } from './types.js';

/** L6 cascade tier: 0.92 cosine threshold (operator-spec). */
export const L6_THRESHOLD = 0.92;
/** L6 cascade tier: 24h TTL (operator-spec). */
export const L6_TTL_MS = 24 * 60 * 60 * 1000;
/** L6 cascade tier: cap rows scanned per lookup. */
export const L6_MAX_ROWS_SCANNED = 5_000;

export interface L6CacheOptions {
  /** Path to the sqlite file. Use ':memory:' for ephemeral / test caches. */
  dbPath: string;
  /**
   * Override the default nomic-embed-text embedder (via Ollama). Useful
   * for tests with a mock embedder, or for callers wiring a different
   * local embedder. When omitted, an Ollama-backed nomic embedder is
   * created with default options.
   */
  embed?: EmbeddingFn;
  /**
   * Forwarded to `createNomicEmbedder` when `embed` is not provided.
   * Ignored if `embed` is supplied.
   */
  nomic?: NomicEmbedderOptions;
  /** Override the L6_TTL_MS default. */
  ttlMs?: number;
  /** Override the L6_THRESHOLD default. */
  threshold?: number;
  /** Override the L6_MAX_ROWS_SCANNED default. */
  maxRowsScanned?: number;
}

/**
 * Build a PromptCache pre-configured as cascade tier L6:
 * `nomic-embed-text` embedder, 0.92 cosine threshold, 24h TTL.
 *
 * Insertion of this cache into the local-llm-router decision path is
 * intentionally out of scope for this package — wiring lives in the
 * router under the cascade decision module, so the cache stays
 * router-agnostic and reusable.
 */
export function createL6Cache(opts: L6CacheOptions): PromptCache {
  const cacheOptions: PromptCacheOptions = {
    dbPath: opts.dbPath,
    embed: opts.embed ?? createNomicEmbedder(opts.nomic),
    semantic: {
      threshold: opts.threshold ?? L6_THRESHOLD,
      maxRowsScanned: opts.maxRowsScanned ?? L6_MAX_ROWS_SCANNED,
    },
    ttlMs: opts.ttlMs ?? L6_TTL_MS,
  };
  return new PromptCache(cacheOptions);
}
