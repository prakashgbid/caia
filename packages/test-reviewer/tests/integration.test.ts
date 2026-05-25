/**
 * Integration test — full pass → fail → fix → pass cycle, end-to-end
 * through reviewTicket() with FSM emission verified at every step.
 */

import { describe, it, expect } from 'vitest';
import { reviewTicket } from '../src/api.js';
import {
  cleanComposedArchitecture,
  cleanTestCases,
  InMemoryArchitectureStore,
  InMemoryTicketStore,
  RecordingStateMachine,
  stubTicket,
} from './fixtures.js';

describe('integration — full audit cycle', () => {
  it('clean pass → tests-reviewed; broken → chain; fixed → pass', async () => {
    const ticketId = 't-integration';
    const sm = new RecordingStateMachine();

    // ─── 1. Broken first pass — empty test-cases. ────────────────────────
    const brokenTicket = stubTicket({ id: ticketId, testCases: [] });
    const brokenStore = new InMemoryTicketStore(
      new Map([[ticketId, brokenTicket]]),
    );
    const as = new InMemoryArchitectureStore(
      new Map([[ticketId, cleanComposedArchitecture()]]),
    );

    const failOutcome = await reviewTicket(ticketId, {
      ticketStore: brokenStore,
      architectureStore: as,
      stateMachine: sm,
    });
    expect(failOutcome.decision.decision).toBe('fail');
    expect(failOutcome.emittedTransitions).toHaveLength(2);

    // ─── 2. Fixed second pass — clean test-cases. ────────────────────────
    const fixedTicket = stubTicket({
      id: ticketId,
      testCases: cleanTestCases(),
    });
    const fixedStore = new InMemoryTicketStore(
      new Map([[ticketId, fixedTicket]]),
    );
    const passOutcome = await reviewTicket(ticketId, {
      ticketStore: fixedStore,
      architectureStore: as,
      stateMachine: sm,
    });
    expect(passOutcome.decision.decision).toBe('pass');
    expect(passOutcome.emittedTransitions).toHaveLength(1);
    expect(passOutcome.emittedTransitions[0]?.to).toBe('tests-reviewed');

    // 2 emissions (fail chain) + 1 emission (pass) = 3 total
    expect(sm.emissions).toHaveLength(3);
  });

  it('preserves ticketId across all emissions', async () => {
    const sm = new RecordingStateMachine();
    const ticket = stubTicket({ id: 't-id-check', testCases: [] });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));
    await reviewTicket('t-id-check', { ticketStore: ts, stateMachine: sm });
    expect(sm.emissions.every((e) => e.ticketId === 't-id-check')).toBe(true);
  });

  it('summary on fail names the lenses that fired', async () => {
    const sm = new RecordingStateMachine();
    const ticket = stubTicket({ id: 't-summary', testCases: [] });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));
    const outcome = await reviewTicket('t-summary', {
      ticketStore: ts,
      stateMachine: sm,
    });
    expect(outcome.decision.summary).toMatch(/Audit failed/);
    expect(outcome.decision.summary).toMatch(/acCoverage/);
  });
});
