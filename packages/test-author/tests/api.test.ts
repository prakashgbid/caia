import { describe, it, expect } from 'vitest';

import { authorTests } from '../src/api.js';
import { InMemoryTicketStore } from '../src/persistence.js';
import { TestAuthorAgent } from '../src/agent.js';
import {
  buildFakeArchitecture,
  buildFakeTicket,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  RecordingStateMachine
} from './helpers/fakes.js';

const FIXED_NOW = 1_716_624_000_000;

function seededStore(): InMemoryTicketStore {
  const store = new InMemoryTicketStore();
  const t = buildFakeTicket();
  (t as Record<string, unknown>)['architecture'] = buildFakeArchitecture();
  store.setTicket(t);
  return store;
}

describe('authorTests — pass path', () => {
  it('emits a single ea-complete → tests-authored transition on pass', async () => {
    const store = seededStore();
    const sm = new RecordingStateMachine();
    const agent = new TestAuthorAgent({
      spawner: fakeGoldenSpawner(FIXED_NOW).fn,
      clock: () => FIXED_NOW
    });

    const outcome = await authorTests('ticket-pt-test-001', { store, stateMachine: sm, agent });

    expect(outcome.output.status).toBe('ok');
    expect(outcome.emittedTransitions.length).toBe(1);
    expect(outcome.emittedTransitions[0]).toEqual({
      from: 'ea-complete',
      to: 'tests-authored',
      intermediate: false
    });
    expect(sm.transitions[0]?.triggeredBy.id).toBe('test-author');
  });

  it('writes testCases + testDesign to the store on pass', async () => {
    const store = seededStore();
    const sm = new RecordingStateMachine();
    const agent = new TestAuthorAgent({
      spawner: fakeGoldenSpawner(FIXED_NOW).fn,
      clock: () => FIXED_NOW
    });

    await authorTests('ticket-pt-test-001', { store, stateMachine: sm, agent });

    const stored = store.readTicket('ticket-pt-test-001');
    expect((stored?.['testCases'] as unknown[]).length).toBe(15);
    expect(stored?.['testDesign']).toBeDefined();
  });
});

describe('authorTests — fail path (canonical chain)', () => {
  it('emits the canonical two-row chain ea-complete → tests-authored → tests-authoring-failed on fail', async () => {
    const store = seededStore();
    const sm = new RecordingStateMachine();
    const agent = new TestAuthorAgent({
      spawner: fakeSpawnerReturning('not json at all').fn,
      clock: () => FIXED_NOW
    });

    const outcome = await authorTests('ticket-pt-test-001', { store, stateMachine: sm, agent });

    expect(outcome.output.status).toBe('partial');
    expect(outcome.emittedTransitions.length).toBe(2);
    expect(outcome.emittedTransitions[0]).toEqual({
      from: 'ea-complete',
      to: 'tests-authored',
      intermediate: true
    });
    expect(outcome.emittedTransitions[1]).toEqual({
      from: 'tests-authored',
      to: 'tests-authoring-failed',
      intermediate: false
    });
  });

  it('emits the canonical chain when the spawner fails outright', async () => {
    const store = seededStore();
    const sm = new RecordingStateMachine();
    const agent = new TestAuthorAgent({
      spawner: fakeSpawnerReturning('', false).fn,
      clock: () => FIXED_NOW
    });

    const outcome = await authorTests('ticket-pt-test-001', { store, stateMachine: sm, agent });

    expect(outcome.output.status).toBe('failed');
    expect(outcome.emittedTransitions.length).toBe(2);
    expect(sm.transitions[1]?.to).toBe('tests-authoring-failed');
  });

  it('does NOT write testCases on a fail path (preserves prior good output)', async () => {
    const store = seededStore();
    const sm = new RecordingStateMachine();
    const agent = new TestAuthorAgent({
      spawner: fakeSpawnerReturning('', false).fn,
      clock: () => FIXED_NOW
    });

    await authorTests('ticket-pt-test-001', { store, stateMachine: sm, agent });

    const stored = store.readTicket('ticket-pt-test-001');
    expect(stored?.['testCases']).toBeUndefined();
  });
});

describe('authorTests — error handling', () => {
  it('throws ticket-not-found when the store does not know the id', async () => {
    const store = seededStore();
    const sm = new RecordingStateMachine();
    const agent = new TestAuthorAgent({
      spawner: fakeGoldenSpawner(FIXED_NOW).fn,
      clock: () => FIXED_NOW
    });

    await expect(
      authorTests('ticket-does-not-exist', { store, stateMachine: sm, agent })
    ).rejects.toThrow(/not found/);
  });

  it('skips state-machine emissions when skipStateMachine=true', async () => {
    const store = seededStore();
    const sm = new RecordingStateMachine();
    const agent = new TestAuthorAgent({
      spawner: fakeGoldenSpawner(FIXED_NOW).fn,
      clock: () => FIXED_NOW
    });

    const outcome = await authorTests('ticket-pt-test-001', {
      store,
      stateMachine: sm,
      agent,
      skipStateMachine: true
    });

    expect(outcome.emittedTransitions.length).toBe(0);
    expect(sm.transitions.length).toBe(0);
  });
});
