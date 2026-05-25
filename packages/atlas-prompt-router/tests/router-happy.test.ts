import { beforeEach, describe, expect, it } from 'vitest';
import { createRouter } from '../src/router.js';
import { DESIGN_VERSION, TS_BODY, TS_CLOCK, TS_DISPATCH, body, setup, type Setup } from './router-setup.js';
import { APPROVED_STATE, CHANGE_REQUESTED_STATE } from './test-fixtures.js';

describe('createRouter happy path — self-only', () => {
  let s: Setup;
  beforeEach(() => { s = setup(); });

  it('returns the wire response', async () => {
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    const res = await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
    expect(res.versionId).toBe('tv_000001');
    expect(res.ticketState).toBe(CHANGE_REQUESTED_STATE);
    expect(res.dispatchedTo).toEqual(['caia-frontend-architect']);
    expect(res.enqueuedAt).toBe(TS_DISPATCH);
    expect(res.expectedChangeDescription).toContain('Change typography of');
  });

  it('inserts a version row', async () => {
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
    expect(s.versionStore.rows).toHaveLength(1);
    const row = s.versionStore.rows[0]!;
    expect(row.versionId).toBe('tv_000001');
    expect(row.ticketId).toBe('ST-stats');
    expect(row.designVersionId).toBe(DESIGN_VERSION);
    expect(row.operatorUserId).toBe('u_demo');
    expect(row.scope).toBe('self-only');
    expect(row.previousState).toBe(APPROVED_STATE);
    expect(row.newState).toBe(CHANGE_REQUESTED_STATE);
    expect(row.enqueuedAt).toBe(TS_CLOCK);
    expect(row.operatorTs).toBe(TS_BODY);
  });

  it('records a state-machine transition', async () => {
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
    const tr = s.stateMachine.transitions[0]!;
    expect(tr.ticketId).toBe('ST-stats');
    expect(tr.fromState).toBe(APPROVED_STATE);
    expect(tr.toState).toBe(CHANGE_REQUESTED_STATE);
    expect(tr.triggeredBy).toEqual({ kind: 'operator', id: 'u_demo' });
    expect(tr.ts).toBe(TS_CLOCK);
    expect(tr.designVersionId).toBe(DESIGN_VERSION);
  });

  it('dispatches with the single selected ticket id', async () => {
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
    const d = s.dispatcher.calls[0]!;
    expect(d.ticketIds).toEqual(['ST-stats']);
    expect(d.scope).toBe('self-only');
    expect(d.primaryTicketId).toBe('ST-stats');
    expect(d.versionId).toBe('tv_000001');
    expect(d.designVersionId).toBe(DESIGN_VERSION);
    expect(d.enqueuedAt).toBe(TS_CLOCK);
  });

  it('honors per-call designVersionId override', async () => {
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body(), designVersionId: 'dv_override' });
    expect(s.versionStore.rows[0]!.designVersionId).toBe('dv_override');
    expect(s.stateMachine.transitions[0]!.designVersionId).toBe('dv_override');
  });

  it('honors previousState option on construction', async () => {
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION, previousState: 'in-progress' });
    await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body() });
    expect(s.stateMachine.transitions[0]!.fromState).toBe('in-progress');
  });

  it('honors per-call previousState', async () => {
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body(), previousState: 'change-requested' });
    expect(s.stateMachine.transitions[0]!.fromState).toBe('change-requested');
  });
});
