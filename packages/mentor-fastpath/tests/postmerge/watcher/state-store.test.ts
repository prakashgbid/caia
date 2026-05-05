/**
 * Unit tests for the state-store sqlite helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  countSeenPrs,
  countSeenRuns,
  getCursor,
  isPrSeen,
  isRunSeen,
  openStateStore,
  recordPrSeen,
  recordRunSeen,
  setCursor
} from '../../../src/postmerge/watcher/state-store.js';

describe('state-store — schema', () => {
  it('opens an empty :memory: DB cleanly', () => {
    const db = openStateStore(':memory:');
    expect(countSeenPrs(db)).toBe(0);
    expect(countSeenRuns(db)).toBe(0);
    db.close();
  });

  it('returns null cursor on a fresh DB', () => {
    const db = openStateStore(':memory:');
    const c = getCursor(db);
    expect(c.lastPrQueryIso).toBeNull();
    expect(c.lastRunQueryIso).toBeNull();
    db.close();
  });
});

describe('state-store — seen_prs', () => {
  it('records and recognises a seen PR', () => {
    const db = openStateStore(':memory:');
    expect(isPrSeen(db, 100)).toBe(false);
    recordPrSeen(db, {
      prNumber: 100,
      mergeSha: 'abc',
      mergedAt: '2026-05-05T05:00:00Z',
      emittedEventId: 'ev_1',
      processedAt: '2026-05-05T05:01:00Z'
    });
    expect(isPrSeen(db, 100)).toBe(true);
    expect(countSeenPrs(db)).toBe(1);
    db.close();
  });

  it('idempotent re-record (INSERT OR IGNORE)', () => {
    const db = openStateStore(':memory:');
    recordPrSeen(db, {
      prNumber: 100,
      mergeSha: 'abc',
      mergedAt: '2026-05-05T05:00:00Z',
      emittedEventId: 'ev_1',
      processedAt: '2026-05-05T05:01:00Z'
    });
    recordPrSeen(db, {
      prNumber: 100,
      mergeSha: 'different',
      mergedAt: '2026-05-05T05:00:00Z',
      emittedEventId: 'ev_2',
      processedAt: '2026-05-05T05:01:00Z'
    });
    expect(countSeenPrs(db)).toBe(1);
    db.close();
  });

  it('handles null emittedEventId (failed-emit case)', () => {
    const db = openStateStore(':memory:');
    recordPrSeen(db, {
      prNumber: 200,
      mergeSha: 'xyz',
      mergedAt: '2026-05-05T05:00:00Z',
      emittedEventId: null,
      processedAt: '2026-05-05T05:01:00Z'
    });
    expect(isPrSeen(db, 200)).toBe(true);
    db.close();
  });
});

describe('state-store — seen_runs', () => {
  it('records and recognises a seen run', () => {
    const db = openStateStore(':memory:');
    expect(isRunSeen(db, 12345)).toBe(false);
    recordRunSeen(db, {
      runId: 12345,
      headSha: 'abc',
      updatedAt: '2026-05-05T05:00:00Z',
      emittedEventId: 'ev_1',
      processedAt: '2026-05-05T05:01:00Z'
    });
    expect(isRunSeen(db, 12345)).toBe(true);
    expect(countSeenRuns(db)).toBe(1);
    db.close();
  });

  it('idempotent re-record', () => {
    const db = openStateStore(':memory:');
    for (let i = 0; i < 3; i++) {
      recordRunSeen(db, {
        runId: 999,
        headSha: 'aaa',
        updatedAt: '2026-05-05T05:00:00Z',
        emittedEventId: null,
        processedAt: '2026-05-05T05:01:00Z'
      });
    }
    expect(countSeenRuns(db)).toBe(1);
    db.close();
  });
});

describe('state-store — cursor', () => {
  it('round-trips both fields', () => {
    const db = openStateStore(':memory:');
    setCursor(db, {
      lastPrQueryIso: '2026-05-05T05:00:00Z',
      lastRunQueryIso: '2026-05-05T05:00:30Z'
    });
    const c = getCursor(db);
    expect(c.lastPrQueryIso).toBe('2026-05-05T05:00:00Z');
    expect(c.lastRunQueryIso).toBe('2026-05-05T05:00:30Z');
    db.close();
  });

  it('partial update preserves the un-set field', () => {
    const db = openStateStore(':memory:');
    setCursor(db, {
      lastPrQueryIso: '2026-05-05T05:00:00Z',
      lastRunQueryIso: '2026-05-05T05:00:30Z'
    });
    setCursor(db, { lastPrQueryIso: '2026-05-05T06:00:00Z' });
    const c = getCursor(db);
    expect(c.lastPrQueryIso).toBe('2026-05-05T06:00:00Z');
    expect(c.lastRunQueryIso).toBe('2026-05-05T05:00:30Z');
    db.close();
  });
});
