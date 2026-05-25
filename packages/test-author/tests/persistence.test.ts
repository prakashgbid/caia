import { describe, it, expect } from 'vitest';

import { InMemoryTicketStore, persistAuthorOutput } from '../src/persistence.js';
import type { AuthorOutput, TestDesign } from '../src/types.js';
import { buildFakeTicket, goldenExpectedOutput } from './helpers/fakes.js';

const FIXED_NOW = 1_716_624_000_000;

describe('persistAuthorOutput — happy path', () => {
  it('writes testCases and testDesign to the store on a status=ok output', async () => {
    const store = new InMemoryTicketStore();
    store.setTicket(buildFakeTicket());
    const output = goldenExpectedOutput(FIXED_NOW);

    const result = await persistAuthorOutput({
      ticketId: 'ticket-pt-test-001',
      output,
      store
    });

    expect(result.written).toBe(true);
    expect(result.totalCases).toBe(15);

    const stored = store.readTicket('ticket-pt-test-001');
    expect(stored?.['testCases']).toBeDefined();
    expect(stored?.['testDesign']).toBeDefined();
  });

  it('is idempotent — running twice produces the same stored state', async () => {
    const store = new InMemoryTicketStore();
    store.setTicket(buildFakeTicket());
    const output = goldenExpectedOutput(FIXED_NOW);

    await persistAuthorOutput({ ticketId: 'ticket-pt-test-001', output, store });
    const first = JSON.stringify(store.readTicket('ticket-pt-test-001'));
    await persistAuthorOutput({ ticketId: 'ticket-pt-test-001', output, store });
    const second = JSON.stringify(store.readTicket('ticket-pt-test-001'));

    expect(first).toBe(second);
  });
});

describe('persistAuthorOutput — failure paths', () => {
  it('does NOT write when output.status is "failed"', async () => {
    const store = new InMemoryTicketStore();
    store.setTicket(buildFakeTicket());
    const output: AuthorOutput = {
      ...goldenExpectedOutput(FIXED_NOW),
      status: 'failed',
      testCases: [],
      testDesign: {
        designedBy: 'test-author',
        designedAt: FIXED_NOW,
        totalCases: 0,
        categoryCounts: {
          happy: 0,
          edge: 0,
          error: 0,
          accessibility: 0,
          security: 0,
          performance: 0,
          visual: 0
        },
        layerCounts: { unit: 0, integration: 0, e2e: 0, visual: 0, accessibility: 0 }
      },
      failureReason: 'forced'
    };

    const result = await persistAuthorOutput({
      ticketId: 'ticket-pt-test-001',
      output,
      store
    });

    expect(result.written).toBe(false);
    expect(result.reason).toBe('forced');
    const stored = store.readTicket('ticket-pt-test-001');
    expect(stored?.['testCases']).toBeUndefined();
  });

  it('throws when testDesign.totalCases !== testCases.length', async () => {
    const store = new InMemoryTicketStore();
    store.setTicket(buildFakeTicket());
    const golden = goldenExpectedOutput(FIXED_NOW);
    const badDesign: TestDesign = { ...golden.testDesign, totalCases: golden.testCases.length + 1 };
    const output: AuthorOutput = { ...golden, testDesign: badDesign };

    await expect(
      persistAuthorOutput({ ticketId: 'ticket-pt-test-001', output, store })
    ).rejects.toThrow(/persistence invariant/);
  });

  it('throws on duplicate testCase ids', async () => {
    const store = new InMemoryTicketStore();
    store.setTicket(buildFakeTicket());
    const golden = goldenExpectedOutput(FIXED_NOW);
    const dupCases = [...golden.testCases, { ...golden.testCases[0]! }];
    const output: AuthorOutput = {
      ...golden,
      testCases: dupCases,
      testDesign: { ...golden.testDesign, totalCases: dupCases.length }
    };

    await expect(
      persistAuthorOutput({ ticketId: 'ticket-pt-test-001', output, store })
    ).rejects.toThrow(/duplicate testCases.id/);
  });
});

describe('InMemoryTicketStore', () => {
  it('throws ticket-not-found when loading an unknown id', async () => {
    const store = new InMemoryTicketStore();
    await expect(store.loadTicket('missing')).rejects.toThrow(/not found/);
  });

  it('round-trips setTicket → loadTicket', async () => {
    const store = new InMemoryTicketStore();
    store.setTicket(buildFakeTicket());
    const t = await store.loadTicket('ticket-pt-test-001');
    expect(t.id).toBe('ticket-pt-test-001');
    expect(t.type).toBe('Story');
  });
});
