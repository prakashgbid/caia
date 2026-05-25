import { describe, expect, it } from 'vitest';

import { InMemoryStateStore, StateMachine } from '@caia/state-machine';

import { runFullStackEngineer } from '../src/api.js';
import { createDeterministicEmitter } from '../src/code-emitter.js';
import type { Emitter, GitAdapter } from '../src/types.js';
import {
  makeLoadedTicket,
  newStubGitState,
  staticStore,
  stubGit,
  stubLocalGate,
} from './fixtures/ticket-fixture.js';

async function smInState(initial: 'scheduled' | 'coding-in-progress' = 'scheduled', projectId = 'proj-x'): Promise<StateMachine> {
  const store = new InMemoryStateStore();
  const sm = new StateMachine(store);
  await sm.init();
  await sm.createProject({
    id: projectId,
    tenantId: 'test',
    slug: 'test',
    displayName: 'Test',
    initialState: initial,
  });
  return sm;
}

describe('runFullStackEngineer', () => {
  it('end-to-end: claim → emit → PR → code-complete', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-100', projectId: 'proj-100' });
    const sm = await smInState('scheduled', 'proj-100');
    const state = newStubGitState();
    const r = await runFullStackEngineer('TKT-100', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(state),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w-1',
    });
    expect(r.subState).toBe('pr-opened');
    expect(r.pr?.prNumber).toBe(100);
    expect((await sm.getProject('proj-100'))?.status).toBe('code-complete');
    expect(r.claimTransition?.applied).toBe(true);
    expect(r.completionTransition?.applied).toBe(true);
  });

  it('returns subState=unclaimed when the project is not in scheduled', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-200', projectId: 'proj-200' });
    const sm = await smInState('scheduled', 'proj-200');
    // Force into a non-scheduled state via a manual transition.
    await sm.transition('proj-200', 'coding-in-progress', {
      reason: 'preset',
      triggeredBy: { kind: 'system', id: 'test' },
    });
    await sm.transition('proj-200', 'code-complete', {
      reason: 'preset',
      triggeredBy: { kind: 'system', id: 'test' },
    });
    const r = await runFullStackEngineer('TKT-200', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w-1',
    });
    expect(r.subState).toBe('unclaimed');
    expect(r.failureReason).toContain('expected');
  });

  it('idempotent re-entry: returns subState=idempotent-noop when PR already exists for branch', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-300', projectId: 'proj-300', branchName: 'feat/tkt-300' });
    const sm = await smInState('scheduled', 'proj-300');
    const state = newStubGitState();
    state.prs.push({
      prNumber: 999,
      prUrl: 'https://github.com/example/repo/pull/999',
      branchName: 'feat/tkt-300',
      title: 'existing',
      body: '',
      base: 'develop',
    });
    const r = await runFullStackEngineer('TKT-300', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(state),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w-1',
    });
    expect(r.subState).toBe('idempotent-noop');
    expect(r.pr?.prNumber).toBe(999);
  });

  it('transitions to coding-failed when emitter throws', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-400', projectId: 'proj-400' });
    const sm = await smInState('scheduled', 'proj-400');
    const failingEmitter: Emitter = {
      async emit() {
        throw new Error('boom');
      },
    };
    const r = await runFullStackEngineer('TKT-400', {
      store: staticStore(ticket),
      emitter: failingEmitter,
      git: stubGit(),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w-1',
    });
    expect(r.subState).toBe('implementation-failed');
    expect((await sm.getProject('proj-400'))?.status).toBe('coding-failed');
    expect(r.failureReason).toContain('boom');
  });

  it('transitions to coding-failed when PR opener throws (local gate fail)', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-500', projectId: 'proj-500' });
    const sm = await smInState('scheduled', 'proj-500');
    const r = await runFullStackEngineer('TKT-500', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(),
      localGate: stubLocalGate({ passed: false, output: 'typecheck broke' }),
      stateMachine: sm,
      workerId: 'w-1',
    });
    expect(r.subState).toBe('implementation-failed');
    expect((await sm.getProject('proj-500'))?.status).toBe('coding-failed');
    expect(r.failureReason).toContain('local-gate-failed');
  });

  it('honours skipStateMachine=true (no transitions, claim is auto-accepted)', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-600', projectId: 'proj-600' });
    // No state machine wired.
    const r = await runFullStackEngineer('TKT-600', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(),
      localGate: stubLocalGate({ passed: true }),
      skipStateMachine: true,
    });
    expect(r.subState).toBe('pr-opened');
    expect(r.claimTransition).toBeUndefined();
    expect(r.completionTransition).toBeUndefined();
  });

  it('honours config.workerId verbatim', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-700', projectId: 'proj-700' });
    const sm = await smInState('scheduled', 'proj-700');
    const r = await runFullStackEngineer('TKT-700', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'specific-worker',
    });
    expect(r.workerId).toBe('specific-worker');
  });

  it('uses a default deterministic-ish workerId when none is configured', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-800', projectId: 'proj-800' });
    const sm = await smInState('scheduled', 'proj-800');
    const r = await runFullStackEngineer('TKT-800', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      nonce: 'NONCE',
    });
    expect(r.workerId).toBe('full-stack-engineer-TKT-800-NONCE');
  });

  it('records startedAtIso and finishedAtIso from the injected clock', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-900', projectId: 'proj-900' });
    const sm = await smInState('scheduled', 'proj-900');
    const stamps = ['2026-05-25T10:00:00.000Z', '2026-05-25T10:00:05.000Z'];
    let i = 0;
    const r = await runFullStackEngineer('TKT-900', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w',
      clock: () => new Date(stamps[i++] ?? stamps[stamps.length - 1] as string),
    });
    expect(r.startedAtIso).toBe('2026-05-25T10:00:00.000Z');
    expect(r.finishedAtIso).toBe('2026-05-25T10:00:05.000Z');
  });

  it('emits attributable architecture metadata into the PR body', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-A1', projectId: 'proj-a1' });
    const sm = await smInState('scheduled', 'proj-a1');
    const state = newStubGitState();
    await runFullStackEngineer('TKT-A1', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(state),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w',
    });
    const body = state.prs[0]?.body ?? '';
    expect(body).toContain('TKT-A1');
    expect(body).toContain('frontend-architect');
    expect(body).toContain('database-architect');
    expect(body).toContain('test-author');
    expect(body).toContain('shadcn/ui');
  });

  it('skipLocalGate=true skips the gate AND lets PR open', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-B1', projectId: 'proj-b1' });
    const sm = await smInState('scheduled', 'proj-b1');
    const r = await runFullStackEngineer('TKT-B1', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(),
      localGate: stubLocalGate({ passed: false, output: 'would have failed' }),
      stateMachine: sm,
      workerId: 'w',
      skipLocalGate: true,
    });
    expect(r.subState).toBe('pr-opened');
  });

  it('uses configurable prBaseBranch on PR open', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-C1', projectId: 'proj-c1' });
    const sm = await smInState('scheduled', 'proj-c1');
    const state = newStubGitState();
    await runFullStackEngineer('TKT-C1', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(state),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w',
      prBaseBranch: 'main',
    });
    expect(state.prs[0]?.base).toBe('main');
  });

  it('failureReason is null when subState is pr-opened', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-D1', projectId: 'proj-d1' });
    const sm = await smInState('scheduled', 'proj-d1');
    const r = await runFullStackEngineer('TKT-D1', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w',
    });
    expect(r.failureReason).toBeUndefined();
  });

  it('records the project-not-found path gracefully on a stale ticket', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-E1', projectId: 'proj-missing' });
    const store = new InMemoryStateStore();
    const sm = new StateMachine(store);
    await sm.init();
    // No createProject — project is missing.
    const r = await runFullStackEngineer('TKT-E1', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w',
    });
    expect(r.subState).toBe('unclaimed');
    expect(r.failureReason).toContain('not found');
  });
});

