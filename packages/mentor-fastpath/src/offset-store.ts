/**
 * Per-consumer offset tracking for the fast-path consumer.
 *
 * The consumer polls the events.sqlite for new OperatorCorrection events
 * since its last-processed `ingest_offset`. To survive daemon restarts,
 * we persist the offset + a per-event audit trail in a small SQLite
 * database (separate from the main event bus DB so writes don't contend
 * with the high-throughput event-bus producers).
 *
 * Schema (created on first open):
 *
 *   CREATE TABLE IF NOT EXISTS processed_events (
 *     event_id            TEXT PRIMARY KEY,
 *     ingest_offset       INTEGER NOT NULL,
 *     processed_at        TEXT NOT NULL,
 *     classification_json TEXT NOT NULL,
 *     artifact_ref        TEXT
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_processed_offset ON processed_events(ingest_offset);
 *
 * Trust boundary: dbPath comes from the consumer caller (production
 * usage threads it from CLI flag / env). No untrusted input reaches the
 * SQL — all queries are parameterised.
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';

import type { ProcessedRecord } from './types.js';

/**
 * Open the offset DB and create the schema if missing. Returns a handle
 * the caller is responsible for closing (call `close(db)` on shutdown).
 *
 * The DB is opened with WAL mode for concurrent reader compatibility
 * with the producer (mentor-event-bus already uses WAL).
 */
export function openOffsetDb(dbPath: string): DatabaseInstance {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id            TEXT PRIMARY KEY,
      ingest_offset       INTEGER NOT NULL,
      processed_at        TEXT NOT NULL,
      classification_json TEXT NOT NULL,
      artifact_ref        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_processed_offset
      ON processed_events(ingest_offset);
  `);
  return db;
}

/** Close the offset DB. */
export function close(db: DatabaseInstance): void {
  db.close();
}

/**
 * Get the highest `ingest_offset` we've already processed. Returns 0 if
 * the table is empty (consumer should then start at offset 0 and pick up
 * everything currently in events.sqlite).
 */
export function getLastProcessedOffset(db: DatabaseInstance): number {
  const row = db
    .prepare('SELECT MAX(ingest_offset) AS max_off FROM processed_events')
    .get() as { max_off: number | null } | undefined;
  return row?.max_off ?? 0;
}

/**
 * Record that we've processed an event. Idempotent: re-recording the
 * same event_id is a no-op (PRIMARY KEY conflict is silently ignored).
 *
 * The consumer calls this AFTER successfully classifying + (in later
 * PRs) synthesizing the lesson — so a crashed/aborted run on a given
 * event will retry on the next iteration.
 */
export function recordProcessed(
  db: DatabaseInstance,
  rec: ProcessedRecord
): void {
  db.prepare(
    `INSERT OR IGNORE INTO processed_events
       (event_id, ingest_offset, processed_at, classification_json, artifact_ref)
       VALUES (@event_id, @ingest_offset, @processed_at, @classification_json, @artifact_ref)`
  ).run(rec);
}

/**
 * Has this event already been processed? Used by the consumer to skip
 * events the offset store says are already done — defence in depth on
 * top of the offset cursor.
 */
export function isProcessed(db: DatabaseInstance, eventId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS one FROM processed_events WHERE event_id = ?')
    .get(eventId) as { one: number } | undefined;
  return row !== undefined;
}

/**
 * Count of processed events. Useful for status / progress reporting.
 */
export function countProcessed(db: DatabaseInstance): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM processed_events')
    .get() as { n: number } | undefined;
  return row?.n ?? 0;
}
