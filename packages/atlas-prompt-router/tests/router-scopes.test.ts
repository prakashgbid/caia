import { describe, expect, it } from 'vitest';
import { createRouter } from '../src/router.js';
import { CHANGE_REQUESTED_STATE } from './test-fixtures.js';
import { DESIGN_VERSION, body, setup } from './router-setup.js';

describe('createRouter subtree scope', () => {
  it('expands a section into descendants', async () => {
    const s = setup();
    s.classifier.next = { kind: 'subtree', reason: 'whole section' };
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    const res = await r.submitPrompt({ ticketId: 'SE-hero', operatorUserId: 'u_demo', body: body({ selection: ['SE-hero'], prompt: 'rebuild the hero' }) });
    expect(res.ticketState).toBe(CHANGE_REQUESTED_STATE);
    const call = s.dispatcher.calls[0]!;
    expect(call.scope).toBe('subtree');
    expect(call.ticketIds).toContain('SE-hero');
    expect(call.ticketIds).toContain('WD-rotator');
    expect(call.ticketIds).toContain('WD-slide-01');
    expect(call.ticketIds).toContain('ST-stats');
    expect(call.ticketIds[0]).toBe('SE-hero');
  });
  it('keeps a leaf ticket as a singleton when subtree', async () => {
    const s = setup();
    s.classifier.next = { kind: 'subtree', reason: 'big' };
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body({ selection: ['ST-stats'] }) });
    expect(s.dispatcher.calls[0]!.ticketIds).toEqual(['ST-stats']);
  });
  it('passes scope reason into the version snapshot', async () => {
    const s = setup();
    s.classifier.next = { kind: 'subtree', reason: 'whole section' };
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'SE-hero', operatorUserId: 'u_demo', body: body({ selection: ['SE-hero'], prompt: 'rebuild the hero' }) });
    expect(s.versionStore.rows[0]!.scopeReason).toBe('whole section');
  });
});

describe('createRouter page scope', () => {
  it('does not widen for page-level', async () => {
    const s = setup();
    s.classifier.next = { kind: 'page', reason: 'layout' };
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'PG-home', operatorUserId: 'u_demo', body: body({ selection: ['PG-home'], prompt: 'rearrange the page' }) });
    const call = s.dispatcher.calls[0]!;
    expect(call.scope).toBe('page');
    expect(call.ticketIds).toEqual(['PG-home']);
  });
});

describe('createRouter multi-select', () => {
  it('fans out per-ticket and shares a prompt group id', async () => {
    const s = setup();
    s.classifier.next = { kind: 'self-only', reason: 'r' };
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'WD-rotator', operatorUserId: 'u_demo', body: body({ selection: ['WD-rotator', 'ST-stats'] }) });
    expect(s.versionStore.rows).toHaveLength(2);
    expect(s.stateMachine.transitions).toHaveLength(2);
    expect(s.dispatcher.calls).toHaveLength(2);
    const pgids = s.versionStore.rows.map((r) => r.promptGroupId);
    expect(pgids[0]).toBe(pgids[1]);
    expect(pgids[0]).not.toBeNull();
  });
  it('returns the primary ticket response', async () => {
    const s = setup();
    s.classifier.next = { kind: 'self-only', reason: 'r' };
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    const res = await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body({ selection: ['WD-rotator', 'ST-stats'] }) });
    expect(res.versionId).toBe('tv_000003');
  });
  it('honors caller-provided promptGroupId', async () => {
    const s = setup();
    s.classifier.next = { kind: 'self-only', reason: 'r' };
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body({ selection: ['WD-rotator', 'ST-stats'], promptGroupId: 'pg_explicit' }) });
    expect(s.versionStore.rows[0]!.promptGroupId).toBe('pg_explicit');
    expect(s.versionStore.rows[1]!.promptGroupId).toBe('pg_explicit');
  });
});
