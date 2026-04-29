/**
 * `RetestLoopController` — FIX-006 contract tests.
 *
 * Pins three behaviours independent of the orchestrator:
 *
 *   1. **History persistence** — every (testCase, attempt) pair gets
 *      one row recorded, regardless of outcome.
 *   2. **Blocker writing** — fix-stuck (exhausted) / coding-stuck
 *      (IPC ok:false) / same-sha-twice all get the right blocker
 *      kind and history payload.
 *   3. **Same-sha guard** — Coding Agent producing the same sha twice
 *      bails immediately rather than burning the remaining attempts.
 */

import {
  DEFAULT_MAX_ATTEMPTS,
  RetestLoopController,
  type BlockerInput,
  type BlockerWriter,
  type RunHistoryRecorder,
  type RunHistoryRow,
  type TestRunnerPort,
} from '../src/retest-loop-controller';
import {
  type CodingIpcInvoker,
  type FailureDiagnoser,
  type FixOutcome,
  type GenerateContext,
  type GeneratedSpec,
  type ResultEmitter,
  type RunResult,
  type TestCodeGenerator,
} from '../src/stubs';
import type {
  CodingCompletePayload,
  FixRequest,
  TestCaseResultPayload,
  TestFailureReport,
} from '../src/types';
import type { TestCase } from '@chiefaia/ticket-template';

// ─── Recorders ──────────────────────────────────────────────────────────────

class RecordingHistory implements RunHistoryRecorder {
  public rows: RunHistoryRow[] = [];
  async record(row: RunHistoryRow): Promise<void> {
    this.rows.push(row);
  }
}

class RecordingBlocker implements BlockerWriter {
  public blockers: BlockerInput[] = [];
  async fileBlocker(b: BlockerInput): Promise<void> {
    this.blockers.push(b);
  }
}

