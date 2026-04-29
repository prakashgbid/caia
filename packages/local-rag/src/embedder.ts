// Ollama embeddings client.
//
// Calls /api/embeddings on the local Ollama daemon and returns a Float32Array.
// We pin IPv4 explicitly (same reason as @chiefaia/local-llm-router):
// macOS resolves `localhost` to ::1 first, and a stray IPv6 listener on
// :11434 will silently route to the wrong daemon.

const DEFAULT_BASE_URL =
  process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';

const DEFAULT_KEEP_ALIVE = process.env['OLLAMA_KEEP_ALIVE'] ?? '10m';

interface OllamaEmbeddingsResponse {
  embedding: number[];
}

export interface EmbedderOptions {
  /** Ollama tag of the embedding model (default: nomic-embed-text) */
  model?: string;
  /** Override Ollama base URL */
  baseUrl?: string;
  /** Keep-alive duration; defaults to 10m so cold-load isn't paid every batch */
  keepAlive?: string;
}

export class Embedder {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly keepAlive: string;

  constructor(options: EmbedderOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.model = options.model ?? 'nomic-embed-text';
    this.keepAlive = options.keepAlive ?? DEFAULT_KEEP_ALIVE;
  }

  get modelTag(): string {
    return this.model;
  }

  /**
   * Embed a single text. Returns a Float32Array (typed for storage; we
   * persist as a BLOB in the SQLite store).
   */
  async embed(text: string): Promise<Float32Array> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
        keep_alive: this.keepAlive,
      }),
      // Embedding requests are quick once the model is warm (~20ms on M1
      // Pro for nomic-embed-text); 30s is plenty including cold load.
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Ollama embeddings ${this.model} failed (${res.status}): ${body}`,
      );
    }

    const data = (await res.json()) as OllamaEmbeddingsResponse;
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      throw new Error(
        `Ollama returned an empty embedding for model "${this.model}"`,
      );
    }
    return Float32Array.from(data.embedding);
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
