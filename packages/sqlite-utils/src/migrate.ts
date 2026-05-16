/**
 * `migrate` — apply file-backed SQL migrations idempotently.
 *
 * Lifted from the mentor-event-bus implementation, which is the most
 * complete site (it already handled the missing-dir case + the
 * already-applied case + the transactional-per-file case). The
 * surface here is unchanged in shape so the donor can re-export it
 * with no behavior delta.
 *
 * Contract:
 *   - Migration files live under `migrationsDir/` with `.sql` suffix.
 *   - Files run in lexicographic-sort order (use a numeric prefix:
 *     `0001_init.sql`, `0002_add_index.sql`, ...).
 *   - The tracking table is named `_migrations` with `filename`
 *     primary key + `applied_at` ISO timestamp.
 *   - Each file's `db.exec(sql)` + the tracking row insert run in a
 *     single transaction, so a failure mid-file leaves the previous
 *     state intact and re-running re-attempts from that file.
 *   - Files already in `_migrations` are skipped — re-running on the
 *     same DB is a no-op.
 *   - Missing `migrationsDir` is treated as a no-op (e.g. tests using
 *     `:memory:` with hand-written schema and no real migrations
 *     folder, which is the existing pattern in mentor-event-bus).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Database as DatabaseInstance } from 'better-sqlite3';

const TRACKING_TABLE = '_migrations';

export interface MigrateOptions {
  /**
   * Subset of files to apply. Default: every `*.sql` in `migrationsDir`.
   * Files outside this list are simply not considered. Used by the
   * mentor-event-bus + librarian split-migration tests where the
   * harness wants to drive applied-state in N steps.
   */
  only?: readonly string[];
  /**
   * Override the tracking-table name. Default: `_migrations`. The only
   * reason to change this is a legacy database that pre-existed this
   * helper with a different convention.
   */
  trackingTable?: string;
}

export interface MigrationReport {
  /** Files in `migrationsDir` that were considered for this run. */
  considered: readonly string[];
  /** Files actually applied this call (not present in `_migrations`). */
  applied: readonly string[];
  /** Files skipped because they were already in `_migrations`. */
  skipped: readonly string[];
}

/**
 * Apply every unapplied `.sql` file in `migrationsDir`, in lex-sort
 * order, in its own transaction, recording success in `_migrations`.
 *
 * Returns a `MigrationReport` describing which files were considered,
 * applied, and skipped. Re-running on an unchanged tree returns
 * `applied = []` and `skipped = everything`.
 *
 * @throws if any migration file fails — the transaction rolls back
 * and `_migrations` does not record the failed filename, so the next
 * call re-attempts it.
 */
export function migrate(
  db: DatabaseInstance,
  migrationsDir: string,
  opts: MigrateOptions = {},
): MigrationReport {
  const tracking = opts.trackingTable ?? TRACKING_TABLE;
  ensureTrackingTable(db, tracking);

  if (!existsSync(migrationsDir)) {
    return { considered: [], applied: [], skipped: [] };
  }

  const allFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const considered = opts.only
    ? allFiles.filter((f) => opts.only?.includes(f))
    : allFiles;

  const appliedSet = new Set<string>(
    (db.prepare(`SELECT filename FROM ${tracking}`).all() as Array<{ filename: string }>)
      .map((r) => r.filename),
  );

  const insertMigration = db.prepare(
    `INSERT INTO ${tracking}(filename, applied_at) VALUES(?, ?)`,
  );

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const f of considered) {
    if (appliedSet.has(f)) {
      skipped.push(f);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, f), 'utf-8');
    db.transaction(() => {
      db.exec(sql);
      insertMigration.run(f, new Date().toISOString());
    })();
    applied.push(f);
  }

  return { considered, applied, skipped };
}

/**
 * Has the migrations runner been initialised against this DB?
 *
 * `true` if `_migrations` exists. Used by callers that need to
 * branch on "is this a fresh DB?" before calling `migrate`.
 */
export function isMigrationsInitialised(
  db: DatabaseInstance,
  trackingTable: string = TRACKING_TABLE,
): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(trackingTable) as { name: string } | undefined;
  return row !== undefined;
}

/**
 * Lists every migration filename recorded in `_migrations`. Returned
 * in `applied_at` order (chronological).
 */
export function listAppliedMigrations(
  db: DatabaseInstance,
  trackingTable: string = TRACKING_TABLE,
): readonly string[] {
  if (!isMigrationsInitialised(db, trackingTable)) return [];
  const rows = db
    .prepare(`SELECT filename FROM ${trackingTable} ORDER BY applied_at ASC, filename ASC`)
    .all() as Array<{ filename: string }>;
  return rows.map((r) => r.filename);
}

function ensureTrackingTable(db: DatabaseInstance, trackingTable: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${trackingTable} (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}
