/**
 * Pipeline regression — Fix-It loop escalation.
 *
 * Asserts the contract when a test case fails every retry up to
 * `MAX_ATTEMPTS_PER_CASE = 6`:
 *   - The orchestrator returns `kind: 'fix_loop_escalated'`.
 *   - The escalation payload lists every exhausted test case in
 *     one shot (the loop does NOT short-circuit on the first
 *     exhaustion — every case must be attempted so the operator
 *     sees the full damage report).
 *   - Per-case `lastFailures` carries the final attempt's error
 *     message.
 *   - The Coding Agent's IPC.shutdown() is NOT called (the worktree
 *     stays warm so the operator can attach for triage; the
 *     escalation handler in the orchestrator is responsible for
 *     filing the `fix-stuck` blocker and releasing the worker
 *     manually).
 */

import type { TestCase } from '@chiefaia/ticket-template';
import {
  FixItOrchestrator,
  MAX_ATTEMPTS_PER_CASE,
} from '../../../../worker-fix-it/src/orchestrator';
import type { CodingCompletePayload } from '../../../../worker-fix-it/src/types';
import {
  StubTestCodeGenerator,
  StubFailureDiagnoser,
  type TestRunner,
  type RunResult,
  type GeneratedSpec,
  type CodingIpcInvoker,
  type FixOutcome,
  NoopResultEmitter,
} from '../../../../worker-fix-it/src/stubs';
import type { FixRequest } from '../../../../worker-fix-it/src/types';

class AlwaysFailRunner implements TestRunner {
  async runSpec(spec: GeneratedSpec): Promise<RunResult> {
    return {
      testCaseId: spec.testCaseId,
      status: 'failed',
      durationMs: 1,
      errorMessage: 'simulated permanent failure',
      errorStack: 'fake stack',
    };
  }
}

class RecordingIpc implements CodingIpcInvoker {
  shutdownCalls = 0;
  applyFixCalls: FixRequest[] = [];
  async applyFix(req: FixRequest): Promise<FixOutcome> {
    this.applyFixCalls.push(req);
    return { ok: true, sha: 'b'.repeat(40), summary: 'fake fix' };
  }
  async shutdown(): Promise<void> {
    this.shutdownCalls++;
  }
}

const TEST_CASES: TestCase[] = [
  {
    id: 'tc-escalate-1',
    title: 'will never pass',
    category: 'happy',
    layer: 'e2e',
    given: '...',
    when: '...',
    then: '...',
    selectorHints: [],
    mocks: [],
    required: true,
    status: 'pending',
    designedBy: 'test-design-agent',
    designedAt: 0,
  },
  {
    id: 'tc-escalate-2',
    title: 'also never passes',
    category: 'edge',
    layer: 'integration',
    given: '...',
    when: '...',
    then: '...',
    selectorHints: [],
    mocks: [],
    required: true,
    status: 'pending',
    designedBy: 'test-design-agent',
    designedAt: 0,
  },
];

const PAYLOAD: CodingCompletePayload = {
  storyId: 'story_fix_escalate_regression',
  workerId: 'wkr_fix_escalate',
  prUrl: 'https://github.com/acme/repo/pull/8888',
  prNumber: 8888,
  sha: 'a'.repeat(40),
  localTestsPassed: true,
  worktreePath: '/tmp/fake-worktree',
  codingSessionId: 'sess_fix_escalate',
  completedAt: 1_000_000,
  correlationId: 'cor_fix_escalate',
};

describe('Pipeline regression — Fix-It loop escalation', () => {
  it('produces fix_loop_escalated after MAX_ATTEMPTS_PER_CASE failures per case', async () => {
    const ipc = new RecordingIpc();
    const fixIt = new FixItOrchestrator({
      generator: new StubTestCodeGenerator(),
      runner: new AlwaysFailRunner(),
      diagnoser: new StubFailureDiagnoser(),
      ipc,
      emitter: new NoopResultEmitter(),
    });

    const result = await fixIt.run(PAYLOAD, TEST_CASES);
    expect(result.kind).toBe('fix_loop_escalated');
    if (result.kind !== 'fix_loop_escalated') {
      throw new Error('expected fix_loop_escalated');
    }
    // Every case must be in the escalation payload (even after the
    // first one exhausted — the loop must not short-circuit).
    expect(result.payload.exhaustedTestCaseIds).toEqual(TEST_CASES.map((t) => t.id));
    expect(result.payload.lastFailures.length).toBe(TEST_CASES.length);
    for (const f of result.payload.lastFailures) {
      expect(f.attempt).toBe(MAX_ATTEMPTS_PER_CASE);
      expect(f.errorMessage).toContain('simulated permanent failure');
    }
    expect(result.payload.correlationId).toBe('cor_fix_escalate');

    // Coding Agent IPC must NOT be shutdown on escalation — the
    // worktree stays warm for operator triage.
    expect(ipc.shutdownCalls).toBe(0);
    // applyFix is called (MAX_ATTEMPTS_PER_CASE - 1) times per case
    // — the loop applies a fix between every retry except after the
    // final failed attempt.
    expect(ipc.applyFixCalls.length).toBe(TEST_CASES.length * (MAX_ATTEMPTS_PER_CASE - 1));
  });
});
