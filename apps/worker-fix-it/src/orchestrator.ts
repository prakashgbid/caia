/**
 * `FixItOrchestrator` — the inner state-machine of the Fix-It Test
 * Agent.
 *
 * Inputs:
 *   - `task.coding_complete` payload (with worktree path + Coding Agent
 *     session reference)
 *   - the ticket's `testCases` array
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
 * As of FIX-006, the per-case loop is delegated to
 * `RetestLoopController` so the loop logic, persistence, and blocker
 * writing can be tested in isolation. The orchestrator's job here is
 * solely to fan the testCases out to the controller and roll up the
 * per-case outcomes into a run-level result.
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

import {
  type BlockerWriter,
  type RunHistoryRecorder,
  NoopBlockerWriter,
  NoopRunHistoryRecorder,
  RetestLoopController,
} from './retest-loop-controller';

/** Ports the orchestrator depends on; each replaceable per PR. */
export interface FixItOrchestratorPorts {
  generator: TestCodeGenerator;
  runner: TestRunner;
  diagnoser: FailureDiagnoser;
  ipc: CodingIpcInvoker;
  emitter: ResultEmitter;
  /** FIX-006: persistence of per-attempt run history. */
  history: RunHistoryRecorder;
  /** FIX-006: blocker writer for fix-stuck / coding-stuck escalations. */
  blockers: BlockerWriter;
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
  private readonly controller: RetestLoopController;

  constructor(ports: Partial<FixItOrchestratorPorts> = {}) {
    this.ports = {
      generator: ports.generator ?? new StubTestCodeGenerator(),
      runner: ports.runner ?? new StubTestRunner(),
      diagnoser: ports.diagnoser ?? new StubFailureDiagnoser(),
      ipc: ports.ipc ?? new StubCodingIpcInvoker(),
      emitter: ports.emitter ?? new NoopResultEmitter(),
      history: ports.history ?? new NoopRunHistoryRecorder(),
      blockers: ports.blockers ?? new NoopBlockerWriter(),
      now: ports.now ?? Date.now,
    };
    this.controller = new RetestLoopController({
      generator: this.ports.generator,
      runner: this.ports.runner,
      diagnoser: this.ports.diagnoser,
      ipc: this.ports.ipc,
      emitter: this.ports.emitter,
      history: this.ports.history,
      blockers: this.ports.blockers,
      now: this.ports.now,
    });
  }

  /**
   * Drive a single coding-complete handoff through the test/fix cycle.
   *
   * Per-test-case loop is delegated to `RetestLoopController`. The
   * orchestrator does NOT abort on the first exhausted case — every
   * remaining case must be attempted so the escalation payload lists
   * every exhausted case in one shot.
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
      // eslint-disable-next-line no-await-in-loop
      const outcome = await this.controller.runCase(testCase, payload, {
        maxAttempts,
      });
      outcomes.push(outcome);
      totalAttempts += outcome.attempts;
      if (outcome.lastSha) lastSha = outcome.lastSha;
    }

    const exhausted = outcomes.filter(
      (o) => o.finalStatus === 'exhausted' || o.finalStatus === 'fix-failed',
    );

    const ts = this.ports.now();

    if (exhausted.length === 0) {
      // Tell the still-warm Coding Agent it can release the worktree.
      await this.ports.ipc.shutdown();
      return {
        kind: 'tested_and_done',
        payload: {
          storyId: payload.storyId,
          workerId: payload.workerId,
          allPassedAt: ts,
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
        escalatedAt: ts,
        correlationId: payload.correlationId,
      },
    };
  }
}

// ─── Re-export types so consumers import from one barrel ────────────────────

export type { CodingCompletePayload, FixItRunResult, TestCaseOutcome };
