/**
 * @chiefaia/feature-registry — hybrid search API (FREG-005)
 *
 * The PO Agent's primary entry point. Given a free-form task description,
 * returns a SearchResult with:
 *   - top-K hits ranked by Reciprocal Rank Fusion of dense + sparse retrievers
 *   - classification verdict (enhance / ambiguous / new) per the configured
 *     thresholds
 *   - latency + embedder-token telemetry
 *
 * Hot-path budget: <200ms p95 on M1 Pro (dominated by Ollama embed at ~190ms).
 * Vector + FTS5 retrieval is sub-millisecond (per FREG-002 benchmark).
 *
 * Token cost: zero Claude tokens. ~50-200 local Ollama tokens per call.
 */

import type Database from 'better-sqlite3';
import {
  DEFAULT_AMBIGUOUS_THRESHOLD,
  DEFAULT_ENHANCE_THRESHOLD,
  type ClassificationVerdict,
  type FeatureRegistryRow,
  type SearchHit,
  type SearchResult,
} from './schema';
import { queryDense, querySparse, type DenseHit, type SparseHit, type QueryOpts } from './storage';
import type { EmbeddingClient } from './embedding-client';

export interface SearchOpts {
  /** Restrict search to a single project. Default: cross-project. */
  project?: string;
  /** Top-K to return (after fusion). Default 5. */
  topK?: number;
  /** RRF fusion constant. Default 60 (industry standard). */
  rrfK?: number;
  /** Inner-K per retriever before fusion. Default max(topK*4, 20). */
  innerK?: number;
  /** Cosine threshold for confident `enhance`. Default DEFAULT_ENHANCE_THRESHOLD. */
  enhanceThreshold?: number;
  /** Cosine threshold for `ambiguous`. Default DEFAULT_AMBIGUOUS_THRESHOLD. */
  ambiguousThreshold?: number;
  /**
   * If true, skip the dense path (FTS5-only). Used by the dashboard's
   * keyword-filter mode and by tests when no embedder is wired.
   */
  sparseOnly?: boolean;
  /**
   * If true, skip the sparse path (vec-only). Used when the description
   * has no keyword overlap with the registry (rare).
   */
  denseOnly?: boolean;
}

/**
 * SearchClient binds an embedding client + a DB to the search API. PO
 * Agent constructs one at startup; tests can construct one with stubs.
 */
export interface SearchClientDeps {
  db: Database.Database;
  embedder: EmbeddingClient;
  /**
   * Registry-row loader by ID. The hits' rows are loaded via this so
   * the search layer doesn't need to know the orchestrator's schema
   * shape (project-row fields, JSON-encoded columns, etc.). Tests
   * inject a dict-backed loader.
   */
  loadRowsByIds(ids: string[], project?: string): FeatureRegistryRow[];
}

/**
 * Reciprocal Rank Fusion. Score = sum_over_lists(1 / (k + rank_in_list)).
 * Returns ids sorted by RRF score desc.
 */
function fuseRrf(
  denseHits: DenseHit[],
  sparseHits: SparseHit[],
  k: number,
): Map<string, { score: number; dense?: number; sparse?: number }> {
  const fused = new Map<string, { score: number; dense?: number; sparse?: number }>();

  denseHits.forEach((hit, idx) => {
    const rank = idx + 1;
    const contribution = 1 / (k + rank);
    fused.set(hit.id, { score: contribution, dense: hit.score });
  });

  sparseHits.forEach((hit, idx) => {
    const rank = idx + 1;
    const contribution = 1 / (k + rank);
    const existing = fused.get(hit.id);
    if (existing) {
      existing.score += contribution;
      existing.sparse = hit.score;
    } else {
      fused.set(hit.id, { score: contribution, sparse: hit.score });
    }
  });

  return fused;
}

/**
 * Classify a search result based on the top match's cosine similarity.
 * Note we use cosine sim from the dense retriever (which is in [0,1])
 * — NOT the fused RRF score (which is bounded by 1/(k+1) ≈ 0.016).
 * The thresholds are tuned for cosine sim, not RRF.
 *
 * Stories with no dense match (sparse-only hit) classify as `new` since
 * we can't verify semantic similarity.
 */
function classify(
  topHit: SearchHit | null,
  enhanceThreshold: number,
  ambiguousThreshold: number,
): ClassificationVerdict {
  if (!topHit) return 'new';
  if (topHit.scoreDense < 0) return 'new'; // sparse-only — be conservative
  if (topHit.scoreDense >= enhanceThreshold) return 'enhance';
  if (topHit.scoreDense >= ambiguousThreshold) return 'ambiguous';
  return 'new';
}

/**
 * The hot-path. Embed the query → dense + sparse retrieval in parallel
 * → RRF fuse → load rows → classify → return.
 */
export async function search(
  query: string,
  opts: SearchOpts,
  deps: SearchClientDeps,
): Promise<SearchResult> {
  const t0 = Date.now();
  const topK = opts.topK ?? 5;
  const rrfK = opts.rrfK ?? 60;
  const innerK = opts.innerK ?? Math.max(topK * 4, 20);
  const enhanceThreshold = opts.enhanceThreshold ?? DEFAULT_ENHANCE_THRESHOLD;
  const ambiguousThreshold = opts.ambiguousThreshold ?? DEFAULT_AMBIGUOUS_THRESHOLD;

  let embedderTokens = 0;
  let denseHits: DenseHit[] = [];
  let sparseHits: SparseHit[] = [];

  const queryOpts: QueryOpts = { topK: innerK, project: opts.project };

  // Dense + sparse retrieval. Run sparse first (no I/O) then dense
  // (Ollama HTTP). For larger registries we'd parallelize them, but
  // the FTS5 query is so cheap that serializing keeps the code
  // simpler with no measurable cost.
  if (!opts.denseOnly) {
    sparseHits = querySparse(deps.db, query, queryOpts);
  }

  if (!opts.sparseOnly) {
    const embedResult = await deps.embedder.embed(query);
    embedderTokens = embedResult.tokens;
    denseHits = queryDense(deps.db, embedResult.embedding, queryOpts);
  }

  // Fuse + sort
  const fused = fuseRrf(denseHits, sparseHits, rrfK);
  const sorted = Array.from(fused.entries())
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, topK);

  // Load row data for the surviving IDs in one DB call.
  const ids = sorted.map(([id]) => id);
  const rowsById = new Map<string, FeatureRegistryRow>(
    deps.loadRowsByIds(ids, opts.project).map((r) => [r.id, r]),
  );

  const hits: SearchHit[] = sorted
    .map(([id, scores]) => {
      const row = rowsById.get(id);
      if (!row) return null;
      const matchType: SearchHit['matchType'] =
        scores.dense !== undefined && scores.sparse !== undefined
          ? 'both'
          : scores.dense !== undefined
            ? 'dense'
            : 'sparse';
      return {
        row,
        scoreDense: scores.dense ?? -1,
        scoreSparse: scores.sparse ?? -1,
        scoreFused: scores.score,
        matchType,
      };
    })
    .filter((h): h is SearchHit => h !== null);

  const topMatch = hits.length > 0 ? hits[0]! : null;
  const classification = classify(topMatch, enhanceThreshold, ambiguousThreshold);

  return {
    hits,
    classification,
    topMatch,
    thresholdUsed: enhanceThreshold,
    latencyMs: Date.now() - t0,
    embedderTokens,
  };
}
