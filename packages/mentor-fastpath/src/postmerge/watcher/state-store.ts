/**
 * State store for the postmerge watcher.
 *
 * Tracks which merged PRs and which failed workflow runs we have
 * already emitted events for, so the watcher is idempotent across
 * restarts.
 *
 * Schema (single sqlite file, separate from the event-bus DB):
 *
 *   table seen_prs:
 *     pr_number INTEGER PRIMARY KEY,
 *     merge_sha TEXT,
 *     merged_at TEXT,
 *     emitted_event_id TEXT,
 *     processed_at TEXT
 *
 *   table seen_runs:
 *     run_id INTEGER PRIMARY KEY,
 *     head_sha TEXT,
 *     updated_at TEXT,
 *     emitted_event_id TEXT,
 *     processed_at TEXT
 *
 *   table cursor:
 *     id INTEGER PRIMARY KEY CHECK (id = 1),
 *     last_pr_query_iso TEXT,
 *     last_run_query_iso TEXT
 *
 * The cursor table holds the rolling "since" timestamp so subsequent
 * polls don't re-fetch the entire history every time.
 *
 * All public functions are synchronous (better-sqlite3 is sync). Safe
 * to call from a long-running daemon's tick handler.
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Open or create the state-store DB. Idempotent. */
export function openStateStore(path: string): DatabaseInstance {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_prs (
      pr_number       INTEGER PRIMARY KEY,
      merge_sha       TEXT,
      merged_at       TEXT,
      emitted_event_id TEXT,
      processed_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seen_runs (
      run_id          INTEGER PRIMARY KEY,
      head_sha        TEXT,
      updated_at      TEXT,
      emitted_event_id TEXT,
      processed_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cursor (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_pr_query_iso  TEXT,
      last_run_query_iso TEXT
    );
    INSERT OR IGNORE INTO cursor (id, last_pr_query_iso, last_run_query_iso)
      VALUES (1, NULL, NULL);
  `);
  return db;
}

export interface CursorState {
  lastPrQueryIso: string | null;
  lastRunQueryIso: string | null;
}

export function getCursor(db: DatabaseInstance): CursorState {
  const row = db
    .prepare('SELECT last_pr_query_iso, last_run_query_iso FROM cursor WHERE id = 1')
    .get() as
    | { last_pr_query_iso: string | null; last_run_query_iso: string | null }
    | undefined;
  return {
    lastPrQueryIso: row?.last_pr_query_iso ?? null,
    lastRunQueryIso: row?.last_run_query_iso ?? null
  };
}

export function setCursor(
  db: DatabaseInstance,
  state: Partial<CursorState>
): void {
  // Read-modify-write — only update fields the caller passed.
  const cur = getCursor(db);
  const next: CursorState = {
    lastPrQueryIso: state.lastPrQueryIso ?? cur.lastPrQueryIso,
    lastRunQueryIso: state.lastRunQueryIso ?? cur.lastRunQueryIso
  };
  db.prepare(
    `UPDATE cursor SET last_pr_query_iso = @last_pr_query_iso,
                       last_run_query_iso = @last_run_query_iso
       WHERE id = 1`
  ).run({
    last_pr_query_iso: next.lastPrQueryIso,
    last_run_query_iso: next.lastRunQueryIso
  });
}

export function isPrSeen(db: DatabaseInstance, prNumber: number): boolean {
  const r = db
    .prepare('SELECT 1 FROM seen_prs WHERE pr_number = @pr')
    .get({ pr: prNumber });
  return r !== undefined;
}

export function recordPrSeen(
  db: DatabaseInstance,
  rec: {
    prNumber: number;
    mergeSha: string;
    mergedAt: string;
    emittedEventId: string | null;
    processedAt: string;
  }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO seen_prs
       (pr_number, merge_sha, merged_at, emitted_event_id, processed_at)
       VALUES (@pr_number, @merge_sha, @merged_at, @emitted_event_id, @processed_at)`
  ).run({
    pr_number: rec.prNumber,
    merge_sha: rec.mergeSha,
    merged_at: rec.mergedAt,
    emitted_event_id: rec.emittedEventId,
    processed_at: rec.processedAt
  });
}

export function isRunSeen(db: DatabaseInstance, runId: number): boolean {
  const r = db
    .prepare('SELECT 1 FROM seen_runs WHERE run_id = @id')
    .get({ id: runId });
  return r !== undefined;
}

export function recordRunSeen(
  db: DatabaseInstance,
  rec: {
    runId: number;
    headSha: string;
    updatedAt: string;
    emittedEventId: string | null;
    processedAt: string;
  }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO seen_runs
       (run_id, head_sha, updated_at, emitted_event_id, processed_at)
       VALUES (@run_id, @head_sha, @updated_at, @emitted_event_id, @processed_at)`
  ).run({
    run_id: rec.runId,
    head_sha: rec.headSha,
    updated_at: rec.updatedAt,
    emitted_event_id: rec.emittedEventId,
    processed_at: rec.processedAt
  });
}

export function countSeenPrs(db: DatabaseInstance): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM seen_prs').get() as { n: number };
  return r.n;
}

export function countSeenRuns(db: DatabaseInstance): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM seen_runs').get() as { n: number };
  return r.n;
}
