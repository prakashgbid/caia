/**
 * @chiefaia/architecture-registry — storage layer (ARCH-004)
 *
 * Wires the AKG's Zod-validated rows onto the orchestrator's SQLite DB
 * via better-sqlite3 + sqlite-vec. Three tables collaborate per kind:
 *
 *   arch_artifacts            — declared in migration 0030 (ARCH-001)
 *   arch_artifacts_vec (vec0) — declared here (idempotent), holds embeddings
 *   arch_artifacts_fts (fts5) — declared here (idempotent), BM25 over text
 *
 * Plus the always-present:
 *
 *   arch_edges                — declared in migration 0030 (ARCH-001)
 *   arch_extract_runs         — declared in migration 0030 (ARCH-001)
 *
 * The vec0 + FTS5 virtual tables live outside drizzle's schema (drizzle
 * has no first-class virtual-table support, and the vec0 module isn't
 * loaded at migration time). We bootstrap them once per connection.
 *
 * Public API:
 *   - bootstrapVectorTables(db, dim) — idempotent CREATE-IF-NOT-EXISTS
 *   - upsertArtifactRow(db, row, embedding) — atomic 3-table write
 *   - upsertEdgeRow(db, row) — atomic edge upsert
 *   - queryDense / querySparse — primitive retrieval; ARCH-005 layers
 *     hybrid + per-domain filters on top.
 */

import type Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import {
  DEFAULT_EMBEDDING_DIM,
  type ArchArtifactRow,
  type ArchEdgeRow,
  type ArtifactKind,
} from './schema';

// ─── Bootstrap ──────────────────────────────────────────────────────────────

export interface BootstrapResult {
  dim: number;
  vecVersion: string;
}

export function bootstrapVectorTables(
  db: Database.Database,
  dim: number = DEFAULT_EMBEDDING_DIM,
): BootstrapResult {
  // Idempotent — sqlite-vec's load() is no-op if already loaded on this
  // connection. The shared FREG bootstrap may have already loaded it; we
  // guard with a try/catch in case.
  try {
    sqliteVec.load(db);
  } catch (err) {
    // If the extension is already present (e.g. the FREG bootstrap ran
    // first), `vec_version()` will still resolve below. Re-throw any
    // unrelated load error.
    const versionRow = db.prepare('SELECT vec_version() AS v').get() as { v?: string } | undefined;
    if (!versionRow?.v) {
      throw err;
    }
  }

  const versionRow = db.prepare('SELECT vec_version() AS v').get() as { v: string };

  // vec0 virtual table for artifact embeddings.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS arch_artifacts_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[${dim}]
    );
  `);

  // FTS5 virtual table for BM25 keyword search over name + description +
  // key_signature + tags + tech_sub_domains. `id` is UNINDEXED so it
  // round-trips back to the main table without participating in the
  // inverted index.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS arch_artifacts_fts USING fts5(
      id UNINDEXED,
      kind UNINDEXED,
      text,
      tokenize = 'porter'
    );
  `);

  return { dim, vecVersion: versionRow.v };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function vecBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * The text indexed in FTS5 for an artifact row. Keep in one place so
 * indexer + query path agree. Includes name, description, key signature,
 * locator hints, and tags / tech-sub-domains so a developer-style query
 * like "leaderboard component" hits the right row regardless of which
 * field the term lives in.
 */
export function buildArtifactFtsText(row: ArchArtifactRow): string {
  const parts: string[] = [
    row.name,
    row.description,
    row.keySignature ?? '',
    row.routeSignature ?? '',
    row.tableName ?? '',
    row.packageName ?? '',
    row.entryPath ?? '',
    row.owningService ?? '',
    (row.techSubDomains ?? []).join(' '),
    (row.tags ?? []).join(' '),
  ].filter((s) => s.length > 0);
  return parts.join(' ');
}

// ─── Upserts ────────────────────────────────────────────────────────────────

