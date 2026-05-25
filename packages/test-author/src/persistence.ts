/**
 * Persistence — writes `ticket.testCases` and `ticket.testDesign` JSONB
 * onto the ticket via a TicketStore adapter. Idempotent.
 *
 * The orchestrator owns the actual store; this module wires the agent
 * output into the store, runs basic invariants, and returns the
 * persistence outcome.
 */

import type { TestCase } from '@chiefaia/ticket-template';

import { AUTHOR_HARD_BOUNDS } from './contract.js';
import type { AuthorOutput, AuthorTicket, TestDesign, TicketStore } from './types.js';

export interface PersistInput {
  ticketId: string;
  output: AuthorOutput;
  store: TicketStore;
}

export interface PersistOutcome {
  ticketId: string;
  written: boolean;
  totalCases: number;
  reason?: string;
}

/**
 * Persist the agent's `AuthorOutput` to the ticket store.
 *
 * Invariants enforced here (mirroring `@chiefaia/ticket-template`'s
 * super-refine):
 *  - testDesign.totalCases === testCases.length
 *  - testCase IDs are unique
 *  - testCases length <= maxCases (50)
 *
 * On a failed-status `AuthorOutput`, this function does NOT write the
 * cases (we never want to overwrite a known-good prior set with an
 * empty one on a transient spawn failure). It returns `written: false`
 * with the reason.
 */
export async function persistAuthorOutput(input: PersistInput): Promise<PersistOutcome> {
  if (input.output.status === 'failed') {
    return {
      ticketId: input.ticketId,
      written: false,
      totalCases: 0,
      reason: input.output.failureReason ?? 'author returned status=failed'
    };
  }

  validateTotals(input.output.testCases, input.output.testDesign);
  validateUniqueIds(input.output.testCases);
  validateCap(input.output.testCases);

  await input.store.writeTestCases({
    ticketId: input.ticketId,
    testCases: input.output.testCases,
    testDesign: input.output.testDesign
  });

  return {
    ticketId: input.ticketId,
    written: true,
    totalCases: input.output.testCases.length
  };
}

function validateTotals(cases: readonly TestCase[], design: TestDesign): void {
  if (cases.length !== design.totalCases) {
    throw new Error(
      `persistence invariant: testDesign.totalCases (${design.totalCases}) !== testCases.length (${cases.length})`
    );
  }
}

function validateUniqueIds(cases: readonly TestCase[]): void {
  const seen = new Set<string>();
  for (const tc of cases) {
    if (seen.has(tc.id)) {
      throw new Error(`persistence invariant: duplicate testCases.id '${tc.id}'`);
    }
    seen.add(tc.id);
  }
}

function validateCap(cases: readonly TestCase[]): void {
  if (cases.length > AUTHOR_HARD_BOUNDS.maxCases) {
    throw new Error(
      `persistence invariant: testCases.length ${cases.length} > maxCases ${AUTHOR_HARD_BOUNDS.maxCases}`
    );
  }
}

/**
 * In-memory store for tests. Production wires to the orchestrator's
 * Postgres-backed adapter.
 */
export class InMemoryTicketStore implements TicketStore {
  private readonly tickets = new Map<string, AuthorTicket>();

  setTicket(ticket: AuthorTicket): void {
    this.tickets.set(ticket.id, { ...ticket });
  }

  async loadTicket(ticketId: string): Promise<AuthorTicket> {
    const t = this.tickets.get(ticketId);
    if (!t) throw new Error(`ticket ${ticketId} not found`);
    return t;
  }

  async writeTestCases(input: {
    ticketId: string;
    testCases: readonly TestCase[];
    testDesign: TestDesign;
  }): Promise<void> {
    const t = this.tickets.get(input.ticketId);
    if (!t) throw new Error(`ticket ${input.ticketId} not found`);
    (t as Record<string, unknown>)['testCases'] = input.testCases;
    (t as Record<string, unknown>)['testDesign'] = input.testDesign;
  }

  /** Test helper — returns the latest stored ticket including the writes. */
  readTicket(ticketId: string): AuthorTicket | undefined {
    return this.tickets.get(ticketId);
  }
}
