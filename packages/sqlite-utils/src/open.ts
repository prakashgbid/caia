/**
 * `openDb` — open (or create) a SQLite database file with the canonical
 * CAIA pragma set. Lifted from the pattern that recurs across at least
 * five workspace packages (mentor-event-bus, librarian, mentor-retrieval,
 * llm-cache, local-rag) where every site re-implements:
 *
 *   1. ensure the parent directory exists (mkdirSync, recursive)
 *   2. `new Database(path)` (or `:memory:` for tests)
 *   3. `pragma('journal_mode = WAL')` unless in-memory
 *   4. `pragma('foreign_keys = ON')`
 *
 * Centralising this in one place means a future hardening pass (e.g.
 * `pragma('synchronous = NORMAL')` everywhere; a global busy_timeout)
 * lands once instead of in nine src files.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database, { type Database as DatabaseInstance, type Options as BetterSqlite3Options } from 'better-sqlite3';

export interface OpenDbOptions {
  /**
   * Enable WAL journal mode. Default: `true` for disk-backed paths,
   * forced `false` for `:memory:` (WAL is meaningless without a file).
   *
   * WAL gives concurrent readers + a single writer, with crash-safe
   * commits. The only reason to disable it is the rare in-memory test
   * fixture that doesn't open a file at all.
   */
  wal?: boolean;
  /**
   * Enable foreign-key enforcement. Default: `true`. Off only for the
   * rare schema that explicitly relies on dangling references during
   * migration (none in caia today, but the escape hatch is here).
   */
  foreignKeys?: boolean;
  /**
   * Set `pragma synchronous = NORMAL` after enabling WAL. Default:
   * `true`. NORMAL is the documented safe-with-WAL setting; it trades
   * a sub-microsecond commit speed-up for the same fsync guarantee
   * WAL already provides. The librarian and mentor-retrieval index
   * stores already do this; centralising it here means new consumers
   * get the same default without having to remember it.
   */
  synchronousNormal?: boolean;
  /**
   * Open the database read-only. Default: `false`. When `true`, the
   * function passes `{ readonly: true, fileMustExist: true }` to
   * better-sqlite3 and skips the writable pragmas (WAL / synchronous
   * / foreign_keys), since they are forbidden on read-only handles.
   *
   * Used by retrieval-only callers (e.g. the librarian Phase-2 reader
   * that opens the index DB while the builder is writing).
   */
  readonly?: boolean;
  /**
   * Pass-through to `new Database(path, options)`. Use for advanced
   * cases like `timeout` or `verbose`. The fields above (`readonly`,
   * `fileMustExist`) are filled in from this struct automatically;
   * if you set them here as well, the explicit option wins.
   */
  betterSqlite3?: BetterSqlite3Options;
  /**
   * Create the parent directory if missing. Default: `true`. Only
   * disable if the caller has already done the mkdirSync (e.g. a
   * test harness creating a known directory once per suite).
   *
   * Ignored when path is `:memory:` — there's no file to root.
   */
  ensureDir?: boolean;
}

/**
 * Open a SQLite database at `path`. Returns a connected
 * `better-sqlite3` handle with the canonical CAIA pragma set
 * applied. The caller owns `.close()`.
 *
 * @example
 * ```ts
 * import { openDb } from '@chiefaia/sqlite-utils';
 *
 * const db = openDb('/data/events.sqlite');
 * try {
 *   db.exec('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY)');
 * } finally {
 *   db.close();
 * }
 * ```
 *
 * @example In-memory test fixture
 * ```ts
 * const db = openDb(':memory:'); // WAL/synchronous skipped, FK on
 * ```
 */
export function openDb(path: string, opts: OpenDbOptions = {}): DatabaseInstance {
  const isMemory = path === ':memory:';
  const readonly = opts.readonly === true;

  if (!isMemory && opts.ensureDir !== false && !readonly) {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const baseOpts: BetterSqlite3Options = readonly
    ? { readonly: true, fileMustExist: true }
    : {};
  const dbOpts: BetterSqlite3Options = { ...baseOpts, ...(opts.betterSqlite3 ?? {}) };

  const db = new Database(path, dbOpts);

  // The read-only handle disallows pragma writes; better-sqlite3 raises
  // SQLITE_READONLY on any of these. Skip the writable pragmas.
  if (readonly) {
    return db;
  }

  if (!isMemory && opts.wal !== false) {
    db.pragma('journal_mode = WAL');
    if (opts.synchronousNormal !== false) {
      db.pragma('synchronous = NORMAL');
    }
  }
  // better-sqlite3 enables foreign_keys by default (raw SQLite leaves them
  // OFF). To honour `foreignKeys: false` we have to explicitly disable;
  // setting ON is otherwise a no-op but kept for clarity and to insulate
  // against a future better-sqlite3 default flip.
  if (opts.foreignKeys === false) {
    db.pragma('foreign_keys = OFF');
  } else {
    db.pragma('foreign_keys = ON');
  }

  return db;
}
