/**
 * @chiefaia/test-isolation/sqlite
 *
 * Per-test ephemeral SQLite isolation (FIX-008).
 *
 * Each test that opts in gets its own throwaway database file at
 * `${tmpdir}/caia-test-<uuid>.sqlite`. Migrations are applied from a
 * caller-supplied folder; the file is deleted on teardown regardless of
 * whether the test passed or failed.
 *
 * Why a separate file per test?
 *   - SQLite WAL mode + concurrent writes from different processes is the
 *     well-known foot-gun. A unique file per test eliminates the entire
 *     class of "test A's writes leak into test B" flakes.
 *   - Each Playwright worker (FIX-010) and each remote Browserless
 *     session (FIX-007) needs its own isolated DB anyway.
 *
 * Design notes:
 *   - We use `node:crypto.randomUUID()` (Node 20+) — no `uuid` dep.
 *   - We do NOT use `:memory:` — production runs on disk-backed SQLite,
 *     and we want tests to catch quirks like text-typed integers and
 *     JSON-as-text that only manifest with the disk engine.
 *   - We attempt cleanup even if the process is interrupted by wiring a
 *     `process.on('exit')` hook for any DBs created in this run.
 *   - Cleanup is idempotent — calling `cleanup()` more than once is fine.
 *   - The caller-supplied schema (drizzle) is generic — this package
 *     does NOT depend on `apps/orchestrator/src/db/schema`. Each
 *     consumer wires their own schema; the orchestrator wires the
 *     orchestrator schema, behavior-suite wires its schema, etc.
 *
 * Usage (Vitest example):
 *
 *   import { afterEach, beforeEach } from 'vitest';
 *   import { createTestDb, type TestDb } from '@chiefaia/test-isolation/sqlite';
 *   import * as schema from './schema';
 *
 *   let testDb: TestDb<typeof schema>;
 *   beforeEach(() => {
 *     testDb = createTestDb({
 *       migrationsFolder: 'src/db/migrations',
 *       schema,
 *     });
 *   });
 *   afterEach(() => testDb.cleanup());
 *
 *   test('does a thing', () => {
 *     testDb.db.insert(...).values(...);
 *   });
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/**
 * Options for {@link createTestDb}.
 */
export interface CreateTestDbOptions<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Absolute or repo-relative path to the directory containing the Drizzle
   * SQL migration files. Required — we always start from a fresh schema.
   */
  migrationsFolder: string;

  /**
   * Optional Drizzle schema. If supplied, the returned `db` is typed
   * as `BetterSQLite3Database<TSchema>` so consumers get full
   * relational query inference. Omit if you only need the raw connection.
   */
  schema?: TSchema;

  /**
   * Optional filename prefix. Defaults to `'caia-test'`. Useful for
   * grouping files by package when debugging:
   *   `${tmpdir}/${prefix}-<uuid>.sqlite`
   */
  prefix?: string;

  /**
   * Optional alternate temp directory. Defaults to `os.tmpdir()`.
   * Mostly used by the package's own tests to assert file creation.
   */
  tmpDir?: string;

  /**
   * If true, run a single-statement WAL pragma so tests behave like
   * production. Default true.
   */
  walMode?: boolean;
}

/**
 * The per-test database handle returned by {@link createTestDb}.
 *
 * The handle implements `[Symbol.dispose]` so it can be used with
 * TypeScript 5.2+ `using` declarations:
 *
 *   using testDb = createTestDb({ migrationsFolder });
 *
 * Or with explicit cleanup in any test framework:
 *
 *   const testDb = createTestDb({ migrationsFolder });
 *   try { ... } finally { testDb.cleanup(); }
 */
export interface TestDb<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /** Absolute path to the SQLite file. */
  readonly url: string;

  /** Drizzle handle, typed by the caller's schema if supplied. */
  readonly db: BetterSQLite3Database<TSchema>;

  /** Underlying better-sqlite3 connection for raw queries / pragmas. */
  readonly sqlite: Database.Database;

  /**
   * Closes the connection and deletes the file. Idempotent. Safe to
   * call from `afterEach`/`finally`/`Symbol.dispose`.
   */
  cleanup(): void;

  /** Disposable hook for `using` declarations. */
  [Symbol.dispose](): void;
}

// ---------------------------------------------------------------------------
// Process-wide registry of live DBs so we can clean up if the test runner
// is killed. We take a best-effort pass on `process.exit` and on uncaught
// exceptions — but we do NOT swallow exceptions, only react to them.
// ---------------------------------------------------------------------------

