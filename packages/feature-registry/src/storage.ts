/**
 * @chiefaia/feature-registry — storage layer (FREG-002)
 *
 * Wires the registry's Zod-validated rows onto the orchestrator's
 * SQLite DB via better-sqlite3 + sqlite-vec. Three tables collaborate:
 *
 *   feature_registry              — declared in migration 0028 (FREG-001)
 *   feature_registry_vec   (vec0) — declared here (idempotent), holds embeddings
 *   feature_registry_fts   (fts5) — declared here (idempotent), BM25 over text
 *
 * The vec0 + FTS5 virtual tables live outside drizzle's schema (drizzle
 * has no first-class virtual-table support, and the vec0 module isn't
 * loaded at migration time). We bootstrap them once per connection.
 *
 * Public API:
 *   - bootstrapVectorTables(db, dim) — idempotent CREATE-IF-NOT-EXISTS.
 *   - upsertRegistryRow(db, row, embedding) — atomic 3-table write.
 *   - queryDense(db, queryEmbedding, opts) — cosine top-K from vec0.
 *   - querySparse(db, queryText, opts) — BM25 top-K from FTS5.
 *
 * The high-level hybrid search API (FREG-005) layers on top of these.
 */

import type Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import {
  DEFAULT_EMBEDDING_DIM,
  type FeatureRegistryRow,
} from './schema';

// ─── Bootstrap ──────────────────────────────────────────────────────────────

/**
 * Load the sqlite-vec extension into the given connection and create
 * `feature_registry_vec` + `feature_registry_fts` if they don't exist.
 *
 * Safe to call repeatedly; safe to call BEFORE any feature_registry rows
 * exist. Returns the dim used so callers can assert the registry's
 * embeddingDim matches.
 */
/**
 * Generic helper — create a sqlite-vec `vec0` + FTS5 pair scoped to the
 * given table prefix. Idempotent; safe to call once per process per
 * connection. Used by both feature_registry (this package) and ARCH-###
 * (architecture_registry — coordinates with FREG to share infra).
 *
 * Created tables:
 *   <prefix>_vec   — vec0 virtual table; embedding FLOAT[dim]
 *   <prefix>_fts   — FTS5 virtual table; text column + porter tokenizer
 *
 * Returns the dim used + the live sqlite-vec version (proof the
 * extension is wired correctly).
 */
export interface VecTableOpts {
  /** Prefix for the two virtual tables. Required; no default to prevent collisions. */
  tablePrefix: string;
  /** Embedding dimensionality. Must match the EmbeddingClient's modelDim. */
  dim: number;
  /** FTS5 tokenizer. Default 'porter' (English-aware stemming). */
  ftsTokenize?: string;
}

