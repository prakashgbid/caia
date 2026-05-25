import { describe, expect, it } from 'vitest';

import { InMemoryStateStore, StateMachine } from '@caia/state-machine';

import { claimTicket } from '../src/work-claimer.js';

async function setup(initialState: 'scheduled' | 'coding-in-progress' | 'tests-reviewed' = 'scheduled'): Promise<{
  sm: StateMachine;
  projectId: string;
}> {
  const store = new InMemoryStateStore();
  const sm = new StateMachine(store);
  await sm.init();
  const projectId = `proj-${Math.random().toString(36).slice(2, 8)}`;
  await sm.createProject({
    id: projectId,
    tenantId: 'test',
    slug: 'test',
    displayName: 'Test',
    initialState,
  });
  return { sm, projectId };
}

describe('claimTicket', () => {
  it('claims a scheduled ticket and transitions to coding-in-progress', async () => {
    const { sm, projectId } = await setup();
    const r = await claimTicket({
      ticketId: 'TKT-1',
      projectId,
      workerId: 'w1',
      stateMachine: sm,
    });
    expect(r.claimed).toBe(true);
    expect(r.reason).toBe('claimed');
    expect(r.transition?.applied).toBe(true);
    expect(r.transition?.toState).toBe('coding-in-progress');
    expect((await sm.getProject(projectId))?.status).toBe('coding-in-progress');
  });

  it('returns claimed=false with structured reason when the project is not found', async () => {
    const { sm } = await setup();
    const r = await claimTicket({
      ticketId: 'TKT-1',
      projectId: 'missing',
      workerId: 'w1',
      stateMachine: sm,
    });
    expect(r.claimed).toBe(false);
    expect(r.reason).toContain('not found');
  });

  it('rejects when project is in an unexpected source state', async () => {
    const { sm, projectId } = await setup('tests-reviewed');
    const r = await claimTicket({
      ticketId: 'TKT-2',
      projectId,
      workerId: 'w1',
      stateMachine: sm,
    });
    expect(r.claimed).toBe(false);
    expect(r.reason).toContain('expected');
  });

  it('idempotently re-enters when project is already coding-in-progress', async () => {
    const { sm, projectId } = await setup('coding-in-progress');
    const r = await claimTicket({
      ticketId: 'TKT-3',
      projectId,
      workerId: 'w1',
      stateMachine: sm,
    });
    expect(r.claimed).toBe(true);
    expect(r.reason).toBe('already-in-progress');
  });

  it('a second worker loses the assignment race', async () => {
    const { sm, projectId } = await setup();
    const r1 = await claimTicket({
      ticketId: 'TKT-4',
      projectId,
      workerId: 'w1',
      stateMachine: sm,
    });
    expect(r1.claimed).toBe(true);
    const r2 = await claimTicket({
      ticketId: 'TKT-4',
      projectId,
      workerId: 'w2',
      stateMachine: sm,
    });
    expect(r2.claimed).toBe(false);
    expect(r2.reason).toMatch(/(already held by .w1.|lost-race)/);
  });

  it('honours skipStateMachine by claiming without transitioning', async () => {
    const { sm, projectId } = await setup();
    const r = await claimTicket({
      ticketId: 'TKT-5',
      projectId,
      workerId: 'w1',
      stateMachine: sm,
      skipStateMachine: true,
    });
    expect(r.claimed).toBe(true);
    expect(r.transition).toBeUndefined();
    expect((await sm.getProject(projectId))?.status).toBe('scheduled');
  });

  it('records the TTL returned by tryAssignWork', async () => {
    const { sm, projectId } = await setup();
    const r = await claimTicket({
      ticketId: 'TKT-6',
      projectId,
      workerId: 'w1',
      stateMachine: sm,
      ttlSeconds: 30,
    });
    expect(r.claimed).toBe(true);
    expect(r.ttlSeconds).toBe(30);
  });

  it('uses agent triggeredBy by default', async () => {
    const { sm, projectId } = await setup();
    const r = await claimTicket({
      ticketId: 'TKT-7',
      projectId,
      workerId: 'worker-A',
      stateMachine: sm,
    });
    expect(r.claimed).toBe(true);
    const history = await sm.replayHistory(projectId);
    const last = history[history.length - 1];
    expect(last?.actorKind).toBe('agent');
    expect(last?.actorId).toBe('worker-A');
  });

  it('records ticketId and workerId on the transition payload', async () => {
    const { sm, projectId } = await setup();
    await claimTicket({
      ticketId: 'TKT-8',
      projectId,
      workerId: 'w1',
      stateMachine: sm,
    });
    const history = await sm.replayHistory(projectId);
    const last = history[history.length - 1];
    expect(last?.payload['ticketId']).toBe('TKT-8');
    expect(last?.payload['workerId']).toBe('w1');
    expect(last?.payload['subState']).toBe('claimed');
  });
});
