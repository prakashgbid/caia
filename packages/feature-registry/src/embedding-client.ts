/**
 * @chiefaia/feature-registry — embedding client (FREG-002)
 *
 * Abstracts the embedding source so the registry can use any of:
 *   - OllamaEmbeddingClient (the default — calls localhost Ollama).
 *   - LaiEmbeddingClient (when LAI-### ships its shared embedder).
 *   - StubEmbeddingClient (deterministic fixture for tests).
 *
 * Hot-path budget: <100ms per call on M1 Pro. Uses HTTP keep-alive + an
 * in-process LRU cache (FREG-005 wires the cache in front of the client).
 */

import * as http from 'node:http';

export interface EmbedResult {
  /** Float32Array of length DEFAULT_EMBEDDING_DIM (768 for nomic-embed-text). */
  embedding: Float32Array;
  /** Local-Ollama tokens consumed. Used by dashboards to prove zero Claude tokens. */
  tokens: number;
  /** Wall-clock ms inside the embedding call (HTTP + model). */
  latencyMs: number;
}

export interface EmbeddingClient {
  embed(text: string): Promise<EmbedResult>;
  /** Optional batch path — defaults to N sequential embed() calls. */
  embedBatch(texts: string[]): Promise<EmbedResult[]>;
  /** For dashboards / smoke tests. */
  modelName(): string;
  modelDim(): number;
}

// ─── OllamaEmbeddingClient ─────────────────────────────────────────────────

export interface OllamaClientOpts {
  /** Default `http://localhost:11434`. */
  baseUrl?: string;
  /** Default `nomic-embed-text`. */
  model?: string;
  /** Default 768 — must match the model. */
  dim?: number;
  /** Default 5000ms — generous for cold starts. */
  timeoutMs?: number;
}

const DEFAULT_BASE = 'http://localhost:11434';
const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_DIM = 768;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Talks to the running Ollama daemon over HTTP keep-alive (so the TCP
 * + TLS overhead doesn't dominate the per-call budget).
 */
export class OllamaEmbeddingClient implements EmbeddingClient {
  private agent: http.Agent;
  constructor(private readonly opts: OllamaClientOpts = {}) {
    this.agent = new http.Agent({ keepAlive: true, maxSockets: 4 });
  }

  modelName(): string {
    return this.opts.model ?? DEFAULT_MODEL;
  }

  modelDim(): number {
    return this.opts.dim ?? DEFAULT_DIM;
  }

  async embed(text: string): Promise<EmbedResult> {
    const baseUrl = new URL(this.opts.baseUrl ?? DEFAULT_BASE);
    const body = JSON.stringify({
      model: this.modelName(),
      input: text,
    });
    const t0 = Date.now();
    const respJson = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          hostname: baseUrl.hostname,
          port: Number(baseUrl.port || 80),
          path: '/api/embed',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body).toString(),
          },
          agent: this.agent,
          timeout: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf-8');
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('ollama embed timeout')));
      req.write(body);
      req.end();
    });
    const latencyMs = Date.now() - t0;
    const parsed = JSON.parse(respJson) as {
      embeddings?: number[][];
      embedding?: number[];
      // newer Ollama versions return an error object on failure
      error?: string | { message: string };
      prompt_eval_count?: number;
    };
    if (parsed.error) {
      const msg =
        typeof parsed.error === 'string' ? parsed.error : parsed.error.message;
      throw new EmbedderUnavailableError(`ollama: ${msg}`);
    }
    const raw =
      parsed.embeddings && parsed.embeddings[0]
        ? parsed.embeddings[0]
        : parsed.embedding;
    if (!raw || raw.length === 0) {
      throw new EmbedderUnavailableError('ollama: empty embedding response');
    }
    if (raw.length !== this.modelDim()) {
      throw new EmbedderUnavailableError(
        `ollama: dim mismatch — expected ${this.modelDim()}, got ${raw.length}`,
      );
    }
    return {
      embedding: Float32Array.from(raw),
      tokens: parsed.prompt_eval_count ?? 0,
      latencyMs,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbedResult[]> {
    // nomic-embed-text supports an array `input` natively, but the
    // implementation gain is marginal for the registry's batch sizes
    // (1 query at search-time, ~1 row at insert-time). Keep it simple.
    const out: EmbedResult[] = [];
    for (const t of texts) {
      out.push(await this.embed(t));
    }
    return out;
  }

  /** Free the keep-alive agent. Call before process exit in long-lived hosts. */
  destroy(): void {
    this.agent.destroy();
  }
}

// ─── StubEmbeddingClient (tests) ────────────────────────────────────────────

/**
 * Deterministic embeddings for tests + benchmarks. Hashes the input
 * string into a fixed-length Float32Array; semantically meaningful
 * inputs (`'leaderboard page'` vs `'top players list'`) get distinct
 * embeddings, but identical inputs always produce identical vectors.
 */
export class StubEmbeddingClient implements EmbeddingClient {
  constructor(
    private readonly model = 'stub-embed-text',
    private readonly dim = 32,
  ) {}

  modelName(): string {
    return this.model;
  }
  modelDim(): number {
    return this.dim;
  }

  async embed(text: string): Promise<EmbedResult> {
    // Simple deterministic hash → vector. Not semantically meaningful
    // beyond input-equality, which is enough for storage tests.
    const out = new Float32Array(this.dim);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    for (let i = 0; i < this.dim; i++) {
      // Mix in i so each dim differs.
      const v = ((hash ^ (i * 2654435761)) >>> 0) / 0xffffffff;
      out[i] = v * 2 - 1;
    }
    // L2-normalize so cosine math is well-defined.
    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += out[i]! * out[i]!;
    const inv = 1 / Math.sqrt(norm || 1);
    for (let i = 0; i < this.dim; i++) out[i]! *= inv;
    return { embedding: out, tokens: text.length, latencyMs: 0 };
  }

  async embedBatch(texts: string[]): Promise<EmbedResult[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ─── Errors ────────────────────────────────────────────────────────────────

/**
 * Raised by EmbeddingClient implementations when the upstream embedder
 * is unreachable / misconfigured. PO Agent catches this and falls
 * through to `lifecycle='new'` + a `feature.classification.skipped` tag.
 */
export class EmbedderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedderUnavailableError';
  }
}
