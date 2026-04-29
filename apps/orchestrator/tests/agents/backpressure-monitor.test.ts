/**
 * BackpressureMonitor — TASKMGR-004 unit tests.
 *
 * Verifies the engage/release transitions, hysteresis behaviour,
 * idempotency, and the listEngaged + checkAll helpers.
 *
 * 11 cases.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories, taskBuckets, prompts } from '../../src/db/schema';
import { BackpressureMonitor } from '../../src/agents/backpressure-monitor';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup(opts: { ceiling?: number; hysteresis?: number } = {}) {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const monitor = new BackpressureMonitor(db, { silent: true, ...opts });
  db.insert(prompts).values({
    id: 'p_test',
    body: 'test',
    receivedAt: new Date().toISOString(),
    correlationId: 'corr_test',
    hash: 'h_test',
  }).run();
  for (const bid of ['bkt_a', 'bkt_b', 'bkt_c']) {
    db.insert(taskBuckets).values({
      id: bid,
      kind: 'parallel',
      promptId: 'p_test',
      createdAt: Date.now(),
      status: 'open',
    }).run();
  }
  return { db, monitor };
}

function fillBucket(
  db: ReturnType<typeof setup>['db'],
  bucketId: string,
  count: number,
  startIdx = 0,
) {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    db.insert(stories)
      .values({
        id: `s_${bucketId}_${startIdx + i}`,
        title: `s${i}`,
        description: '',
        expectedBehavior: '',
        acceptanceCriteriaJson: '[]',
        verificationPlanJson: '[]',
        dependsOnJson: '[]',
        domainSlugsJson: '[]',
        status: 'pending',
        createdAt: String(now),
        agentContributionsJson: '{}',
        templateVersion: 'v1',
        templateValidationStatus: 'pending',
        businessSubDomainsJson: '[]',
        techSubDomainsJson: '[]',
        qualityTagsJson: '[]',
        blockedByJson: '[]',
        softDependsOnJson: '[]',
        conflictsWithJson: '[]',
        claimsJson: '{}',
        inputDependenciesJson: '[]',
        testCasesJson: '[]',
        testDesignStatus: 'pending',
        validationStatus: 'pending',
        validationAttempts: 0,
        linksToJson: '[]',
        architecturalInstructionsJson: '[]',
        bucketId,
      })
      .run();
  }
}

describe('BackpressureMonitor — construction', () => {
  it('rejects ceiling <= 0', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    expect(() => new BackpressureMonitor(db, { ceiling: 0 })).toThrow(/ceiling/);
  });

  it('rejects hysteresis >= ceiling', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    expect(() => new BackpressureMonitor(db, { ceiling: 10, hysteresis: 10 })).toThrow(/hysteresis/);
  });
});

describe('BackpressureMonitor — depth + snapshot', () => {
  it('counts only pending + unassigned stories per bucket', () => {
    const { db, monitor } = setup();
    fillBucket(db, 'bkt_a', 5);
    fillBucket(db, 'bkt_b', 3);
    expect(monitor.depth('bkt_a')).toBe(5);
    expect(monitor.depth('bkt_b')).toBe(3);
    expect(monitor.depth('bkt_unknown')).toBe(0);
  });

  it('snapshot returns depth + thresholds + engaged state', () => {
    const { db, monitor } = setup({ ceiling: 5, hysteresis: 2 });
    fillBucket(db, 'bkt_a', 3);
    const snap = monitor.snapshot('bkt_a');
    expect(snap).toEqual({
      bucketId: 'bkt_a',
      queueDepth: 3,
      engaged: false,
      ceiling: 5,
      hysteresis: 2,
    });
  });
});

describe('BackpressureMonitor — engage/release transitions', () => {
  it('engages when depth crosses ceiling', () => {
    const { db, monitor } = setup({ ceiling: 5, hysteresis: 2 });
    fillBucket(db, 'bkt_a', 4);
    let snap = monitor.checkBucket('bkt_a');
    expect(snap.engaged).toBe(false);
    fillBucket(db, 'bkt_a', 1, 4);  // depth = 5
    snap = monitor.checkBucket('bkt_a');
    expect(snap.engaged).toBe(true);
  });

  it('does NOT release until depth drops to ceiling-hysteresis (4 with c=5,h=2 → release at 3)', () => {
    const { db, monitor } = setup({ ceiling: 5, hysteresis: 2 });
    fillBucket(db, 'bkt_a', 5);
    monitor.checkBucket('bkt_a');             // engaged
    // Drop to 4 (above release threshold of 3) — should still be engaged
    db.delete(stories).where(undefined as never).run = undefined as never;  // noop guard
    // remove one story by calling delete directly
    const sqliteDb = (db as unknown as { $client: { exec: (s: string) => void } }).$client;
    sqliteDb.exec(`DELETE FROM stories WHERE id='s_bkt_a_4'`);
    expect(monitor.depth('bkt_a')).toBe(4);
    let snap = monitor.checkBucket('bkt_a');
    expect(snap.engaged).toBe(true);
    // Drop to 3 — release threshold met
    sqliteDb.exec(`DELETE FROM stories WHERE id='s_bkt_a_3'`);
    expect(monitor.depth('bkt_a')).toBe(3);
    snap = monitor.checkBucket('bkt_a');
    expect(snap.engaged).toBe(false);
  });

  it('engaging is idempotent — second checkBucket at same depth does not re-emit', () => {
    const { db, monitor } = setup({ ceiling: 5, hysteresis: 2 });
    fillBucket(db, 'bkt_a', 5);
    monitor.checkBucket('bkt_a');
    const before = monitor.listEngaged().length;
    monitor.checkBucket('bkt_a');
    monitor.checkBucket('bkt_a');
    expect(monitor.listEngaged().length).toBe(before);
  });

  it('listEngaged tracks multiple buckets', () => {
    const { db, monitor } = setup({ ceiling: 3, hysteresis: 1 });
    fillBucket(db, 'bkt_a', 3);
    fillBucket(db, 'bkt_b', 3);
    fillBucket(db, 'bkt_c', 1);
    monitor.checkBucket('bkt_a');
    monitor.checkBucket('bkt_b');
    monitor.checkBucket('bkt_c');
    expect(monitor.listEngaged().sort()).toEqual(['bkt_a', 'bkt_b']);
  });
});

describe('BackpressureMonitor — checkAll', () => {
  it('discovers and checks every bucket with pending stories', () => {
    const { db, monitor } = setup({ ceiling: 3, hysteresis: 1 });
    fillBucket(db, 'bkt_a', 3);
    fillBucket(db, 'bkt_b', 3);
    fillBucket(db, 'bkt_c', 1);
    const snaps = monitor.checkAll();
    expect(snaps.find((s) => s.bucketId === 'bkt_a')!.engaged).toBe(true);
    expect(snaps.find((s) => s.bucketId === 'bkt_b')!.engaged).toBe(true);
    expect(snaps.find((s) => s.bucketId === 'bkt_c')!.engaged).toBe(false);
    expect(monitor.listEngaged().sort()).toEqual(['bkt_a', 'bkt_b']);
  });

  it('returns empty when no buckets have pending stories', () => {
    const { monitor } = setup();
    expect(monitor.checkAll()).toEqual([]);
  });
});

describe('BackpressureMonitor — assigned stories drop out of depth', () => {
  it('a story flipped to assigned no longer counts', () => {
    const { db, monitor } = setup({ ceiling: 5, hysteresis: 2 });
    fillBucket(db, 'bkt_a', 5);
    monitor.checkBucket('bkt_a');
    expect(monitor.listEngaged()).toEqual(['bkt_a']);
    // simulate one story getting picked up
    const sqliteDb = (db as unknown as { $client: { exec: (s: string) => void } }).$client;
    sqliteDb.exec(`UPDATE stories SET assigned_worker_id='wkr_x' WHERE id='s_bkt_a_4'`);
    expect(monitor.depth('bkt_a')).toBe(4);
    monitor.checkBucket('bkt_a');
    expect(monitor.listEngaged()).toEqual(['bkt_a']);  // still above release threshold
  });
});
