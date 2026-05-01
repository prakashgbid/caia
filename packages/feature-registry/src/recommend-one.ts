/**
 * @chiefaia/feature-registry — recommendOne (core)
 *
 * Returns a single, opinionated recommendation given a task description:
 *   'reuse'   — a feature with scoreDense ≥ reuseThreshold exists; use it as-is.
 *   'enhance' — a feature with scoreDense ≥ enhanceThreshold (but < reuseThreshold) exists; build on it.
 *   'new'     — nothing is close enough; create from scratch.
 *
 * Built on top of search() — same RRF hybrid pipeline, same deps shape.
 * Callers that need raw top-K hits should use search() directly.
 */

import {
  DEFAULT_AMBIGUOUS_THRESHOLD,
  DEFAULT_ENHANCE_THRESHOLD,
  type SearchHit,
} from './schema';
import { search, type SearchClientDeps, type SearchOpts } from './search';

// ─── Public types ────────────────────────────────────────────────────────────

export interface RecommendOneOpts {
  /** Restrict to a single project. Default: cross-project. */
  project?: string;
  /**
   * Cosine-similarity floor for 'reuse'. Default DEFAULT_ENHANCE_THRESHOLD (0.85).
   * We borrow the existing 0.85 constant because empirically a dense score at
   * that level already signals near-identical semantics — safe to use as-is.
   */
  reuseThreshold?: number;
  /**
   * Cosine-similarity floor for 'enhance'. Default DEFAULT_AMBIGUOUS_THRESHOLD (0.78).
   */
  enhanceThreshold?: number;
  /** Internal top-K passed to search(). Default 5. */
  topK?: number;
  /** RRF constant forwarded to search(). Default 60. */
  rrfK?: number;
  /** Skip dense retrieval (FTS5-only). scoreDense will be -1 → 'new'. Mainly for tests. */
  sparseOnly?: boolean;
}

export interface RecommendOneResult {
  /** Definitive recommendation. */
  action: 'reuse' | 'enhance' | 'new';
  /**
   * Confidence in [0, 1]. Direct pass-through from topMatch.scoreDense.
   * 0 when the registry is empty or the top hit had no dense signal.
   */
  confidence: number;
  /** Highest-ranked feature hit. null when the registry is empty. */
  topMatch: SearchHit | null;
  /** Human-readable rationale (one sentence). */
  reasoning: string;
  /** Wall-clock ms for the full search call. */
  latencyMs: number;
}

// ─── Core function ───────────────────────────────────────────────────────────

/**
 * Recommend a single action for a task described by `query`.
 *
 * Example:
 * ```ts
 * const rec = await recommendOne('add user leaderboard', {}, { db, embedder, loadRowsByIds });
 * if (rec.action === 'reuse') return rec.topMatch!.row.id;
 * ```
 */
export async function recommendOne(
  query: string,
  opts: RecommendOneOpts,
  deps: SearchClientDeps,
): Promise<RecommendOneResult> {
  const reuseThreshold = opts.reuseThreshold ?? DEFAULT_ENHANCE_THRESHOLD; // 0.85
  const enhanceThreshold = opts.enhanceThreshold ?? DEFAULT_AMBIGUOUS_THRESHOLD; // 0.78

  const searchOpts: SearchOpts = {
    project: opts.project,
    topK: opts.topK ?? 5,
    rrfK: opts.rrfK,
    sparseOnly: opts.sparseOnly,
    // Pass thresholds so search() computes a classification internally, but
    // we discard result.classification entirely — topMatch is hits[0] regardless
    // of thresholds, and we apply our own three-tier logic below.
    enhanceThreshold: reuseThreshold,
    ambiguousThreshold: enhanceThreshold,
  };

  const result = await search(query, searchOpts, deps);

  const topMatch = result.topMatch;
  const scoreDense = topMatch?.scoreDense ?? -1;

  let action: RecommendOneResult['action'];
  let reasoning: string;

  if (!topMatch) {
    action = 'new';
    reasoning = 'Registry is empty — create a new feature.';
  } else if (scoreDense < 0) {
    // Sparse-only hit: BM25 matched a keyword but there is no dense vector
    // signal. scoreDense = -1 from search(). Conservative: treat as new.
    action = 'new';
    reasoning = `Sparse-only match for "${topMatch.row.name}" — no dense signal, defaulting to new.`;
  } else if (scoreDense >= reuseThreshold) {
    action = 'reuse';
    reasoning =
      `High-confidence match (score ${scoreDense.toFixed(3)} ≥ ${reuseThreshold}): ` +
      `"${topMatch.row.name}" — reuse as-is.`;
  } else if (scoreDense >= enhanceThreshold) {
    action = 'enhance';
    reasoning =
      `Partial match (score ${scoreDense.toFixed(3)}, ${enhanceThreshold}–${reuseThreshold} band): ` +
      `"${topMatch.row.name}" — enhance this existing feature.`;
  } else {
    action = 'new';
    reasoning =
      `Closest match scored ${scoreDense.toFixed(3)} < enhance threshold ${enhanceThreshold} — create a new feature.`;
  }

  return {
    action,
    confidence: Math.max(0, scoreDense),
    topMatch,
    reasoning,
    latencyMs: result.latencyMs,
  };
}