export function bootstrapVecTable(
  db: Database.Database,
  opts: VecTableOpts,
): { dim: number; vecVersion: string; tablePrefix: string } {
  sqliteVec.load(db);
  const versionRow = db.prepare('SELECT vec_version() AS v').get() as { v: string };

  const vecTable = `${opts.tablePrefix}_vec`;
  const ftsTable = `${opts.tablePrefix}_fts`;
  const tokenize = opts.ftsTokenize ?? 'porter';

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${vecTable} USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[${opts.dim}]
    );
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${ftsTable} USING fts5(
      id UNINDEXED,
      text,
      tokenize = '${tokenize}'
    );
  `);

  return { dim: opts.dim, vecVersion: versionRow.v, tablePrefix: opts.tablePrefix };
}

/**
 * Feature Registry's vec0 + FTS5 setup. Thin wrapper around
 * bootstrapVecTable; preserved for backwards compatibility with all
 * existing FREG callers.
 */
export function bootstrapVectorTables(
  db: Database.Database,
  dim: number = DEFAULT_EMBEDDING_DIM,
): { dim: number; vecVersion: string } {
  const { dim: d, vecVersion } = bootstrapVecTable(db, {
    tablePrefix: 'feature_registry',
    dim,
  });
  return { dim: d, vecVersion };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Float32Array → Buffer for sqlite-vec INSERT. sqlite-vec accepts
 * either a JSON string `'[0.1, 0.2, ...]'` or a raw little-endian
 * Float32 buffer; the buffer path is faster + avoids float-to-string
 * round-trip rounding.
 */
function vecBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * Concatenate a row's BM25-relevant fields into a single FTS5 text.
 * Keeping this in one place ensures the indexer + query path agree.
 */
export function buildFtsText(row: Pick<
  FeatureRegistryRow,
  | 'name'
  | 'description'
  | 'routePath'
  | 'componentName'
  | 'apiEndpoint'
  | 'agentName'
  | 'tags'
>): string {
  const parts: string[] = [
    row.name,
    row.description,
    row.routePath ?? '',
    row.componentName ?? '',
    row.apiEndpoint ?? '',
    row.agentName ?? '',
    (row.tags ?? []).join(' '),
  ].filter((s) => s.length > 0);
  return parts.join(' ');
}

// ─── Upsert ─────────────────────────────────────────────────────────────────

/**
 * Idempotently upsert a registry row + its embedding + its FTS text in
 * a single transaction.
 *
 * - `feature_registry` upsert is keyed on the UNIQUE `dedup_key`. On
 *   conflict we update everything except `id`, `created_at`, `dedup_key`.
 * - `feature_registry_vec` is REPLACE on `id` so a re-embed after a
 *   model swap overwrites cleanly.
 * - `feature_registry_fts` is DELETE-then-INSERT on `id` (FTS5 has no
 *   ON CONFLICT clause).
 *
 * Caller passes the already-computed embedding + the same `id` they
 * stored (or will store) in `feature_registry`. We do NOT compute the
 * embedding inside the storage layer — that's the caller's job (so the
 * embedder can be cached / mocked / batched independently).
 */
export function upsertRegistryRow(
  db: Database.Database,
  row: FeatureRegistryRow,
  embedding: Float32Array,
): void {
  if (embedding.length !== row.embeddingDim) {
    throw new Error(
      `embedding dim mismatch: row.embeddingDim=${row.embeddingDim} but embedding.length=${embedding.length}`,
    );
  }

  const tx = db.transaction(() => {
    const filePathsJson = JSON.stringify(row.filePaths);
    const dbTablesJson = JSON.stringify(row.dbTables);
    const tagsJson = JSON.stringify(row.tags);

    db.prepare(
      `
      INSERT INTO feature_registry (
        id, project, name, description, route_path,
        file_paths_json, component_name, api_endpoint,
        db_tables_json, agent_name, shipped_at, story_id,
        tags_json, embedding_model, embedding_dim, embedding_version,
        source, created_at, updated_at, dedup_key
      ) VALUES (
        @id, @project, @name, @description, @route_path,
        @file_paths_json, @component_name, @api_endpoint,
        @db_tables_json, @agent_name, @shipped_at, @story_id,
        @tags_json, @embedding_model, @embedding_dim, @embedding_version,
        @source, @created_at, @updated_at, @dedup_key
      )
      ON CONFLICT(dedup_key) DO UPDATE SET
        name              = excluded.name,
        description       = excluded.description,
        route_path        = excluded.route_path,
        file_paths_json   = excluded.file_paths_json,
        component_name    = excluded.component_name,
        api_endpoint      = excluded.api_endpoint,
        db_tables_json    = excluded.db_tables_json,
        agent_name        = excluded.agent_name,
        shipped_at        = excluded.shipped_at,
        story_id          = excluded.story_id,
        tags_json         = excluded.tags_json,
        embedding_model   = excluded.embedding_model,
        embedding_dim     = excluded.embedding_dim,
        embedding_version = excluded.embedding_version,
        source            = excluded.source,
        updated_at        = excluded.updated_at;
    `,
    ).run({
      id: row.id,
      project: row.project,
      name: row.name,
      description: row.description,
      route_path: row.routePath ?? null,
      file_paths_json: filePathsJson,
      component_name: row.componentName ?? null,
      api_endpoint: row.apiEndpoint ?? null,
      db_tables_json: dbTablesJson,
      agent_name: row.agentName ?? null,
      shipped_at: row.shippedAt,
      story_id: row.storyId ?? null,
      tags_json: tagsJson,
      embedding_model: row.embeddingModel,
      embedding_dim: row.embeddingDim,
      embedding_version: row.embeddingVersion,
      source: row.source,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      dedup_key: row.dedupKey,
    });

    // The conflict path may have left `feature_registry.id` pointing at
    // a different ID than the one passed in (the stored row's id is
    // immutable; the new id is dropped). Resolve the canonical id so
    // the vec0 + fts5 writes attach to the row that actually exists.
    const canonicalRow = db
      .prepare('SELECT id FROM feature_registry WHERE dedup_key = ?')
      .get(row.dedupKey) as { id: string } | undefined;
    const canonicalId = canonicalRow?.id ?? row.id;

    // vec0 — REPLACE so embedding refresh is one operation.
    db.prepare('DELETE FROM feature_registry_vec WHERE id = ?').run(canonicalId);
    db.prepare('INSERT INTO feature_registry_vec(id, embedding) VALUES (?, ?)').run(
      canonicalId,
      vecBuffer(embedding),
    );

    // FTS5 — DELETE then INSERT (FTS5 has no UPSERT).
    const ftsText = buildFtsText(row);
    db.prepare('DELETE FROM feature_registry_fts WHERE id = ?').run(canonicalId);
    db.prepare('INSERT INTO feature_registry_fts(id, text) VALUES (?, ?)').run(
      canonicalId,
      ftsText,
    );
  });
  tx();
}

// ─── Dense + sparse retrieval primitives ────────────────────────────────────

export interface DenseHit {
  id: string;
  /** cosine similarity in [0, 1] (1 = identical). */
  score: number;
}

export interface SparseHit {
  id: string;
  /** BM25 normalized to [0, 1] (1 = best). */
  score: number;
}

export interface QueryOpts {
  topK?: number;
  /** Optional project restriction at the SQL layer. */
  project?: string;
}

/**
 * Top-K cosine-nearest neighbors via sqlite-vec brute-force scan.
 * Cosine *distance* in vec0 ranges [0, 2]; we convert to similarity
 * `(2 - distance) / 2` so the caller sees `[0, 1]` semantics.
 */
export function queryDense(
  db: Database.Database,
  queryEmbedding: Float32Array,
  opts: QueryOpts = {},
): DenseHit[] {
  const topK = opts.topK ?? 10;
  // sqlite-vec's MATCH selects nearest neighbors; we then optionally
  // join feature_registry to filter on project. We cap the inner KNN
  // larger than topK because filtering rejects some, and we want at
  // least topK to survive the join when feasible.
  const innerK = opts.project ? Math.max(topK * 4, 50) : topK;
  // sqlite-vec restricts queries: you may use 'k = N' OR 'LIMIT N',
  // not both. We use k = innerK and then apply project filtering +
  // topK trimming in JS so we don't violate that restriction.
  const sql = opts.project
    ? `
      SELECT v.id AS id, v.distance AS distance
      FROM feature_registry_vec AS v
      JOIN feature_registry AS r ON r.id = v.id
      WHERE v.embedding MATCH ? AND k = ${innerK} AND r.project = ?
      ORDER BY v.distance
    `
    : `
      SELECT id, distance
      FROM feature_registry_vec
      WHERE embedding MATCH ? AND k = ${innerK}
      ORDER BY distance
    `;
  const buf = vecBuffer(queryEmbedding);
  const rows = opts.project
    ? (db.prepare(sql).all(buf, opts.project) as Array<{ id: string; distance: number }>)
    : (db.prepare(sql).all(buf) as Array<{ id: string; distance: number }>);

  return rows.slice(0, topK).map((r) => ({
    id: r.id,
    // cosine distance ∈ [0, 2] → similarity ∈ [0, 1].
    score: Math.max(0, Math.min(1, (2 - r.distance) / 2)),
  }));
}

/**
 * Top-K BM25 hits via FTS5. BM25 scores in SQLite are NEGATIVE (lower =
 * better — by SQLite convention, the -1 multiplier makes ORDER BY ASC
 * "most relevant first"). We negate for downstream sanity and compress
 * to [0, 1] via `1 - exp(-score)` so RRF treats sparse + dense scores
 * comparably.
 */
export function querySparse(
  db: Database.Database,
  queryText: string,
  opts: QueryOpts = {},
): SparseHit[] {
  const topK = opts.topK ?? 10;
  // Sanitize the query to avoid FTS5 syntax errors when the user types
  // characters with special meaning (`OR`, `AND`, parens). Each token
  // becomes a prefix term so partial matches still count.
  const sanitized = queryText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `${t}*`)
    .join(' OR ');
  if (sanitized.length === 0) return [];

  const sql = opts.project
    ? `
      SELECT f.id AS id, bm25(feature_registry_fts) AS bm25
      FROM feature_registry_fts AS f
      JOIN feature_registry AS r ON r.id = f.id
      WHERE feature_registry_fts MATCH ? AND r.project = ?
      ORDER BY bm25
      LIMIT ${topK}
    `
    : `
      SELECT id, bm25(feature_registry_fts) AS bm25
      FROM feature_registry_fts
      WHERE feature_registry_fts MATCH ?
      ORDER BY bm25
      LIMIT ${topK}
    `;
  const rows = opts.project
    ? (db.prepare(sql).all(sanitized, opts.project) as Array<{ id: string; bm25: number }>)
    : (db.prepare(sql).all(sanitized) as Array<{ id: string; bm25: number }>);

  return rows.map((r) => {
    // SQLite bm25() returns 0 (no match) or negative (best match is most negative).
    // Map to [0, 1] via a smooth saturating function: 1 - exp(score).
    // For a non-match we'd never get here (filtered by MATCH), so score < 0.
    const positive = -r.bm25;
    const normalized = 1 - Math.exp(-positive);
    return { id: r.id, score: Math.max(0, Math.min(1, normalized)) };
  });
}
