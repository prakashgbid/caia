import { describe, expect, it } from 'vitest';

import {
  TRACKER_TABLE_NAME,
  ensureTrackerTable,
  readTracker,
  recordTracker,
  sqlChecksum,
} from '../src/tracker.js';
import { makeMockPool } from './mock-pool.js';
import { VALID_SCHEMA } from './fixtures.js';

describe('sqlChecksum', () => {
  it('is deterministic — same input, same output', () => {
    expect(sqlChecksum('SELECT 1')).toBe(sqlChecksum('SELECT 1'));
  });

  it('changes when SQL content changes (even whitespace)', () => {
    const a = sqlChecksum('SELECT 1;');
    const b = sqlChecksum('SELECT 1 ;');
    expect(a).not.toBe(b);
  });

  it('produces a 64-char hex string (SHA-256)', () => {
    expect(sqlChecksum('any')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('ensureTrackerTable', () => {
  it('runs CREATE SCHEMA + CREATE TABLE with the validated quoted schema', async () => {
    const pool = makeMockPool();
    await ensureTrackerTable(pool, VALID_SCHEMA);
    expect(pool.calls.length).toBe(2);
    expect(pool.calls[0]!.text).toContain(`CREATE SCHEMA IF NOT EXISTS "${VALID_SCHEMA}"`);
    expect(pool.calls[1]!.text).toContain(`CREATE TABLE IF NOT EXISTS "${VALID_SCHEMA}".${TRACKER_TABLE_NAME}`);
    expect(pool.calls[1]!.text).toContain('PRIMARY KEY (package, filename)');
  });

  it('refuses an invalid schema name (defence-in-depth)', async () => {
    const pool = makeMockPool();
    await expect(ensureTrackerTable(pool, 'public')).rejects.toThrow(/invalid tenant schema/);
    expect(pool.calls.length).toBe(0);
  });
});

describe('readTracker / recordTracker', () => {
  it('readTracker returns null when no row exists', async () => {
    const pool = makeMockPool();
    pool.default(() => ({ rows: [], rowCount: 0 }));
    const row = await readTracker(pool, VALID_SCHEMA, '@caia/x', '0001_x.sql');
    expect(row).toBeNull();
  });

  it('readTracker returns a parsed row when one exists', async () => {
    const pool = makeMockPool();
    const appliedAt = '2026-05-26T10:00:00.000Z';
    pool.on(/SELECT package, filename, checksum, applied_at/, () => ({
      rows: [
        {
          package: '@caia/x',
          filename: '0001_x.sql',
          checksum: 'abc',
          applied_at: appliedAt,
        },
      ],
      rowCount: 1,
    }));
    const row = await readTracker(pool, VALID_SCHEMA, '@caia/x', '0001_x.sql');
    expect(row).toEqual({
      packageName: '@caia/x',
      filename: '0001_x.sql',
      checksum: 'abc',
      appliedAt: new Date(appliedAt),
    });
  });

  it('recordTracker upserts with the right params', async () => {
    const pool = makeMockPool();
    await recordTracker(pool, VALID_SCHEMA, '@caia/x', '0001_x.sql', 'cs');
    expect(pool.calls.length).toBe(1);
    expect(pool.calls[0]!.text).toContain('INSERT INTO');
    expect(pool.calls[0]!.text).toContain('ON CONFLICT (package, filename) DO UPDATE');
    expect(pool.calls[0]!.params).toEqual(['@caia/x', '0001_x.sql', 'cs']);
  });
});
