// Sqlite store for the prompt cache.
//
// Two tables (split intentionally — the exact-hash path doesn't even need
// to load the embedding):
//
//   exact   (hash, namespace, model, response, created_at)
//           Primary lookup is by sha256 hash of (model, namespace, system, prompt).
//
//   semantic(id, namespace, model, prompt, embedding, response, created_at)
//           Looked up after an exact miss: load all rows in (namespace, model),
//           compute cosine similarity against the query embedding, return the
//           top hit if it clears the threshold.
//
// Why two tables and not just the semantic one with an extra hash column?
// The exact path runs on every call and we want it to be a single keyed
// SELECT — no row scan, no embedding deserialization, no cosine math. The
// semantic path is the slow path; keeping it split makes the cost model
// obvious in profiles.

import BetterSqlite3 from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import type { CachedResponse } from './types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS exact (
  hash TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  model TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS exact_ns_model ON exact(namespace, model);

CREATE TABLE IF NOT EXISTS semantic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  embedding BLOB NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS semantic_ns_model ON semantic(namespace, model);
`;

interface ExactRow {
  hash: string;
  payload: string;
  created_at: number;
}

interface SemanticRow {
  id: number;
  prompt: string;
  embedding: Buffer;
  payload: string;
  created_at: number;
}

export class CacheStore {
  private readonly db: Database;
  private readonly insertExact: ReturnType<Database['prepare']>;
  private readonly getExact: ReturnType<Database['prepare']>;
  private readonly insertSemantic: ReturnType<Database['prepare']>;
  private readonly listSemantic: ReturnType<Database['prepare']>;
  private readonly countExact: ReturnType<Database['prepare']>;
  private readonly countSemantic: ReturnType<Database['prepare']>;
  private readonly evictExact: ReturnType<Database['prepare']>;
  private readonly evictSemantic: ReturnType<Database['prepare']>;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);

    this.insertExact = this.db.prepare(
      `INSERT OR REPLACE INTO exact (hash, namespace, model, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.getExact = this.db.prepare(
      `SELECT hash, payload, created_at FROM exact WHERE hash = ?`,
    );
    this.insertSemantic = this.db.prepare(
      `INSERT INTO semantic (namespace, model, prompt, embedding, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.listSemantic = this.db.prepare(
      `SELECT id, prompt, embedding, payload, created_at
         FROM semantic
        WHERE namespace = ? AND model = ?
        ORDER BY id DESC
        LIMIT ?`,
    );
    this.countExact = this.db.prepare(
      `SELECT COUNT(*) as n FROM exact`,
    );
    this.countSemantic = this.db.prepare(
      `SELECT COUNT(*) as n FROM semantic`,
    );
    this.evictExact = this.db.prepare(
      `DELETE FROM exact WHERE created_at < ?`,
    );
    this.evictSemantic = this.db.prepare(
      `DELETE FROM semantic WHERE created_at < ?`,
    );
  }

  close(): void {
    this.db.close();
  }

  putExact(
    hash: string,
    namespace: string,
    model: string,
    value: CachedResponse,
    createdAt: number,
  ): void {
    (
      this.insertExact.run as (
        hash: string,
        ns: string,
        m: string,
        payload: string,
        ts: number,
      ) => void
    )(hash, namespace, model, JSON.stringify(value), createdAt);
  }

  getExactByHash(hash: string): { value: CachedResponse; createdAt: number } | undefined {
    const row = (this.getExact.get as (h: string) => ExactRow | undefined)(hash);
    if (!row) return undefined;
    return {
      value: JSON.parse(row.payload) as CachedResponse,
      createdAt: row.created_at,
    };
  }

  putSemantic(
    namespace: string,
    model: string,
    prompt: string,
    embedding: Float32Array,
    value: CachedResponse,
    createdAt: number,
  ): void {
    (
      this.insertSemantic.run as (
        ns: string,
        m: string,
        prompt: string,
        emb: Buffer,
        payload: string,
        ts: number,
      ) => void
    )(
      namespace,
      model,
      prompt,
      Buffer.from(
        embedding.buffer,
        embedding.byteOffset,
        embedding.byteLength,
      ),
      JSON.stringify(value),
      createdAt,
    );
  }

  /**
   * Iterate the most recent N rows in (namespace, model). Caller decides
   * how many to scan. Returns rows in newest-first order so the caller
   * can short-circuit on a high-similarity match.
   */
  listSemanticRows(
    namespace: string,
    model: string,
    limit: number,
  ): Array<{
    id: number;
    prompt: string;
    embedding: Float32Array;
    value: CachedResponse;
    createdAt: number;
  }> {
    const rows = (
      this.listSemantic.all as (
        ns: string,
        m: string,
        n: number,
      ) => SemanticRow[]
    )(namespace, model, limit);
    return rows.map((row) => ({
      id: row.id,
      prompt: row.prompt,
      embedding: bufferToFloat32(row.embedding),
      value: JSON.parse(row.payload) as CachedResponse,
      createdAt: row.created_at,
    }));
  }

  countAll(): { exact: number; semantic: number } {
    const e = (this.countExact.get as () => { n: number })();
    const s = (this.countSemantic.get as () => { n: number })();
    return { exact: e.n, semantic: s.n };
  }

  /** Evict rows older than the given epoch-ms threshold. */
  evictOlderThan(cutoffEpochMs: number): { exact: number; semantic: number } {
    const e = this.evictExact.run(cutoffEpochMs);
    const s = this.evictSemantic.run(cutoffEpochMs);
    return {
      exact: Number(e.changes ?? 0),
      semantic: Number(s.changes ?? 0),
    };
  }
}

function bufferToFloat32(buf: Buffer): Float32Array {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Float32Array(ab);
}
