// Nomic-embed-text embedder factory.
//
// Returns an EmbeddingFn that hits a local Ollama instance at
// `/api/embeddings`. The cache stays embedder-agnostic — this is just one
// concrete implementation, kept in-package because nomic + ollama is the
// canonical local pairing across the CAIA stack (mirrors the router's
// rag/embed.ts but without that package's internals leaking into the cache).

import type { EmbeddingFn } from '../types.js';

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
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
  const baseUrl =
    opts.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? DEFAULT_BASE_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (text: string): Promise<Float32Array> => {
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new NomicEmbedError(
        `ollama /api/embeddings returned ${res.status} for model ${model}`,
        res.status,
      );
    }
    const body = (await res.json()) as { embedding?: number[] };
    const v = body.embedding;
    if (!Array.isArray(v) || v.length === 0) {
      throw new NomicEmbedError(
        `ollama /api/embeddings returned empty vector for model ${model}`,
      );
    }
    return Float32Array.from(v);
  };
}
