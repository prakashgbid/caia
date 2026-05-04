/**
 * `FixItOrchestrator` — orchestrator-level contract tests.
 *
 * Drives the orchestrator with hand-rolled stub ports so we can assert
 * the four interesting branches without booting a real worker:
 *
 *   1. happy path — all cases pass on attempt 1 → tested_and_done
 *   2. failure that the IPC fixes — one retry → tested_and_done with
 *      totalAttempts == 2
 *   3. failure that the IPC cannot fix — escalation with finalStatus
 *      `fix-failed`
 *   4. attempts exhausted — escalation with finalStatus `exhausted`
 *
 * The per-case loop (and its same-sha guard, blocker writing, and
 * persistence) is now owned by RetestLoopController; see
 * `tests/retest-loop-controller.test.ts` for that file's tests. This
 * file pins the orchestrator's run-level state machine.
 */

import {
  FixItOrchestrator,
  MAX_ATTEMPTS_PER_CASE,
} from '../src/orchestrator';
import type {
  CodingIpcInvoker,
  FailureDiagnoser,
  FixOutcome,
  GenerateContext,
  GeneratedSpec,
  ResultEmitter,
  RunResult,
  TestCodeGenerator,
  TestRunner,
} from '../src/stubs';
import type { TestCase } from '@chiefaia/ticket-template';
import type {
  CodingCompletePayload,
  TestCaseResultPayload,
  TestFailureReport,
  FixRequest,
} from '../src/types';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const coreCodingCompletePayload: CodingCompletePayload = {
  storyId: 'story_test',
  workerId: 'worker_test',
  prUrl: 'https://github.com/x/y/pull/1',
  prNumber: 1,
  sha: 'origsha',
  localTestsPassed: true,
  worktreePath: '/tmp/wt',
  codingSessionId: 'sess_test',
  completedAt: 1_700_000_000_000,
  correlationId: 'corr_test',
};

function makeTestCase(id: string): TestCase {
  return {
    id,
    title: `case ${id}`,
    category: 'happy',
    layer: 'unit',
    given: 'g',
    when: 'w',
    then: 't',
    selectorHints: [],
    mocks: [],
    required: true,
    status: 'pending',
    designedBy: 'testing-agent',
    designedAt: 0,
  };
}

