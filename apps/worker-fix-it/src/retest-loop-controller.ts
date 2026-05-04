/**
 * `RetestLoopController` — FIX-006 (Phase 2D).
 *
 * Owns the per-test-case retest loop. Lifted out of the orchestrator
 * so its three responsibilities can be tested in isolation:
 *
 *   1. **Loop**: generate spec → run → if pass, exit. Else diagnose →
 *      apply fix via IPC → loop. Cap at `maxAttempts` (default 6).
 *   2. **Persistence**: every (testCase, attempt) pair is recorded
 *      via the injected `RunHistoryRecorder` so the dashboard timeline
 *      and the orchestrator's `task.test_case.result` event stream
 *      both have a faithful audit trail.
 *   3. **Blocker writing**: on exhaustion (or coding-agent-failed-to-
 *      fix), the controller hands the full failure history to the
 *      injected `BlockerWriter` which files a `fix-stuck` /
 *      `coding-stuck` blocker. The orchestrator still emits the
 *      `task.fix_loop_escalated` event; the blocker writer covers the
 *      table side.
 *
 * Plus a defensive **same-sha guard**: per the architecture risk
 * register, if the Coding Agent applies the same sha twice in a row
 * for the same test case the loop bails immediately with a
 * `same-sha-twice` reason — that is a strong signal the agent isn't
 * actually changing the code, and continuing to ask it would just
 * waste tokens.
 *
 * @owner fix-it-test-agent (Phase 2D worker track)
 */

import type { TestCase } from '@chiefaia/ticket-template';

import type {
  CodingIpcInvoker,
  FailureDiagnoser,
  GeneratedSpec,
  ResultEmitter,
  RunResult,
  TestCodeGenerator,
} from './stubs';
import type {
  CodingCompletePayload,
  TestCaseOutcome,
  TestFailureReport,
  FixRequest,
} from './types';

// ─── New ports (in addition to the orchestrator's existing ones) ────────────

/**
 * Persists every (testCase, attempt) result to a durable store —
 * normally the orchestrator's `test_case_runs` table. Tests inject a
 * recorder that captures rows in memory.
 */
export interface RunHistoryRecorder {
  record(row: RunHistoryRow): Promise<void>;
}

export interface RunHistoryRow {
  storyId: string;
  testCaseId: string;
  attempt: number;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  durationMs: number;
  errorMessage: string | null;
  errorStack: string | null;
  tracePath: string | null;
  failureDiagnosis: TestFailureReport | null;
  startedAt: number;
  endedAt: number;
}

/** No-op recorder default — tests inject a recording one. */
export class NoopRunHistoryRecorder implements RunHistoryRecorder {
  async record(_row: RunHistoryRow): Promise<void> {
    // no-op
  }
}

/**
 * Files a blocker on terminal failure — fix-stuck (case exhausted)
 * or coding-stuck (Coding Agent IPC returned ok:false).
 */
export interface BlockerWriter {
  fileBlocker(blocker: BlockerInput): Promise<void>;
}

export interface BlockerInput {
  storyId: string;
  testCaseId: string;
  kind: 'fix-stuck' | 'coding-stuck' | 'same-sha-twice';
  attempts: number;
  history: ReadonlyArray<TestFailureReport>;
  /** Last error message captured (for the dashboard's blocker card). */
  lastErrorMessage: string;
}

export class NoopBlockerWriter implements BlockerWriter {
  async fileBlocker(_input: BlockerInput): Promise<void> {
    // no-op
  }
}

// ─── Controller ─────────────────────────────────────────────────────────────

export interface RetestLoopControllerPorts {
  generator: TestCodeGenerator;
  runner: TestRunnerPort;
  diagnoser: FailureDiagnoser;
  ipc: CodingIpcInvoker;
  emitter?: ResultEmitter;
  history?: RunHistoryRecorder;
  blockers?: BlockerWriter;
  now?: () => number;
}

/** Subset of `TestRunner` the controller needs. */
export interface TestRunnerPort {
  runSpec(spec: GeneratedSpec): Promise<RunResult>;
}

export interface RetestLoopOptions {
  /** Per-case attempt cap. Defaults to 6 per the directive. */
  maxAttempts?: number;
}

export const DEFAULT_MAX_ATTEMPTS = 6;

/**
 * The richer per-case outcome the controller returns; the orchestrator
 * lifts the four fields it cares about into its public TestCaseOutcome.
 */
export interface ControllerOutcome extends TestCaseOutcome {
  history: ReadonlyArray<TestFailureReport>;
}

export class RetestLoopController {
  private readonly ports: Required<
    Omit<RetestLoopControllerPorts, 'emitter' | 'history' | 'blockers' | 'now'>
  > & {
    emitter: ResultEmitter | undefined;
    history: RunHistoryRecorder;
    blockers: BlockerWriter;
    now: () => number;
  };

  constructor(ports: RetestLoopControllerPorts) {
    this.ports = {
      generator: ports.generator,
      runner: ports.runner,
      diagnoser: ports.diagnoser,
      ipc: ports.ipc,
      emitter: ports.emitter,
      history: ports.history ?? new NoopRunHistoryRecorder(),
      blockers: ports.blockers ?? new NoopBlockerWriter(),
      now: ports.now ?? Date.now,
    };
  }

