/**
 * Per-agent regression — Fix-It Test Agent (FixItOrchestrator).
 *
 * Asserts the Fix-It orchestrator's contract — verified via direct
 * exercise of the class with stub ports (the FIX-002..006 PRs swap
 * each stub for the real implementation while keeping this contract
 * stable):
 *   - All-pass on attempt 1 → tested_and_done with
 *     totalAttempts == testCases.length.
 *   - First-failure-then-pass → tested_and_done with retries.
 *   - All-fail → fix_loop_escalated covering every test case.
 *   - IPC.shutdown() is called only on tested_and_done (NOT on
 *     escalation — keeps worktree warm for triage).
 *   - Per-attempt result events carry the correlation_id.
 */

import type { TestCase } from '@chiefaia/ticket-template';
import {
  FixItOrchestrator,
  MAX_ATTEMPTS_PER_CASE,
} from '../../../../worker-fix-it/src/orchestrator';
import type {
  CodingCompletePayload,
  TestCaseResultPayload,
} from '../../../../worker-fix-it/src/types';
import {
  StubTestCodeGenerator,
  StubFailureDiagnoser,
  type TestRunner,
  type RunResult,
  type GeneratedSpec,
  type CodingIpcInvoker,
  type FixOutcome,
  type ResultEmitter,
  StubTestRunner,
  StubCodingIpcInvoker,
  NoopResultEmitter,
} from '../../../../worker-fix-it/src/stubs';
import type { FixRequest } from '../../../../worker-fix-it/src/types';

const TC: TestCase[] = [
  {
    id: 'tc-r-1',
    title: 'happy',
    category: 'happy',
    layer: 'e2e',
    given: 'g',
    when: 'w',
    then: 't',
    selectorHints: [],
    mocks: [],
    required: true,
    status: 'pending',
    designedBy: 'test-design-agent',
    designedAt: 0,
  },
];

const PAYLOAD: CodingCompletePayload = {
  storyId: 'story_fix_regression',
  workerId: 'wkr_fix_regression',
  prUrl: 'https://github.com/acme/repo/pull/1',
  prNumber: 1,
  sha: 'a'.repeat(40),
  localTestsPassed: true,
  worktreePath: '/tmp/x',
  codingSessionId: 'sess_fix',
  completedAt: 0,
  correlationId: 'cor_fix',
};

class CountingIpc implements CodingIpcInvoker {
  shutdownCalls = 0;
  applyFixCalls = 0;
  async applyFix(_req: FixRequest): Promise<FixOutcome> {
    this.applyFixCalls++;
    return { ok: true, sha: 'b'.repeat(40), summary: 'fake' };
  }
  async shutdown(): Promise<void> {
    this.shutdownCalls++;
  }
}

class FailNTimesRunner implements TestRunner {
  private counter = 0;
  constructor(private readonly failTimes: number) {}
  async runSpec(spec: GeneratedSpec): Promise<RunResult> {
    this.counter++;
    if (this.counter <= this.failTimes) {
      return {
        testCaseId: spec.testCaseId,
        status: 'failed',
        durationMs: 1,
        errorMessage: `failure ${this.counter}`,
        errorStack: 'stack',
      };
    }
    return { testCaseId: spec.testCaseId, status: 'passed', durationMs: 1 };
  }
}

class CapturingEmitter implements ResultEmitter {
  records: TestCaseResultPayload[] = [];
  async emitTestCaseResult(p: TestCaseResultPayload): Promise<void> {
    this.records.push(p);
  }
}

describe('Per-agent regression — Fix-It Test Agent', () => {
  it('all stubs pass → tested_and_done + IPC.shutdown called once', async () => {
    const ipc = new CountingIpc();
    const fixIt = new FixItOrchestrator({
      generator: new StubTestCodeGenerator(),
      runner: new StubTestRunner(),
      diagnoser: new StubFailureDiagnoser(),
      ipc,
      emitter: new NoopResultEmitter(),
    });
    const r = await fixIt.run(PAYLOAD, TC);
    expect(r.kind).toBe('tested_and_done');
    expect(ipc.shutdownCalls).toBe(1);
    expect(ipc.applyFixCalls).toBe(0);
  });

  it('runner fails first then passes → tested_and_done with totalAttempts > testCases', async () => {
    const ipc = new CountingIpc();
    const fixIt = new FixItOrchestrator({
      generator: new StubTestCodeGenerator(),
      runner: new FailNTimesRunner(/* failTimes */ 2),
      diagnoser: new StubFailureDiagnoser(),
      ipc,
      emitter: new NoopResultEmitter(),
    });
    const r = await fixIt.run(PAYLOAD, TC);
    expect(r.kind).toBe('tested_and_done');
    if (r.kind !== 'tested_and_done') throw new Error('unexpected');
    expect(r.payload.totalAttempts).toBe(3);
    expect(ipc.applyFixCalls).toBe(2);
    expect(ipc.shutdownCalls).toBe(1);
  });

  it('always-fail runner → fix_loop_escalated + NO IPC.shutdown', async () => {
    const ipc = new CountingIpc();
    const fixIt = new FixItOrchestrator({
      generator: new StubTestCodeGenerator(),
      runner: new FailNTimesRunner(/* failTimes */ 100),
      diagnoser: new StubFailureDiagnoser(),
      ipc,
      emitter: new NoopResultEmitter(),
    });
    const r = await fixIt.run(PAYLOAD, TC);
    expect(r.kind).toBe('fix_loop_escalated');
    if (r.kind !== 'fix_loop_escalated') throw new Error('unexpected');
    expect(r.payload.exhaustedTestCaseIds).toEqual([TC[0]!.id]);
    expect(r.payload.lastFailures[0]!.attempt).toBe(MAX_ATTEMPTS_PER_CASE);
    expect(ipc.shutdownCalls).toBe(0);
  });

  it('emitter records every per-attempt result with the correlation_id', async () => {
    const emitter = new CapturingEmitter();
    const fixIt = new FixItOrchestrator({
      generator: new StubTestCodeGenerator(),
      runner: new FailNTimesRunner(/* failTimes */ 1),
      diagnoser: new StubFailureDiagnoser(),
      ipc: new StubCodingIpcInvoker(),
      emitter,
    });
    await fixIt.run(PAYLOAD, TC);
    expect(emitter.records.length).toBe(2);
    expect(emitter.records[0]!.status).toBe('failed');
    expect(emitter.records[1]!.status).toBe('passed');
    for (const r of emitter.records) {
      expect(r.correlationId).toBe('cor_fix');
    }
  });
});
