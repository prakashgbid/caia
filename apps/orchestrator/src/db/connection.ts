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

export function runMigrations(dbUrl?: string): void {
  const db = getDb(dbUrl);
  const migrationsFolder = path.join(__dirname, 'migrations');
  migrate(db, { migrationsFolder });
}
