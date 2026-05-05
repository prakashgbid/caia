/**
 * SQLite client for the mentor event bus.
 *
 * Responsibilities:
 *   - open a database file (or in-memory for tests)
 *   - apply migrations idempotently (currently 0001_init.sql)
 *   - enable WAL mode (default) for safer concurrent reads
 *   - expose typed insert + query primitives consumed by client.ts
 *
 * Migrations live under `migrations/` (sibling to `src/`). At build time
 * tsc emits `dist/sqlite.js` and the migration files stay alongside the
 * package root via `package.json#files`.
 */

import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EventRow } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Open + migrate a database. Returns a connected handle. Idempotent.
 *
 * @param dbPath - Absolute path or `:memory:` for tests.
 * @param migrationsDir - Override migrations dir (default: package's migrations/).
 * @param wal - Enable WAL mode (default true). Set false for `:memory:`.
 */
export function openDatabase(
  dbPath: string,
  migrationsDir?: string,
  wal = true
): DatabaseInstance {
  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  if (wal && dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  applyMigrations(db, migrationsDir ?? defaultMigrationsDir());
  return db;
}

function defaultMigrationsDir(): string {
  // dist layout: dist/sqlite.js → ../migrations/
  // src layout (vitest):   src/sqlite.ts → ../migrations/
  return resolve(__dirname, '..', 'migrations');
}

/**
 * Track applied migrations in a small table so re-opening the database
 * doesn't re-run them. Migration files are sorted by filename.
 */
function applyMigrations(db: DatabaseInstance, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  if (!existsSync(migrationsDir)) {
    // No migrations dir (tests using ':memory:' with manual schema). Skip.
    return;
  }

  const applied = new Set<string>(
    db.prepare('SELECT filename FROM _migrations').all().map((r) => (r as { filename: string }).filename)
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const insertMigration = db.prepare(
    'INSERT INTO _migrations(filename, applied_at) VALUES(?, ?)'
  );

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(migrationsDir, f), 'utf-8');
    db.transaction(() => {
      db.exec(sql);
      insertMigration.run(f, new Date().toISOString());
    })();
  }
}

// ─── CRUD primitives ──────────────────────────────────────────────────────

export interface InsertEventArgs {
  id: string;
  event_type: string;
  schema_version: number;
  correlation_id: string | null;
  parent_event_id: string | null;
  emitted_at: string;
  hostname: string;
  process_name: string | null;
  payload_json: string;
  validation_failed: 0 | 1;
}

/**
 * Insert a single event. The `ingest_offset` is allocated atomically from
 * `_ingest_counter`. Returns the inserted row's offset.
 */
export function insertEvent(db: DatabaseInstance, args: InsertEventArgs): number {
  // Allocate a monotonic offset.
  const allocate = db.prepare('UPDATE _ingest_counter SET next_offset = next_offset + 1 WHERE id = 1');
  const readOffset = db.prepare('SELECT next_offset - 1 AS prev FROM _ingest_counter WHERE id = 1');
  const insert = db.prepare(`
    INSERT INTO events (
      id, event_type, schema_version, correlation_id, parent_event_id,
      emitted_at, hostname, process_name, payload_json, validation_failed,
      ingest_offset
    ) VALUES (
      @id, @event_type, @schema_version, @correlation_id, @parent_event_id,
      @emitted_at, @hostname, @process_name, @payload_json, @validation_failed,
      @ingest_offset
    )
  `);

  const tx = db.transaction((row: InsertEventArgs) => {
    allocate.run();
    const { prev } = readOffset.get() as { prev: number };
    const offset = prev;
    insert.run({ ...row, ingest_offset: offset });
    return offset;
  });

  return tx(args);
}

export interface QueryEventsOptions {
  eventType?: string;
  correlationId?: string;
  sinceIso?: string;
  untilIso?: string;
  /** Lower bound on ingest_offset (exclusive). Used by tail consumers. */
  sinceOffset?: number;
  limit?: number;
  /** Order: 'asc' (default) or 'desc' on emitted_at. */
  order?: 'asc' | 'desc';
}

export function queryEvents(
  db: DatabaseInstance,
  opts: QueryEventsOptions = {}
): EventRow[] {
  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (opts.eventType !== undefined) {
    where.push('event_type = @eventType');
    params['eventType'] = opts.eventType;
  }
  if (opts.correlationId !== undefined) {
    where.push('correlation_id = @correlationId');
    params['correlationId'] = opts.correlationId;
  }
  if (opts.sinceIso !== undefined) {
    where.push('emitted_at >= @sinceIso');
    params['sinceIso'] = opts.sinceIso;
  }
  if (opts.untilIso !== undefined) {
    where.push('emitted_at < @untilIso');
    params['untilIso'] = opts.untilIso;
  }
  if (opts.sinceOffset !== undefined) {
    where.push('ingest_offset > @sinceOffset');
    params['sinceOffset'] = opts.sinceOffset;
  }

  const order = opts.order === 'desc' ? 'DESC' : 'ASC';
  const limitClause = opts.limit !== undefined ? `LIMIT @limit` : '';
  if (opts.limit !== undefined) params['limit'] = opts.limit;

  const sql = `
    SELECT id, event_type, schema_version, correlation_id, parent_event_id,
           emitted_at, hostname, process_name, payload_json, validation_failed,
           ingest_offset
    FROM events
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ingest_offset ${order}
    ${limitClause}
  `;

  return db.prepare(sql).all(params) as EventRow[];
}

export function countEvents(db: DatabaseInstance, opts: QueryEventsOptions = {}): number {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (opts.eventType !== undefined) {
    where.push('event_type = @eventType');
    params['eventType'] = opts.eventType;
  }
  if (opts.correlationId !== undefined) {
    where.push('correlation_id = @correlationId');
    params['correlationId'] = opts.correlationId;
  }
  if (opts.sinceIso !== undefined) {
    where.push('emitted_at >= @sinceIso');
    params['sinceIso'] = opts.sinceIso;
  }
  const sql = `
    SELECT COUNT(*) AS n
    FROM events
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `;
  const row = db.prepare(sql).get(params) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Register or update a Zod-schema fingerprint for an event type.
 * Idempotent — re-registering the same (type, version, fingerprint) is a no-op.
 */
export function registerSchemaDefinition(
  db: DatabaseInstance,
  args: { event_type: string; schema_version: number; zod_schema: string }
): void {
  db.prepare(
    `INSERT OR REPLACE INTO schema_definitions
       (event_type, schema_version, zod_schema, registered_at)
       VALUES (?, ?, ?, ?)`
  ).run(args.event_type, args.schema_version, args.zod_schema, new Date().toISOString());
}
