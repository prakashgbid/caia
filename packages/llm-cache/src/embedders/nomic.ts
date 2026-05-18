// Nomic-embed-text embedder factory.
//
// P3 ADOPTION (2026-05-18, Audit v2 Section 5 #4): the raw
// `/api/embeddings` POST is now delegated to
// `@chiefaia/local-llm-router#embedText`. The cache still owns its own
// embedder-factory shape, but the wire-level Ollama call is shared with
// every other consumer in the stack.

import { embedText, type EmbedTextOptions } from '@chiefaia/local-llm-router';
import type { EmbeddingFn } from '../types.js';

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface NomicEmbedderOptions {
  /** Ollama tag. Defaults to `nomic-embed-text`. */
  model?: string;
  /** Ollama base URL. Defaults to env `OLLAMA_BASE_URL` or 127.0.0.1:11434. */
  baseUrl?: string;
  /** Per-call abort timeout in ms. Defaults to 15s. */
  timeoutMs?: number;
}

export class NomicEmbedError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'NomicEmbedError';
  }
}

/**
 * Build an `EmbeddingFn` backed by Ollama's `/api/embeddings` endpoint.
 *
 * The default 15s timeout is conservative — nomic-embed-text returns in
 * sub-100ms on warm hardware. Extending it past 30s indicates Ollama isn't
 * really available; surface that as an error rather than silently stalling
 * cache lookups.
 */
export function createNomicEmbedder(
  opts: NomicEmbedderOptions = {},
): EmbeddingFn {
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (text: string): Promise<Float32Array> => {
    const embedOpts: EmbedTextOptions = { model, timeoutMs };
    if (opts.baseUrl !== undefined) embedOpts.baseUrl = opts.baseUrl;

    let result: { vector: readonly number[]; model: string };
    try {
      result = await embedText(text, embedOpts);
    } catch (err) {
      // The shared helper throws plain Errors with descriptive messages;
      // wrap to preserve the NomicEmbedError contract callers depend on.
      // We try to recover the HTTP status from the message when present.
      const msg = (err as Error).message;
      const statusMatch = msg.match(/Embed call failed: (\d+)/);
      const status = statusMatch ? Number(statusMatch[1]) : undefined;
      throw new NomicEmbedError(
        `ollama /api/embeddings failed for model ${model}: ${msg}`,
        status,
      );
    }
    if (result.vector.length === 0) {
      throw new NomicEmbedError(
        `ollama /api/embeddings returned empty vector for model ${model}`,
      );
    }
    return Float32Array.from(result.vector);
  };
}
