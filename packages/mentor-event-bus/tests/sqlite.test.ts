import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  openDatabase,
  insertEvent,
  queryEvents,
  countEvents,
  registerSchemaDefinition,
  type InsertEventArgs
} from '../src/sqlite';

let dbDir: string;
let migrationsDir: string;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'mentor-bus-sqlite-'));
  // Use the actual package migration as fixture
  migrationsDir = join(__dirname, '..', 'migrations');
  // sanity
  if (!existsSync(migrationsDir)) {
    // fall back: write a copy from the repo location
    migrationsDir = join(dbDir, 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(
      join(migrationsDir, '0001_init.sql'),
      readFileSync(join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf-8'),
      'utf-8'
    );
  }
});
afterEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
});

const baseInsert = (overrides: Partial<InsertEventArgs> = {}): InsertEventArgs => ({
  id: 'ev_test_001',
  event_type: 'PRMerged',
  schema_version: 1,
  correlation_id: null,
  parent_event_id: null,
  emitted_at: new Date().toISOString(),
  hostname: 'test-host',
  process_name: null,
  payload_json: '{}',
  validation_failed: 0,
  ...overrides
});

describe('openDatabase', () => {
  it('creates a fresh DB and applies migrations', () => {
    const dbPath = join(dbDir, 'test.sqlite');
    const db = openDatabase(dbPath, migrationsDir, false);
    expect(existsSync(dbPath)).toBe(true);
    // schema present
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const names = tables.map((t) => (t as { name: string }).name);
    expect(names).toContain('events');
    expect(names).toContain('schema_definitions');
    expect(names).toContain('_migrations');
    db.close();
  });

  it('is idempotent — re-open is safe', () => {
    const dbPath = join(dbDir, 'test2.sqlite');
    const db1 = openDatabase(dbPath, migrationsDir, false);
    db1.close();
    const db2 = openDatabase(dbPath, migrationsDir, false);
    const applied = db2.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number };
    expect(applied.n).toBe(1); // not duplicated
    db2.close();
  });

  it('opens an in-memory DB', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables.length).toBeGreaterThan(0);
    db.close();
  });
});

describe('insertEvent + queryEvents', () => {
  it('inserts and reads back a single event', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    const offset = insertEvent(db, baseInsert({ id: 'ev_a' }));
    expect(offset).toBe(1);
    const rows = queryEvents(db);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe('ev_a');
    db.close();
  });

  it('assigns monotonically increasing ingest_offset', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    insertEvent(db, baseInsert({ id: 'ev_1' }));
    insertEvent(db, baseInsert({ id: 'ev_2' }));
    insertEvent(db, baseInsert({ id: 'ev_3' }));
    const rows = queryEvents(db);
    expect(rows.map((r) => r.ingest_offset)).toEqual([1, 2, 3]);
    db.close();
  });

  it('filters by eventType', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    insertEvent(db, baseInsert({ id: 'ev_pr1', event_type: 'PRMerged' }));
    insertEvent(db, baseInsert({ id: 'ev_t1', event_type: 'TaskSpawned' }));
    insertEvent(db, baseInsert({ id: 'ev_pr2', event_type: 'PRMerged' }));
    const prRows = queryEvents(db, { eventType: 'PRMerged' });
    expect(prRows.length).toBe(2);
    expect(prRows.every((r) => r.event_type === 'PRMerged')).toBe(true);
    db.close();
  });

  it('filters by correlationId', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    insertEvent(db, baseInsert({ id: 'ev_a', correlation_id: 'corr-1' }));
    insertEvent(db, baseInsert({ id: 'ev_b', correlation_id: 'corr-2' }));
    insertEvent(db, baseInsert({ id: 'ev_c', correlation_id: 'corr-1' }));
    const rows = queryEvents(db, { correlationId: 'corr-1' });
    expect(rows.map((r) => r.id).sort()).toEqual(['ev_a', 'ev_c']);
    db.close();
  });

  it('filters by sinceOffset (tail mode)', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    insertEvent(db, baseInsert({ id: 'ev_a' }));
    insertEvent(db, baseInsert({ id: 'ev_b' }));
    insertEvent(db, baseInsert({ id: 'ev_c' }));
    const rows = queryEvents(db, { sinceOffset: 1 });
    expect(rows.map((r) => r.id)).toEqual(['ev_b', 'ev_c']);
    db.close();
  });

  it('respects limit', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    for (let i = 0; i < 10; i++) {
      insertEvent(db, baseInsert({ id: `ev_${i}` }));
    }
    const rows = queryEvents(db, { limit: 3 });
    expect(rows.length).toBe(3);
    db.close();
  });

  it('orders desc when requested', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    insertEvent(db, baseInsert({ id: 'ev_a' }));
    insertEvent(db, baseInsert({ id: 'ev_b' }));
    const rows = queryEvents(db, { order: 'desc' });
    expect(rows.map((r) => r.id)).toEqual(['ev_b', 'ev_a']);
    db.close();
  });
});

describe('countEvents', () => {
  it('counts inserted events', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    expect(countEvents(db)).toBe(0);
    insertEvent(db, baseInsert({ id: 'ev_a' }));
    insertEvent(db, baseInsert({ id: 'ev_b' }));
    expect(countEvents(db)).toBe(2);
    db.close();
  });

  it('counts with eventType filter', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    insertEvent(db, baseInsert({ id: 'ev_a', event_type: 'PRMerged' }));
    insertEvent(db, baseInsert({ id: 'ev_b', event_type: 'TaskSpawned' }));
    expect(countEvents(db, { eventType: 'PRMerged' })).toBe(1);
    expect(countEvents(db, { eventType: 'TaskSpawned' })).toBe(1);
    db.close();
  });
});

describe('registerSchemaDefinition', () => {
  it('persists a row + is idempotent on conflict', () => {
    const db = openDatabase(':memory:', migrationsDir, false);
    registerSchemaDefinition(db, {
      event_type: 'PRMerged',
      schema_version: 1,
      zod_schema: '{"foo":"bar"}'
    });
    registerSchemaDefinition(db, {
      event_type: 'PRMerged',
      schema_version: 1,
      zod_schema: '{"foo":"updated"}'
    });
    const rows = db.prepare('SELECT * FROM schema_definitions').all() as Array<{
      zod_schema: string;
    }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.zod_schema).toBe('{"foo":"updated"}');
    db.close();
  });
});
