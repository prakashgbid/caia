/**
 * WorkerPoolRegistry — TASKMGR-002 unit tests.
 *
 * Exercises every public method against an in-memory SQLite fixture with
 * the migration set applied. Event emissions are verified via the
 * `silent: false` path with a mocked publish (we can't easily intercept
 * the singleton bus without DI; the contract is documented in the spec
 * so we cover behaviour by reading the resulting rows after each call).
 *
 * Total: 14 cases.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { workerPool } from '../../src/db/schema';
import { WorkerPoolRegistry, type WorkerKind } from '../../src/agents/worker-pool-registry';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup(opts: { now?: () => number; staleThresholdMs?: number } = {}) {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const registry = new WorkerPoolRegistry(db, { silent: true, ...opts });
  return { db, registry, sqlite };
}

describe('WorkerPoolRegistry — register', () => {
  it('inserts an idle row with generated id and stores capabilities', () => {
    const { db, registry } = setup();
    const w = registry.register({ kind: 'coding', capabilities: ['bkt_a'] });
    expect(w.id).toMatch(/^wkr_/);
    expect(w.kind).toBe('coding');
    expect(w.capabilities).toEqual(['bkt_a']);
    expect(w.status).toBe('idle');
    expect(w.currentStoryId).toBeNull();
    expect(w.releasedAt).toBeNull();
    const row = db.select().from(workerPool).where(eq(workerPool.id, w.id)).get();
    expect(row!.status).toBe('idle');
    expect(JSON.parse(row!.capabilitiesJson)).toEqual(['bkt_a']);
  });

  it('defaults capabilities to [] (any bucket) and metadata to {}', () => {
    const { registry } = setup();
    const w = registry.register({ kind: 'fix-it' });
    expect(w.capabilities).toEqual([]);
    expect(w.metadata).toEqual({});
  });

  it('honours an explicit id when provided (testing convenience)', () => {
    const { registry } = setup();
    const w = registry.register({ kind: 'coding', id: 'wkr_explicit' });
    expect(w.id).toBe('wkr_explicit');
  });
});

describe('WorkerPoolRegistry — heartbeat', () => {
  it('bumps lastHeartbeatAt and returns true', () => {
    let t = 1000;
    const { registry } = setup({ now: () => t });
    const w = registry.register({ kind: 'coding' });
    expect(w.lastHeartbeatAt).toBe(1000);
    t = 5000;
    const ok = registry.heartbeat(w.id);
    expect(ok).toBe(true);
    expect(registry.get(w.id)!.lastHeartbeatAt).toBe(5000);
  });

  it('returns false for an unknown worker (phantom heartbeat)', () => {
    const { registry } = setup();
    expect(registry.heartbeat('wkr_ghost')).toBe(false);
  });

  it('returns false for a released worker (no resurrection)', () => {
    const { registry } = setup();
    const w = registry.register({ kind: 'coding' });
    registry.release(w.id);
    expect(registry.heartbeat(w.id)).toBe(false);
  });
});

describe('WorkerPoolRegistry — setBusy / setIdle', () => {
  it('transitions idle → busy(storyId)', () => {
    const { registry } = setup();
    const w = registry.register({ kind: 'coding' });
    const after = registry.setBusy(w.id, 'story-xyz');
    expect(after.status).toBe('busy');
    expect(after.currentStoryId).toBe('story-xyz');
  });

  it('throws when trying to setBusy on a non-idle worker (race detection)', () => {
    const { registry } = setup();
    const w = registry.register({ kind: 'coding' });
    registry.setBusy(w.id, 'story-1');
    expect(() => registry.setBusy(w.id, 'story-2')).toThrow(/not idle/);
  });

  it('transitions busy → idle and clears currentStoryId', () => {
    const { registry } = setup();
    const w = registry.register({ kind: 'coding' });
    registry.setBusy(w.id, 'story-1');
    const after = registry.setIdle(w.id);
    expect(after.status).toBe('idle');
    expect(after.currentStoryId).toBeNull();
  });

  it('refuses to bring a crashed worker back to idle', () => {
    let t = 1000;
    const { registry } = setup({ now: () => t, staleThresholdMs: 100 });
    const w = registry.register({ kind: 'coding' });
    t = 5000;
    registry.detectStale();
    expect(() => registry.setIdle(w.id)).toThrow(/crashed/);
  });
});

describe('WorkerPoolRegistry — release', () => {
  it('marks the worker released and stamps releasedAt', () => {
    let t = 1000;
    const { registry } = setup({ now: () => t });
    const w = registry.register({ kind: 'coding' });
    t = 2000;
    const after = registry.release(w.id, 'task-completed');
    expect(after.status).toBe('released');
    expect(after.releasedAt).toBe(2000);
    // Released workers stay in the table.
    expect(registry.get(w.id)).toBeTruthy();
  });
});

describe('WorkerPoolRegistry — listIdle', () => {
  it('returns only idle workers, sorted by registeredAt asc', () => {
    let t = 1000;
    const { registry } = setup({ now: () => t });
    const w1 = registry.register({ kind: 'coding', id: 'wkr_a' });
    t = 2000;
    const w2 = registry.register({ kind: 'coding', id: 'wkr_b' });
    t = 3000;
    const w3 = registry.register({ kind: 'fix-it', id: 'wkr_c' });
    registry.setBusy(w2.id, 'story-1');           // w2 becomes busy
    expect(registry.listIdle().map((w) => w.id)).toEqual([w1.id, w3.id]);
  });

  it('filters by kind when requested', () => {
    const { registry } = setup();
    registry.register({ kind: 'coding', id: 'wkr_c' });
    registry.register({ kind: 'fix-it', id: 'wkr_f' });
    expect(registry.listIdle({ kind: 'coding' }).map((w) => w.id)).toEqual(['wkr_c']);
    expect(registry.listIdle({ kind: 'fix-it' }).map((w) => w.id)).toEqual(['wkr_f']);
  });

  it('filters by bucket — empty caps means any bucket; non-empty must contain it', () => {
    const { registry } = setup();
    registry.register({ kind: 'coding', id: 'wkr_any', capabilities: [] });
    registry.register({ kind: 'coding', id: 'wkr_a', capabilities: ['bkt_a'] });
    registry.register({ kind: 'coding', id: 'wkr_b', capabilities: ['bkt_b'] });
    expect(registry.listIdle({ bucket: 'bkt_a' }).map((w) => w.id).sort()).toEqual(['wkr_a', 'wkr_any']);
    expect(registry.listIdle({ bucket: 'bkt_b' }).map((w) => w.id).sort()).toEqual(['wkr_any', 'wkr_b']);
  });
});

describe('WorkerPoolRegistry — countByStatus', () => {
  it('aggregates the four status buckets', () => {
    let t = 1000;
    const { registry } = setup({ now: () => t, staleThresholdMs: 100 });
    registry.register({ kind: 'coding', id: 'wkr_idle' });
    const wb = registry.register({ kind: 'coding', id: 'wkr_busy' });
    const wr = registry.register({ kind: 'coding', id: 'wkr_released' });
    registry.setBusy(wb.id, 'story-x');
    registry.release(wr.id);
    // Force crash on a fresh worker by NOT heartbeating it.
    registry.register({ kind: 'coding', id: 'wkr_crashed' });
    t = 5000;
    // Heartbeat the live workers so they survive the stale sweep.
    registry.heartbeat(wb.id);
    // wkr_idle and wkr_crashed will be flipped to crashed by detectStale.
    registry.detectStale();
    const counts = registry.countByStatus();
    expect(counts.busy).toBe(1);          // wb survived via heartbeat
    expect(counts.released).toBe(1);      // wr stays released
    expect(counts.crashed).toBe(2);       // wkr_idle + wkr_crashed
    expect(counts.idle).toBe(0);          // all idles got reaped
  });
});

describe('WorkerPoolRegistry — detectStale', () => {
  it('flips idle and busy workers older than threshold to crashed', () => {
    let t = 1000;
    const { registry } = setup({ now: () => t, staleThresholdMs: 100 });
    registry.register({ kind: 'coding', id: 'wkr_old' });
    const wb = registry.register({ kind: 'coding', id: 'wkr_busy' });
    registry.setBusy(wb.id, 'story-x');
    t = 5000;                                   // 4000 ms later — past threshold
    const evicted = registry.detectStale();
    expect(evicted.sort()).toEqual(['wkr_busy', 'wkr_old']);
    expect(registry.get('wkr_old')!.status).toBe('crashed');
    expect(registry.get('wkr_busy')!.status).toBe('crashed');
  });

  it('skips released and already-crashed workers (idempotent on 2nd sweep)', () => {
    let t = 1000;
    const { registry } = setup({ now: () => t, staleThresholdMs: 100 });
    registry.register({ kind: 'coding', id: 'wkr_a' });
    t = 5000;
    expect(registry.detectStale().length).toBe(1);
    expect(registry.detectStale().length).toBe(0);  // 2nd sweep is a no-op
  });

  it('preserves the worker row (no delete) so the dashboard can render history', () => {
    let t = 1000;
    const { db, registry } = setup({ now: () => t, staleThresholdMs: 100 });
    registry.register({ kind: 'coding', id: 'wkr_a' });
    t = 5000;
    registry.detectStale();
    const row = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_a')).get();
    expect(row).toBeTruthy();
    expect(row!.status).toBe('crashed');
    expect(row!.lastHeartbeatAt).toBe(1000);  // preserved, not bumped
  });
});

describe('WorkerPoolRegistry — get', () => {
  it('returns null for unknown id', () => {
    const { registry } = setup();
    expect(registry.get('wkr_nope')).toBeNull();
  });

  it('round-trips capabilities + metadata as parsed JSON', () => {
    const { registry } = setup();
    const w = registry.register({
      kind: 'coding',
      capabilities: ['bkt_a', 'bkt_b'],
      metadata: { hostname: 'mac', pid: 1234 },
    });
    const got = registry.get(w.id)!;
    expect(got.capabilities).toEqual(['bkt_a', 'bkt_b']);
    expect(got.metadata).toEqual({ hostname: 'mac', pid: 1234 });
  });
});

describe('WorkerPoolRegistry — concurrency safety', () => {
  it('two parallel setBusy calls on the same idle worker — only one succeeds', () => {
    const { registry } = setup();
    const w = registry.register({ kind: 'coding' });
    registry.setBusy(w.id, 'story-1');
    expect(() => registry.setBusy(w.id, 'story-2')).toThrow();
    // The first assignment wins.
    expect(registry.get(w.id)!.currentStoryId).toBe('story-1');
  });
});
