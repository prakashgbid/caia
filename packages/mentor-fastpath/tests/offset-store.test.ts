/**
 * Unit tests for the offset-store module.
 *
 * Each test creates a fresh tmp DB so there's no inter-test state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  countProcessed,
  getLastProcessedOffset,
  isProcessed,
  openOffsetDb,
  recordProcessed
} from '../src/offset-store.js';
import type { ProcessedRecord } from '../src/types.js';

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mentor-fastpath-offset-test-'));
  dbPath = join(tmp, 'offset.sqlite');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const sample = (overrides: Partial<ProcessedRecord> = {}): ProcessedRecord => ({
  event_id: 'ev1',
  ingest_offset: 1,
  processed_at: '2026-05-05T00:00:00Z',
  classification_json: JSON.stringify({ primary: 'Hallucination' }),
  artifact_ref: null,
  ...overrides
});

describe('openOffsetDb', () => {
  it('creates the schema if missing', () => {
    const db = openOffsetDb(dbPath);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='processed_events'"
      )
      .all() as Array<{ name: string }>;
    expect(tables.length).toBe(1);
    db.close();
  });

  it('is idempotent (re-opening on existing DB is a no-op)', () => {
    const a = openOffsetDb(dbPath);
    a.close();
    const b = openOffsetDb(dbPath);
    expect(countProcessed(b)).toBe(0);
    b.close();
  });

  it('uses WAL mode', () => {
    const db = openOffsetDb(dbPath);
    const mode = (
      db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    ).journal_mode;
    expect(mode).toBe('wal');
    db.close();
  });
});

describe('recordProcessed + lookup helpers', () => {
  it('records a new event and reports it as processed', () => {
    const db = openOffsetDb(dbPath);
    recordProcessed(db, sample());
    expect(isProcessed(db, 'ev1')).toBe(true);
    expect(isProcessed(db, 'ev_nonexistent')).toBe(false);
    db.close();
  });

  it('is idempotent on duplicate event_id (PRIMARY KEY conflict ignored)', () => {
    const db = openOffsetDb(dbPath);
    recordProcessed(db, sample());
    expect(() => recordProcessed(db, sample({ ingest_offset: 999 }))).not.toThrow();
    expect(countProcessed(db)).toBe(1);
    db.close();
  });

  it('countProcessed returns 0 on empty DB', () => {
    const db = openOffsetDb(dbPath);
    expect(countProcessed(db)).toBe(0);
    db.close();
  });

  it('countProcessed counts inserted rows', () => {
    const db = openOffsetDb(dbPath);
    recordProcessed(db, sample({ event_id: 'a', ingest_offset: 1 }));
    recordProcessed(db, sample({ event_id: 'b', ingest_offset: 2 }));
    recordProcessed(db, sample({ event_id: 'c', ingest_offset: 3 }));
    expect(countProcessed(db)).toBe(3);
    db.close();
  });
});

describe('getLastProcessedOffset', () => {
  it('returns 0 for an empty DB', () => {
    const db = openOffsetDb(dbPath);
    expect(getLastProcessedOffset(db)).toBe(0);
    db.close();
  });

  it('returns the highest offset across all rows', () => {
    const db = openOffsetDb(dbPath);
    recordProcessed(db, sample({ event_id: 'a', ingest_offset: 1 }));
    recordProcessed(db, sample({ event_id: 'b', ingest_offset: 5 }));
    recordProcessed(db, sample({ event_id: 'c', ingest_offset: 3 }));
    expect(getLastProcessedOffset(db)).toBe(5);
    db.close();
  });
});

describe('artifact_ref persistence', () => {
  it('stores and reads back artifact_ref', () => {
    const db = openOffsetDb(dbPath);
    recordProcessed(db, sample({ artifact_ref: 'agent/memory/feedback_test.md' }));
    const row = db
      .prepare('SELECT artifact_ref FROM processed_events WHERE event_id = ?')
      .get('ev1') as { artifact_ref: string };
    expect(row.artifact_ref).toBe('agent/memory/feedback_test.md');
    db.close();
  });

  it('null is preserved as NULL', () => {
    const db = openOffsetDb(dbPath);
    recordProcessed(db, sample({ artifact_ref: null }));
    const row = db
      .prepare('SELECT artifact_ref FROM processed_events WHERE event_id = ?')
      .get('ev1') as { artifact_ref: string | null };
    expect(row.artifact_ref).toBeNull();
    db.close();
  });
});
