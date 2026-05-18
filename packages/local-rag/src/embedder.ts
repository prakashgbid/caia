// Ollama embeddings client.
//
// P3 ADOPTION (2026-05-18, Audit v2 Section 5 #4): the raw
// `/api/embeddings` POST is now delegated to
// `@chiefaia/local-llm-router#embedText` so this package shares the
// canonical client implementation with feature-registry, llm-cache,
// dspy-bridge, and apprentice-eval. Behaviour is identical (same
// endpoint, same body shape, `keep_alive` preserved). The class shape
// is kept so existing consumers don't need to change.

import { embedText } from '@chiefaia/local-llm-router';

const DEFAULT_KEEP_ALIVE = process.env['OLLAMA_KEEP_ALIVE'] ?? '10m';

export interface EmbedderOptions {
  /** Ollama tag of the embedding model (default: nomic-embed-text) */
  model?: string;
  /** Override Ollama base URL */
  baseUrl?: string;
  /** Keep-alive duration; defaults to 10m so cold-load isn't paid every batch */
  keepAlive?: string;
}

export class Embedder {
  private readonly baseUrl: string | undefined;
  private readonly model: string;
  private readonly keepAlive: string;

  constructor(options: EmbedderOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.model = options.model ?? 'nomic-embed-text';
    this.keepAlive = options.keepAlive ?? DEFAULT_KEEP_ALIVE;
  }

  get modelTag(): string {
    return this.model;
  }

  /**
   * Embed a single text. Returns a Float32Array (typed for storage; we
   * persist as a BLOB in the SQLite store).
   *
   * Embedding requests are quick once the model is warm (~20ms on M1 Pro
   * for nomic-embed-text); 30s is plenty including cold load.
   */
  async embed(text: string): Promise<Float32Array> {
    let result: { vector: readonly number[]; model: string };
    try {
      result = await embedText(text, {
        ...(this.baseUrl !== undefined ? { baseUrl: this.baseUrl } : {}),
        model: this.model,
        timeoutMs: 30_000,
        keepAlive: this.keepAlive,
      });
    } catch (err) {
      throw new Error(
        `Ollama embeddings ${this.model} failed: ${(err as Error).message}`,
        { cause: err },
      );
    }
    if (result.vector.length === 0) {
      throw new Error(
        `Ollama returned an empty embedding for model "${this.model}"`,
      );
    }
    return Float32Array.from(result.vector);
  }

  /**
   * Embed many texts sequentially. We deliberately don't fan out: Ollama
   * serializes requests onto a single GPU slot anyway (unless
   * OLLAMA_NUM_PARALLEL is bumped daemon-side), so batching them in
   * parallel here just queues them with extra timeout pressure.
   */
  async embedBatch(
    texts: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      out.push(await this.embed(texts[i]!));
      onProgress?.(i + 1, texts.length);
    }
    return out;
  }
}
