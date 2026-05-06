/**
 * SQLite-backed precedent index store for Librarian Phase-1.
 *
 * Schema (`<memoryDir>/_librarian-index.sqlite`):
 *
 *   table precedent(
 *     id              INTEGER PRIMARY KEY AUTOINCREMENT,
 *     source_path     TEXT NOT NULL UNIQUE,
 *     kind            TEXT NOT NULL,         -- one of types.ts ALL_PRECEDENT_KINDS
 *     slug            TEXT NOT NULL,
 *     mtime_ms        INTEGER NOT NULL,
 *     content_sha256  TEXT NOT NULL,
 *     content_snippet TEXT NOT NULL,         -- first 4 KB of the file
 *     embedding_dim   INTEGER NOT NULL,
 *     embedding_blob  BLOB NOT NULL,         -- Float32 LE buffer
 *     indexed_at_ms   INTEGER NOT NULL
 *   );
 *
 *   table meta(
 *     key             TEXT PRIMARY KEY,
 *     value           TEXT NOT NULL
 *   );
 *
 *   index precedent_kind  on precedent(kind);
 *   index precedent_mtime on precedent(mtime_ms);
 *
 * Why no sqlite-vec extension: the expected scale (≤ a few thousand
 * precedent rows) makes JS-side cosine-similarity scans both fast (<5ms)
 * and portable. sqlite-vec brings native binary install hassle (per-OS,
 * per-arch) for no win at this scale. Same conclusion as Mentor.
 *
 * Why a SEPARATE DB from Mentor: see `librarian-agent-analysis.md` —
 * Mentor's read-only contract on `_mentor-index.sqlite` would break if
 * the kind column gained new values, and the rebuild cadences differ
 * (Mentor rebuilds rarely; Librarian rebuilds whenever a new report
 * lands, which is multiple times per leg).
 *
 * Concurrency: WAL mode + foreign-keys-on. Multiple readers may run
 * concurrently with writes. Only the index builder opens read-write.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';

import Database from 'better-sqlite3';

import type { IndexedPrecedent, PrecedentKind } from './types.js';
import { isPrecedentKind } from './types.js';

/** Filename of the index DB under `<memoryDir>/`. */
export const INDEX_DB_FILENAME = '_librarian-index.sqlite';

/** Snapshot length for the human-readable preview of a precedent row. */
export const SNIPPET_MAX_BYTES = 4096;

/** Resolve `<memoryDir>/_librarian-index.sqlite`. */
export function indexDbPath(memoryDir: string): string {
  return join(pathResolve(memoryDir), INDEX_DB_FILENAME);
}

export interface IndexStoreOptions {
  /** memoryDir to root the index under. */
  memoryDir: string;
  /** Override the path entirely (tests use this). */
  dbPath?: string;
  /** If true, DB connection opens read-only. Used by retrieval. */
  readonly?: boolean;
}

export interface IndexStore {
  /** Underlying better-sqlite3 handle. Exposed for tests + future callers. */
  db: Database.Database;
  /** Filesystem path the DB was opened at. */
  dbPath: string;
  /** Insert-or-replace a single row. */
  upsertPrecedent(p: Omit<IndexedPrecedent, 'id'>): void;
  /** List all rows, ordered deterministically by source_path. */
  listAll(): IndexedPrecedent[];
  /** Count rows grouped by kind. */
  countByKind(): Record<string, number>;
  /** Get a row by source path; returns null if absent. */
  getBySourcePath(p: string): IndexedPrecedent | null;
  /** Delete a row by source path. Returns true if a row was removed. */
  deleteBySourcePath(p: string): boolean;
  /** Read a meta key. Returns null if unset. */
  getMeta(key: string): string | null;
  /** Write a meta key. Caller's responsibility to JSON-encode complex values. */
  setMeta(key: string, value: string): void;
  /** Close the connection. Idempotent. */
  close(): void;
}

/**
 * Open (or initialize) the index store at `<memoryDir>/_librarian-index.sqlite`.
 * The parent directory is created if missing.
 */
export function openIndexStore(opts: IndexStoreOptions): IndexStore {
  const dbPath = opts.dbPath ?? indexDbPath(opts.memoryDir);
  const parent = dirname(dbPath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }

  const dbOptions: Database.Options = opts.readonly === true
    ? { readonly: true, fileMustExist: true }
    : {};
  const db = new Database(dbPath, dbOptions);

  if (opts.readonly !== true) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }

  return makeStore(db, dbPath);
}

/**
 * Initialize the schema. Idempotent — safe to call on an existing DB
 * because every statement is `CREATE ... IF NOT EXISTS`.
 */
