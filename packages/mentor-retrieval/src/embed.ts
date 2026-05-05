/**
 * Ollama embedder for Mentor Phase-3.
 *
 * Hits the local Ollama HTTP server's `/api/embeddings` endpoint with
 * the configured model (default: `nomic-embed-text`). Returns a Float32
 * vector wrapped with the echo'd model id.
 *
 * Subscription mandate: this is the only LLM-calling code Phase-3 PR-1
 * adds, and it talks exclusively to a local Ollama daemon — zero
 * marginal cost, zero API-key billing.
 *
 * Hard requirements:
 *   - Network calls go to a localhost-style URL by default. Caller can
 *     override with OLLAMA_URL env var.
 *   - All errors are wrapped with `cause: e` so the eslint
 *     `preserve-caught-error` rule is satisfied (recurring lesson from
 *     leg-5 + leg-6).
 *   - Response shape is validated — Ollama returns `{ embedding: number[] }`,
 *     and any deviation throws synchronously rather than producing a
 *     malformed Float32Array silently.
 */

import type { EmbedResult, Embedder } from './types.js';

/** Default Ollama HTTP endpoint (the daemon listens on 11434 by default). */
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/** Default embedding model. nomic-embed-text returns 768-dim vectors. */
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';

export interface OllamaEmbedderOptions {
  /** Base URL of the Ollama HTTP server. */
  url?: string;
  /** Model to use. Must be pulled in advance via `ollama pull <model>`. */
  model?: string;
  /** Total request timeout in ms. Default 30s. */
  timeoutMs?: number;
  /**
   * Override the global `fetch` for tests. Production passes the
   * runtime's built-in fetch.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Build an `Embedder` closure bound to a specific Ollama URL + model.
 * Returns a function the caller invokes per text-to-embed.
 */
export function createOllamaEmbedder(opts: OllamaEmbedderOptions = {}): Embedder {
  const url = opts.url ?? DEFAULT_OLLAMA_URL;
  const model = opts.model ?? DEFAULT_EMBED_MODEL;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return async (text: string): Promise<EmbedResult> => {
    const endpoint = `${url.replace(/\/$/, '')}/api/embeddings`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let resp: Response;
    try {
      resp = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(`ollama embed request failed (${endpoint})`, { cause: e });
    }
    clearTimeout(timer);

    if (!resp.ok) {
      const bodyText = await safeReadBody(resp);
      throw new Error(
        `ollama embed http ${resp.status} ${resp.statusText}: ${bodyText}`
      );
    }

    let parsed: unknown;
    try {
      parsed = await resp.json();
    } catch (e) {
      throw new Error('ollama embed response was not valid JSON', { cause: e });
    }

    const vec = extractEmbedding(parsed);
    return { vector: vec, model };
  };
}

/**
 * Safely extract `embedding: number[]` from an Ollama response object.
 * Throws a descriptive error on any shape mismatch.
 */
export function extractEmbedding(parsed: unknown): Float32Array {
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('ollama embed response was not an object');
  }
  const obj = parsed as Record<string, unknown>;
  const raw = obj['embedding'];
  if (!Array.isArray(raw)) {
    throw new Error(
      'ollama embed response missing required `embedding` array field'
    );
  }
  if (raw.length === 0) {
    throw new Error('ollama embed response returned an empty embedding');
  }
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(
        `ollama embed returned non-finite value at index ${i} (got ${typeof v})`
      );
    }
    out[i] = v;
  }
  return out;
}

/**
 * Convert a Float32Array to a Buffer with little-endian layout, suitable
 * for storing in a SQLite BLOB column.
 */
export function vectorToBlob(v: Float32Array): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) {
    buf.writeFloatLE(v[i] ?? 0, i * 4);
  }
  return buf;
}

/** Inverse of `vectorToBlob`. */
export function blobToVector(b: Buffer, dim: number): Float32Array {
  if (b.length !== dim * 4) {
    throw new Error(
      `embedding blob length ${b.length} does not match dim ${dim} (expected ${dim * 4})`
    );
  }
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = b.readFloatLE(i * 4);
  }
  return out;
}

/** Best-effort body read for error reporting; never throws. */
async function safeReadBody(resp: Response): Promise<string> {
  try {
    const t = await resp.text();
    return t.slice(0, 500);
  } catch {
    return '<could not read body>';
  }
}