class RecordingEmitter implements ResultEmitter {
  public readonly events: TestCaseResultPayload[] = [];
  async emitTestCaseResult(payload: TestCaseResultPayload): Promise<void> {
    this.events.push(payload);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('FixItOrchestrator', () => {
  it('emits tested_and_done when every case passes on attempt 1', async () => {
    const emitter = new RecordingEmitter();
    const orchestrator = new FixItOrchestrator({
      emitter,
      now: () => 1_700_000_000_999,
    });

    const result = await orchestrator.run(coreCodingCompletePayload, [
      makeTestCase('tc1'),
      makeTestCase('tc2'),
    ]);

    expect(result.kind).toBe('tested_and_done');
    if (result.kind !== 'tested_and_done') return;
    expect(result.payload.allPassedAt).toBe(1_700_000_000_999);
    expect(result.payload.totalAttempts).toBe(2); // 1 attempt × 2 cases
    expect(result.payload.finalSha).toBe(coreCodingCompletePayload.sha);
    expect(result.payload.correlationId).toBe('corr_test');

    expect(emitter.events).toHaveLength(2);
    expect(emitter.events.map((e) => e.status)).toEqual(['passed', 'passed']);
  });

  it('loops once via the IPC then emits tested_and_done', async () => {
    const generator: TestCodeGenerator = {
      generate: async (testCase: TestCase, ctx: GenerateContext): Promise<GeneratedSpec> => ({
        testCaseId: testCase.id,
        specPath: `${ctx.worktreePath}/spec.ts`,
        contentHash: 'h',
      }),
    };

    let runs = 0;
    const runner: TestRunner = {
      runSpec: async (): Promise<RunResult> => {
        runs += 1;
        return runs === 1
          ? {
              testCaseId: 'tc1',
              status: 'failed',
              durationMs: 10,
              errorMessage: 'expected /dashboard, got /login',
            }
          : {
              testCaseId: 'tc1',
              status: 'passed',
              durationMs: 5,
            };
      },
    };

    const diagnoser: FailureDiagnoser = {
      diagnose: async (
        runResult: RunResult,
        testCase: TestCase,
        attempt: number,
      ): Promise<TestFailureReport> => ({
        testCaseId: testCase.id,
        attempt,
        category: testCase.category,
        errorMessage: runResult.errorMessage ?? 'unknown',
        errorStack: null,
        failingAssertion: null,
        artifacts: {},
        inferredCause: 'session cookie was missing',
      }),
    };

    const appliedFixes: FixRequest[] = [];
    const ipc: CodingIpcInvoker = {
      applyFix: async (req: FixRequest): Promise<FixOutcome> => {
        appliedFixes.push(req);
        return { ok: true, sha: 'fixsha1', summary: 'fixed cookie' };
      },
      shutdown: async () => undefined,
    };

    const emitter = new RecordingEmitter();
    const orchestrator = new FixItOrchestrator({
      generator,
      runner,
      diagnoser,
      ipc,
      emitter,
      now: () => 1_700_000_000_999,
    });

    const result = await orchestrator.run(coreCodingCompletePayload, [
      makeTestCase('tc1'),
    ]);

    expect(result.kind).toBe('tested_and_done');
    if (result.kind !== 'tested_and_done') return;
    expect(result.payload.totalAttempts).toBe(2);
    expect(result.payload.finalSha).toBe('fixsha1');

    expect(appliedFixes.length).toBe(1);
    const appliedFix = appliedFixes[0]!;
    expect(appliedFix.testCaseId).toBe('tc1');
    expect(appliedFix.preserveScopeOf).toBe('fix-only');
    expect(appliedFix.hypothesisFromDiagnoser).toBe(
      'session cookie was missing',
    );

    // emitter sees: failed (attempt 1), passed (attempt 2)
    expect(emitter.events.map((e) => `${e.status}:${e.attempt}`)).toEqual([
      'failed:1',
      'passed:2',
    ]);
  });

  it('escalates with fix-failed when the IPC returns ok:false', async () => {
    const runner: TestRunner = {
      runSpec: async (): Promise<RunResult> => ({
        testCaseId: 'tc1',
        status: 'failed',
        durationMs: 10,
        errorMessage: 'boom',
      }),
    };
    const ipc: CodingIpcInvoker = {
      applyFix: async (): Promise<FixOutcome> => ({
        ok: false,
        error: 'sdk-rate-limited',
      }),
      shutdown: async () => undefined,
    };

    const orchestrator = new FixItOrchestrator({
      runner,
      ipc,
      now: () => 1_700_000_000_999,
    });

    const result = await orchestrator.run(coreCodingCompletePayload, [
      makeTestCase('tc1'),
    ]);

    expect(result.kind).toBe('fix_loop_escalated');
    if (result.kind !== 'fix_loop_escalated') return;
    expect(result.payload.exhaustedTestCaseIds).toEqual(['tc1']);
    expect(result.payload.lastFailures[0]?.errorMessage).toBe('sdk-rate-limited');
    expect(result.payload.lastFailures[0]?.attempt).toBe(1);
  });

  it('escalates with exhausted after MAX_ATTEMPTS_PER_CASE failures', async () => {
    const runner: TestRunner = {
      runSpec: async (): Promise<RunResult> => ({
        testCaseId: 'tc1',
        status: 'failed',
        durationMs: 10,
        errorMessage: 'still broken',
      }),
    };
    let attemptCount = 0;
    const ipc: CodingIpcInvoker = {
      // Each retry produces a unique sha so the FIX-006 same-sha guard
      // doesn't fire — we want to exercise the attempts-exhausted path.
      applyFix: async (): Promise<FixOutcome> => {
        attemptCount += 1;
        return { ok: true, sha: `attempt${attemptCount}fix`, summary: 'tried' };
      },
      shutdown: async () => undefined,
    };
    let exitCalls = 0;
    const ipcCounted: CodingIpcInvoker = {
      applyFix: ipc.applyFix.bind(ipc),
      shutdown: async () => {
        exitCalls += 1;
      },
    };

    const orchestrator = new FixItOrchestrator({
      runner,
      ipc: ipcCounted,
      now: () => 1_700_000_000_999,
    });

    const result = await orchestrator.run(
      coreCodingCompletePayload,
      [makeTestCase('tc1')],
      { maxAttemptsPerCase: 3 },
    );

    expect(result.kind).toBe('fix_loop_escalated');
    if (result.kind !== 'fix_loop_escalated') return;
    expect(result.payload.exhaustedTestCaseIds).toEqual(['tc1']);
    expect(result.payload.lastFailures[0]?.attempt).toBe(3);
    expect(result.payload.lastFailures[0]?.errorMessage).toBe('still broken');

    // Escalation path should NOT close the IPC — the worker stays
    // alive so the blocker can be inspected.
    expect(exitCalls).toBe(0);
  });

  it('exposes MAX_ATTEMPTS_PER_CASE = 6 as the directive contract', () => {
    expect(MAX_ATTEMPTS_PER_CASE).toBe(6);
  });
});
