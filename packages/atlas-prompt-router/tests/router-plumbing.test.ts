import { describe, expect, it } from 'vitest';
import { createRouter } from '../src/router.js';
import { steppingClockFrom } from '../src/clock.js';
import { DESIGN_VERSION, TS_CLOCK, body, setup } from './router-setup.js';

describe('createRouter id + clock plumbing', () => {
  it('allocates id-gens monotonically across multi-select', async () => {
    const s = setup();
    s.classifier.next = { kind: 'self-only', reason: 'r' };
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'WD-rotator', operatorUserId: 'u_demo', body: body({ selection: ['WD-rotator', 'ST-stats'] }) });
    expect(s.versionStore.rows[0]!.versionId).toBe('tv_000002');
    expect(s.versionStore.rows[1]!.versionId).toBe('tv_000003');
  });
  it('reads enqueue ts from the clock', async () => {
    const s = setup();
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    const oldTs = '2020-01-01T00:00:00.000Z';
    await r.submitPrompt({ ticketId: 'ST-stats', operatorUserId: 'u_demo', body: body({ ts: oldTs }) });
    expect(s.versionStore.rows[0]!.enqueuedAt).toBe(TS_CLOCK);
  });
});

describe('writer', () => {
  it('passes resolved scope to the writer', async () => {
    const s = setup();
    s.classifier.next = { kind: 'subtree', reason: 'r' };
    const r = createRouter(s.deps, { designVersionId: DESIGN_VERSION });
    await r.submitPrompt({ ticketId: 'SE-hero', operatorUserId: 'u_demo', body: body({ selection: ['SE-hero'] }) });
    expect(s.writer.calls[0]!.scope).toBe('subtree');
  });
});
