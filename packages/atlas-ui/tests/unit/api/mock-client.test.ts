/**
 * `createMockClient` tests — fixture playback + SSE emit.
 */

import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../../src/api/index.js';
import {
  PROJECT_ID,
  latestDesignResponse,
  sampleEvents,
  ticketTree,
  versionsByTicketId,
  HERO_STATS_TICKET_ID,
} from '../../../fixtures/index.js';

describe('createMockClient', () => {
  function build(): ReturnType<typeof createMockClient> {
    return createMockClient({
      latestDesign: latestDesignResponse,
      ticketsTree: ticketTree,
      versionsByTicketId,
      events: sampleEvents,
    });
  }

  it('returns the canned latest design', async () => {
    const c = build();
    const r = await c.getLatestDesign(PROJECT_ID);
    expect(r.projectId).toBe(PROJECT_ID);
    expect(r.designVersion.id).toBe(latestDesignResponse.designVersion.id);
  });

  it('returns the canned tickets tree (deep-cloned)', async () => {
    const c = build();
    const r = await c.getTicketsTree(PROJECT_ID);
    expect(r.tree.id).toBe(ticketTree.tree.id);
    r.tree.title = 'mutated';
    const r2 = await c.getTicketsTree(PROJECT_ID);
    expect(r2.tree.title).toBe(ticketTree.tree.title);
  });

  it('returns canned versions for a known ticket', async () => {
    const c = build();
    const r = await c.getTicketVersions(HERO_STATS_TICKET_ID);
    expect(r.versions.length).toBeGreaterThan(0);
  });

  it('returns empty versions for an unknown ticket', async () => {
    const c = build();
    const r = await c.getTicketVersions('WD-unknown');
    expect(r.versions).toEqual([]);
  });

  it('submitPrompt synthesises a response and flips state', async () => {
    const c = build();
    const r = await c.submitPrompt(HERO_STATS_TICKET_ID, {
      prompt: 'change',
      selection: [HERO_STATS_TICKET_ID],
      ts: '2026-01-01T00:00:00Z',
    });
    expect(r.ticketState).toBe('change-requested');
    expect(r.versionId).toMatch(/^tv_mock_/);
  });

  it('subscribeEvents replays canned events on subscribe', async () => {
    const c = build();
    const seen: unknown[] = [];
    const unsub = c.subscribeEvents(PROJECT_ID, (e) => seen.push(e));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.length).toBe(sampleEvents.length);
    unsub();
  });

  it('emitEvent broadcasts to live subscribers only', async () => {
    const c = build();
    const seen: unknown[] = [];
    const unsub = c.subscribeEvents(PROJECT_ID, (e) => seen.push(e));
    await new Promise((r) => setTimeout(r, 0));
    seen.length = 0;
    c.emitEvent({
      type: 'ticket.state-changed',
      ticketId: HERO_STATS_TICKET_ID,
      from: 'in-progress',
      to: 'implemented',
      ts: '2026-01-01T00:00:00Z',
    });
    expect(seen).toHaveLength(1);
    unsub();
    c.emitEvent({
      type: 'ticket.state-changed',
      ticketId: HERO_STATS_TICKET_ID,
      from: 'implemented',
      to: 'verified',
      ts: '2026-01-01T00:00:01Z',
    });
    expect(seen).toHaveLength(1);
  });
});