/**
 * Idempotently upsert an artifact row + its embedding + its FTS text in
 * a single transaction.
 *
 * - `arch_artifacts` upsert is keyed on the UNIQUE `dedup_key`. On
 *   conflict we update everything except `id`, `created_at`, `dedup_key`.
 * - `arch_artifacts_vec` is REPLACE on `id` so a re-embed after a model
 *   swap overwrites cleanly.
 * - `arch_artifacts_fts` is DELETE-then-INSERT on `id` (FTS5 has no
 *   ON CONFLICT clause).
 *
 * Caller passes the already-computed embedding.
 */
export function upsertArtifactRow(
  db: Database.Database,
  row: ArchArtifactRow,
  embedding: Float32Array,
): void {
  if (embedding.length !== row.embeddingDim) {
    throw new Error(
      `embedding dim mismatch: row.embeddingDim=${row.embeddingDim} but embedding.length=${embedding.length}`,
    );
  }

  const tx = db.transaction(() => {
    const filePathsJson = JSON.stringify(row.filePaths);
    const techJson = JSON.stringify(row.techSubDomains);
    const tagsJson = JSON.stringify(row.tags);

    db.prepare(
      `
      INSERT INTO arch_artifacts (
        id, kind, project, name, description, key_signature,
        file_paths_json, entry_path, route_signature, table_name,
        owning_service, package_name, design_system_tier,
        tech_sub_domains_json, tags_json, metadata_json,
        source, content_hash, extracted_at_commit,
        embedding_model, embedding_dim, embedding_version,
        created_at, updated_at, dedup_key
      ) VALUES (
        @id, @kind, @project, @name, @description, @key_signature,
        @file_paths_json, @entry_path, @route_signature, @table_name,
        @owning_service, @package_name, @design_system_tier,
        @tech_sub_domains_json, @tags_json, @metadata_json,
        @source, @content_hash, @extracted_at_commit,
        @embedding_model, @embedding_dim, @embedding_version,
        @created_at, @updated_at, @dedup_key
      )
      ON CONFLICT(dedup_key) DO UPDATE SET
        kind                  = excluded.kind,
        name                  = excluded.name,
        description           = excluded.description,
        key_signature         = excluded.key_signature,
        file_paths_json       = excluded.file_paths_json,
        entry_path            = excluded.entry_path,
        route_signature       = excluded.route_signature,
        table_name            = excluded.table_name,
        owning_service        = excluded.owning_service,
        package_name          = excluded.package_name,
        design_system_tier    = excluded.design_system_tier,
        tech_sub_domains_json = excluded.tech_sub_domains_json,
        tags_json             = excluded.tags_json,
        metadata_json         = excluded.metadata_json,
        source                = excluded.source,
        content_hash          = excluded.content_hash,
        extracted_at_commit   = excluded.extracted_at_commit,
        embedding_model       = excluded.embedding_model,
        embedding_dim         = excluded.embedding_dim,
        embedding_version     = excluded.embedding_version,
        updated_at            = excluded.updated_at;
    `,
    ).run({
      id: row.id,
      kind: row.kind,
      project: row.project,
      name: row.name,
      description: row.description,
      key_signature: row.keySignature ?? null,
      file_paths_json: filePathsJson,
      entry_path: row.entryPath ?? null,
      route_signature: row.routeSignature ?? null,
      table_name: row.tableName ?? null,
      owning_service: row.owningService ?? null,
      package_name: row.packageName ?? null,
      design_system_tier: row.designSystemTier ?? null,
      tech_sub_domains_json: techJson,
      tags_json: tagsJson,
      metadata_json: row.metadataJson,
      source: row.source,
      content_hash: row.contentHash ?? null,
      extracted_at_commit: row.extractedAtCommit ?? null,
      embedding_model: row.embeddingModel,
      embedding_dim: row.embeddingDim,
      embedding_version: row.embeddingVersion,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      dedup_key: row.dedupKey,
    });

    // Resolve canonical id (the conflict path may have left an existing
    // row's id pointing at a different ID than the input).
    const canonicalRow = db
      .prepare('SELECT id FROM arch_artifacts WHERE dedup_key = ?')
      .get(row.dedupKey) as { id: string } | undefined;
    const canonicalId = canonicalRow?.id ?? row.id;

    // vec0 — REPLACE so embedding refresh is one operation.
    db.prepare('DELETE FROM arch_artifacts_vec WHERE id = ?').run(canonicalId);
    db.prepare('INSERT INTO arch_artifacts_vec(id, embedding) VALUES (?, ?)').run(
      canonicalId,
      vecBuffer(embedding),
    );

    // FTS5 — DELETE then INSERT.
    const ftsText = buildArtifactFtsText(row);
    db.prepare('DELETE FROM arch_artifacts_fts WHERE id = ?').run(canonicalId);
    db.prepare('INSERT INTO arch_artifacts_fts(id, kind, text) VALUES (?, ?, ?)').run(
      canonicalId,
      row.kind,
      ftsText,
    );
  });
  tx();
}