describe('runFullStackEngineer — parallel safety', () => {
  it('only one of two parallel workers wins the claim, the other reports unclaimed', async () => {
    const ticket = makeLoadedTicket({ ticketId: 'TKT-P1', projectId: 'proj-p1' });
    const sm = await smInState('scheduled', 'proj-p1');

    // Each worker gets its OWN git stub state so the second one doesn't
    // see the first's PR before the claim race resolves.
    const result1Promise = runFullStackEngineer('TKT-P1', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(newStubGitState()),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w-A',
    });
    const result2Promise = runFullStackEngineer('TKT-P1', {
      store: staticStore(ticket),
      emitter: createDeterministicEmitter(),
      git: stubGit(newStubGitState()),
      localGate: stubLocalGate({ passed: true }),
      stateMachine: sm,
      workerId: 'w-B',
    });
    const [r1, r2] = await Promise.all([result1Promise, result2Promise]);
    const winners = [r1, r2].filter((r) => r.subState === 'pr-opened');
    const losers = [r1, r2].filter((r) => r.subState !== 'pr-opened');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
  });
});

it('integration: full pipeline with stub adapters on a known small ticket', async () => {
  const ticket = makeLoadedTicket({
    ticketId: 'TKT-INT-1',
    projectId: 'proj-int-1',
    branchName: 'feat/tkt-int-1',
    commitScope: 'feat(integration)',
    acceptanceCriteria: ['User can greet', 'Greeting is persisted'],
  });
  const sm = await smInState('scheduled', 'proj-int-1');
  const state = newStubGitState();
  const result = await runFullStackEngineer('TKT-INT-1', {
    store: staticStore(ticket),
    emitter: createDeterministicEmitter(),
    git: stubGit(state),
    localGate: stubLocalGate({ passed: true }),
    stateMachine: sm,
    workerId: 'integration-worker',
  });

  expect(result.subState).toBe('pr-opened');
  expect(result.workerId).toBe('integration-worker');
  expect(result.branchName).toBe('feat/tkt-int-1');
  expect(result.pr?.prNumber).toBeGreaterThan(0);
  expect(state.committed).toHaveLength(4);
  expect(state.pushed).toEqual(['feat/tkt-int-1']);

  // PR body cites both ACs and the architects.
  const body = state.prs[0]?.body ?? '';
  expect(body).toContain('- [x] User can greet');
  expect(body).toContain('- [x] Greeting is persisted');
  expect(body).toContain('frontend-architect');
  expect(body).toContain('backend-architect');
  expect(body).toContain('database-architect');
  expect(body).toContain('test-author');

  // FSM ends at code-complete.
  expect((await sm.getProject('proj-int-1'))?.status).toBe('code-complete');
  expect(result.completionTransition?.applied).toBe(true);
  expect(result.completionTransition?.toState).toBe('code-complete');
});

// silence unused-import lint
void ({} as GitAdapter);
