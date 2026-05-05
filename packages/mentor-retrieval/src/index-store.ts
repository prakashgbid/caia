/**
 * SQLite-backed lesson index store.
 *
 * Schema (`<memoryDir>/_mentor-index.sqlite`):
 *
 *   table lessons(
 *     id              INTEGER PRIMARY KEY AUTOINCREMENT,
 *     source_path     TEXT NOT NULL UNIQUE,
 *     kind            TEXT NOT NULL,         -- 'feedback' | 'proposal'
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
 *   index lessons_kind on lessons(kind);
 *
 * Why no sqlite-vec extension: the expected scale (≤ a few thousand
 * lessons) makes JS-side cosine-similarity scans both fast (<5ms) and
 * portable. sqlite-vec brings native binary install hassle (per-OS,
 * per-arch) for no win at this scale.
 *
 * Concurrency: the index DB is opened read-write only inside the
 * builder process. WAL mode is enabled so other readers (the Phase-3
 * PR-2 retrieval CLI) can run concurrently without blocking writes.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';

import Database from 'better-sqlite3';

import type { IndexedLesson, LessonKind } from './types.js';

/** Filename of the index DB under `<memoryDir>/`. */
export const INDEX_DB_FILENAME = '_mentor-index.sqlite';

/** Snapshot length for the human-readable preview of a lesson. */
export const SNIPPET_MAX_BYTES = 4096;

/** Resolve `<memoryDir>/_mentor-index.sqlite`. */
export function indexDbPath(memoryDir: string): string {
  return join(pathResolve(memoryDir), INDEX_DB_FILENAME);
}

export interface IndexStoreOptions {
  /** memoryDir to root the index under. */
  memoryDir: string;
  /** Override the path entirely (tests use this). */
  dbPath?: string;
  /** If true, DB connection opens read-only. Used by retrieval (PR-2). */
  readonly?: boolean;
}

export interface IndexStore {
  /** Underlying better-sqlite3 handle. Exposed for tests + future callers. */
  db: Database.Database;
  /** Filesystem path the DB was opened at. */
  dbPath: string;
  /** Insert-or-replace a single row. */
  upsertLesson(lesson: Omit<IndexedLesson, 'id'>): void;
  /** List all rows, ordered deterministically by source_path. */
  listAll(): IndexedLesson[];
  /** Get a row by source path; returns null if absent. */
  getBySourcePath(p: string): IndexedLesson | null;
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
 * Open (or initialize) the index store at `<memoryDir>/_mentor-index.sqlite`.
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
    CREATE TABLE IF NOT EXISTS lessons (
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

    CREATE INDEX IF NOT EXISTS lessons_kind ON lessons(kind);
    CREATE INDEX IF NOT EXISTS lessons_mtime ON lessons(mtime_ms);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function makeStore(db: Database.Database, dbPath: string): IndexStore {
  const upsertStmt = db.prepare(`
    INSERT INTO lessons
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
    FROM lessons
    ORDER BY source_path ASC
  `);

  const getStmt = db.prepare(`
    SELECT id, source_path AS sourcePath, kind, slug, mtime_ms AS mtimeMs,
           content_sha256 AS contentSha256, content_snippet AS contentSnippet,
           embedding_dim AS embeddingDim, embedding_blob AS embedding,
           indexed_at_ms AS indexedAtMs
    FROM lessons
    WHERE source_path = ?
  `);

  const deleteStmt = db.prepare(`DELETE FROM lessons WHERE source_path = ?`);

  const metaGetStmt = db.prepare(`SELECT value FROM meta WHERE key = ?`);
  const metaSetStmt = db.prepare(
    `INSERT INTO meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  let closed = false;

  return {
    db,
    dbPath,
    upsertLesson(lesson) {
      upsertStmt.run({
        sourcePath: lesson.sourcePath,
        kind: lesson.kind,
        slug: lesson.slug,
        mtimeMs: lesson.mtimeMs,
        contentSha256: lesson.contentSha256,
        contentSnippet: lesson.contentSnippet,
        embeddingDim: lesson.embeddingDim,
        embedding: lesson.embedding,
        indexedAtMs: lesson.indexedAtMs
      });
    },
    listAll() {
      const rows = listAllStmt.all() as RawRow[];
      return rows.map(rowToLesson);
    },
    getBySourcePath(p) {
      const row = getStmt.get(p) as RawRow | undefined;
      if (!row) return null;
      return rowToLesson(row);
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

function rowToLesson(r: RawRow): IndexedLesson {
  if (r.kind !== 'feedback' && r.kind !== 'proposal') {
    throw new Error(
      `index DB has unexpected lesson kind ${JSON.stringify(r.kind)} for ${r.sourcePath}`
    );
  }
  return {
    id: r.id,
    sourcePath: r.sourcePath,
    kind: r.kind as LessonKind,
    slug: r.slug,
    mtimeMs: r.mtimeMs,
    contentSha256: r.contentSha256,
    contentSnippet: r.contentSnippet,
    embeddingDim: r.embeddingDim,
    embedding: r.embedding,
    indexedAtMs: r.indexedAtMs
  };
}