function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS precedent (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path     TEXT NOT NULL UNIQUE,
      kind            TEXT NOT NULL,
      slug            TEXT NOT NULL,
      mtime_ms        INTEGER NOT NULL,
      content_sha256  TEXT NOT NULL,
      content_snippet TEXT NOT NULL,
      embedding_dim   INTEGER NOT NULL,
      embedding_blob  BLOB NOT NULL,
      indexed_at_ms   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS precedent_kind  ON precedent(kind);
    CREATE INDEX IF NOT EXISTS precedent_mtime ON precedent(mtime_ms);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function makeStore(db: Database.Database, dbPath: string): IndexStore {
  const upsertStmt = db.prepare(`
    INSERT INTO precedent
      (source_path, kind, slug, mtime_ms, content_sha256,
       content_snippet, embedding_dim, embedding_blob, indexed_at_ms)
    VALUES (@sourcePath, @kind, @slug, @mtimeMs, @contentSha256,
            @contentSnippet, @embeddingDim, @embedding, @indexedAtMs)
    ON CONFLICT(source_path) DO UPDATE SET
      kind            = excluded.kind,
      slug            = excluded.slug,
      mtime_ms        = excluded.mtime_ms,
      content_sha256  = excluded.content_sha256,
      content_snippet = excluded.content_snippet,
      embedding_dim   = excluded.embedding_dim,
      embedding_blob  = excluded.embedding_blob,
      indexed_at_ms   = excluded.indexed_at_ms
  `);

  const listAllStmt = db.prepare(`
    SELECT id, source_path AS sourcePath, kind, slug, mtime_ms AS mtimeMs,
           content_sha256 AS contentSha256, content_snippet AS contentSnippet,
           embedding_dim AS embeddingDim, embedding_blob AS embedding,
           indexed_at_ms AS indexedAtMs
    FROM precedent
    ORDER BY source_path ASC
  `);

  const countByKindStmt = db.prepare(`
    SELECT kind, COUNT(*) AS n FROM precedent GROUP BY kind ORDER BY kind ASC
  `);

  const getStmt = db.prepare(`
    SELECT id, source_path AS sourcePath, kind, slug, mtime_ms AS mtimeMs,
           content_sha256 AS contentSha256, content_snippet AS contentSnippet,
           embedding_dim AS embeddingDim, embedding_blob AS embedding,
           indexed_at_ms AS indexedAtMs
    FROM precedent
    WHERE source_path = ?
  `);

  const deleteStmt = db.prepare(`DELETE FROM precedent WHERE source_path = ?`);

  const metaGetStmt = db.prepare(`SELECT value FROM meta WHERE key = ?`);
  const metaSetStmt = db.prepare(
    `INSERT INTO meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  let closed = false;

  return {
    db,
    dbPath,
    upsertPrecedent(p) {
      upsertStmt.run({
        sourcePath: p.sourcePath,
        kind: p.kind,
        slug: p.slug,
        mtimeMs: p.mtimeMs,
        contentSha256: p.contentSha256,
        contentSnippet: p.contentSnippet,
        embeddingDim: p.embeddingDim,
        embedding: p.embedding,
        indexedAtMs: p.indexedAtMs
      });
    },
    listAll() {
      const rows = listAllStmt.all() as RawRow[];
      return rows.map(rowToPrecedent);
    },
    countByKind() {
      const rows = countByKindStmt.all() as Array<{ kind: string; n: number }>;
      const out: Record<string, number> = {};
      for (const r of rows) out[r.kind] = r.n;
      return out;
    },
    getBySourcePath(p) {
      const row = getStmt.get(p) as RawRow | undefined;
      if (!row) return null;
      return rowToPrecedent(row);
    },
    deleteBySourcePath(p) {
      const info = deleteStmt.run(p);
      return info.changes > 0;
    },
    getMeta(key) {
      const row = metaGetStmt.get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },
    setMeta(key, value) {
      metaSetStmt.run(key, value);
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    }
  };
}

interface RawRow {
  id: number;
  sourcePath: string;
  kind: string;
  slug: string;
  mtimeMs: number;
  contentSha256: string;
  contentSnippet: string;
  embeddingDim: number;
  embedding: Buffer;
  indexedAtMs: number;
}

function rowToPrecedent(r: RawRow): IndexedPrecedent {
  // Be permissive: an unrecognized kind from a future schema version
  // should NOT crash retrieval — coerce to 'other' and let the caller
  // see something rather than nothing.
  const kind: PrecedentKind = isPrecedentKind(r.kind) ? r.kind : 'other';
  return {
    id: r.id,
    sourcePath: r.sourcePath,
    kind,
    slug: r.slug,
    mtimeMs: r.mtimeMs,
    contentSha256: r.contentSha256,
    contentSnippet: r.contentSnippet,
    embeddingDim: r.embeddingDim,
    embedding: r.embedding,
    indexedAtMs: r.indexedAtMs
  };
}
