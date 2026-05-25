import { describe, expect, it } from 'vitest';

import {
  createScheduleHandler,
  parseScheduleBody,
  SCHEDULE_ROUTE,
} from '../src/api.js';
import { FakeStateMachine, okSpawn, staticSystemPrompt } from './test-helpers.js';

function handler() {
  const sm = new FakeStateMachine();
  return {
    sm,
    handle: createScheduleHandler({
      stateMachine: sm,
      spawnFn: okSpawn(),
      fseSubagentPath: 'fake.md',
      workerIds: ['w1'],
      dryRun: true,
    }),
  };
}

describe('parseScheduleBody', () => {
  it('rejects non-object body', () => {
    expect(parseScheduleBody(null).ok).toBe(false);
    expect(parseScheduleBody('x').ok).toBe(false);
  });

  it('rejects missing tickets', () => {
    const r = parseScheduleBody({ tenantTier: 'pro', projectIdByTicket: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('tickets');
  });

  it('rejects invalid tier', () => {
    const r = parseScheduleBody({
      tickets: [{ ticketId: 'A', dependsOn: [] }],
      projectIdByTicket: { A: 'p1' },
      tenantTier: 'mega',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('tenantTier');
  });

  it('rejects missing projectIdByTicket entry', () => {
    const r = parseScheduleBody({
      tickets: [{ ticketId: 'A', dependsOn: [] }],
      projectIdByTicket: {},
      tenantTier: 'pro',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('projectIdByTicket.A');
  });

  it('accepts a valid body', () => {
    const r = parseScheduleBody({
      tickets: [{ ticketId: 'A', dependsOn: [] }],
      projectIdByTicket: { A: 'p1' },
      tenantTier: 'pro',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.tickets).toHaveLength(1);
      expect(r.input.tenantTier).toBe('pro');
    }
  });

  it('accepts optional resourceLocks + effort', () => {
    const r = parseScheduleBody({
      tickets: [
        { ticketId: 'A', dependsOn: [], resourceLocks: ['db'], effort: 2 },
      ],
      projectIdByTicket: { A: 'p1' },
      tenantTier: 'pro',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.tickets[0]?.resourceLocks).toEqual(['db']);
  });

  it('rejects non-numeric tenantOverrideCap', () => {
    const r = parseScheduleBody({
      tickets: [{ ticketId: 'A', dependsOn: [] }],
      projectIdByTicket: { A: 'p1' },
      tenantTier: 'pro',
      tenantOverrideCap: 'twenty',
    });
    expect(r.ok).toBe(false);
  });
});

describe('createScheduleHandler', () => {
  it('returns 405 for non-POST', async () => {
    const { handle } = handler();
    const res = await handle({ method: 'GET', body: {} });
    expect(res.status).toBe(405);
  });

  it('returns 400 for invalid body', async () => {
    const { handle } = handler();
    const res = await handle({ method: 'POST', body: { tickets: 'not-an-array' } });
    expect(res.status).toBe(400);
  });

  it('returns 200 with a wave plan for a valid request', async () => {
    const { handle, sm } = handler();
    sm.ensureProject('p1', 'tests-reviewed');
    sm.ensureProject('p2', 'tests-reviewed');
    const res = await handle({
      method: 'POST',
      body: {
        tickets: [
          { ticketId: 'A', dependsOn: [] },
          { ticketId: 'B', dependsOn: ['A'] },
        ],
        projectIdByTicket: { A: 'p1', B: 'p2' },
        tenantTier: 'pro',
      },
    });
    expect(res.status).toBe(200);
    const body = res.body as { wavePlan: { waveCount: number } };
    expect(body.wavePlan.waveCount).toBe(2);
  });

  it('returns 422 with cycles for a cyclic input', async () => {
    const { handle, sm } = handler();
    sm.ensureProject('p1', 'tests-reviewed');
    sm.ensureProject('p2', 'tests-reviewed');
    const res = await handle({
      method: 'POST',
      body: {
        tickets: [
          { ticketId: 'A', dependsOn: ['B'] },
          { ticketId: 'B', dependsOn: ['A'] },
        ],
        projectIdByTicket: { A: 'p1', B: 'p2' },
        tenantTier: 'pro',
      },
    });
    expect(res.status).toBe(422);
    const body = res.body as { cycles: Array<{ nodes: string[] }> };
    expect(body.cycles[0]?.nodes).toEqual(['A', 'B']);
  });

  it('exposes the route literal', () => {
    expect(SCHEDULE_ROUTE).toBe('/api/principal-engineer/schedule');
  });
});
