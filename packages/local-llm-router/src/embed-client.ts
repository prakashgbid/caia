/**
 * Canonical Ollama-embeddings client for the CAIA stack.
 *
 * Lifted from the ad-hoc `/api/embeddings` POSTs that were duplicated
 * across feature-registry, dspy-bridge, llm-cache, local-rag, apprentice-eval,
 * and apps/orchestrator/scripts (P3 Adoption Audit v2 Section 5 #4).
 * Consumer sites that don't have an upstream-dep cycle with
 * @chiefaia/local-llm-router should adopt this helper rather than rolling
 * their own fetch loop.
 *
 * `embedText()` posts to the configured Ollama daemon's `/api/embeddings`
 * endpoint and returns the raw `number[]` vector + the model name the
 * daemon echoed back. Callers that want a `Float32Array` should wrap the
 * return value themselves (kept out of this helper so it stays trivial to
 * stub in tests).
 *
 * NOTE on the librarian / mentor-retrieval circular case:
 *   @chiefaia/local-llm-router already depends on @chiefaia/librarian +
 *   @chiefaia/mentor-retrieval (see package.json). Those two packages
 *   therefore cannot import from this module without forming a cycle.
 *   Their own embed.ts modules (`packages/librarian/src/embed.ts`,
 *   `packages/mentor-retrieval/src/embed.ts`) remain the canonical
 *   primitive implementations for that tier — this helper mirrors their
 *   contract so consumers downstream of either tier see identical
 *   behaviour. A future PR may invert the dep edge so this helper
 *   becomes the single source of truth across the whole repo; that's
 *   out of scope here.
 */

/** Default Ollama HTTP endpoint. The daemon listens on 11434 by default;
 *  we pin IPv4 explicitly because macOS resolves `localhost` to ::1 first
 *  and a stray IPv6 listener silently routes to the wrong daemon. Same
 *  reasoning as in `ollama-adapter.ts` and the leaf-package embedders. */
export const DEFAULT_OLLAMA_URL =
  process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';

/** Default embedding model. `nomic-embed-text` returns 768-dim vectors;
 *  used as the canonical default across librarian, mentor-retrieval,
 *  llm-cache, local-rag, feature-registry — kept aligned here. */
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';

/** Default per-call wall-clock timeout. 5s is the median of what the
 *  consumer sites used pre-consolidation (some used 5s, some 15s, some
 *  unbounded). Keep it short — embeddings should be fast; if the daemon
 *  is slow that's a signal worth propagating, not absorbing. */
const DEFAULT_TIMEOUT_MS = 5_000;

export interface EmbedTextOptions {
  /** Override the Ollama HTTP base URL. */
  baseUrl?: string;
  /** Override the embedding model. */
  model?: string;
  /** Per-call wall-clock timeout (ms). */
  timeoutMs?: number;
  /** Ollama `keep_alive` parameter (string like '10m' or seconds as number).
   *  Default: unset (Ollama uses its daemon-wide default). Set this to keep
   *  the embedding model warm between calls; matches the contract of the
   *  pre-consolidation per-package embedders that exposed this option. */
  keepAlive?: string | number;
  /** Test seam — replace `fetch`. */
  fetchFn?: typeof fetch;
}

export interface EmbedTextResult {
  /** The raw embedding vector. Callers that want Float32Array should
   *  wrap themselves (Float32Array.from(result.vector)). */
  readonly vector: readonly number[];
  /** The model the daemon used (echoed back from the request). */
  readonly model: string;
}

/**
 * Ollama HTTP `/api/embeddings` POST body shape (well-defined; the daemon
 * accepts both `{ model, prompt }` and the OpenAI-compatible
 * `{ model, input }` variants but we standardise on the native shape
 * since that's what every consumer site we're consolidating uses).
 */
interface OllamaEmbeddingsRequest {
  model: string;
  prompt: string;
  keep_alive?: string | number;
}

interface OllamaEmbeddingsResponse {
  embedding?: number[];
}

/**
 * Embed `text` using the local Ollama daemon.
 *
 * Throws on:
 *   - HTTP non-2xx (`Embed call failed: <status> <body>`)
 *   - missing `embedding` field in the JSON response
 *   - request timeout (AbortError surfaced as `Embed call timed out after Nms`)
 *
 * Every thrown Error carries the original `cause` so eslint's
 * `preserve-caught-error` rule is satisfied.
 */
export async function embedText(
  text: string,
  opts: EmbedTextOptions = {},
): Promise<EmbedTextResult> {
  const baseUrl = (opts.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, '');
  const model = opts.model ?? DEFAULT_EMBED_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchFn ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    const body: OllamaEmbeddingsRequest = { model, prompt: text };
    if (opts.keepAlive !== undefined) body.keep_alive = opts.keepAlive;
    res = await fetchImpl(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Embed call timed out after ${timeoutMs}ms`, { cause: e });
    }
    throw new Error(
      `Embed call to ${baseUrl}/api/embeddings failed: ${(e as Error).message}`,
      { cause: e },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Embed call failed: ${res.status} ${text.slice(0, 200)}`);
  }

  let json: OllamaEmbeddingsResponse;
  try {
    json = (await res.json()) as OllamaEmbeddingsResponse;
  } catch (e) {
    throw new Error(`Embed response parse failed: ${(e as Error).message}`, { cause: e });
  }

  if (!json.embedding || !Array.isArray(json.embedding)) {
    throw new Error(
      `Embed response missing 'embedding' field (got keys: ${Object.keys(json).join(',') || '<none>'})`,
    );
  }

  return { vector: json.embedding, model };
}
