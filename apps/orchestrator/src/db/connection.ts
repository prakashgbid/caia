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
