/**
 * @chiefaia/feature-registry — schema (FREG-001)
 *
 * The canonical, Zod-validated shape of a Feature Registry row. Every row
 * represents one shipped feature/route/component/agent that the PO Agent
 * can match a new task against (to classify `lifecycle = 'enhance'`).
 *
 * Keep this file dependency-free aside from `zod` so it can be imported
 * by the orchestrator, dashboard, and tooling alike without dragging in
 * SQLite/Ollama transitive deps.
 */

import { z } from 'zod';
import { PROJECT_SLUGS } from '@chiefaia/ticket-template';

// ─── Constants ───────────────────────────────────────────────────────────────

export const FEATURE_REGISTRY_VERSION = 'v1' as const;

/**
 * The default embedding model the registry uses for new rows. Stored on
 * each row so a future model swap can detect-and-backfill stale rows
 * without rebuilding the whole index from scratch.
 */
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text' as const;
export const DEFAULT_EMBEDDING_DIM = 768 as const;
export const DEFAULT_EMBEDDING_VERSION = 'v1.5' as const;

/**
 * Where a registry row originated. Distinguishes auto-populated rows
 * (which can be safely re-embedded without losing curation) from
 * human-curated ones (which a backfill should not overwrite).
 */
export const FEATURE_REGISTRY_SOURCES = [
  'story_completed',
  'backfill_codebase',
  'backfill_stories',
  'manual',
] as const;
export type FeatureRegistrySource = (typeof FEATURE_REGISTRY_SOURCES)[number];

// ─── Per-row schema ──────────────────────────────────────────────────────────

/**
 * Bounded so a misbehaving caller (or a corrupted backfill) cannot blow
 * up the embedding model context. nomic-embed-text caps at 8K tokens,
 * but well-formed feature blurbs are usually <300 chars; 2000 is generous.
 */
export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_TAGS = 20;

/**
 * Project slug must match the canonical taxonomy from ticket-template
 * (so cross-project search and dashboard filters are coherent). New
 * project? Add it to PROJECT_SLUGS first.
 */
const ProjectSlugEnum = z.enum(PROJECT_SLUGS);

export const FeatureRegistryRowSchema = z
  .object({
    // ─── Identity ──────────────────────────────────────────────────────────
    /** `freg_<nanoid10>`. Stable across re-embeds. */
    id: z.string().min(1),

    project: ProjectSlugEnum,

    /** Human-readable feature name. Used as the BM25-search anchor. */
    name: z.string().min(1).max(MAX_NAME_LENGTH),

    /** Free-form description. The primary embedding input. */
    description: z.string().min(1).max(MAX_DESCRIPTION_LENGTH),

    // ─── Locator fields (any may be null) ──────────────────────────────────
    /** e.g. '/leaderboard' or '/api/v1/users/[id]'. */
    routePath: z.string().optional(),

    /** Files implementing this feature. Empty if not yet known. */
    filePaths: z.array(z.string().min(1)).default([]),

    /** Exported component name, e.g. 'LeaderboardPage'. */
    componentName: z.string().optional(),

    /** Backend route signature, e.g. 'GET /api/leaderboard'. */
    apiEndpoint: z.string().optional(),

    /** Tables the feature reads/writes. */
    dbTables: z.array(z.string().min(1)).default([]),

    /** Agent name if the feature IS an agent (e.g. 'po-agent'). */
    agentName: z.string().optional(),

    // ─── Provenance ────────────────────────────────────────────────────────
    /** epoch ms — when the feature reached `done`. */
    shippedAt: z.number().int().nonnegative(),

    /** Story it was synthesized from (if any). Back-link for the dashboard. */
    storyId: z.string().optional(),

    /**
     * Free-form tags. Union of business-sub-domains, quality tags, and
     * tech-sub-domains drawn from the BUCKET-001 axes; arbitrary strings
     * also welcome.
     */
    tags: z.array(z.string().min(1)).max(MAX_TAGS).default([]),

    // ─── Embedding metadata ────────────────────────────────────────────────
    /** Model used to compute the vector stored in feature_registry_vec. */
    embeddingModel: z.string().default(DEFAULT_EMBEDDING_MODEL),

    /** Dimensionality. Must match the vec0 table column declaration. */
    embeddingDim: z.number().int().positive().default(DEFAULT_EMBEDDING_DIM),

    /** Model version — used to invalidate on upgrade. */
    embeddingVersion: z.string().default(DEFAULT_EMBEDDING_VERSION),

    // ─── Audit ─────────────────────────────────────────────────────────────
    source: z.enum(FEATURE_REGISTRY_SOURCES),

    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),

    /**
     * sha256 of (project, name, locator). Indexed UNIQUE so the
     * story.completed subscriber + backfill script are idempotent
     * (re-running upserts the embedding/tags/updatedAt without
     * inserting a duplicate row).
     */
    dedupKey: z.string().min(40).max(80),
  })
  .strict();

