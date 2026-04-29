/**
 * @chiefaia/architecture-registry — per-domain query API (ARCH-005)
 *
 * The EA Agent's primary entry point. Given a free-form architectural
 * query (and an optional domain filter), returns a ranked list of
 * `arch_artifacts` that match — fused dense (cosine) + sparse (BM25)
 * via Reciprocal Rank Fusion, then filtered by kind / project /
 * tech_sub_domain.
 *
 * Mirrors the FREG-005 search API but operates on a different surface:
 *
 *   FREG.search(query)              → user-feature granularity
 *   AKG.findUIArtifacts(query)      → components / themes / plugins
 *   AKG.findBackendArtifacts(query) → APIs / services
 *   AKG.findDBArtifacts(query)      → schemas / migrations
 *   AKG.findAcrossDomains(query)    → all-kinds semantic search
 *
 * Hot-path budget: <250ms p95 on M1 Pro (dominated by Ollama embed at
 * ~190ms; vec0 + FTS5 retrieval is sub-millisecond for ≤10K rows).
 *
 * Token cost: zero Claude tokens. ~50-200 local Ollama tokens per call.
 */

import type Database from 'better-sqlite3';
import {
  type ArchArtifactRow,
  type ArchSearchHit,
  type ArchSearchResult,
  type ArtifactKind,
} from './schema';
import {
  queryDense,
  querySparse,
  readArtifactsByIds,
  type DenseHit,
  type SparseHit,
  type DenseQueryOpts,
} from './storage';
import type { EmbeddingClient } from '@chiefaia/feature-registry';

// ─── Per-domain kind groupings ──────────────────────────────────────────────
//
// EA Agent thinks in tech_sub_domain terms but a story may need to query
// across multiple AKG kinds within one domain (e.g. UI = components +
// themes + plugins). These maps translate.

export const UI_KINDS: ReadonlyArray<ArtifactKind> = [
  'component',
  'theme',
  'plugin',
] as const;

export const BACKEND_KINDS: ReadonlyArray<ArtifactKind> = [
  'api',
  'service',
] as const;

export const DB_KINDS: ReadonlyArray<ArtifactKind> = ['schema', 'migration'] as const;

export const PACKAGE_KINDS: ReadonlyArray<ArtifactKind> = ['package'] as const;

export const INTEGRATION_KINDS: ReadonlyArray<ArtifactKind> = [
  'integration',
  'observability_signal',
  'domain_module',
] as const;

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_TOP_K = 10;
export const DEFAULT_RRF_K = 60;
export const DEFAULT_MIN_SCORE = 0.5;

// ─── Search options ─────────────────────────────────────────────────────────

export interface ArchSearchOpts {
  /** Top-K hits to return (after fusion). */
  topK?: number;
  /** Restrict to specific projects (default: all). */
  projects?: readonly string[];
  /** Restrict to specific tech_sub_domains. */
  techSubDomains?: readonly string[];
  /** Restrict to specific artifact kinds. */
  kinds?: ReadonlyArray<ArtifactKind>;
  /** Cosine threshold floor (drop dense hits below). */
  minScore?: number;
  /** RRF fusion constant. */
  rrfK?: number;
  /** Inner-K per retriever before fusion. */
  innerK?: number;
  /** If true, FTS5-only (no dense retriever call — used when embedder unavailable). */
  sparseOnly?: boolean;
  /** If true, vec-only. */
  denseOnly?: boolean;
}

export interface ArchSearchDeps {
  db: Database.Database;
  embedder: EmbeddingClient;
}

// ─── RRF fusion (parallel of FREG's) ────────────────────────────────────────

interface FusedScore {
  score: number;
  dense?: number;
  sparse?: number;
}

