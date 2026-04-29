/**
 * Stub implementations of the Fix-It Test Agent's pluggable modules —
 * FIX-001 (Phase 2D).
 *
 * The orchestrator (FIX-001) needs concrete instances of the test
 * code generator, runner, failure diagnoser, IPC invoker, and retest
 * loop controller in order to wire end-to-end and prove the event
 * contract. The real implementations land in FIX-002 .. FIX-006.
 *
 * Until then, the stubs here:
 *   - Skip generation (return a synthetic spec path).
 *   - Always report `passed` from the runner.
 *   - Refuse to diagnose (returning `null`) — the loop should never
 *     reach the diagnoser when the runner says `passed`.
 *   - The IPC invoker `apply_fix` always returns `ok: true` with a
 *     synthetic sha.
 *
 * This deliberately produces a tested_and_done outcome on the happy
 * path — it's the simplest non-trivial implementation of the contract,
 * which is what we want for FIX-001's tests to assert.
 *
 * Subsequent PRs replace each stub with the real module while keeping
 * the same interface; the orchestrator remains untouched.
 *
 * @owner fix-it-test-agent (Phase 2D worker track)
 */

import { randomUUID } from 'crypto';
import type {
  FixRequest,
  TestCaseResultPayload,
  TestFailureReport,
} from './types';

import type { TestCase } from '@chiefaia/ticket-template';

// ─── Test code generator ────────────────────────────────────────────────────

export interface GeneratedSpec {
  testCaseId: string;
  /** Where the generated spec file lives on disk. */
  specPath: string;
  /** SHA of the generated content — drives idempotency in FIX-002. */
  contentHash: string;
}

export interface TestCodeGenerator {
  generate(testCase: TestCase, ctx: GenerateContext): Promise<GeneratedSpec>;
}

export interface GenerateContext {
  storyId: string;
  worktreePath: string;
}

/**
 * Stub generator — never touches the filesystem; just returns a
 * deterministic-looking spec path so callers can pass it through to
 * the runner without crashing.
 *
 * FIX-002 replaces this with a real generator that writes a
 * Playwright/vitest spec file.
 */
export class StubTestCodeGenerator implements TestCodeGenerator {
  async generate(
    testCase: TestCase,
    ctx: GenerateContext,
  ): Promise<GeneratedSpec> {
    return {
      testCaseId: testCase.id,
      specPath: `${ctx.worktreePath}/tests/generated/${ctx.storyId}/${testCase.id}.spec.ts`,
      contentHash: 'stub-content-hash',
    };
  }
}

// ─── Test runner ────────────────────────────────────────────────────────────

export interface RunResult {
  testCaseId: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  durationMs: number;
  /** Path to the trace file when the runner is real and the test failed. */
  tracePath?: string;
  /** Captured error message when the test failed. */
  errorMessage?: string;
  /** Captured stack trace when the test failed. */
  errorStack?: string;
  /** Anything else the runner attached. Real runner populates in FIX-003. */
  artifacts?: Record<string, unknown>;
}

export interface TestRunner {
  runSpec(spec: GeneratedSpec): Promise<RunResult>;
}

/**
 * Stub runner — pretends every spec passes in 1ms. Lets FIX-001 assert
 * the happy path produces a `task.tested_and_done` event.
 *
 * FIX-003 replaces this with a Playwright/vitest invoker.
 */
export class StubTestRunner implements TestRunner {
  async runSpec(spec: GeneratedSpec): Promise<RunResult> {
    return {
      testCaseId: spec.testCaseId,
      status: 'passed',
      durationMs: 1,
    };
  }
}

// ─── Failure diagnoser ──────────────────────────────────────────────────────

export interface FailureDiagnoser {
  diagnose(
    runResult: RunResult,
    testCase: TestCase,
    attempt: number,
  ): Promise<TestFailureReport>;
}

/**
 * Stub diagnoser — just echoes back whatever the runner reported.
 * Should never be reached on the happy path because the stub runner
 * always returns `passed`.
 *
 * FIX-004 replaces this with a real diagnoser that captures
 * stack traces, screenshots, console + network logs, and DOM state.
 */
export class StubFailureDiagnoser implements FailureDiagnoser {
  async diagnose(
    runResult: RunResult,
    testCase: TestCase,
    attempt: number,
  ): Promise<TestFailureReport> {
    return {
      testCaseId: testCase.id,
      attempt,
      category: testCase.category,
      errorMessage: runResult.errorMessage ?? 'stub diagnoser — no real diagnosis',
      errorStack: runResult.errorStack ?? null,
      failingAssertion: null,
      artifacts: {},
      inferredCause:
        'stub diagnoser — replace with real diagnoser in FIX-004',
    };
  }
}

// ─── IPC invoker (Coding Agent in-session) ──────────────────────────────────

export interface FixOutcome {
  ok: boolean;
  sha?: string;
  summary?: string;
  error?: string;
}

export interface CodingIpcInvoker {
  applyFix(req: FixRequest): Promise<FixOutcome>;
  /** Tell the still-warm Coding Agent worker it can release the worktree. */
  shutdown(): Promise<void>;
}

/**
 * Stub IPC invoker — pretends the Coding Agent always applies the fix
 * successfully. Should never be reached on the happy path.
 *
 * FIX-005 replaces this with a Unix-domain-socket client speaking
 * the Coding Agent's apply_fix / health / flush_logs / shutdown
 * methods (per the directive's wire format).
 */
export class StubCodingIpcInvoker implements CodingIpcInvoker {
  async applyFix(req: FixRequest): Promise<FixOutcome> {
    return {
      ok: true,
      sha: `stub${randomUUID().slice(0, 7)}`,
      summary: `stub fix for ${req.testCaseId} (replace via FIX-005)`,
    };
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}

// ─── Result emitter ─────────────────────────────────────────────────────────

/**
 * Hook for publishing per-attempt results. Real implementation is the
 * orchestrator's event-bus emitter; tests inject a recorder.
 */
export interface ResultEmitter {
  emitTestCaseResult(payload: TestCaseResultPayload): Promise<void>;
}

/** Default no-op emitter for FIX-001. Replaced by a bus emitter when wired. */
export class NoopResultEmitter implements ResultEmitter {
  async emitTestCaseResult(_payload: TestCaseResultPayload): Promise<void> {
    // no-op
  }
}
