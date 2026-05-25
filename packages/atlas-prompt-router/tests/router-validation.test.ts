import { describe, expect, it } from 'vitest';
import { createRouter } from '../src/router.js';
import { RouterError } from '../src/types.js';
import { DESIGN_VERSION, TS_BODY, body, setup } from './router-setup.js';

describe('createRouter validation', () => {
  it('rejects submit when designVersionId is missing both in opts and per-call', async () => {
    const s = setup();
    const r = createRouter(s.deps);
    await expect(
      r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u', body: body() }),
    ).rejects.toBeInstanceOf(RouterError);
  });
  it('rejects empty operatorUserId', async () => {
    const s = setup();
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await expect(
      r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: '', body: body() }),
    ).rejects.toBeInstanceOf(RouterError);
  });
  it('rejects empty ticketId', async () => {
    const s = setup();
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await expect(
      r.submitPrompt({ ticketId: '', operatorUserId: 'u', body: body() }),
    ).rejects.toBeInstanceOf(RouterError);
  });
  it('surfaces validation errors as RouterError with kind', async () => {
    const s = setup();
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u', body: { prompt: '', selection: ['ST-stats'], ts: TS_BODY } });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RouterError);
      expect((e as RouterError).kind).toBe('invalid-prompt');
    }
  });
  it('rejects unknown tickets with unknown-ticket', async () => {
    const s = setup();
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    try {
      await r.submitPrompt({ ticketId: 'NOPE', operatorUserId: 'u', body: { prompt: 'p', selection: ['NOPE'], ts: TS_BODY } });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RouterError).kind).toBe('unknown-ticket');
    }
  });
});
