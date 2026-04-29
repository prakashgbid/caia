/**
 * `SubprocessTestRunner` — FIX-003 (Phase 2D).
 *
 * Replaces the FIX-001 `StubTestRunner` with a real subprocess runner
 * that exec's vitest or Playwright against a generated spec and parses
 * the output into a structured `RunResult` the orchestrator can act
 * on.
 *
 * Design — the runner is split into two collaborators:
 *
 *   - `CommandExecutor`        — exec's a child process; default impl
 *                                is `child_process.spawn`. Tests inject
 *                                a mock so we can exercise the parser
 *                                without booting a real test process.
 *   - `SubprocessTestRunner`   — picks the runner (vitest vs playwright)
 *                                based on the spec file's imports,
 *                                builds the command, exec's, parses,
 *                                returns RunResult.
 *
 * Status mapping:
 *
 *   - exit 0 + reporter says PASS  → 'passed'
 *   - exit 0 + reporter says SKIP  → 'skipped'
 *   - exit non-zero + reporter has  → 'failed' (with errorMessage,
 *     a failure                       errorStack, tracePath if any)
 *   - executor timeout fired       → 'failed' with errorMessage
 *                                    'timeout after Nms'
 *   - executor crashed before      → 'failed' with errorMessage
 *     reporting                      'runner crashed: <msg>'
 *
 * The directive's per-test-case wallclock budget is ~10s; the runner
 * defaults `timeoutMs = 60_000` to give the test process room while
 * still bounding lockup risk.
 *
 * @owner fix-it-test-agent (Phase 2D worker track)
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';

import type {
  GeneratedSpec,
  RunResult,
  TestRunner,
} from './stubs';

// ─── Executor port ──────────────────────────────────────────────────────────

export interface ExecOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Hard timeout. Executor must SIGKILL on expiry. */
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface CommandExecutor {
  exec(cmd: string, args: ReadonlyArray<string>, opts?: ExecOpts): Promise<ExecResult>;
}

// ─── Default executor ───────────────────────────────────────────────────────