/**
 * Upsert an edge row. UNIQUE on (from_id, to_id, relation). Since edges
 * carry no embedding, this is a single-table operation.
 *
 * If `metadataJson.edgeDedupKey` exists (set by extractors), we use it
 * for idempotency; otherwise we rely on the schema-level UNIQUE constraint.
 *
 * Edges referencing placeholder package targets (the form
 * `pkg::<package_name>` emitted by the component extractor) are
 * resolved here: we look up the canonical artifact id by the package's
 * dedupKey before persisting.
 */
export function upsertEdgeRow(db: Database.Database, row: ArchEdgeRow): void {
  // Resolve placeholder package targets (e.g. `pkg::lucide-react`).
  let resolvedToId = row.toId;
  if (resolvedToId.startsWith('pkg::')) {
    const pkgName = resolvedToId.slice(5);
    const found = db
      .prepare(
        `SELECT id FROM arch_artifacts WHERE kind = 'package' AND package_name = ? LIMIT 1`,
      )
      .get(pkgName) as { id: string } | undefined;
    if (!found) {
      // Target not yet known — the package extractor may not have run.
      // Skip silently so re-running ARCH-002+ARCH-003 in either order
      // converges.
      return;
    }
    resolvedToId = found.id;
  }

  db.prepare(
    `
    INSERT INTO arch_edges (
      id, from_id, to_id, relation, weight, metadata_json,
      source, created_at, updated_at
    ) VALUES (
      @id, @from_id, @to_id, @relation, @weight, @metadata_json,
      @source, @created_at, @updated_at
    )
    ON CONFLICT(from_id, to_id, relation) DO UPDATE SET
      weight        = excluded.weight,
      metadata_json = excluded.metadata_json,
      source        = excluded.source,
      updated_at    = excluded.updated_at;
  `,
  ).run({
    id: row.id,
    from_id: row.fromId,
    to_id: resolvedToId,
    relation: row.relation,
    weight: row.weight,
    metadata_json: row.metadataJson,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
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

export interface DenseQueryOpts {
  topK?: number;
  /** Restrict to a specific artifact kind (or list). */
  kinds?: ReadonlyArray<ArtifactKind>;
  /** Restrict to specific projects. */
  projects?: readonly string[];
  /** Restrict to artifacts tagged with at least one of these tech_sub_domains. */
  techSubDomains?: readonly string[];
}

export interface SparseQueryOpts extends DenseQueryOpts {
  // (FTS5 query options share the dense-side filters.)
}

function buildFilterSql(opts: DenseQueryOpts, alias = 'a'): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.kinds && opts.kinds.length > 0) {
    clauses.push(`${alias}.kind IN (${opts.kinds.map(() => '?').join(', ')})`);
    params.push(...opts.kinds);
  }
  if (opts.projects && opts.projects.length > 0) {
    clauses.push(`${alias}.project IN (${opts.projects.map(() => '?').join(', ')})`);
    params.push(...opts.projects);
  }
  if (opts.techSubDomains && opts.techSubDomains.length > 0) {
    // Each tech sub-domain → a JSON-substring LIKE; OR them.
    const techClauses: string[] = [];
    for (const t of opts.techSubDomains) {
      techClauses.push(`${alias}.tech_sub_domains_json LIKE ?`);
      params.push(`%"${t}"%`);
    }
    clauses.push(`(${techClauses.join(' OR ')})`);
  }
  return {
    clause: clauses.length > 0 ? clauses.join(' AND ') : '',
    params,
  };
}

export function queryDense(
  db: Database.Database,
  queryEmbedding: Float32Array,
  opts: DenseQueryOpts = {},
): DenseHit[] {
  const topK = opts.topK ?? 10;
  const filter = buildFilterSql(opts, 'a');
  const innerK = filter.clause ? Math.max(topK * 4, 50) : topK;

  const sql = filter.clause
    ? `
      SELECT v.id AS id, v.distance AS distance
      FROM arch_artifacts_vec AS v
      JOIN arch_artifacts AS a ON a.id = v.id
      WHERE v.embedding MATCH ? AND k = ${innerK} AND ${filter.clause}
      ORDER BY v.distance
    `
    : `
      SELECT id, distance
      FROM arch_artifacts_vec
      WHERE embedding MATCH ? AND k = ${innerK}
      ORDER BY distance
    `;
  const buf = vecBuffer(queryEmbedding);
  const stmt = db.prepare(sql);
  const rows = filter.clause
    ? (stmt.all(buf, ...filter.params) as Array<{ id: string; distance: number }>)
    : (stmt.all(buf) as Array<{ id: string; distance: number }>);

  return rows.slice(0, topK).map((r) => ({
    id: r.id,
    score: Math.max(0, Math.min(1, (2 - r.distance) / 2)),
  }));
}

export function querySparse(
  db: Database.Database,
  queryText: string,
  opts: SparseQueryOpts = {},
): SparseHit[] {
  const topK = opts.topK ?? 10;
  const filter = buildFilterSql(opts, 'a');

  const sanitized = queryText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `${t}*`)
    .join(' OR ');
  if (sanitized.length === 0) return [];

  const sql = filter.clause
    ? `
      SELECT f.id AS id, bm25(arch_artifacts_fts) AS bm25
      FROM arch_artifacts_fts AS f
      JOIN arch_artifacts AS a ON a.id = f.id
      WHERE arch_artifacts_fts MATCH ? AND ${filter.clause}
      ORDER BY bm25
      LIMIT ${topK}
    `
    : `
      SELECT id, bm25(arch_artifacts_fts) AS bm25
      FROM arch_artifacts_fts
      WHERE arch_artifacts_fts MATCH ?
      ORDER BY bm25
      LIMIT ${topK}
    `;
  const stmt = db.prepare(sql);
  const rows = filter.clause
    ? (stmt.all(sanitized, ...filter.params) as Array<{ id: string; bm25: number }>)
    : (stmt.all(sanitized) as Array<{ id: string; bm25: number }>);
  return rows.map((r) => {
    const positive = -r.bm25;
    const normalized = 1 - Math.exp(-positive);
    return { id: r.id, score: Math.max(0, Math.min(1, normalized)) };
  });
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export function readArtifactById(
  db: Database.Database,
  id: string,
): ArchArtifactRow | undefined {
  const row = db.prepare(`SELECT * FROM arch_artifacts WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return rowToArchArtifact(row);
}

export function readArtifactsByIds(
  db: Database.Database,
  ids: string[],
): ArchArtifactRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM arch_artifacts WHERE id IN (${placeholders})`)
    .all(...ids) as Array<Record<string, unknown>>;
  return rows.map(rowToArchArtifact);
}

function rowToArchArtifact(row: Record<string, unknown>): ArchArtifactRow {
  return {
    id: row.id as string,
    kind: row.kind as ArchArtifactRow['kind'],
    project: row.project as ArchArtifactRow['project'],
    name: row.name as string,
    description: row.description as string,
    keySignature: (row.key_signature as string | null) ?? undefined,
    filePaths: JSON.parse((row.file_paths_json as string) ?? '[]'),
    entryPath: (row.entry_path as string | null) ?? undefined,
    routeSignature: (row.route_signature as string | null) ?? undefined,
    tableName: (row.table_name as string | null) ?? undefined,
    owningService: (row.owning_service as string | null) ?? undefined,
    packageName: (row.package_name as string | null) ?? undefined,
    designSystemTier: (row.design_system_tier as ArchArtifactRow['designSystemTier']) ?? undefined,
    techSubDomains: JSON.parse((row.tech_sub_domains_json as string) ?? '[]'),
    tags: JSON.parse((row.tags_json as string) ?? '[]'),
    metadataJson: (row.metadata_json as string) ?? '{}',
    source: row.source as ArchArtifactRow['source'],
    contentHash: (row.content_hash as string | null) ?? undefined,
    extractedAtCommit: (row.extracted_at_commit as string | null) ?? undefined,
    embeddingModel: row.embedding_model as string,
    embeddingDim: row.embedding_dim as number,
    embeddingVersion: row.embedding_version as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    dedupKey: row.dedup_key as string,
  };
}

export function readEdgesFrom(
  db: Database.Database,
  fromId: string,
  relation?: ArchEdgeRow['relation'],
): ArchEdgeRow[] {
  const rows = relation
    ? (db
        .prepare(`SELECT * FROM arch_edges WHERE from_id = ? AND relation = ?`)
        .all(fromId, relation) as Array<Record<string, unknown>>)
    : (db.prepare(`SELECT * FROM arch_edges WHERE from_id = ?`).all(fromId) as Array<Record<string, unknown>>);
  return rows.map(rowToArchEdge);
}

export function readEdgesTo(
  db: Database.Database,
  toId: string,
  relation?: ArchEdgeRow['relation'],
): ArchEdgeRow[] {
  const rows = relation
    ? (db
        .prepare(`SELECT * FROM arch_edges WHERE to_id = ? AND relation = ?`)
        .all(toId, relation) as Array<Record<string, unknown>>)
    : (db.prepare(`SELECT * FROM arch_edges WHERE to_id = ?`).all(toId) as Array<Record<string, unknown>>);
  return rows.map(rowToArchEdge);
}

function rowToArchEdge(row: Record<string, unknown>): ArchEdgeRow {
  return {
    id: row.id as string,
    fromId: row.from_id as string,
    toId: row.to_id as string,
    relation: row.relation as ArchEdgeRow['relation'],
    weight: row.weight as number,
    metadataJson: (row.metadata_json as string) ?? '{}',
    source: row.source as ArchEdgeRow['source'],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

// ─── Extract-run logging ────────────────────────────────────────────────────

export interface ExtractRunRow {
  id: string;
  extractor: string;
  startedAt: number;
  finishedAt?: number | null;
  durationMs?: number | null;
  commitSha?: string | null;
  artifactsInserted: number;
  artifactsUpdated: number;
  artifactsUnchanged: number;
  edgesInserted: number;
  edgesUpdated: number;
  error?: string | null;
  metadataJson?: string;
}

export function recordExtractRun(db: Database.Database, row: ExtractRunRow): void {
  db.prepare(
    `
    INSERT INTO arch_extract_runs (
      id, extractor, started_at, finished_at, duration_ms, commit_sha,
      artifacts_inserted, artifacts_updated, artifacts_unchanged,
      edges_inserted, edges_updated, error, metadata_json
    ) VALUES (
      @id, @extractor, @started_at, @finished_at, @duration_ms, @commit_sha,
      @artifacts_inserted, @artifacts_updated, @artifacts_unchanged,
      @edges_inserted, @edges_updated, @error, @metadata_json
    )
  `,
  ).run({
    id: row.id,
    extractor: row.extractor,
    started_at: row.startedAt,
    finished_at: row.finishedAt ?? null,
    duration_ms: row.durationMs ?? null,
    commit_sha: row.commitSha ?? null,
    artifacts_inserted: row.artifactsInserted,
    artifacts_updated: row.artifactsUpdated,
    artifacts_unchanged: row.artifactsUnchanged,
    edges_inserted: row.edgesInserted,
    edges_updated: row.edgesUpdated,
    error: row.error ?? null,
    metadata_json: row.metadataJson ?? '{}',
  });
}
