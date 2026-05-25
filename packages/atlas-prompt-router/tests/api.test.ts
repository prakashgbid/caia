import { describe, expect, it } from 'vitest';
import { createAtlasPromptApiHandler, statusForKind } from '../src/api.js';
import { createRouter } from '../src/router.js';
import { DESIGN_VERSION, TS_BODY, body, setup } from './router-setup.js';

describe('statusForKind', () => {
  it('maps validation kinds to 400', () => {
    expect(statusForKind('invalid-body')).toBe(400);
    expect(statusForKind('invalid-prompt')).toBe(400);
    expect(statusForKind('invalid-selection')).toBe(400);
    expect(statusForKind('invalid-ts')).toBe(400);
    expect(statusForKind('invalid-prompt-group-id')).toBe(400);
  });
  it('maps body-too-large to 413', () => {
    expect(statusForKind('body-too-large')).toBe(413);
  });
  it('maps unknown-ticket to 404', () => {
    expect(statusForKind('unknown-ticket')).toBe(404);
  });
  it('maps invalid-transition to 409', () => {
    expect(statusForKind('invalid-transition')).toBe(409);
  });
  it('maps downstream failures to 502', () => {
    expect(statusForKind('classifier-failed')).toBe(502);
    expect(statusForKind('dispatcher-failed')).toBe(502);
    expect(statusForKind('description-writer-failed')).toBe(502);
  });
  it('maps persistence-failed to 500', () => {
    expect(statusForKind('persistence-failed')).toBe(500);
  });
});

describe('createAtlasPromptApiHandler', () => {
  it('returns 200 with the wire response on success', async () => {
    const s = setup();
    const handler = createAtlasPromptApiHandler(createRouter(s.deps, { designVersionId: DESIGN_VERSION }));
    const res = await handler({
      body: { prompt: 'serif', selection: ['ST-stats'], ts: TS_BODY },
      params: { ticketId: 'ST-stats' },
      operatorUserId: 'u_demo',
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('unreachable');
    const ok = res.body as { versionId: string; ticketState: string };
    expect(ok.versionId).toBe('tv_000001');
    expect(ok.ticketState).toBe('change-requested');
  });
  it('returns 400 when params.ticketId is missing', async () => {
    const s = setup();
    const handler = createAtlasPromptApiHandler(createRouter(s.deps, { designVersionId: DESIGN_VERSION }));
    const res = await handler({ body: body(), params: { ticketId: '' }, operatorUserId: 'u' });
    expect(res.status).toBe(400);
  });
  it('returns 400 when operatorUserId is missing', async () => {
    const s = setup();
    const handler = createAtlasPromptApiHandler(createRouter(s.deps, { designVersionId: DESIGN_VERSION }));
    const res = await handler({ body: body(), params: { ticketId: 'ST-stats' }, operatorUserId: '' });
    expect(res.status).toBe(400);
  });
});

describe('createAtlasPromptApiHandler — error paths', () => {
  it('returns 400 when body is missing required fields', async () => {
    const s = setup();
    const handler = createAtlasPromptApiHandler(createRouter(s.deps, { designVersionId: DESIGN_VERSION }));
    const res = await handler({
      body: { prompt: '   ', selection: ['ST-stats'], ts: TS_BODY },
      params: { ticketId: 'ST-stats' },
      operatorUserId: 'u',
    });
    expect(res.status).toBe(400);
    if (res.status !== 400) throw new Error('unreachable');
    expect(res.body.error.kind).toBe('invalid-prompt');
  });
  it('returns 404 when the ticket is unknown', async () => {
    const s = setup();
    const handler = createAtlasPromptApiHandler(createRouter(s.deps, { designVersionId: DESIGN_VERSION }));
    const res = await handler({ body: { prompt: 'p', selection: ['ZZZ'], ts: TS_BODY }, params: { ticketId: 'ZZZ' }, operatorUserId: 'u' });
    expect(res.status).toBe(404);
  });
  it('returns 502 when the dispatcher fails', async () => {
    const s = setup();
    s.dispatcher.throws = new Error('downstream');
    const handler = createAtlasPromptApiHandler(createRouter(s.deps, { designVersionId: DESIGN_VERSION }));
    const res = await handler({ body: body(), params: { ticketId: 'ST-stats' }, operatorUserId: 'u_demo' });
    expect(res.status).toBe(502);
  });
  it('returns 500 on persistence failure', async () => {
    const s = setup();
    s.versionStore.throws = new Error('db');
    const handler = createAtlasPromptApiHandler(createRouter(s.deps, { designVersionId: DESIGN_VERSION }));
    const res = await handler({ body: body(), params: { ticketId: 'ST-stats' }, operatorUserId: 'u_demo' });
    expect(res.status).toBe(500);
  });
});

describe('createAtlasPromptApiHandler — pass-through', () => {
  it('passes operator-supplied designVersionId through', async () => {
    const s = setup();
    const handler = createAtlasPromptApiHandler(createRouter(s.deps, { designVersionId: DESIGN_VERSION }));
    await handler({
      body: body(),
      params: { ticketId: 'ST-stats' },
      operatorUserId: 'u_demo',
      designVersionId: 'dv_override',
    });
    expect(s.versionStore.rows[0]!.designVersionId).toBe('dv_override');
  });
  it('passes operator-supplied previousState through', async () => {
    const s = setup();
    const handler = createAtlasPromptApiHandler(createRouter(s.deps, { designVersionId: DESIGN_VERSION }));
    await handler({
      body: body(),
      params: { ticketId: 'ST-stats' },
      operatorUserId: 'u_demo',
      previousState: 'verified',
    });
    expect(s.stateMachine.transitions[0]!.fromState).toBe('verified');
  });
  it('returns 500 on unexpected non-RouterError throws', async () => {
    const router = { submitPrompt: () => { throw new Error('unexpected'); } };
    const handler = createAtlasPromptApiHandler(router as Parameters<typeof createAtlasPromptApiHandler>[0]);
    const res = await handler({ body: body(), params: { ticketId: 'ST-stats' }, operatorUserId: 'u_demo' });
    expect(res.status).toBe(500);
    if (res.status !== 500) throw new Error('unreachable');
    expect(res.body.error.kind).toBe('internal');
  });
});
