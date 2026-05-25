import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WORKER_TTL_SECONDS,
  WorkerPool,
} from '../src/worker-pool.js';
import { FakeStateMachine } from './test-helpers.js';

describe('WorkerPool', () => {
  it('exposes the defaults', () => {
    expect(DEFAULT_WORKER_TTL_SECONDS).toBe(90);
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it('registers and lists workers', () => {
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({ stateMachine: sm });
    pool.register({ workerId: 'w1', tier: 'pro' });
    pool.register({ workerId: 'w2', tier: 'enterprise', capabilities: ['macos'] });
    expect(pool.list()).toEqual(['w1', 'w2']);
  });

  it('claims a project for a worker', async () => {
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({ stateMachine: sm });
    pool.register({ workerId: 'w1', tier: 'pro' });
    sm.ensureProject('p1', 'scheduled');
    const res = await pool.claim('p1', 'w1');
    expect(res.claimed).toBe(true);
    expect(pool.status().find((w) => w.workerId === 'w1')?.assignedProjects).toEqual(['p1']);
  });

  it('refuses a duplicate claim from another worker', async () => {
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({ stateMachine: sm });
    pool.register({ workerId: 'w1', tier: 'pro' });
    pool.register({ workerId: 'w2', tier: 'pro' });
    sm.ensureProject('p1', 'scheduled');
    expect((await pool.claim('p1', 'w1')).claimed).toBe(true);
    expect((await pool.claim('p1', 'w2')).claimed).toBe(false);
  });

  it('heartbeats a worker', async () => {
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({ stateMachine: sm });
    pool.register({ workerId: 'w1', tier: 'pro' });
    sm.ensureProject('p1', 'scheduled');
    await pool.claim('p1', 'w1');
    const result = await pool.heartbeat('w1');
    expect(result.ok).toBe(true);
    expect(result.refreshed).toEqual(['p1']);
  });

  it('releases assignments via completeWork', async () => {
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({ stateMachine: sm });
    pool.register({ workerId: 'w1', tier: 'pro' });
    sm.ensureProject('p1', 'scheduled');
    await pool.claim('p1', 'w1');
    const result = await pool.release('w1', 'coding-in-progress', {
      reason: 'fse-done',
      triggeredBy: { kind: 'agent', id: 'w1' },
    });
    expect(result.released).toEqual(['p1']);
    expect(result.transitioned).toHaveLength(1);
    expect(pool.status().find((w) => w.workerId === 'w1')?.assignedProjects).toEqual([]);
  });

  it('flags a worker as dead when its last heartbeat is older than TTL', async () => {
    let now = new Date(2026, 0, 1, 12, 0, 0);
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({
      stateMachine: sm,
      ttlSeconds: 10,
      clock: (): Date => now,
    });
    pool.register({ workerId: 'w1', tier: 'pro' });
    sm.ensureProject('p1', 'scheduled');
    await pool.claim('p1', 'w1');
    now = new Date(2026, 0, 1, 12, 5, 0);
    const snap = pool.status().find((w) => w.workerId === 'w1');
    expect(snap?.isAlive).toBe(false);
  });

  it('throws on unknown worker for claim/heartbeat/release', async () => {
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({ stateMachine: sm });
    await expect(pool.claim('p1', 'nope')).rejects.toThrow(/unknown worker/);
    await expect(pool.heartbeat('nope')).rejects.toThrow(/unknown worker/);
    await expect(pool.release('nope')).rejects.toThrow(/unknown worker/);
  });

  it('sweepDead delegates to expireInactiveWorkers', async () => {
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({ stateMachine: sm });
    pool.register({ workerId: 'w1', tier: 'pro' });
    sm.ensureProject('p1', 'scheduled');
    await pool.claim('p1', 'w1');
    const r = await pool.sweepDead();
    expect(r.releasedAssignments).toEqual([]);
  });

  it('re-registering a worker preserves assignments', async () => {
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({ stateMachine: sm });
    pool.register({ workerId: 'w1', tier: 'pro' });
    sm.ensureProject('p1', 'scheduled');
    await pool.claim('p1', 'w1');
    pool.register({ workerId: 'w1', tier: 'pro', capabilities: ['k3s'] });
    expect(pool.status().find((w) => w.workerId === 'w1')?.assignedProjects).toEqual(['p1']);
  });

  it('reset clears all workers', () => {
    const sm = new FakeStateMachine();
    const pool = new WorkerPool({ stateMachine: sm });
    pool.register({ workerId: 'w1', tier: 'pro' });
    pool.reset();
    expect(pool.list()).toEqual([]);
  });
});
