/**
 * Librarian Phase-1 retrieval — query a built precedent index for the
 * top-N rows most relevant to a given prompt.
 *
 * Algorithm:
 *
 *   1. Embed the prompt via the same Embedder used at build time
 *      (Ollama nomic-embed-text by default; subscription-only).
 *   2. Open the index DB read-only.
 *   3. Scan every row (or every row matching the kind filter), decode
 *      its Float32 BLOB, compute cosine similarity against the query.
 *   4. Filter rows whose similarity is below the configured threshold.
 *   5. Sort by similarity desc (tiebreak by mtime desc), take top N,
 *      return.
 *
 * The scan is intentionally JS-side (no sqlite-vec extension): at the
 * scale this serves (≈200 rows today, plausibly 1000+ in a year) the
 * scan runs in <5 ms, and avoiding a native binary dependency keeps
 * cross-platform install simple.
 *
 * Dimensional safety: rows whose `embeddingDim` doesn't match the
 * query's are skipped (logged once via the optional warn callback) so a
 * model migration doesn't crash retrieval — old rows just don't match
 * until a rebuild.
 */

import { blobToVector } from './embed.js';
import { openIndexStore } from './index-store.js';
import type {
  Embedder,
  IndexedPrecedent,
  PrecedentKind
} from './types.js';

/** Default top-N for `retrievePrecedent`. */
export const DEFAULT_TOP_N = 5;

/**
 * Default minimum cosine similarity. Below this, a result is too weak
 * to be worth showing the spawned agent. nomic-embed-text on technical
 * markdown text typically lands "clearly relevant" matches in 0.55-0.85
 * and unrelated content under 0.30; 0.4 is a deliberately conservative
 * floor so we err toward false-positives over false-negatives at v0.
 */
export const DEFAULT_MIN_SIMILARITY = 0.4;

export interface RetrievedPrecedent {
  /** Source path on disk. */
  path: string;
  /** Classification kind. */
  kind: PrecedentKind;
  /** Human-readable identifier (filename minus extension). */
  slug: string;
  /** Cosine similarity in [-1, 1]; in practice [0, 1] for nomic. */
  similarity: number;
  /** First ≤4 KB of the source content, for the agent to read. */
  snippet: string;
  /** Modified time of the source, for tiebreak / reporting. */
  mtimeMs: number;
}

export interface RetrievePrecedentOptions {
  /** Same memoryDir as the builder. */
  memoryDir: string;
  /** Override the index DB path entirely. */
  dbPath?: string;
  /** Embedder for the query. Production passes createOllamaEmbedder. */
  embed: Embedder;
  /** Maximum results to return. Defaults to DEFAULT_TOP_N. */
  topN?: number;
  /** Minimum cosine similarity. Defaults to DEFAULT_MIN_SIMILARITY. */
  minSimilarity?: number;
  /**
   * Optional kind filter. Single kind OR list of kinds. When set, only
   * matching rows are scored.
   */
  kindFilter?: PrecedentKind | PrecedentKind[];
  /**
   * Optional warn sink for non-fatal anomalies (dim mismatch, etc.).
   * Defaults to a no-op so production callers don't get noise.
   */
  warn?: (msg: string) => void;
}

/**
 * Compute cosine similarity between two Float32 vectors.
 *
 * Defensive against NaNs (returns 0 if either norm is 0) and dim
 * mismatch (throws — that's a programmer error, not a data anomaly).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity dim mismatch: a=${a.length} b=${b.length}`
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Retrieve the top-N precedent rows most similar to the given prompt.
 *
 * Returns an empty array if the index doesn't exist yet — that's the
 * graceful "no precedent indexed yet" path. Callers can treat empty as
 * "nothing to inject".
 */
export async function retrievePrecedent(
  prompt: string,
  opts: RetrievePrecedentOptions
): Promise<RetrievedPrecedent[]> {
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const minSim = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const warn = opts.warn ?? ((_m: string) => undefined);
  const kindFilterSet = normalizeKindFilter(opts.kindFilter);

  const queryRes = await opts.embed(prompt);
  const queryVec = queryRes.vector;

  let rows: IndexedPrecedent[];
  try {
    const storeOpts: { memoryDir: string; readonly: true; dbPath?: string } = {
      memoryDir: opts.memoryDir,
      readonly: true
    };
    if (opts.dbPath !== undefined) storeOpts.dbPath = opts.dbPath;
    const store = openIndexStore(storeOpts);
    try {
      rows = store.listAll();
    } finally {
      store.close();
    }
  } catch (e) {
    // Most common cause: index not built yet (DB doesn't exist).
    // Treat as graceful empty result rather than a hard failure.
    warn(
      `librarian-retrieve: could not open index at memoryDir=${opts.memoryDir}: ${describeError(e)}`
    );
    return [];
  }

  if (rows.length === 0) return [];

  let dimWarnedFor = 0;
  const scored: RetrievedPrecedent[] = [];
  for (const row of rows) {
    if (kindFilterSet !== null && !kindFilterSet.has(row.kind)) continue;
    if (row.embeddingDim !== queryVec.length) {
      // Limit warn spam — once per call is enough.
      if (dimWarnedFor === 0) {
        warn(
          `librarian-retrieve: ${row.sourcePath} indexed dim ${row.embeddingDim} != query dim ${queryVec.length} (rebuild needed); suppressing further warnings this call`
        );
      }
      dimWarnedFor++;
      continue;
    }
    let docVec: Float32Array;
    try {
      docVec = blobToVector(row.embedding, row.embeddingDim);
    } catch (e) {
      warn(
        `librarian-retrieve: skipping ${row.sourcePath}: blob decode failed: ${describeError(e)}`
      );
      continue;
    }
    const sim = cosineSimilarity(queryVec, docVec);
    if (sim < minSim) continue;
    scored.push({
      path: row.sourcePath,
      kind: row.kind,
      slug: row.slug,
      similarity: sim,
      snippet: row.contentSnippet,
      mtimeMs: row.mtimeMs
    });
  }

  // Sort by similarity desc, tiebreak by mtime desc (newer wins) for
  // determinism + recency bias.
  scored.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return b.mtimeMs - a.mtimeMs;
  });

  return scored.slice(0, topN);
}

/**
 * Build the literal text the orchestrator hook prepends to a spawned
 * agent's prompt. Empty results yield an empty string (caller can skip
 * prepending anything).
 *
 * Format:
 *
 *     Precedent from prior decisions — for context:
 *
 *     1. <slug> (kind=directive, similarity=0.82)
 *        <first 8 lines of snippet, indented>
 *
 *     2. ...
 */
export function formatPrecedentPreamble(
  rows: RetrievedPrecedent[],
  opts: { maxSnippetLines?: number } = {}
): string {
  if (rows.length === 0) return '';
  const maxLines = opts.maxSnippetLines ?? 8;
  const out: string[] = [];
  out.push('Precedent from prior decisions — for context:');
  out.push('');
  rows.forEach((r, i) => {
    out.push(
      `${i + 1}. ${r.slug} (kind=${r.kind}, similarity=${r.similarity.toFixed(3)})`
    );
    const lines = snippetLines(r.snippet, maxLines);
    for (const line of lines) {
      out.push(`   ${line}`);
    }
    out.push('');
  });
  return out.join('\n');
}

function snippetLines(snippet: string, maxLines: number): string[] {
  const lines = snippet.split('\n').filter((l) => l.trim() !== '');
  return lines.slice(0, maxLines);
}

function normalizeKindFilter(
  v: PrecedentKind | PrecedentKind[] | undefined
): Set<PrecedentKind> | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    return new Set(v);
  }
  return new Set([v]);
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
