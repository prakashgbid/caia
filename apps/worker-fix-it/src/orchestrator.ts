/**
 * `FixItOrchestrator` — the inner state-machine of the Fix-It Test
 * Agent — FIX-001 (Phase 2D).
 *
 * Inputs:
 *   - `task.coding_complete` payload (with worktree path + Coding Agent
 *     session reference)
 *   - the ticket bundle (fetched via the orchestrator's
 *     `GET /stories/:id/bundle`; injected here for testability)
 *
 * Outputs:
 *   - `task.tested_and_done` payload — every test case green
 *   - `task.fix_loop_escalated` payload — at least one case exhausted
 *
 * The orchestrator is implemented bottom-up: every collaborator
 * (generator, runner, diagnoser, IPC invoker) is an injected interface
 * with a stub default. FIX-002 .. FIX-006 swap each stub out for the
 * real implementation while keeping this orchestrator unchanged.
 *
 * The retest loop (`MAX_ATTEMPTS_PER_CASE = 6`) lives here in skeleton
 * form for FIX-001; FIX-006 layers on per-attempt persistence + the
 * `fix-stuck` escalation contract.
 *
 * @owner fix-it-test-agent (Phase 2D worker track)
 */

import type {
  CodingCompletePayload,
  FixItRunResult,
  TestCaseOutcome,
} from './types';

import type { TestCase } from '@chiefaia/ticket-template';

import {
  type CodingIpcInvoker,
  type FailureDiagnoser,
  type ResultEmitter,
  type TestCodeGenerator,
  type TestRunner,
  NoopResultEmitter,
  StubCodingIpcInvoker,
  StubFailureDiagnoser,
  StubTestCodeGenerator,
  StubTestRunner,
} from './stubs';

/** Ports the orchestrator depends on; each replaceable per PR. */
export interface FixItOrchestratorPorts {
  generator: TestCodeGenerator;
  runner: TestRunner;
  diagnoser: FailureDiagnoser;
  ipc: CodingIpcInvoker;
  emitter: ResultEmitter;
  /** Wall clock — injectable for deterministic tests. */
  now?: () => number;
}

export interface RunOptions {
  /** Override the per-case attempt cap. Defaults to `MAX_ATTEMPTS_PER_CASE`. */
  maxAttemptsPerCase?: number;
}

export const MAX_ATTEMPTS_PER_CASE = 6;

export class FixItOrchestrator {
  private readonly ports: Required<FixItOrchestratorPorts>;

  constructor(ports: Partial<FixItOrchestratorPorts> = {}) {
    this.ports = {
      generator: ports.generator ?? new StubTestCodeGenerator(),
      runner: ports.runner ?? new StubTestRunner(),
      diagnoser: ports.diagnoser ?? new StubFailureDiagnoser(),
      ipc: ports.ipc ?? new StubCodingIpcInvoker(),
      emitter: ports.emitter ?? new NoopResultEmitter(),
      now: ports.now ?? Date.now,
    };
  }

  /**
   * Drive a single coding-complete handoff through the test/fix cycle.
   *
   * Per-test-case retest loop (FIX-006 will deepen):
   *   1. generate spec → run → record result
   *   2. if passed → next case
   *   3. if failed → diagnose → IPC apply_fix → loop (capped at N)
   *   4. if cap reached → mark exhausted; do NOT abort the run — every
   *      remaining case must be attempted so the escalation payload
   *      lists *every* exhausted case in one shot.
   */
  async run(
    payload: CodingCompletePayload,
    testCases: ReadonlyArray<TestCase>,
    opts: RunOptions = {},
  ): Promise<FixItRunResult> {
    const maxAttempts = opts.maxAttemptsPerCase ?? MAX_ATTEMPTS_PER_CASE;
    const outcomes: TestCaseOutcome[] = [];
    let lastSha = payload.sha;
    let totalAttempts = 0;

    for (const testCase of testCases) {
      const outcome = await this.runCase(testCase, payload, maxAttempts);
      outcomes.push(outcome);
      totalAttempts += outcome.attempts;
      if (outcome.lastSha) lastSha = outcome.lastSha;
    }

    const exhausted = outcomes.filter(
      (o) => o.finalStatus === 'exhausted' || o.finalStatus === 'fix-failed',
    );

    const allPassedAt = this.ports.now();

    if (exhausted.length === 0) {
      // Tell the still-warm Coding Agent it can release the worktree.
      await this.ports.ipc.shutdown();
      return {
        kind: 'tested_and_done',
        payload: {
          storyId: payload.storyId,
          workerId: payload.workerId,
          allPassedAt,
          totalAttempts: Math.max(totalAttempts, 1),
          finalSha: lastSha,
          correlationId: payload.correlationId,
        },
      };
    }

    return {
      kind: 'fix_loop_escalated',
      payload: {
        storyId: payload.storyId,
        workerId: payload.workerId,
        exhaustedTestCaseIds: exhausted.map((o) => o.testCaseId),
        lastFailures: exhausted.map((o) => ({
          testCaseId: o.testCaseId,
          attempt: o.attempts,
          errorMessage: o.lastErrorMessage ?? 'no error captured',
        })),
        escalatedAt: allPassedAt,
        correlationId: payload.correlationId,
      },
    };
  }

  /**
   * Run one test case through the per-case retest loop.
   *
   * FIX-001: skeleton — implements the loop with stub collaborators
   * so the happy path emits tested_and_done.
   */
  private async runCase(
    testCase: TestCase,
    payload: CodingCompletePayload,
    maxAttempts: number,
  ): Promise<TestCaseOutcome> {
    let lastErrorMessage: string | undefined;
    let lastSha: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const spec = await this.ports.generator.generate(testCase, {
        storyId: payload.storyId,
        worktreePath: payload.worktreePath,
      });
      const runResult = await this.ports.runner.runSpec(spec);

      await this.ports.emitter.emitTestCaseResult({
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
        return {
          testCaseId: testCase.id,
          finalStatus: 'passed',
          attempts: attempt,
          lastSha,
        };
      }

      lastErrorMessage = runResult.errorMessage ?? `${runResult.status}`;

      if (attempt === maxAttempts) break;

      const report = await this.ports.diagnoser.diagnose(
        runResult,
        testCase,
        attempt,
      );

      const ipcResult = await this.ports.ipc.applyFix({
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
      });

      if (!ipcResult.ok) {
        return {
          testCaseId: testCase.id,
          finalStatus: 'fix-failed',
          attempts: attempt,
          lastSha,
          lastErrorMessage: ipcResult.error ?? 'coding-agent-ipc-failed',
        };
      }

      if (ipcResult.sha) lastSha = ipcResult.sha;
    }

    return {
      testCaseId: testCase.id,
      finalStatus: 'exhausted',
      attempts: maxAttempts,
      lastSha,
      lastErrorMessage,
    };
  }
}

// ─── Re-export types so consumers import from one barrel ────────────────────

export type { CodingCompletePayload, FixItRunResult, TestCaseOutcome };
