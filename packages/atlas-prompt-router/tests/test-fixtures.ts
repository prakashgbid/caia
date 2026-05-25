/**
 * In-memory fakes for every router port. Smoke test + unit tests wire
 * the router through these.
 */

import type {
  DispatchInput,
  DispatchResult,
  DispatcherPort,
  ExpectedChangeWriter,
  ExpectedChangeWriterInput,
  IntentClassifier,
  IntentClassifierInput,
  MapperPort,
  MapperTicket,
  ScopeClassification,
  StateMachinePort,
  TicketState,
  TicketTransitionInput,
  TicketVersionInsert,
  VersionStorePort,
} from '../src/types.js';

export interface FakeClassifier extends IntentClassifier {
  next: ScopeClassification;
  calls: IntentClassifierInput[];
  throws: Error | null;
}

export function makeClassifier(initial: ScopeClassification): FakeClassifier {
  const calls: IntentClassifierInput[] = [];
  const fn = ((input: IntentClassifierInput) => {
    calls.push(input);
    if (fn.throws) throw fn.throws;
    return fn.next;
  }) as FakeClassifier;
  fn.next = initial;
  fn.calls = calls;
  fn.throws = null;
  return fn;
}

export interface FakeWriter extends ExpectedChangeWriter {
  prefix: string;
  calls: ExpectedChangeWriterInput[];
  throws: Error | null;
}

export function makeWriter(prefix: string): FakeWriter {
  const calls: ExpectedChangeWriterInput[] = [];
  const fn = ((input: ExpectedChangeWriterInput) => {
    calls.push(input);
    if (fn.throws) throw fn.throws;
    return `${fn.prefix} ${input.prompt}`;
  }) as FakeWriter;
  fn.prefix = prefix;
  fn.calls = calls;
  fn.throws = null;
  return fn;
}

export interface FakeVersionStore extends VersionStorePort {
  rows: TicketVersionInsert[];
  throws: Error | null;
}

export function makeVersionStore(): FakeVersionStore {
  const rows: TicketVersionInsert[] = [];
  return {
    rows,
    throws: null,
    insertVersion(input: TicketVersionInsert): void {
      if (this.throws) throw this.throws;
      rows.push(input);
    },
  } as FakeVersionStore;
}

export interface FakeStateMachine extends StateMachinePort {
  transitions: TicketTransitionInput[];
  throws: Error | null;
}

export function makeStateMachine(): FakeStateMachine {
  const transitions: TicketTransitionInput[] = [];
  return {
    transitions,
    throws: null,
    transitionTicket(input: TicketTransitionInput): void {
      if (this.throws) throw this.throws;
      transitions.push(input);
    },
  } as FakeStateMachine;
}

export interface FakeDispatcher extends DispatcherPort {
  calls: DispatchInput[];
  result: DispatchResult;
  throws: Error | null;
}

export function makeDispatcher(result: DispatchResult): FakeDispatcher {
  const calls: DispatchInput[] = [];
  return {
    calls,
    result,
    throws: null,
    enqueue(input: DispatchInput): DispatchResult {
      if (this.throws) throw this.throws;
      calls.push(input);
      return this.result;
    },
  } as FakeDispatcher;
}

export interface StaticMapperTicket extends MapperTicket {
  readonly id: string;
}

export function makeStaticMapper(tickets: StaticMapperTicket[]): MapperPort {
  const byId = new Map<string, StaticMapperTicket>();
  const byDom = new Map<string, StaticMapperTicket>();
  const childrenOf = new Map<string, string[]>();
  for (const t of tickets) {
    byId.set(t.id, t);
    if (t.domId) byDom.set(t.domId, t);
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId);
      if (arr) arr.push(t.id);
      else childrenOf.set(t.parentId, [t.id]);
    }
  }

  function ticketByDomId(domId: string): MapperTicket | null {
    return byDom.get(domId) ?? null;
  }

  function descendantTickets(domId: string): MapperTicket[] {
    const start = byDom.get(domId);
    if (!start) return [];
    const out: MapperTicket[] = [];
    const stack: string[] = [start.id];
    while (stack.length > 0) {
      const id = stack.shift();
      if (id === undefined) break;
      const t = byId.get(id);
      if (!t) continue;
      out.push(t);
      const kids = childrenOf.get(id);
      if (kids) {
        for (let i = kids.length - 1; i >= 0; i--) {
          const k = kids[i];
          if (k !== undefined) stack.unshift(k);
        }
      }
    }
    return out;
  }

  return { ticketByDomId, descendantTickets };
}

export const APPROVED_STATE: TicketState = 'approved';
export const CHANGE_REQUESTED_STATE: TicketState = 'change-requested';
