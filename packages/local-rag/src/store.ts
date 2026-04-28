// Persistent vector store backed by better-sqlite3.
//
// We store one row per chunk: the chunk metadata + the embedding as a BLOB
// (Float32Array → Buffer). Search is exact cosine similarity, computed in
// JS over the entire table. That's O(N) per query, which is fine for the
// CAIA monorepo's expected ~50–100k chunks (≈ 50ms on M1 Pro).
//
// We deliberately do NOT use sqlite-vec here. It's a great extension but
// adds a native binary that we'd need to load via better-sqlite3's
// loadExtension API and ship across CI environments. For a 100k-chunk
// index the manual cosine path is simpler and has no extra moving parts.
// LAI-008 can swap to sqlite-vec if the index ever grows past ~1M chunks.

import BetterSqlite3 from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import type { EmbeddedChunk, RagHit } from './types.js';

interface StoredRow {
  id: string;
  path: string;
  start_line: number;
  end_line: number;
  content: string;
  embedding: Buffer;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class VectorStore {
  private readonly db: Database;
  private readonly insertStmt: ReturnType<Database['prepare']>;
  private readonly clearForPathStmt: ReturnType<Database['prepare']>;
  private readonly allStmt: ReturnType<Database['prepare']>;
  private readonly countStmt: ReturnType<Database['prepare']>;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);

    this.insertStmt = this.db.prepare(
      `INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, content, embedding)
       VALUES (@id, @path, @start_line, @end_line, @content, @embedding)`,
    );
    this.clearForPathStmt = this.db.prepare(
      `DELETE FROM chunks WHERE path = ?`,
    );
    this.allStmt = this.db.prepare(`SELECT * FROM chunks`);
    this.countStmt = this.db.prepare(`SELECT COUNT(*) as n FROM chunks`);
  }

  close(): void {
    this.db.close();
  }

  /** Insert (or replace) chunks. Wrapped in a transaction for atomicity. */
  upsert(chunks: EmbeddedChunk[]): void {
    const tx = this.db.transaction((rows: EmbeddedChunk[]) => {
      for (const row of rows) {
        this.insertStmt.run({
          id: row.id,
          path: row.path,
          start_line: row.startLine,
          end_line: row.endLine,
          content: row.content,
          embedding: Buffer.from(
            row.embedding.buffer,
            row.embedding.byteOffset,
            row.embedding.byteLength,
          ),
        });
      }
    });
    tx(chunks);
  }

  /** Remove all chunks for a given path (used on re-index). */
  clearForPath(path: string): void {
    this.clearForPathStmt.run(path);
  }

  /** Number of stored chunks. */
  count(): number {
    const row = (this.countStmt.get as () => { n: number })();
    return row.n;
  }

  /**
   * Brute-force cosine search. Loads all rows once per call; for typical
   * monorepo sizes (50–100k chunks) this is well under 100 ms on M1 Pro.
   */
  search(
    queryEmbedding: Float32Array,
    topK: number,
    minScore: number,
  ): RagHit[] {
    const queryNorm = norm(queryEmbedding);
    if (queryNorm === 0) return [];

    const rows = (this.allStmt.all as () => StoredRow[])();
    const hits: RagHit[] = [];

    for (const row of rows) {
      const embedding = bufferToFloat32(row.embedding);
      const score = cosine(
        queryEmbedding,
        embedding,
        queryNorm,
        norm(embedding),
      );
      if (score < minScore) continue;
      hits.push({
        chunk: {
          id: row.id,
          path: row.path,
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
        },
        score,
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  /** Read or write a meta key/value (used to record the embedding model). */
  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
      )
      .run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db
      .prepare(`SELECT value FROM meta WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value;
  }
}

function bufferToFloat32(buf: Buffer): Float32Array {
  // Copy into a fresh aligned ArrayBuffer; SQLite's BLOB returns a Buffer
  // that may share an underlying ArrayBuffer at an unaligned byte offset.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Float32Array(ab);
}

function norm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    sum += x * x;
  }
  return Math.sqrt(sum);
}

function cosine(
  a: Float32Array,
  b: Float32Array,
  normA: number,
  normB: number,
): number {
  if (normA === 0 || normB === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot / (normA * normB);
}
