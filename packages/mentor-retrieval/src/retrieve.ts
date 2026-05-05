/**
 * Mentor Phase-3 retrieval — query a built lesson index for the top-N
 * lessons most relevant to a given prompt.
 *
 * Algorithm:
 *
 *   1. Embed the prompt via the same Embedder used at build time
 *      (Ollama nomic-embed-text by default; subscription-only).
 *   2. Open the index DB read-only.
 *   3. Scan every row, decode its Float32 BLOB, compute cosine
 *      similarity against the query.
 *   4. Filter rows whose similarity is below the configured threshold.
 *   5. Sort by similarity desc, take the top N, return.
 *
 * The scan is intentionally JS-side (no sqlite-vec extension): at the
 * scale this serves (≤ a few thousand lessons) the scan runs in <5ms,
 * and avoiding a native binary dependency keeps cross-platform install
 * simple. The retrieval API is open to swapping for ANN indexing later
 * without changing this signature.
 *
 * Dimensional safety: rows whose `embeddingDim` doesn't match the
 * query's are skipped (logged once via the optional warn callback) so a
 * model migration doesn't crash the whole retrieval — old rows just
 * don't match until a rebuild.
 */

import { blobToVector } from './embed.js';
import { openIndexStore } from './index-store.js';
import type {
  Embedder,
  IndexedLesson,
  LessonKind
} from './types.js';

/** Default top-N for `retrieveLessons` (matches the directive's spec). */
export const DEFAULT_TOP_N = 5;

/**
 * Default minimum cosine similarity. Below this, a result is too weak
 * to be worth showing the spawned agent. nomic-embed-text on technical
 * markdown text typically lands "clearly relevant" matches in 0.55-0.85
 * and unrelated content under 0.30; 0.40 is a deliberately conservative
 * floor so we err toward false-positives over false-negatives at PR-2.
 */
export const DEFAULT_MIN_SIMILARITY = 0.4;

export interface RetrievedLesson {
  /** Source path on disk. */
  path: string;
  /** 'feedback' (durable) or 'proposal' (recent incident). */
  kind: LessonKind;
  /** Human-readable identifier (filename minus extension). */
  slug: string;
  /** Cosine similarity in [-1, 1]; in practice [0, 1] for nomic. */
  similarity: number;
  /** First ≤4 KB of the source content, for the agent to read. */
  snippet: string;
  /** Modified time of the source, for tiebreak / reporting. */
  mtimeMs: number;
}

export interface RetrieveLessonsOptions {
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
   * Optional kind filter — when set, only lessons of this kind are
   * returned. Useful for callers who want only durable feedback (high
   * s/n) and not recent proposals (lower s/n).
   */
  kindFilter?: LessonKind;
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
 * Retrieve the top-N lessons most similar to the given prompt.
 *
 * Returns an empty array if the index doesn't exist yet — that's the
 * graceful "no lessons learned yet" path. Callers can treat empty as
 * "nothing to inject".
 */
export async function retrieveLessons(
  prompt: string,
  opts: RetrieveLessonsOptions
): Promise<RetrievedLesson[]> {
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const minSim = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const warn = opts.warn ?? ((_m: string) => undefined);

  const queryRes = await opts.embed(prompt);
  const queryVec = queryRes.vector;

  let rows: IndexedLesson[];
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
      `mentor-retrieve: could not open index at memoryDir=${opts.memoryDir}: ${describeError(e)}`
    );
    return [];
  }

  if (rows.length === 0) return [];

  const scored: RetrievedLesson[] = [];
  for (const row of rows) {
    if (opts.kindFilter !== undefined && row.kind !== opts.kindFilter) continue;
    if (row.embeddingDim !== queryVec.length) {
      warn(
        `mentor-retrieve: skipping ${row.sourcePath}: indexed dim ${row.embeddingDim} != query dim ${queryVec.length} (rebuild needed)`
      );
      continue;
    }
    let docVec: Float32Array;
    try {
      docVec = blobToVector(row.embedding, row.embeddingDim);
    } catch (e) {
      warn(
        `mentor-retrieve: skipping ${row.sourcePath}: blob decode failed: ${describeError(e)}`
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
 * Format (per `mentor_agent_directive.md` ## Pre-spawn injection):
 *
 *     Lessons from past similar work — do not repeat:
 *
 *     1. <slug> (kind=feedback, similarity=0.82)
 *        <first 4 lines of snippet, indented>
 *
 *     2. ...
 */
export function formatLessonsPreamble(
  lessons: RetrievedLesson[],
  opts: { maxSnippetLines?: number } = {}
): string {
  if (lessons.length === 0) return '';
  const maxLines = opts.maxSnippetLines ?? 8;
  const out: string[] = [];
  out.push('Lessons from past similar work — do not repeat:');
  out.push('');
  lessons.forEach((l, i) => {
    out.push(
      `${i + 1}. ${l.slug} (kind=${l.kind}, similarity=${l.similarity.toFixed(3)})`
    );
    const lines = snippetLines(l.snippet, maxLines);
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

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