export type FeatureRegistryRow = z.infer<typeof FeatureRegistryRowSchema>;

// ─── Search-result schemas ──────────────────────────────────────────────────

/**
 * The classification verdict returned by `registry.search`.
 *
 * `enhance` means: the top match clears the high-confidence threshold;
 * PO Agent should set `lifecycle='enhance'` and `links_to=[topMatch.id]`.
 *
 * `ambiguous` means: top match is in the grey zone. PO Agent should
 * still set `lifecycle='enhance'` + `links_to=[topMatch.id]` but emit
 * a `feature.classification.uncertain` event so BA / a human can review.
 *
 * `new` means: nothing came close enough. PO Agent sets `lifecycle='new'`.
 */
export const ClassificationVerdictSchema = z.enum(['enhance', 'ambiguous', 'new']);
export type ClassificationVerdict = z.infer<typeof ClassificationVerdictSchema>;

/** Per-hit record in a SearchResult. */
export const SearchHitSchema = z
  .object({
    row: FeatureRegistryRowSchema,
    /** cosine similarity in [0, 1]. -1 if dense retrieval missed. */
    scoreDense: z.number(),
    /** BM25 normalized to [0, 1]. -1 if sparse retrieval missed. */
    scoreSparse: z.number(),
    /** Reciprocal-Rank-Fusion score; higher = better. */
    scoreFused: z.number(),
    matchType: z.enum(['dense', 'sparse', 'both']),
  })
  .strict();
export type SearchHit = z.infer<typeof SearchHitSchema>;

/** Aggregate result returned by `registry.search`. */
export const SearchResultSchema = z
  .object({
    hits: z.array(SearchHitSchema),
    classification: ClassificationVerdictSchema,
    /** null iff hits is empty. */
    topMatch: SearchHitSchema.nullable(),
    /** Cosine threshold actually used (after per-project override). */
    thresholdUsed: z.number(),
    /** Wall-clock ms for the full search call (embed + retrieve + fuse). */
    latencyMs: z.number().nonnegative(),
    /**
     * Local-Ollama tokens consumed. Reported separately from Claude
     * tokens (which are always 0 in the search hot path) so dashboards
     * can prove the zero-Claude-token guarantee.
     */
    embedderTokens: z.number().int().nonnegative(),
  })
  .strict();
export type SearchResult = z.infer<typeof SearchResultSchema>;

// ─── Threshold defaults (used by registry.search) ───────────────────────────

/**
 * Default cosine thresholds. Tune per project after FREG-004 backfill +
 * FREG-007 dashboard surfaces calibration data.
 *
 * Why 0.78 and not 0.7: nomic-embed-text on short English feature
 * descriptions clusters tighter than the general MTEB distribution.
 * Empirically (research notebook 2026-04-28), unrelated feature
 * descriptions land at 0.55-0.65; loosely related ones around 0.7;
 * clear matches at 0.85+.
 */
export const DEFAULT_ENHANCE_THRESHOLD = 0.85 as const;
export const DEFAULT_AMBIGUOUS_THRESHOLD = 0.78 as const;
