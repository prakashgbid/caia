import { describe, expect, it } from 'vitest';

import {
  composePrompt,
  DEFAULT_SPAWN_TIMEOUT_MS,
  DEFAULT_TRIGGERED_BY,
  Dispatcher,
  renderDefaultUserPrompt,
} from '../src/dispatcher.js';
import type { WaveBucket } from '../src/types.js';
import {
  FakeStateMachine,
  failingSpawn,
  mk,
  okSpawn,
  recordingSpawn,
  staticSystemPrompt,
} from './test-helpers.js';

const SYSTEM_PROMPT = 'fake-fse-system-prompt';

function bucket(ticketIds: string[]): WaveBucket {
  return Object.freeze({
    bucketId: 'bk-test',
    waveIndex: 0,
    assignment: Object.freeze({ kind: 'parallel-bucket', index: 0 }),
    ticketIds: Object.freeze(ticketIds.slice()),
  });
}

describe('Dispatcher constants + helpers', () => {
  it('exposes the defaults', () => {
    expect(DEFAULT_SPAWN_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(DEFAULT_TRIGGERED_BY.kind).toBe('agent');
    expect(DEFAULT_TRIGGERED_BY.id).toBe('@caia/principal-engineer');
  });

  it('composePrompt wraps system and user blocks', () => {
    const p = composePrompt('sys', 'usr');
    expect(p).toContain('<system>\nsys\n</system>');
    expect(p).toContain('<user>\nusr\n</user>');
  });

  it('renderDefaultUserPrompt includes ticket info', () => {
    const out = renderDefaultUserPrompt({
      ticket: mk('T-1', ['T-0'], { resourceLocks: ['db'] }),
      projectId: 'p1',
      waveIndex: 0,
      bucketId: 'bk-x',
    });
    expect(out).toContain('T-1');
    expect(out).toContain('Project: p1');
    expect(out).toContain('Depends on: T-0');
    expect(out).toContain('Resource locks: db');
  });
});

describe('Dispatcher.dispatchBucket — happy path', () => {
  it('records one DispatchAttempt per ticket and drives scheduled transitions', async () => {
    const sm = new FakeStateMachine();
    sm.ensureProject('p1', 'tests-reviewed');
    sm.ensureProject('p2', 'tests-reviewed');
    const d = new Dispatcher({
      stateMachine: sm,
      spawnFn: okSpawn(),
      fseSubagentPath: 'fake.md',
      workerIds: ['w1', 'w2'],
      loadSystemPrompt: staticSystemPrompt(SYSTEM_PROMPT),
    });
    const tickets = new Map([
      ['T-1', mk('T-1')],
      ['T-2', mk('T-2')],
    ]);
    const projectIdByTicket = { 'T-1': 'p1', 'T-2': 'p2' };
    const results = await d.dispatchBucket(bucket(['T-1', 'T-2']), tickets, projectIdByTicket);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(sm.transitions.map((t) => t.toState)).toEqual(['scheduled', 'scheduled']);
  });

  it('round-robins workers', async () => {
    const sm = new FakeStateMachine();
    sm.ensureProject('p1', 'tests-reviewed');
    sm.ensureProject('p2', 'tests-reviewed');
    sm.ensureProject('p3', 'tests-reviewed');
    const d = new Dispatcher({
      stateMachine: sm,
      spawnFn: okSpawn(),
      fseSubagentPath: 'fake.md',
      workerIds: ['w1', 'w2'],
      loadSystemPrompt: staticSystemPrompt(SYSTEM_PROMPT),
    });
    const tickets = new Map([
      ['T-1', mk('T-1')],
      ['T-2', mk('T-2')],
      ['T-3', mk('T-3')],
    ]);
    const r = await d.dispatchBucket(
      bucket(['T-1', 'T-2', 'T-3']),
      tickets,
      { 'T-1': 'p1', 'T-2': 'p2', 'T-3': 'p3' },
    );
    expect(r[0]?.workerId).toBe('w1');
    expect(r[1]?.workerId).toBe('w2');
    expect(r[2]?.workerId).toBe('w1');
  });
});

describe('Dispatcher.dispatchBucket — failures', () => {
  it('marks ticket as failed and drives scheduling-failed when spawn returns ok=false', async () => {
    const sm = new FakeStateMachine();
    sm.ensureProject('p1', 'tests-reviewed');
    const d = new Dispatcher({
      stateMachine: sm,
      spawnFn: failingSpawn('boom'),
      fseSubagentPath: 'fake.md',
      workerIds: ['w1'],
      loadSystemPrompt: staticSystemPrompt(SYSTEM_PROMPT),
    });
    const r = await d.dispatchBucket(
      bucket(['T-1']),
      new Map([['T-1', mk('T-1')]]),
      { 'T-1': 'p1' },
    );
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.failureReason).toBe('boom');
    expect(sm.transitions[0]?.toState).toBe('scheduling-failed');
  });

  it('flags missing ticket gracefully', async () => {
    const sm = new FakeStateMachine();
    const d = new Dispatcher({
      stateMachine: sm,
      spawnFn: okSpawn(),
      fseSubagentPath: 'fake.md',
      workerIds: ['w1'],
      loadSystemPrompt: staticSystemPrompt(SYSTEM_PROMPT),
    });
    const r = await d.dispatchBucket(
      bucket(['T-missing']),
      new Map(),
      { 'T-missing': 'p1' },
    );
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.failureReason).toMatch(/not found/);
  });

  it('flags missing project id gracefully', async () => {
    const sm = new FakeStateMachine();
    const d = new Dispatcher({
      stateMachine: sm,
      spawnFn: okSpawn(),
      fseSubagentPath: 'fake.md',
      workerIds: ['w1'],
      loadSystemPrompt: staticSystemPrompt(SYSTEM_PROMPT),
    });
    const r = await d.dispatchBucket(
      bucket(['T-1']),
      new Map([['T-1', mk('T-1')]]),
      {},
    );
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.failureReason).toMatch(/projectIdByTicket missing/);
  });

  it('refuses to dispatch when no workers and not dryRun', async () => {
    const sm = new FakeStateMachine();
    const d = new Dispatcher({
      stateMachine: sm,
      spawnFn: okSpawn(),
      fseSubagentPath: 'fake.md',
      workerIds: [],
      loadSystemPrompt: staticSystemPrompt(SYSTEM_PROMPT),
    });
    await expect(
      d.dispatchBucket(bucket(['T-1']), new Map([['T-1', mk('T-1')]]), { 'T-1': 'p1' }),
    ).rejects.toThrow(/no workers/);
  });

  it('dryRun records the scheduled transition without spawning', async () => {
    const sm = new FakeStateMachine();
    sm.ensureProject('p1', 'tests-reviewed');
    const { fn, calls } = recordingSpawn();
    const d = new Dispatcher({
      stateMachine: sm,
      spawnFn: fn,
      fseSubagentPath: 'fake.md',
      workerIds: ['w1'],
      loadSystemPrompt: staticSystemPrompt(SYSTEM_PROMPT),
      dryRun: true,
    });
    const r = await d.dispatchBucket(
      bucket(['T-1']),
      new Map([['T-1', mk('T-1')]]),
      { 'T-1': 'p1' },
    );
    expect(r[0]?.ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(sm.transitions[0]?.toState).toBe('scheduled');
  });

  it('renders the FSE subagent system prompt into the dispatched message', async () => {
    const sm = new FakeStateMachine();
    sm.ensureProject('p1', 'tests-reviewed');
    const { fn, calls } = recordingSpawn();
    const d = new Dispatcher({
      stateMachine: sm,
      spawnFn: fn,
      fseSubagentPath: 'fake.md',
      workerIds: ['w1'],
      loadSystemPrompt: staticSystemPrompt(SYSTEM_PROMPT),
    });
    await d.dispatchBucket(
      bucket(['T-1']),
      new Map([['T-1', mk('T-1')]]),
      { 'T-1': 'p1' },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toContain(SYSTEM_PROMPT);
    expect(calls[0]?.prompt).toContain('T-1');
  });
});