const liveDbs = new Set<TestDb>();
let exitHookRegistered = false;

function ensureExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  // `process.on('exit', ...)` runs synchronously; we cannot do async work
  // here. `cleanup()` is sync because we use better-sqlite3 + fs.unlinkSync.
  const flush = (): void => {
    for (const db of liveDbs) {
      try {
        db.cleanup();
      } catch {
        // Best-effort. Don't mask the original exit reason.
      }
    }
  };
  process.on('exit', flush);
}

/**
 * Create a per-test ephemeral SQLite database.
 *
 * The file lives at `${tmpDir}/${prefix}-<uuid>.sqlite` and is deleted
 * by `cleanup()`. Migrations from `migrationsFolder` are applied
 * synchronously before the function returns.
 *
 * Throws if the migrations folder does not exist or migration fails.
 */
export function createTestDb<TSchema extends Record<string, unknown> = Record<string, unknown>>(
  opts: CreateTestDbOptions<TSchema>,
): TestDb<TSchema> {
  const tmpDir = opts.tmpDir ?? os.tmpdir();
  const prefix = opts.prefix ?? 'caia-test';
  const url = path.join(tmpDir, `${prefix}-${randomUUID()}.sqlite`);

  // Make the directory exist. tmpdir() always does, but tmpDir may be
  // a caller-controlled path (e.g. inside a per-suite folder).
  fs.mkdirSync(path.dirname(url), { recursive: true });

  const sqlite = new Database(url);

  // Pragmas that mirror production (apps/orchestrator/src/db/connection.ts).
  if (opts.walMode !== false) {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');

  // Drizzle handle. The schema generic flows through to consumers so
  // their `db.query.<table>` autocomplete works.
  const db = (
    opts.schema
      ? drizzle(sqlite, { schema: opts.schema })
      : drizzle(sqlite)
  ) as BetterSQLite3Database<TSchema>;

  // Apply migrations. Failure here is unrecoverable — propagate.
  try {
    migrate(db, { migrationsFolder: opts.migrationsFolder });
  } catch (err) {
    sqlite.close();
    safeUnlink(url);
    throw err;
  }

  // Wire cleanup. Cleanup is idempotent: track a flag so a second call
  // is a no-op even if the file was already removed manually.
  let cleaned = false;
  const handle: TestDb<TSchema> = {
    url,
    db,
    sqlite,
    cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      liveDbs.delete(handle);
      try {
        sqlite.close();
      } catch {
        // ignore — we still want to delete the file
      }
      safeUnlink(url);
      // Also remove WAL + SHM siblings if WAL mode was on.
      safeUnlink(`${url}-wal`);
      safeUnlink(`${url}-shm`);
    },
    [Symbol.dispose](): void {
      handle.cleanup();
    },
  };

  liveDbs.add(handle);
  ensureExitHook();

  return handle;
}

/**
 * Snapshot of currently-live test DBs. Exported for the per-test
 * resource panel in the dashboard (FIX-013) and for diagnostic tooling.
 * Returns a frozen array of file paths; callers cannot mutate the
 * internal registry through this surface.
 */
export function listLiveTestDbs(): readonly string[] {
  return Object.freeze(Array.from(liveDbs, (d) => d.url));
}

/**
 * Delete files matching the test-DB prefix older than `maxAgeMs`.
 *
 * Use case: a stuck CI runner left files behind. A periodic cleaner
 * (FIX-013 cron) calls this with `maxAgeMs = 60 * 60 * 1000`. Returns
 * the list of files removed. Never throws — failures are silently
 * skipped.
 */
export function sweepStaleTestDbs(
  opts: { tmpDir?: string; prefix?: string; maxAgeMs?: number } = {},
): readonly string[] {
  const dir = opts.tmpDir ?? os.tmpdir();
  const prefix = opts.prefix ?? 'caia-test';
  const maxAge = opts.maxAgeMs ?? 60 * 60 * 1000;
  const removed: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return removed;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(`${prefix}-`)) continue;
    const full = path.join(dir, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs < maxAge) continue;
    if (safeUnlink(full)) removed.push(full);
  }
  return Object.freeze(removed);
}

function safeUnlink(p: string): boolean {
  try {
    fs.unlinkSync(p);
    return true;
  } catch (err) {
    // ENOENT is fine — the file was already gone.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    // Any other error is surprising; surface it on stderr but do not
    // throw, since cleanup is best-effort.
    console.warn('[test-isolation] unlink failed for %s: %s', p, (err as Error).message);
    return false;
  }
}
