// embed.ts — thin wrapper around Ollama's /api/embeddings endpoint.
//
// We hard-code `nomic-embed-text` as the default since (a) it's already
// pulled on the dev box (verified via /healthz) and (b) the file index is
// embedded with the same model — querying with a different one would yield
// useless distances. The env override exists for experiment runs.

const DEFAULT_MODEL = process.env['ROUTER_RAG_EMBED_MODEL'] ?? 'nomic-embed-text';
const DEFAULT_OLLAMA_URL = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = Number(process.env['ROUTER_RAG_EMBED_TIMEOUT_MS'] ?? 15_000);

export interface EmbedOptions {
  model?: string;
  ollamaBaseUrl?: string;
  timeoutMs?: number;
}

export class EmbedError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'EmbedError';
  }
}

export async function embedOne(
  text: string,
  opts: EmbedOptions = {},
): Promise<number[]> {
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = opts.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new EmbedError(`ollama embeddings returned ${res.status}`, res.status);
  }
  const body = (await res.json()) as { embedding?: number[] };
  const v = body.embedding;
  if (!Array.isArray(v) || v.length === 0) {
    throw new EmbedError('ollama embeddings returned empty vector');
  }
  return v;
}

// Convenience for the index-builder (sequential — Ollama serializes anyway
// on a single GPU, and we want to keep the script simple).
export async function embedMany(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) out.push(await embedOne(t, opts));
  return out;
}

// Cosine similarity in [-1, 1]. Returns 0 if either vector is degenerate.
export function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