function fuseRrf(
  denseHits: DenseHit[],
  sparseHits: SparseHit[],
  k: number,
): Map<string, FusedScore> {
  const fused = new Map<string, FusedScore>();
  denseHits.forEach((hit, idx) => {
    fused.set(hit.id, { score: 1 / (k + idx + 1), dense: hit.score });
  });
  sparseHits.forEach((hit, idx) => {
    const contribution = 1 / (k + idx + 1);
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

// ─── Core search ────────────────────────────────────────────────────────────

export async function archSearch(
  query: string,
  opts: ArchSearchOpts,
  deps: ArchSearchDeps,
): Promise<ArchSearchResult> {
  const t0 = Date.now();
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const rrfK = opts.rrfK ?? DEFAULT_RRF_K;
  const innerK = opts.innerK ?? Math.max(topK * 4, 30);
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;

  const queryOpts: DenseQueryOpts = {
    topK: innerK,
    kinds: opts.kinds,
    projects: opts.projects,
    techSubDomains: opts.techSubDomains,
  };

  let embedderTokens = 0;
  let denseHits: DenseHit[] = [];
  let sparseHits: SparseHit[] = [];

  if (!opts.denseOnly) {
    sparseHits = querySparse(deps.db, query, queryOpts);
  }

  if (!opts.sparseOnly) {
    try {
      const embedResult = await deps.embedder.embed(query);
      embedderTokens = embedResult.tokens;
      denseHits = queryDense(deps.db, embedResult.embedding, queryOpts);
    } catch (err) {
      // Fall through to sparse-only when the embedder is unavailable —
      // EA Agent gets a degraded but useful result instead of a hard
      // error. The dashboard can surface this state via the search-log.
      void err;
      denseHits = [];
    }
  }

  // Drop dense hits below minScore floor BEFORE fusion.
  const denseFiltered = denseHits.filter((h) => h.score >= minScore);

  const fused = fuseRrf(denseFiltered, sparseHits, rrfK);
  const sorted = Array.from(fused.entries())
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, topK);

  // Load full row data in one DB call.
  const ids = sorted.map(([id]) => id);
  const rows = readArtifactsByIds(deps.db, ids);
  const rowsById = new Map<string, ArchArtifactRow>(rows.map((r) => [r.id, r]));

  const hits: ArchSearchHit[] = sorted
    .map(([id, scores]) => {
      const row = rowsById.get(id);
      if (!row) return null;
      const matchType: ArchSearchHit['matchType'] =
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
    .filter((h): h is ArchSearchHit => h !== null);

  const topMatch = hits.length > 0 ? hits[0]! : null;

  return {
    hits,
    topMatch,
    thresholdUsed: minScore,
    latencyMs: Date.now() - t0,
    embedderTokens,
    kindsSearched: opts.kinds ? Array.from(opts.kinds) : [],
    techSubDomainsFiltered: opts.techSubDomains
      ? Array.from(opts.techSubDomains as readonly Parameters<
          NonNullable<ArchSearchResult['techSubDomainsFiltered']>['push']
        >[0][])
      : [],
  };
}

// ─── Per-domain helpers ─────────────────────────────────────────────────────
//
// These mirror the per-domain method shape from the directive doc:
//   arch.findUIArtifacts, findBackendArtifacts, findDBArtifacts,
//   findAcrossDomains.
//
// Each delegates to archSearch with appropriate kind + tech-sub-domain
// defaults. Callers can still override via opts.

export async function findUIArtifacts(
  query: string,
  opts: ArchSearchOpts,
  deps: ArchSearchDeps,
): Promise<ArchSearchResult> {
  return archSearch(
    query,
    {
      ...opts,
      kinds: opts.kinds ?? UI_KINDS,
      techSubDomains:
        opts.techSubDomains ?? ['frontend', 'design-system', 'accessibility', 'web-analytics'],
    },
    deps,
  );
}

export async function findBackendArtifacts(
  query: string,
  opts: ArchSearchOpts,
  deps: ArchSearchDeps,
): Promise<ArchSearchResult> {
  return archSearch(
    query,
    {
      ...opts,
      kinds: opts.kinds ?? BACKEND_KINDS,
      techSubDomains:
        opts.techSubDomains ??
        ['bff', 'backend', 'api-gateway', 'agent-runtime', 'event-driven', 'auth', 'observability'],
    },
    deps,
  );
}

export async function findDBArtifacts(
  query: string,
  opts: ArchSearchOpts,
  deps: ArchSearchDeps,
): Promise<ArchSearchResult> {
  return archSearch(
    query,
    {
      ...opts,
      kinds: opts.kinds ?? DB_KINDS,
      techSubDomains: opts.techSubDomains ?? ['database', 'data-migration'],
    },
    deps,
  );
}

export async function findPackageArtifacts(
  query: string,
  opts: ArchSearchOpts,
  deps: ArchSearchDeps,
): Promise<ArchSearchResult> {
  return archSearch(
    query,
    {
      ...opts,
      kinds: opts.kinds ?? PACKAGE_KINDS,
    },
    deps,
  );
}

export async function findIntegrationArtifacts(
  query: string,
  opts: ArchSearchOpts,
  deps: ArchSearchDeps,
): Promise<ArchSearchResult> {
  return archSearch(
    query,
    {
      ...opts,
      kinds: opts.kinds ?? INTEGRATION_KINDS,
    },
    deps,
  );
}

export async function findAcrossDomains(
  query: string,
  opts: ArchSearchOpts,
  deps: ArchSearchDeps,
): Promise<ArchSearchResult> {
  // No kind filter — searches every artifact kind.
  return archSearch(query, opts, deps);
}