export class SpawnCommandExecutor implements CommandExecutor {
  async exec(
    cmd: string,
    args: ReadonlyArray<string>,
    opts: ExecOpts = {},
  ): Promise<ExecResult> {
    return new Promise((resolve) => {
      const start = Date.now();
      // SpawnCommandExecutor is invoked by the worker with cmd values from a
      // pinned allowlist (vitest, playwright). The runner never executes
      // attacker-supplied commands; `cmd` is set by the worker's runtime
      // configuration, not by ticket payloads.
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
      const child = spawn(cmd, args as string[], {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killTimer: NodeJS.Timeout | null = null;

      if (opts.timeoutMs && opts.timeoutMs > 0) {
        killTimer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, opts.timeoutMs);
      }

      child.stdout?.on('data', (b: Buffer) => {
        stdout += b.toString('utf8');
      });
      child.stderr?.on('data', (b: Buffer) => {
        stderr += b.toString('utf8');
      });

      child.on('error', (err: Error) => {
        if (killTimer) clearTimeout(killTimer);
        resolve({
          exitCode: null,
          stdout,
          stderr: stderr + `\n[runner crashed: ${err.message}]`,
          timedOut,
          durationMs: Date.now() - start,
        });
      });

      child.on('close', (code: number | null) => {
        if (killTimer) clearTimeout(killTimer);
        resolve({
          exitCode: code,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}

// ─── Spec → command discovery ───────────────────────────────────────────────

export type RunnerKind = 'vitest' | 'playwright';

export function detectRunnerKind(specPath: string): RunnerKind {
  let head = '';
  try {
    head = readFileSync(specPath, { encoding: 'utf8' }).slice(0, 2048);
  } catch {
    // If the file doesn't exist we still need to return something —
    // vitest is the safer default since it'll error out cleanly when
    // the file is missing.
    return 'vitest';
  }
  return head.includes('@playwright/test') ? 'playwright' : 'vitest';
}

/**
 * Build the argv the test runner expects to exec a single spec.
 *
 * For vitest: `pnpm exec vitest run <spec>`
 * For playwright: `pnpm exec playwright test <spec> --reporter=json`
 */
export function buildRunCommand(
  spec: GeneratedSpec,
  kind: RunnerKind = detectRunnerKind(spec.specPath),
): { cmd: string; args: string[] } {
  if (kind === 'playwright') {
    return {
      cmd: 'pnpm',
      args: [
        'exec',
        'playwright',
        'test',
        spec.specPath,
        '--reporter=json',
      ],
    };
  }
  return {
    cmd: 'pnpm',
    args: ['exec', 'vitest', 'run', spec.specPath, '--reporter=json'],
  };
}

// ─── Output parsers ─────────────────────────────────────────────────────────

interface ParsedOutcome {
  status: 'passed' | 'failed' | 'skipped';
  errorMessage?: string;
  errorStack?: string;
  tracePath?: string;
}

/**
 * Parse vitest's --reporter=json output for a single-spec run.
 *
 * Vitest's JSON shape (loosely; we tolerate variations):
 *
 *   {
 *     numTotalTests: 1,
 *     numFailedTests: 0,
 *     numPassedTests: 1,
 *     numPendingTests: 0,
 *     testResults: [{
 *       testFilePath: '...',
 *       message?: string,
 *       assertionResults: [{ status: 'passed'|'failed'|'pending',
 *                            failureMessages?: string[],
 *                            title: string }]
 *     }]
 *   }
 */
export function parseVitestJson(stdout: string): ParsedOutcome {
  const json = extractFirstJsonObject(stdout);
  if (!json) {
    return { status: 'failed', errorMessage: 'unparseable vitest output' };
  }
  const numFailed = numberOf(json.numFailedTests);
  const numPassed = numberOf(json.numPassedTests);
  const numPending = numberOf(json.numPendingTests);
  if (numFailed > 0) {
    const messages = collectVitestFailureMessages(json);
    return {
      status: 'failed',
      errorMessage: messages.message,
      errorStack: messages.stack,
    };
  }
  if (numPassed > 0) return { status: 'passed' };
  if (numPending > 0) return { status: 'skipped' };
  return { status: 'failed', errorMessage: 'no tests reported' };
}

function collectVitestFailureMessages(json: any): {
  message?: string;
  stack?: string;
} {
  const results = Array.isArray(json.testResults) ? json.testResults : [];
  for (const tr of results) {
    const ar = Array.isArray(tr.assertionResults) ? tr.assertionResults : [];
    for (const a of ar) {
      if (a.status === 'failed') {
        const fm = Array.isArray(a.failureMessages) ? a.failureMessages : [];
        const all = fm.join('\n');
        const firstLine = all.split('\n')[0] ?? all;
        return { message: firstLine || tr.message, stack: all || undefined };
      }
    }
    if (tr.status === 'failed' && typeof tr.message === 'string') {
      return { message: tr.message };
    }
  }
  return {};
}

/**
 * Parse Playwright's --reporter=json output. Playwright emits a tree
 * we walk for the first failing test; if everything passed we report
 * `passed`.
 */
export function parsePlaywrightJson(stdout: string): ParsedOutcome {
  const json = extractFirstJsonObject(stdout);
  if (!json) {
    return { status: 'failed', errorMessage: 'unparseable playwright output' };
  }
  // Playwright: { stats: { expected, unexpected, skipped }, suites: [...] }
  const stats = json.stats ?? {};
  const unexpected = numberOf(stats.unexpected);
  const expected = numberOf(stats.expected);
  const skipped = numberOf(stats.skipped);

  if (unexpected > 0) {
    const failure = walkPlaywrightForFailure(json);
    return {
      status: 'failed',
      errorMessage: failure.message,
      errorStack: failure.stack,
      tracePath: failure.tracePath,
    };
  }
  if (expected > 0) return { status: 'passed' };
  if (skipped > 0) return { status: 'skipped' };
  return { status: 'failed', errorMessage: 'no playwright tests reported' };
}

function walkPlaywrightForFailure(json: any): {
  message?: string;
  stack?: string;
  tracePath?: string;
} {
  const queue: any[] = [];
  if (Array.isArray(json.suites)) queue.push(...json.suites);
  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node?.specs)) {
      for (const spec of node.specs) {
        for (const test of spec.tests ?? []) {
          for (const result of test.results ?? []) {
            if (result.status === 'failed' || result.status === 'timedOut' || result.status === 'unexpected') {
              const err = result.error ?? {};
              const tracePath = (result.attachments ?? []).find(
                (a: any) => a?.name === 'trace',
              )?.path;
              return {
                message: err.message ?? `playwright ${result.status}`,
                stack: err.stack,
                tracePath,
              };
            }
          }
        }
      }
    }
    if (Array.isArray(node?.suites)) queue.push(...node.suites);
  }
  return {};
}

function extractFirstJsonObject(s: string): any | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  // bracket-depth scan
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function numberOf(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

// ─── SubprocessTestRunner ───────────────────────────────────────────────────

export interface SubprocessTestRunnerOptions {
  executor?: CommandExecutor;
  /** Per-spec timeout in milliseconds. */
  timeoutMs?: number;
  /** Override the cwd passed to the executor (defaults to process.cwd()). */
  cwd?: string;
}

export const DEFAULT_SPEC_TIMEOUT_MS = 60_000;

export class SubprocessTestRunner implements TestRunner {
  private readonly executor: CommandExecutor;
  private readonly timeoutMs: number;
  private readonly cwd?: string;

  constructor(opts: SubprocessTestRunnerOptions = {}) {
    this.executor = opts.executor ?? new SpawnCommandExecutor();
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_SPEC_TIMEOUT_MS;
    this.cwd = opts.cwd;
  }

  async runSpec(spec: GeneratedSpec): Promise<RunResult> {
    const kind = detectRunnerKind(spec.specPath);
    const { cmd, args } = buildRunCommand(spec, kind);
    const result = await this.executor.exec(cmd, args, {
      cwd: this.cwd,
      timeoutMs: this.timeoutMs,
    });

    if (result.timedOut) {
      return {
        testCaseId: spec.testCaseId,
        status: 'failed',
        durationMs: result.durationMs,
        errorMessage: `timeout after ${this.timeoutMs}ms`,
      };
    }

    if (result.exitCode === null) {
      return {
        testCaseId: spec.testCaseId,
        status: 'failed',
        durationMs: result.durationMs,
        errorMessage:
          result.stderr.trim() || 'runner crashed before reporting',
      };
    }

    const parsed =
      kind === 'playwright'
        ? parsePlaywrightJson(result.stdout)
        : parseVitestJson(result.stdout);

    return {
      testCaseId: spec.testCaseId,
      status: parsed.status,
      durationMs: result.durationMs,
      tracePath: parsed.tracePath,
      errorMessage: parsed.errorMessage,
      errorStack: parsed.errorStack,
      artifacts: {
        stdoutTail: tail(result.stdout, 2000),
        stderrTail: tail(result.stderr, 2000),
        exitCode: result.exitCode,
        runnerKind: kind,
      },
    };
  }
}

function tail(s: string, n: number): string {
  return s.length <= n ? s : s.slice(-n);
}
