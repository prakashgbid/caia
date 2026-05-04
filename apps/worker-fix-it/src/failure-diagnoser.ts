/**
 * `StructuredFailureDiagnoser` — FIX-004 (Phase 2D).
 *
 * For every failed test case, the diagnoser builds a `TestFailureReport`
 * the Coding Agent's IPC handler can consume. The report carries:
 *
 *   - the literal error message + stack
 *   - the failing assertion (extracted heuristically from the stack)
 *   - any browser artifacts the runner attached (tracePath, screenshot
 *     URL, DOM snapshot)
 *   - tail-N lines of stdout / stderr / console captures
 *   - a short `inferredCause` string — heuristic for now; the LLM hook
 *     lands in the parallel enrichment track
 *
 * The diagnoser is intentionally self-contained: it does no I/O beyond
 * tailing log file paths the runner already attached. That keeps it
 * deterministic in tests and cheap on the hot path.
 *
 * Replaces `StubFailureDiagnoser`. Consumed by the orchestrator's
 * `diagnoser` port.
 *
 * @owner fix-it-test-agent (Phase 2D worker track)
 */

import { readFileSync, statSync } from 'fs';

import type { TestCase } from '@chiefaia/ticket-template';

import type { FailureDiagnoser, RunResult } from './stubs';
import type { TestFailureReport } from './types';

// ─── Heuristic cause inference ──────────────────────────────────────────────

interface CausePattern {
  matcher: RegExp;
  cause: string;
}

const CAUSE_PATTERNS: ReadonlyArray<CausePattern> = [
  { matcher: /Cannot find module/i, cause: 'missing-import' },
  { matcher: /Cannot resolve/i, cause: 'missing-import' },
  { matcher: /ENOENT|no such file/i, cause: 'missing-file' },
  { matcher: /ECONNREFUSED/i, cause: 'service-not-running' },
  { matcher: /timeout|timed out/i, cause: 'timeout' },
  { matcher: /selector .* not found/i, cause: 'selector-not-found' },
  { matcher: /Expected:[\s\S]*Received:|Expected:[\s\S]*Got:/, cause: 'assertion-mismatch' },
  { matcher: /toEqual|toBe|toHaveURL|toHaveText/, cause: 'assertion-mismatch' },
  { matcher: /violations/i, cause: 'a11y-violation' },
  { matcher: /to have screenshot/i, cause: 'visual-regression' },
  { matcher: /401|unauthor/i, cause: 'auth-failure' },
  { matcher: /500\b/, cause: 'server-error' },
  { matcher: /404\b/, cause: 'not-found' },
  { matcher: /SyntaxError/i, cause: 'syntax-error' },
  { matcher: /TypeError/i, cause: 'type-error' },
];

export function inferCause(
  errorMessage: string | undefined,
  errorStack: string | undefined,
): string {
  const blob = `${errorMessage ?? ''}\n${errorStack ?? ''}`;
  for (const { matcher, cause } of CAUSE_PATTERNS) {
    if (matcher.test(blob)) return cause;
  }
  return 'unknown';
}

// ─── Failing-assertion lift ─────────────────────────────────────────────────

const ASSERTION_REGEX =
  /(expect[^.]*\.[a-zA-Z]+\([^)]*\))|(toEqual|toBe|toHaveURL|toHaveText|toContain|toMatch|toThrow)\([^)]*\)/;

export function liftFailingAssertion(
  errorMessage: string | undefined,
  errorStack: string | undefined,
): string | null {
  const blob = `${errorMessage ?? ''}\n${errorStack ?? ''}`;
  const match = blob.match(ASSERTION_REGEX);
  return match ? match[0] : null;
}

// ─── Tail helper ────────────────────────────────────────────────────────────

const DEFAULT_LOG_TAIL_LINES = 80;

export function tailLines(s: string | undefined, n = DEFAULT_LOG_TAIL_LINES): string[] {
  if (!s) return [];
  let lines = s.split(/\r?\n/);
  // Drop a single trailing empty line caused by the file/stream ending
  // with a newline. Two trailing empty lines are preserved (the writer
  // explicitly intended that blank line).
  if (lines.length > 0 && lines[lines.length - 1] === '') lines = lines.slice(0, -1);
  return lines.slice(Math.max(0, lines.length - n));
}

export function tailFile(path: string | undefined, n = DEFAULT_LOG_TAIL_LINES): string[] {
  if (!path) return [];
  try {
    statSync(path);
  } catch {
    return [];
  }
  try {
    const body = readFileSync(path, { encoding: 'utf8' });
    return tailLines(body, n);
  } catch {
    return [];
  }
}

// ─── Diagnoser ──────────────────────────────────────────────────────────────

export interface StructuredFailureDiagnoserOptions {
  /** Number of trailing lines preserved when tailing log files / streams. */
  logTailLines?: number;
}

export class StructuredFailureDiagnoser implements FailureDiagnoser {
  private readonly logTail: number;

  constructor(opts: StructuredFailureDiagnoserOptions = {}) {
    this.logTail = opts.logTailLines ?? DEFAULT_LOG_TAIL_LINES;
  }

  async diagnose(
    runResult: RunResult,
    testCase: TestCase,
    attempt: number,
  ): Promise<TestFailureReport> {
    const artifactsIn = (runResult.artifacts ?? {}) as Record<string, unknown>;

    const stdoutTail = tailLines(
      typeof artifactsIn.stdoutTail === 'string'
        ? (artifactsIn.stdoutTail as string)
        : undefined,
      this.logTail,
    );
    const stderrTail = tailLines(
      typeof artifactsIn.stderrTail === 'string'
        ? (artifactsIn.stderrTail as string)
        : undefined,
      this.logTail,
    );
    const consoleLog = collectConsole(artifactsIn);
    const networkLog = collectNetwork(artifactsIn);
    const domSnapshot =
      typeof artifactsIn.domSnapshot === 'string'
        ? (artifactsIn.domSnapshot as string)
        : null;
    const screenshotUrl =
      typeof artifactsIn.screenshotUrl === 'string'
        ? (artifactsIn.screenshotUrl as string)
        : null;
    const seedFixtures = artifactsIn.seedFixtures;

    const tracePath = runResult.tracePath ?? null;

    const errorMessage = runResult.errorMessage ?? `${runResult.status}`;
    const errorStack = runResult.errorStack ?? null;

    return {
      testCaseId: testCase.id,
      attempt,
      category: testCase.category,
      errorMessage,
      errorStack,
      failingAssertion: liftFailingAssertion(errorMessage, errorStack ?? undefined),
      artifacts: {
        screenshotUrl,
        tracePath,
        consoleLog: [...consoleLog, ...stdoutTail, ...stderrTail],
        networkLog,
        domSnapshot,
        seedFixtures,
      },
      inferredCause: inferCause(errorMessage, errorStack ?? undefined),
    };
  }
}

function collectConsole(artifacts: Record<string, unknown>): string[] {
  const direct = artifacts.consoleLog;
  if (Array.isArray(direct)) {
    return direct.filter((l): l is string => typeof l === 'string');
  }
  return [];
}

function collectNetwork(artifacts: Record<string, unknown>): unknown[] {
  const direct = artifacts.networkLog;
  return Array.isArray(direct) ? direct : [];
}
