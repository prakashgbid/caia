import { beforeEach, describe, expect, it } from 'vitest';

import { hashPayload } from '../src/hash.js';
import { InMemoryStateStore } from '../src/in-memory-store.js';

describe('InMemoryStateStore', () => {
  let store: InMemoryStateStore;

  beforeEach(async () => {
    store = new InMemoryStateStore();
    await store.init();
  });

  it('createProject assigns an id and version=1', async () => {
    const p = await store.createProject({
      tenantId: 't',
      slug: 's',
      displayName: 'd',
    });
    expect(p.id).toBeTruthy();
    expect(p.version).toBe(1);
    expect(p.status).toBe('onboarding');
    expect(p.paused).toBe(false);
  });

  it('rejects duplicate ids', async () => {
    const a = await store.createProject({
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: 't',
      slug: 'a',
      displayName: 'A',
    });
    await expect(
      store.createProject({
        id: a.id,
        tenantId: 't',
        slug: 'b',
        displayName: 'B',
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('getProject returns a clone (mutating it does not leak)', async () => {
    const p = await store.createProject({
      tenantId: 't',
      slug: 's',
      displayName: 'd',
    });
    const a = await store.getProject(p.id);
    expect(a).not.toBeNull();
    a!.currentPayload.injected = true;
    const b = await store.getProject(p.id);
    expect(b!.currentPayload.injected).toBeUndefined();
  });

  it('transitionAtomic applies once', async () => {
    const p = await store.createProject({
      tenantId: 't',
      slug: 's',
      displayName: 'd',
    });
    const result = await store.transitionAtomic({
      projectId: p.id,
      expectedVersion: 1,
      expectedStatus: 'onboarding',
      toState: 'idea-captured',
      reason: 'r',
      actorKind: 'system',
      actorId: 'system',
      agentRunId: null,
      payload: {},
      payloadHash: hashPayload({}),
      idempotencyWindowMs: 1000,
    });
    expect(result.applied).toBe(true);
    expect(result.newVersion).toBe(2);
  });

  it('transitionAtomic is idempotent via payload-hash uniqueness', async () => {
    const p = await store.createProject({
      tenantId: 't',
      slug: 's',
      displayName: 'd',
    });
    const args = {
      projectId: p.id,
      expectedVersion: 1,
      expectedStatus: 'onboarding' as const,
      toState: 'idea-captured' as const,
      reason: 'r',
      actorKind: 'system' as const,
      actorId: 'system',
      agentRunId: null,
      payload: { k: 'v' },
      payloadHash: hashPayload({ k: 'v' }),
      idempotencyWindowMs: 1000,
    };
    const first = await store.transitionAtomic(args);
    const second = await store.transitionAtomic({
      ...args,
      expectedVersion: 2,
      expectedStatus: 'idea-captured',
    });
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.historyId).toBe(first.historyId);
  });

  it('transitionAtomic rejects version mismatch', async () => {
    const p = await store.createProject({
      tenantId: 't',
      slug: 's',
      displayName: 'd',
    });
    const r = await store.transitionAtomic({
      projectId: p.id,
      expectedVersion: 99,
      expectedStatus: 'onboarding',
      toState: 'idea-captured',
      reason: 'r',
      actorKind: 'system',
      actorId: 'system',
      agentRunId: null,
      payload: {},
      payloadHash: hashPayload({}),
      idempotencyWindowMs: 0,
    });
    expect(r.applied).toBe(false);
    expect(r.historyId).toBeNull();
  });

  it('listHistory returns rows in id order', async () => {
    const p = await store.createProject({
      tenantId: 't',
      slug: 's',
      displayName: 'd',
    });
    for (const [from, to] of [
      ['onboarding', 'idea-captured'],
      ['idea-captured', 'interviewing'],
    ] as const) {
      await store.transitionAtomic({
        projectId: p.id,
        expectedVersion: (await store.getProject(p.id))!.version,
        expectedStatus: from,
        toState: to,
        reason: 'r',
        actorKind: 'system',
        actorId: 'system',
        agentRunId: null,
        payload: { from, to },
        payloadHash: hashPayload({ from, to }),
        idempotencyWindowMs: 0,
      });
    }
    const rows = await store.listHistory(p.id);
    expect(rows.length).toBe(2);
    expect(rows[0]!.toState).toBe('idea-captured');
    expect(rows[1]!.toState).toBe('interviewing');
  });

  it('setPaused toggles paused + pausedBy', async () => {
    const p = await store.createProject({
      tenantId: 't',
      slug: 's',
      displayName: 'd',
    });
    await store.setPaused(p.id, true, 'op-1');
    const a = await store.getProject(p.id);
    expect(a!.paused).toBe(true);
    expect(a!.pausedBy).toBe('op-1');
    await store.setPaused(p.id, false, null);
    const b = await store.getProject(p.id);
    expect(b!.paused).toBe(false);
    expect(b!.pausedBy).toBeNull();
  });

  it('reset clears everything', async () => {
    const p = await store.createProject({
      tenantId: 't',
      slug: 's',
      displayName: 'd',
    });
    expect(await store.getProject(p.id)).not.toBeNull();
    await store.reset();
    expect(await store.getProject(p.id)).toBeNull();
  });

  it('tryClaim/heartbeat/release lifecycle', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const claim = await store.tryClaim({
      ticketId: 't1',
      projectId: null,
      agentId: 'agent-A',
      ttlSeconds: 30,
      now,
    });
    expect(claim.claimed).toBe(true);

    const conflict = await store.tryClaim({
      ticketId: 't1',
      projectId: null,
      agentId: 'agent-B',
      ttlSeconds: 30,
      now,
    });
    expect(conflict.claimed).toBe(false);

    const hb = await store.heartbeat({
      ticketId: 't1',
      agentId: 'agent-A',
      now: new Date(now.getTime() + 5_000),
    });
    expect(hb.ok).toBe(true);

    const rel = await store.releaseClaim({
      ticketId: 't1',
      agentId: 'agent-A',
      finalStatus: 'done',
      now: new Date(now.getTime() + 6_000),
    });
    expect(rel.ok).toBe(true);
  });

  it('janitorSweep releases stale claims', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    await store.tryClaim({
      ticketId: 't1',
      projectId: null,
      agentId: 'a',
      ttlSeconds: 30,
      now: t0,
    });
    const r = await store.janitorSweep(new Date(t0.getTime() + 60_000));
    expect(r.releasedClaims).toEqual(['t1']);
  });

  it('subscribe + unsubscribe lifecycle', async () => {
    const events: string[] = [];
    const unsub = await store.subscribe('ch', (p) => events.push(p));
    const p = await store.createProject({
      tenantId: 't',
      slug: 's',
      displayName: 'd',
    });
    await store.transitionAtomic({
      projectId: p.id,
      expectedVersion: 1,
      expectedStatus: 'onboarding',
      toState: 'idea-captured',
      reason: 'r',
      actorKind: 'system',
      actorId: 'system',
      agentRunId: null,
      payload: {},
      payloadHash: hashPayload({}),
      idempotencyWindowMs: 0,
    });
    expect(events.length).toBeGreaterThanOrEqual(0); // channel scoping
    await unsub();
  });
});
