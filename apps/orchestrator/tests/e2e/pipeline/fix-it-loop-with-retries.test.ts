/**
 * Pipeline regression — Fix-It loop with retries then pass.
 *
 * The happy-path test (PHASE2E-001) exercises the all-stubs-pass
 * branch where every test case green on attempt 1. This regression
 * covers the more interesting case: a test runner returns 'failed'
 * on the first attempt, the diagnoser produces a report, the IPC
 * applies a fix, and the runner returns 'passed' on attempt 2. The
 * orchestrator must produce a `tested_and_done` outcome with
 * `totalAttempts > testCases.length`.
 *
 * In production these collaborators are wired by FIX-002..006.
 * The regression test injects scripted in-memory ports that model
 * the contract:
 *   - generator    — returns a synthetic spec path (never touches FS).
 *   - runner       — returns `failed` first, `passed` on retry.
 *   - diagnoser    — returns a structured failure report.
 *   - ipc          — returns `{ ok: true, sha }` for every fix.
 *   - emitter      — records every per-attempt result so the test
 *                    can assert the attempt sequence.
 */

import type { TestCase } from '@chiefaia/ticket-template';
import { FixItOrchestrator } from '../../../../worker-fix-it/src/orchestrator';
import type {
  CodingCompletePayload,
  TestCaseResultPayload,
} from '../../../../worker-fix-it/src/types';
import {
  StubTestCodeGenerator,
  StubFailureDiagnoser,
  StubCodingIpcInvoker,
  type TestRunner,
  type ResultEmitter,
  type RunResult,
  type GeneratedSpec,
} from '../../../../worker-fix-it/src/stubs';

class FailThenPassRunner implements TestRunner {
  /** Per-test-case attempt counter. */
  private readonly attempts = new Map<string, number>();
  /** Configurable failures before pass — default 1 (one failure, then pass). */
  constructor(private readonly failuresPerCase = 1) {}

  async runSpec(spec: GeneratedSpec): Promise<RunResult> {
    const prior = this.attempts.get(spec.testCaseId) ?? 0;
    const attempt = prior + 1;
    this.attempts.set(spec.testCaseId, attempt);
    if (attempt <= this.failuresPerCase) {
      return {
        testCaseId: spec.testCaseId,
        status: 'failed',
        durationMs: 5,
        errorMessage: `simulated failure #${attempt} for ${spec.testCaseId}`,
        errorStack: 'fake stack trace at <anonymous>:1:1',
      };
    }
    return {
      testCaseId: spec.testCaseId,
      status: 'passed',
      durationMs: 1,
    };
  }
}

class RecordingEmitter implements ResultEmitter {
  readonly results: TestCaseResultPayload[] = [];
  async emitTestCaseResult(payload: TestCaseResultPayload): Promise<void> {
    this.results.push(payload);
  }
}

const SAMPLE_TEST_CASES: TestCase[] = [
  {
    id: 'tc-happy-1',
    title: 'happy path renders the page',
    category: 'happy',
    layer: 'e2e',
    given: 'page is rendered',
    when: 'user visits',
    then: 'page renders',
    selectorHints: [],
    mocks: [],
    required: true,
    status: 'pending',
    designedBy: 'test-design-agent',
    designedAt: 0,
  },
  {
    id: 'tc-happy-2',
    title: 'happy path submits the form',
    category: 'happy',
    layer: 'e2e',
    given: 'page is rendered',
    when: 'user submits',
    then: 'submission succeeds',
    selectorHints: [],
    mocks: [],
    required: true,
    status: 'pending',
    designedBy: 'test-design-agent',
    designedAt: 0,
  },
];

const PAYLOAD: CodingCompletePayload = {
  storyId: 'story_fix_retry_regression',
  workerId: 'wkr_fix_retry',
  prUrl: 'https://github.com/acme/repo/pull/9999',
  prNumber: 9999,
  sha: 'a'.repeat(40),
  localTestsPassed: true,
  worktreePath: '/tmp/fake-worktree',
  codingSessionId: 'sess_fix_retry',
  completedAt: 1_000_000,
  correlationId: 'cor_fix_retry',
};

describe('Pipeline regression — Fix-It loop with retries then pass', () => {
  it('produces tested_and_done after one failure-then-pass per test case', async () => {
    const runner = new FailThenPassRunner(/* failuresPerCase */ 1);
    const emitter = new RecordingEmitter();
    const fixIt = new FixItOrchestrator({
      generator: new StubTestCodeGenerator(),
      runner,
      diagnoser: new StubFailureDiagnoser(),
      ipc: new StubCodingIpcInvoker(),
      emitter,
    });

    const result = await fixIt.run(PAYLOAD, SAMPLE_TEST_CASES);
    expect(result.kind).toBe('tested_and_done');
    if (result.kind !== 'tested_and_done') throw new Error('expected tested_and_done');
    // Every case did 2 attempts (1 failure + 1 pass) → totalAttempts = 4.
    expect(result.payload.totalAttempts).toBe(SAMPLE_TEST_CASES.length * 2);

    // Per-attempt timeline must contain exactly two entries per case
    // (one failure, one pass), in order.
    for (const tc of SAMPLE_TEST_CASES) {
      const forCase = emitter.results.filter((r) => r.testCaseId === tc.id);
      expect(forCase.length).toBe(2);
      expect(forCase[0]!.status).toBe('failed');
      expect(forCase[0]!.attempt).toBe(1);
      expect(forCase[1]!.status).toBe('passed');
      expect(forCase[1]!.attempt).toBe(2);
    }
  });

  it('all per-attempt events carry the originating correlation_id', async () => {
    const runner = new FailThenPassRunner(/* failuresPerCase */ 1);
    const emitter = new RecordingEmitter();
    const fixIt = new FixItOrchestrator({
      generator: new StubTestCodeGenerator(),
      runner,
      diagnoser: new StubFailureDiagnoser(),
      ipc: new StubCodingIpcInvoker(),
      emitter,
    });
    await fixIt.run(PAYLOAD, SAMPLE_TEST_CASES);
    expect(emitter.results.every((r) => r.correlationId === 'cor_fix_retry')).toBe(true);
  });
});
