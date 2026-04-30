import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;
let _sqlite: Database.Database | null = null;

export function getDb(dbUrl?: string): Db {
  if (_db) return _db;
  const url = dbUrl ?? process.env['CONDUCTOR_DB_URL'] ?? path.join(os.homedir(), '.conductor', 'db.sqlite');
  const dir = path.dirname(url);
  fs.mkdirSync(dir, { recursive: true });
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });

  // FREG-002: load sqlite-vec + bootstrap virtual tables for the
  // feature_registry. Failure is non-fatal — the orchestrator can boot
  // without the registry; the PO Agent will degrade to lifecycle='new'
  // for every story until the bootstrap succeeds. We log + continue.
  try {
    // Lazy require so test-only code paths that don't have the
    // workspace dep wired (or are run in environments without the
    // sqlite-vec native blob) keep working.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { bootstrapVectorTables } = require('@chiefaia/feature-registry') as typeof import('@chiefaia/feature-registry');
    bootstrapVectorTables(sqlite);
  } catch (err) {
    // Use console.warn for compatibility with the orchestrator's
    // existing logger-shim pattern (see po-agent.ts).
    console.warn('[feature-registry] sqlite-vec bootstrap skipped:', (err as Error).message);
  }

  return _db;
}

export function getSqliteRaw(): Database.Database {
  if (!_sqlite) throw new Error('DB not initialized — call getDb() first');
  return _sqlite;
}

export function resetDb(): void {
  _db = null;
  _sqlite = null;
}

/**
 * Apply pending migrations from `dist/src/db/migrations` (or `src/...`
 * when running under tsx) using drizzle's stock better-sqlite3 migrator.
 *
 * ⚠ Quirk — drizzle's skip-logic is timestamp-based, not hash-based.
 *
 * The runner walks `meta/_journal.json` in order and, for each entry,
 * checks `Number(lastDbMigration.created_at) < migration.folderMillis`
 * before applying it. If a DB has any `__drizzle_migrations` row whose
 * `created_at` is `>=` every journal `when`, drizzle considers the DB
 * "caught up" and skips _everything_ after that row — even migrations
 * with new SHA-256 hashes. Conversely, if a manually-applied migration
 * recorded `created_at = Date.now()` while the journal `when` values
 * are pinned far in the future (e.g. `1779200000000` ≈ 2026-05-15),
 * drizzle re-runs everything and crashes on duplicate `ADD COLUMN`s.
 *
 * Practical implications:
 * - Manually applying a migration via `sqlite3 < .sql` _must_ insert a
 *   matching `__drizzle_migrations` row whose `created_at` matches or
 *   exceeds the `when` of every later journal entry, OR set it to a
 *   pinned future value (e.g. 9_999_999_999_999) so the per-entry skip
 *   check never fires for already-applied migrations.
 * - New journal entries should keep `when` strictly monotonically
 *   increasing past the last value (we currently increment by
 *   100_000_000_000, ≈ 3 years per slot, to leave headroom).
 * - The whole batch runs inside a single BEGIN/COMMIT, so a failure
 *   on migration N rolls back N-1, N-2 ... too. Any partial-success
 *   recovery has to bypass drizzle (apply manually, write the
 *   `__drizzle_migrations` rows by hand).
 *
 * See `caia/docs/migration-runner.md` for the full rationale, the
 * 2026-04-30 daemon-repoint case study, and recovery recipes.
 */
export function runMigrations(dbUrl?: string): void {
  const db = getDb(dbUrl);
  const migrationsFolder = path.join(__dirname, 'migrations');
  migrate(db, { migrationsFolder });
}
