// embed.ts — thin wrapper around Ollama's /api/embeddings endpoint.
//
// P3 ADOPTION (2026-05-18, Audit v2 Section 5 #4): the wire-level POST is
// now delegated to `../embed-client.js#embedText` so this internal helper
// shares the canonical implementation with downstream consumers
// (feature-registry, llm-cache, local-rag). The exported function shape
// (`embedOne`, `embedMany`, `cosineSim`) is kept so the existing internal
// callers don't need to change.

import { embedText } from '../embed-client.js';

const DEFAULT_MODEL = process.env['ROUTER_RAG_EMBED_MODEL'] ?? 'nomic-embed-text';
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
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let result: { vector: readonly number[]; model: string };
  try {
    result = await embedText(text, {
      model,
      timeoutMs,
      ...(opts.ollamaBaseUrl !== undefined ? { baseUrl: opts.ollamaBaseUrl } : {}),
    });
  } catch (err) {
    const msg = (err as Error).message;
    const statusMatch = msg.match(/Embed call failed: (\d+)/);
    const status = statusMatch ? Number(statusMatch[1]) : undefined;
    throw new EmbedError(
      `ollama embeddings failed: ${msg}`,
      status,
    );
  }
  if (result.vector.length === 0) {
    throw new EmbedError('ollama embeddings returned empty vector');
  }
  return Array.from(result.vector);
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
