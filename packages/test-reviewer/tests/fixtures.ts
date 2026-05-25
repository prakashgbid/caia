/**
 * Test fixtures for @caia/test-reviewer.
 */

import type { TestCase } from '@chiefaia/ticket-template';
import type { ProjectState } from '@caia/state-machine';
import type {
  ArchitectureStore,
  ReviewerInput,
  ReviewerTicket,
  StateMachineAdapter,
  TicketStore,
} from '../src/types.js';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `tc-${counter}`;
}

export function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: overrides.id ?? nextId(),
    title: overrides.title ?? 'Sample test',
    category: overrides.category ?? 'happy',
    layer: overrides.layer ?? 'unit',
    given: overrides.given ?? 'a sample given',
    when: overrides.when ?? 'the action is taken',
    then: overrides.then ?? 'the expected outcome holds',
    linkedAcceptanceCriterionIndex: overrides.linkedAcceptanceCriterionIndex,
    selectorHints: overrides.selectorHints ?? [],
    mocks: overrides.mocks ?? [],
    status: overrides.status ?? 'pending',
    designedBy: overrides.designedBy ?? 'testing-agent',
  } as TestCase;
}

export function stubTicket(overrides: Partial<ReviewerTicket> = {}): ReviewerTicket {
  return {
    id: 't-1',
    type: 'Page',
    acceptance_criteria: [
      'User can sign up via the signup form',
      'User sees a confirmation message after signup',
    ],
    ...overrides,
  } as ReviewerTicket;
}

export function cleanComposedArchitecture(): Record<string, unknown> {
  return {
    'testing.testingStrategy': {
      pyramidShape: 'broad-base',
      rationale: 'standard',
      riskAreas: ['signup'],
      owner: 'test-author',
      reviewer: 'test-reviewer',
    },
    'testing.testTypeMixPercentages': {
      Page: { unit: 60, integration: 20, e2e: 10, visual: 5, a11y: 3, perf: 2 },
      Story: { unit: 60, integration: 20, e2e: 10, visual: 5, a11y: 3, perf: 2 },
    },
    'a11y.wcagLevel': 'AA',
    'security.dataClassification': 'public',
    'frontend.componentTree': [{ id: 'signup-form', interactive: true }],
    'backend.endpointEnumeration': [{ path: '/api/signup' }],
  };
}

/**
 * A clean test suite — 10 cases:
 *   6 unit (4 happy, 1 edge, 1 error)
 *   2 integration happy (linking ACs 0 + 1)
 *   1 e2e happy
 *   1 accessibility (WCAG floor)
 * Both ACs covered by happy tests at unit layer (tc-u1 ↔ AC#0, tc-u2 ↔ AC#1).
 */
export function cleanTestCases(): TestCase[] {
  counter = 0;
  return [
    makeTestCase({
      id: 'tc-u1',
      category: 'happy',
      layer: 'unit',
      linkedAcceptanceCriterionIndex: 0,
      given: 'a fresh user',
      when: 'they submit the signup form',
      then: 'the signup request is accepted',
    }),
    makeTestCase({
      id: 'tc-u2',
      category: 'happy',
      layer: 'unit',
      linkedAcceptanceCriterionIndex: 1,
      given: 'a successful signup',
      when: 'the user lands on the post-signup page',
      then: 'a confirmation message is shown',
    }),
    makeTestCase({ id: 'tc-u3', category: 'happy', layer: 'unit' }),
    makeTestCase({ id: 'tc-u4', category: 'happy', layer: 'unit' }),
    makeTestCase({
      id: 'tc-u5',
      category: 'edge',
      layer: 'unit',
      given: 'an empty form',
      when: 'submitted',
      then: 'validation fires',
    }),
    makeTestCase({
      id: 'tc-u6',
      category: 'error',
      layer: 'unit',
      given: 'a duplicate signup',
      when: 'submitted',
      then: 'a 409 is returned',
    }),
    makeTestCase({
      id: 'tc-i1',
      category: 'happy',
      layer: 'integration',
      linkedAcceptanceCriterionIndex: 0,
    }),
    makeTestCase({
      id: 'tc-i2',
      category: 'happy',
      layer: 'integration',
      linkedAcceptanceCriterionIndex: 1,
    }),
    makeTestCase({ id: 'tc-e1', category: 'happy', layer: 'e2e' }),
    makeTestCase({
      id: 'tc-a1',
      category: 'accessibility',
      layer: 'accessibility',
    }),
  ];
}

export function cleanReviewerInput(): ReviewerInput {
  return {
    ticket: stubTicket({ testCases: cleanTestCases() }),
    composedArchitecture: cleanComposedArchitecture(),
  };
}

// ─── In-memory stores ──────────────────────────────────────────────────────

export class InMemoryTicketStore implements TicketStore {
  constructor(private readonly tickets: Map<string, ReviewerTicket>) {}
  async loadTicket(ticketId: string): Promise<ReviewerTicket> {
    const t = this.tickets.get(ticketId);
    if (!t) throw new Error(`ticket not found: ${ticketId}`);
    return t;
  }
}

export class InMemoryArchitectureStore implements ArchitectureStore {
  constructor(private readonly archs: Map<string, Record<string, unknown>>) {}
  async loadArchitecture(ticketId: string): Promise<Record<string, unknown>> {
    return this.archs.get(ticketId) ?? {};
  }
}

export interface RecordedTransition {
  ticketId: string;
  from: ProjectState;
  to: ProjectState;
  triggeredById: string;
  payload: unknown;
}

export class RecordingStateMachine implements StateMachineAdapter {
  readonly emissions: RecordedTransition[] = [];
  async transition(input: {
    ticketId: string;
    from: ProjectState;
    to: ProjectState;
    triggeredBy: { kind: 'agent'; id: 'test-reviewer' };
    payload: unknown;
  }): Promise<void> {
    this.emissions.push({
      ticketId: input.ticketId,
      from: input.from,
      to: input.to,
      triggeredById: input.triggeredBy.id,
      payload: input.payload,
    });
  }
}
