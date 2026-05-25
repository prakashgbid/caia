import { describe, it, expect } from 'vitest';
import { reviewTicket } from '../src/api.js';
import {
  cleanComposedArchitecture,
  cleanTestCases,
  InMemoryArchitectureStore,
  InMemoryTicketStore,
  makeTestCase,
  RecordingStateMachine,
  stubTicket,
} from './fixtures.js';

describe('reviewTicket — pass path', () => {
  it('emits a single tests-authored → tests-reviewed transition', async () => {
    const sm = new RecordingStateMachine();
    const ticket = stubTicket({
      id: 't-pass',
      testCases: cleanTestCases(),
    });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));
    const as = new InMemoryArchitectureStore(
      new Map([[ticket.id, cleanComposedArchitecture()]]),
    );

    const outcome = await reviewTicket('t-pass', {
      ticketStore: ts,
      architectureStore: as,
      stateMachine: sm,
    });

    expect(outcome.decision.decision).toBe('pass');
    expect(sm.emissions).toHaveLength(1);
    expect(sm.emissions[0]?.from).toBe('tests-authored');
    expect(sm.emissions[0]?.to).toBe('tests-reviewed');
    expect(outcome.emittedTransitions).toHaveLength(1);
    expect(outcome.emittedTransitions[0]?.intermediate).toBe(false);
  });

  it('marks the agent id on the transition', async () => {
    const sm = new RecordingStateMachine();
    const ticket = stubTicket({
      id: 't-pass-2',
      testCases: cleanTestCases(),
    });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));
    const as = new InMemoryArchitectureStore(
      new Map([[ticket.id, cleanComposedArchitecture()]]),
    );

    await reviewTicket('t-pass-2', {
      ticketStore: ts,
      architectureStore: as,
      stateMachine: sm,
    });

    expect(sm.emissions[0]?.triggeredById).toBe('test-reviewer');
  });
});

describe('reviewTicket — fail path', () => {
  it('emits the canonical chain on fail', async () => {
    const sm = new RecordingStateMachine();
    // Suite with empty testCases — fails the AC-coverage lens.
    const ticket = stubTicket({ id: 't-fail', testCases: [] });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));
    const as = new InMemoryArchitectureStore(
      new Map([[ticket.id, cleanComposedArchitecture()]]),
    );

    const outcome = await reviewTicket('t-fail', {
      ticketStore: ts,
      architectureStore: as,
      stateMachine: sm,
    });

    expect(outcome.decision.decision).toBe('fail');
    expect(sm.emissions).toHaveLength(2);
    expect(sm.emissions[0]?.from).toBe('tests-authored');
    expect(sm.emissions[0]?.to).toBe('tests-reviewed');
    expect(sm.emissions[1]?.from).toBe('tests-reviewed');
    expect(sm.emissions[1]?.to).toBe('tests-review-failed');
    expect(outcome.emittedTransitions[0]?.intermediate).toBe(true);
    expect(outcome.emittedTransitions[1]?.intermediate).toBe(false);
  });

  it('intermediate row has payload.intermediate=true and no findings', async () => {
    const sm = new RecordingStateMachine();
    const ticket = stubTicket({ id: 't-fail-2', testCases: [] });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));
    const as = new InMemoryArchitectureStore(
      new Map([[ticket.id, cleanComposedArchitecture()]]),
    );

    await reviewTicket('t-fail-2', {
      ticketStore: ts,
      architectureStore: as,
      stateMachine: sm,
    });

    const intermediate = sm.emissions[0]?.payload as {
      intermediate?: boolean;
      findings?: unknown;
    };
    expect(intermediate.intermediate).toBe(true);
    expect(intermediate.findings).toBeUndefined();

    const terminal = sm.emissions[1]?.payload as {
      intermediate?: boolean;
      findings?: unknown;
    };
    expect(terminal.intermediate).toBeUndefined();
    expect(terminal.findings).toBeDefined();
  });
});

describe('reviewTicket — architecture sourcing', () => {
  it('falls back to ticket.architecture when no architectureStore', async () => {
    const sm = new RecordingStateMachine();
    const ticket = stubTicket({
      id: 't-arch-on-ticket',
      testCases: cleanTestCases(),
      architecture: cleanComposedArchitecture(),
    });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));

    const outcome = await reviewTicket('t-arch-on-ticket', {
      ticketStore: ts,
      stateMachine: sm,
    });
    expect(outcome.decision.decision).toBe('pass');
  });

  it('uses empty architecture when neither store nor ticket has one', async () => {
    const sm = new RecordingStateMachine();
    const ticket = stubTicket({
      id: 't-no-arch',
      // Suite that doesn't depend on any architecture-driven floors:
      testCases: [
        makeTestCase({
          category: 'happy',
          linkedAcceptanceCriterionIndex: 0,
        }),
        makeTestCase({
          category: 'happy',
          linkedAcceptanceCriterionIndex: 1,
        }),
        makeTestCase({ category: 'edge' }),
        makeTestCase({ category: 'error' }),
        makeTestCase({ category: 'happy', layer: 'integration' }),
      ],
    });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));

    const outcome = await reviewTicket('t-no-arch', {
      ticketStore: ts,
      stateMachine: sm,
    });
    expect(outcome.decision.decision).toBe('pass');
  });
});

describe('reviewTicket — error paths', () => {
  it('propagates "ticket not found" from the store', async () => {
    const sm = new RecordingStateMachine();
    const ts = new InMemoryTicketStore(new Map());

    await expect(
      reviewTicket('missing', { ticketStore: ts, stateMachine: sm }),
    ).rejects.toThrow(/not found/);
  });
});

describe('reviewTicket — option pass-through', () => {
  it('respects fromState override', async () => {
    const sm = new RecordingStateMachine();
    const ticket = stubTicket({
      id: 't-from',
      testCases: cleanTestCases(),
    });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));
    const as = new InMemoryArchitectureStore(
      new Map([[ticket.id, cleanComposedArchitecture()]]),
    );
    await reviewTicket(
      't-from',
      { ticketStore: ts, architectureStore: as, stateMachine: sm },
      { fromState: 'paused' },
    );
    expect(sm.emissions[0]?.from).toBe('paused');
  });

  it('respects custom blockingSeverities', async () => {
    const sm = new RecordingStateMachine();
    // Suite that fires P1 edge finding by default.
    const ticket = stubTicket({
      id: 't-block',
      testCases: [
        makeTestCase({
          category: 'happy',
          linkedAcceptanceCriterionIndex: 0,
        }),
        makeTestCase({
          category: 'happy',
          linkedAcceptanceCriterionIndex: 1,
        }),
        makeTestCase({ category: 'happy', layer: 'integration' }),
        makeTestCase({ category: 'error' }),
        makeTestCase({
          category: 'accessibility',
          layer: 'accessibility',
        }),
      ],
    });
    const ts = new InMemoryTicketStore(new Map([[ticket.id, ticket]]));
    const as = new InMemoryArchitectureStore(
      new Map([[ticket.id, cleanComposedArchitecture()]]),
    );
    const outcome = await reviewTicket(
      't-block',
      { ticketStore: ts, architectureStore: as, stateMachine: sm },
      { blockingSeverities: ['P0'] },
    );
    expect(outcome.decision.decision).toBe('pass');
  });
});