class RecordingEmitter implements ResultEmitter {
  public events: TestCaseResultPayload[] = [];
  async emitTestCaseResult(p: TestCaseResultPayload): Promise<void> {
    this.events.push(p);
  }
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const payload: CodingCompletePayload = {
  storyId: 'story_test',
  workerId: 'worker_test',
  prUrl: 'https://github.com/x/y/pull/1',
  prNumber: 1,
  sha: 'origsha',
  localTestsPassed: true,
  worktreePath: '/tmp/wt',
  codingSessionId: 'sess',
  completedAt: 1,
  correlationId: 'corr',
};

function makeCase(id = 'tc1'): TestCase {
  return {
    id,
    title: 't',
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

const fakeGenerator: TestCodeGenerator = {
  generate: async (tc: TestCase, ctx: GenerateContext): Promise<GeneratedSpec> => ({
    testCaseId: tc.id,
    specPath: `${ctx.worktreePath}/spec.ts`,
    contentHash: 'h',
  }),
};

const fakeDiagnoser: FailureDiagnoser = {
  diagnose: async (
    runResult: RunResult,
    tc: TestCase,
    attempt: number,
  ): Promise<TestFailureReport> => ({
    testCaseId: tc.id,
    attempt,
    category: tc.category,
    errorMessage: runResult.errorMessage ?? 'unknown',
    errorStack: null,
    failingAssertion: null,
    artifacts: {},
    inferredCause: 'cause',
  }),
};

function buildIpc(applyFix: (req: FixRequest) => Promise<FixOutcome> | FixOutcome): CodingIpcInvoker {
  return {
    applyFix: async (req) => applyFix(req),
    shutdown: async () => undefined,
  };
}

function buildRunner(plan: ReadonlyArray<RunResult>): TestRunnerPort {
  let i = 0;
  return {
    runSpec: async () => plan[Math.min(i++, plan.length - 1)] ?? plan[plan.length - 1]!,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('RetestLoopController', () => {
  it('passes on attempt 1 → records 1 history row, files no blocker', async () => {
    const history = new RecordingHistory();
    const blockers = new RecordingBlocker();
    const emitter = new RecordingEmitter();
    const controller = new RetestLoopController({
      generator: fakeGenerator,
      runner: buildRunner([{ testCaseId: 'tc1', status: 'passed', durationMs: 5 }]),
      diagnoser: fakeDiagnoser,
      ipc: buildIpc(() => ({ ok: true, sha: 'never-called' })),
      emitter,
      history,
      blockers,
      now: () => 100,
    });

    const out = await controller.runCase(makeCase(), payload);

    expect(out.finalStatus).toBe('passed');
    expect(out.attempts).toBe(1);
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]?.status).toBe('passed');
    expect(blockers.blockers).toHaveLength(0);
    expect(emitter.events.map((e) => e.status)).toEqual(['passed']);
  });

  it('one retry then pass → 2 history rows, no blocker, lastSha lifted', async () => {
    const history = new RecordingHistory();
    const blockers = new RecordingBlocker();
    const controller = new RetestLoopController({
      generator: fakeGenerator,
      runner: buildRunner([
        { testCaseId: 'tc1', status: 'failed', durationMs: 5, errorMessage: 'boom' },
        { testCaseId: 'tc1', status: 'passed', durationMs: 6 },
      ]),
      diagnoser: fakeDiagnoser,
      ipc: buildIpc(() => ({ ok: true, sha: 'fix1234567' })),
      history,
      blockers,
    });

    const out = await controller.runCase(makeCase(), payload);

    expect(out.finalStatus).toBe('passed');
    expect(out.attempts).toBe(2);
    expect(out.lastSha).toBe('fix1234567');
    expect(history.rows.map((r) => r.status)).toEqual(['failed', 'passed']);
    expect(history.rows[0]?.failureDiagnosis).not.toBeNull();
    expect(history.rows[1]?.failureDiagnosis).toBeNull();
    expect(blockers.blockers).toHaveLength(0);
  });

  it('attempts exhausted → fix-stuck blocker + finalStatus exhausted', async () => {
    const history = new RecordingHistory();
    const blockers = new RecordingBlocker();
    const controller = new RetestLoopController({
      generator: fakeGenerator,
      runner: buildRunner([
        { testCaseId: 'tc1', status: 'failed', durationMs: 1, errorMessage: 'still broken' },
      ]),
      diagnoser: fakeDiagnoser,
      ipc: buildIpc((req) => ({ ok: true, sha: `f${req.attempt}1234567` })),
      history,
      blockers,
    });

    const out = await controller.runCase(makeCase(), payload, { maxAttempts: 3 });

    expect(out.finalStatus).toBe('exhausted');
    expect(out.attempts).toBe(3);
    expect(history.rows).toHaveLength(3);
    expect(blockers.blockers).toHaveLength(1);
    expect(blockers.blockers[0]?.kind).toBe('fix-stuck');
    expect(blockers.blockers[0]?.attempts).toBe(3);
    expect(blockers.blockers[0]?.history).toHaveLength(3);
    expect(blockers.blockers[0]?.lastErrorMessage).toBe('still broken');
  });

  it('IPC returns ok:false → coding-stuck blocker + finalStatus fix-failed', async () => {
    const history = new RecordingHistory();
    const blockers = new RecordingBlocker();
    const controller = new RetestLoopController({
      generator: fakeGenerator,
      runner: buildRunner([
        { testCaseId: 'tc1', status: 'failed', durationMs: 1, errorMessage: 'broken' },
      ]),
      diagnoser: fakeDiagnoser,
      ipc: buildIpc(() => ({ ok: false, error: 'sdk-rate-limit' })),
      history,
      blockers,
    });

    const out = await controller.runCase(makeCase(), payload);

    expect(out.finalStatus).toBe('fix-failed');
    expect(out.lastErrorMessage).toBe('sdk-rate-limit');
    expect(blockers.blockers).toHaveLength(1);
    expect(blockers.blockers[0]?.kind).toBe('coding-stuck');
    expect(blockers.blockers[0]?.lastErrorMessage).toBe('sdk-rate-limit');
  });

  it('same-sha twice → same-sha-twice blocker + finalStatus fix-failed', async () => {
    const history = new RecordingHistory();
    const blockers = new RecordingBlocker();
    const controller = new RetestLoopController({
      generator: fakeGenerator,
      runner: buildRunner([
        { testCaseId: 'tc1', status: 'failed', durationMs: 1, errorMessage: 'broken' },
      ]),
      diagnoser: fakeDiagnoser,
      // Always returns the same sha, simulating a Coding Agent that
      // committed without making a meaningful change.
      ipc: buildIpc(() => ({ ok: true, sha: 'samesha1234567' })),
      history,
      blockers,
    });

    const out = await controller.runCase(makeCase(), payload, { maxAttempts: 6 });

    expect(out.finalStatus).toBe('fix-failed');
    expect(out.lastErrorMessage).toContain('same sha twice');
    // Should NOT exhaust all 6 — bail at attempt 2 (the second time we
    // see the same sha).
    expect(out.attempts).toBe(2);
    expect(blockers.blockers).toHaveLength(1);
    expect(blockers.blockers[0]?.kind).toBe('same-sha-twice');
  });

  it('respects maxAttempts override', async () => {
    const blockers = new RecordingBlocker();
    const controller = new RetestLoopController({
      generator: fakeGenerator,
      runner: buildRunner([
        { testCaseId: 'tc1', status: 'failed', durationMs: 1, errorMessage: 'x' },
      ]),
      diagnoser: fakeDiagnoser,
      ipc: buildIpc((req) => ({ ok: true, sha: `s${req.attempt}xxxxx` })),
      blockers,
    });
    const out = await controller.runCase(makeCase(), payload, { maxAttempts: 2 });
    expect(out.attempts).toBe(2);
    expect(out.finalStatus).toBe('exhausted');
  });

  it('exposes DEFAULT_MAX_ATTEMPTS = 6 (matches directive contract)', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(6);
  });

  it('records run history with correct timing fields', async () => {
    let nowVal = 1000;
    const history = new RecordingHistory();
    const controller = new RetestLoopController({
      generator: fakeGenerator,
      runner: {
        runSpec: async () => {
          nowVal += 50;
          return { testCaseId: 'tc1', status: 'passed', durationMs: 50 };
        },
      },
      diagnoser: fakeDiagnoser,
      ipc: buildIpc(() => ({ ok: true })),
      history,
      now: () => nowVal,
    });
    await controller.runCase(makeCase(), payload);
    expect(history.rows[0]?.startedAt).toBe(1000);
    expect(history.rows[0]?.endedAt).toBe(1050);
  });
});