  /**
   * Drive a single test case through the retest loop.
   *
   * The controller writes one `RunHistoryRow` per attempt (so the
   * dashboard's per-case timeline is faithful), files a blocker on
   * terminal failure, and returns a `ControllerOutcome` the
   * orchestrator can roll up into the run-level result.
   */
  async runCase(
    testCase: TestCase,
    payload: CodingCompletePayload,
    opts: RetestLoopOptions = {},
  ): Promise<ControllerOutcome> {
    const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const history: TestFailureReport[] = [];
    let lastErrorMessage: string | undefined;
    let lastSha: string | undefined;
    let priorFixSha: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = this.ports.now();
      const spec = await this.ports.generator.generate(testCase, {
        storyId: payload.storyId,
        worktreePath: payload.worktreePath,
      });
      const runResult = await this.ports.runner.runSpec(spec);
      const endedAt = this.ports.now();

      // Emit the per-attempt event (orchestrator → bus).
      await this.ports.emitter?.emitTestCaseResult({
        storyId: payload.storyId,
        testCaseId: testCase.id,
        status: runResult.status,
        attempt,
        durationMs: runResult.durationMs,
        traceUrl: runResult.tracePath ?? null,
        error: runResult.errorMessage ?? null,
        correlationId: payload.correlationId,
      });

      if (runResult.status === 'passed') {
        await this.ports.history.record(
          this.toHistoryRow(payload.storyId, testCase, attempt, runResult, null, startedAt, endedAt),
        );
        return {
          testCaseId: testCase.id,
          finalStatus: 'passed',
          attempts: attempt,
          lastSha,
          history,
        };
      }

      lastErrorMessage = runResult.errorMessage ?? `${runResult.status}`;

      const report = await this.ports.diagnoser.diagnose(
        runResult,
        testCase,
        attempt,
      );
      history.push(report);

      await this.ports.history.record(
        this.toHistoryRow(payload.storyId, testCase, attempt, runResult, report, startedAt, endedAt),
      );

      if (attempt === maxAttempts) break;

      const fixRequest: FixRequest = {
        storyId: payload.storyId,
        testCaseId: testCase.id,
        attempt,
        whatFailed: report.errorMessage,
        hypothesisFromDiagnoser: report.inferredCause,
        artifactsRef:
          report.artifacts.screenshotUrl ?? report.artifacts.tracePath
            ? {
                screenshotUrl: report.artifacts.screenshotUrl ?? undefined,
                tracePath: report.artifacts.tracePath ?? undefined,
              }
            : undefined,
        testCaseSpecPath: spec.specPath,
        hintFiles: [],
        preserveScopeOf: 'fix-only',
      };

      const ipcResult = await this.ports.ipc.applyFix(fixRequest);

      if (!ipcResult.ok) {
        await this.ports.blockers.fileBlocker({
          storyId: payload.storyId,
          testCaseId: testCase.id,
          kind: 'coding-stuck',
          attempts: attempt,
          history,
          lastErrorMessage:
            ipcResult.error ?? lastErrorMessage ?? 'coding-agent-ipc-failed',
        });
        return {
          testCaseId: testCase.id,
          finalStatus: 'fix-failed',
          attempts: attempt,
          lastSha,
          lastErrorMessage:
            ipcResult.error ?? 'coding-agent-ipc-failed',
          history,
        };
      }

      // Same-sha guard: if Coding Agent didn't produce a new sha for
      // two consecutive fix requests, escalate immediately. Continuing
      // to ask is just burning tokens.
      if (ipcResult.sha && priorFixSha === ipcResult.sha) {
        await this.ports.blockers.fileBlocker({
          storyId: payload.storyId,
          testCaseId: testCase.id,
          kind: 'same-sha-twice',
          attempts: attempt,
          history,
          lastErrorMessage: `coding agent produced same sha twice (${ipcResult.sha})`,
        });
        return {
          testCaseId: testCase.id,
          finalStatus: 'fix-failed',
          attempts: attempt,
          lastSha: ipcResult.sha,
          lastErrorMessage: `coding agent produced same sha twice (${ipcResult.sha})`,
          history,
        };
      }

      if (ipcResult.sha) {
        priorFixSha = ipcResult.sha;
        lastSha = ipcResult.sha;
      }
    }

    // attempts exhausted
    await this.ports.blockers.fileBlocker({
      storyId: payload.storyId,
      testCaseId: testCase.id,
      kind: 'fix-stuck',
      attempts: maxAttempts,
      history,
      lastErrorMessage: lastErrorMessage ?? 'attempts-exhausted',
    });

    return {
      testCaseId: testCase.id,
      finalStatus: 'exhausted',
      attempts: maxAttempts,
      lastSha,
      lastErrorMessage,
      history,
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private toHistoryRow(
    storyId: string,
    testCase: TestCase,
    attempt: number,
    runResult: RunResult,
    diagnosis: TestFailureReport | null,
    startedAt: number,
    endedAt: number,
  ): RunHistoryRow {
    return {
      storyId,
      testCaseId: testCase.id,
      attempt,
      status: runResult.status,
      durationMs: runResult.durationMs,
      errorMessage: runResult.errorMessage ?? null,
      errorStack: runResult.errorStack ?? null,
      tracePath: runResult.tracePath ?? null,
      failureDiagnosis: diagnosis,
      startedAt,
      endedAt,
    };
  }
}
