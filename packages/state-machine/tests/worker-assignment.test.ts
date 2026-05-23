import { beforeEach, describe, expect, it } from 'vitest';

import { buildInMemoryStateMachine } from '../src/test-support.js';

describe('worker assignment job-queue API', () => {
  let sm: ReturnType<typeof buildInMemoryStateMachine>['sm'];

  beforeEach(async () => {
    ({ sm } = buildInMemoryStateMachine({
      idempotencyWindowMs: 0,
      workerTtlSeconds: 1,
    }));
    await sm.init();
  });

  const newProject = (slug = 'p') =>
    sm.createProject({ tenantId: 't', slug, displayName: slug });

  it('tryAssignWork wins for the first caller and loses for concurrent callers', async () => {
    const p = await newProject('a');
    const a = await sm.tryAssignWork(p.id, 'worker-1');
    const b = await sm.tryAssignWork(p.id, 'worker-2');
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(false);
  });

  it('tryAssignWork is reentrant for the same worker', async () => {
    const p = await newProject('a');
    const a = await sm.tryAssignWork(p.id, 'worker-1');
    const b = await sm.tryAssignWork(p.id, 'worker-1');
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(true);
  });

  it('recordWorkerHeartbeat refreshes every project the worker holds', async () => {
    const a = await newProject('a');
    const b = await newProject('b');
    await sm.tryAssignWork(a.id, 'w1');
    await sm.tryAssignWork(b.id, 'w1');
    const r = await sm.recordWorkerHeartbeat('w1');
    expect(r.ok).toBe(true);
    expect(r.refreshed.sort()).toEqual([a.id, b.id].sort());
  });

  it('recordWorkerHeartbeat returns ok=false for unknown worker', async () => {
    const r = await sm.recordWorkerHeartbeat('ghost');
    expect(r.ok).toBe(false);
    expect(r.refreshed).toEqual([]);
  });

  it('completeWork without finalState releases without transitioning', async () => {
    const p = await newProject('a');
    await sm.tryAssignWork(p.id, 'w1');
    const r = await sm.completeWork('w1');
    expect(r.released).toContain(p.id);
    expect(r.transitioned).toEqual([]);
  });

  it('completeWork with finalState transitions the project', async () => {
    const p = await newProject('a');
    await sm.tryAssignWork(p.id, 'w1');
    const r = await sm.completeWork('w1', 'idea-captured', {
      reason: 'work-done',
    });
    expect(r.released).toContain(p.id);
    expect(r.transitioned.length).toBe(1);
    expect(r.transitioned[0]!.toState).toBe('idea-captured');
    expect(await sm.currentState(p.id)).toBe('idea-captured');
  });

  it('expireInactiveWorkers releases stale claims', async () => {
    const p = await newProject('a');
    // workerTtlSeconds=1 so a 2-second-old claim is stale.
    const now = Date.now();
    const past = new Date(now - 5_000);
    const future = new Date(now);
    // simulate an old claim by directly using the store
    const { sm: sm2, store } = buildInMemoryStateMachine({
      now: () => future,
      workerTtlSeconds: 1,
    });
    const p2 = await sm2.createProject({
      tenantId: 't',
      slug: 'b',
      displayName: 'B',
    });
    await store.tryClaim({
      ticketId: 'project-assignment:' + p2.id,
      projectId: p2.id,
      agentId: 'w-old',
      ttlSeconds: 1,
      now: past,
    });
    const r = await sm2.expireInactiveWorkers();
    expect(r.releasedAssignments).toContain(p2.id);
    expect(p).toBeTruthy();
  });

  it('a worker can be re-assigned after the previous claim expires', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    let now = t0;
    const { sm: sm2 } = buildInMemoryStateMachine({
      now: () => now,
      workerTtlSeconds: 1,
    });
    const p = await sm2.createProject({
      tenantId: 't',
      slug: 'x',
      displayName: 'X',
    });
    const a = await sm2.tryAssignWork(p.id, 'w-1');
    expect(a.claimed).toBe(true);
    // advance past TTL
    now = new Date(t0.getTime() + 10_000);
    const b = await sm2.tryAssignWork(p.id, 'w-2');
    expect(b.claimed).toBe(true);
  });
});
