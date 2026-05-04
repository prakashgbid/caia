/**
 * `SubprocessTestRunner` — FIX-003 contract tests.
 *
 * The runner has two units we test independently:
 *
 *   1. The pure parsers (vitest + playwright JSON shapes).
 *   2. The runner itself, exercised against a mock CommandExecutor so
 *      we never spawn a real test process from CI.
 *
 * Bonus tests cover the spec-kind heuristic (vitest vs playwright)
 * and the buildRunCommand mapping.
 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  DEFAULT_SPEC_TIMEOUT_MS,
  SubprocessTestRunner,
  buildRunCommand,
  detectRunnerKind,
  parsePlaywrightJson,
  parseVitestJson,
  type CommandExecutor,
  type ExecOpts,
  type ExecResult,
} from '../src/test-runner';
import type { GeneratedSpec } from '../src/stubs';

class MockExecutor implements CommandExecutor {
  public calls: Array<{ cmd: string; args: ReadonlyArray<string>; opts?: ExecOpts }> = [];
  constructor(private readonly canned: ExecResult) {}
  async exec(
    cmd: string,
    args: ReadonlyArray<string>,
    opts?: ExecOpts,
  ): Promise<ExecResult> {
    this.calls.push({ cmd, args, opts });
    return this.canned;
  }
}

function specForFile(path: string): GeneratedSpec {
  return { testCaseId: 'tc1', specPath: path, contentHash: 'h' };
}

function writeSpecFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'caia-fix-003-'));
  const path = join(dir, 'tc.spec.ts');
  writeFileSync(path, content, 'utf8');
  return path;
}

// ─── parseVitestJson ────────────────────────────────────────────────────────

describe('parseVitestJson', () => {
  it('returns passed when numPassedTests > 0 and no failures', () => {
    const out = parseVitestJson(
      JSON.stringify({
        numTotalTests: 1,
        numFailedTests: 0,
        numPassedTests: 1,
        numPendingTests: 0,
        testResults: [],
      }),
    );
    expect(out.status).toBe('passed');
  });

  it('returns failed and lifts the first failure message + stack', () => {
    const out = parseVitestJson(
      JSON.stringify({
        numFailedTests: 1,
        numPassedTests: 0,
        numPendingTests: 0,
        testResults: [
          {
            assertionResults: [
              {
                status: 'failed',
                title: 'tc',
                failureMessages: [
                  'Expected: /dashboard\nGot: /login\n  at line 42',
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(out.status).toBe('failed');
    expect(out.errorMessage).toBe('Expected: /dashboard');
    expect(out.errorStack).toContain('at line 42');
  });

  it('returns skipped when only pending tests exist', () => {
    const out = parseVitestJson(
      JSON.stringify({
        numFailedTests: 0,
        numPassedTests: 0,
        numPendingTests: 1,
        testResults: [],
      }),
    );
    expect(out.status).toBe('skipped');
  });

  it('returns failed with message when stdout is not parseable', () => {
    const out = parseVitestJson('garbage');
    expect(out.status).toBe('failed');
    expect(out.errorMessage).toContain('unparseable');
  });

  it('handles JSON embedded in stdout chatter', () => {
    const wrapped = `> vitest run ts.spec.ts\n${JSON.stringify({
      numFailedTests: 0,
      numPassedTests: 1,
      numPendingTests: 0,
    })}\n[stderr line]`;
    const out = parseVitestJson(wrapped);
    expect(out.status).toBe('passed');
  });
});

// ─── parsePlaywrightJson ────────────────────────────────────────────────────

describe('parsePlaywrightJson', () => {
  it('returns passed on stats.expected > 0 and no unexpected', () => {
    const out = parsePlaywrightJson(
      JSON.stringify({
        stats: { expected: 1, unexpected: 0, skipped: 0 },
        suites: [],
      }),
    );
    expect(out.status).toBe('passed');
  });

  it('returns failed with message + stack + tracePath on stats.unexpected', () => {
    const out = parsePlaywrightJson(
      JSON.stringify({
        stats: { expected: 0, unexpected: 1, skipped: 0 },
        suites: [
          {
            specs: [
              {
                tests: [
                  {
                    results: [
                      {
                        status: 'failed',
                        error: {
                          message: 'expected /dashboard, got /login',
                          stack: 'TestError\n  at thing.ts:1',
                        },
                        attachments: [
                          { name: 'trace', path: '/tmp/trace.zip' },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(out.status).toBe('failed');
    expect(out.errorMessage).toContain('/dashboard');
    expect(out.errorStack).toContain('TestError');
    expect(out.tracePath).toBe('/tmp/trace.zip');
  });

  it('returns skipped when only skipped > 0', () => {
    const out = parsePlaywrightJson(
      JSON.stringify({
        stats: { expected: 0, unexpected: 0, skipped: 1 },
        suites: [],
      }),
    );
    expect(out.status).toBe('skipped');
  });

  it('walks nested suites to find the failure', () => {
    const out = parsePlaywrightJson(
      JSON.stringify({
        stats: { expected: 0, unexpected: 1, skipped: 0 },
        suites: [
          {
            suites: [
              {
                specs: [
                  {
                    tests: [
                      { results: [{ status: 'timedOut', error: { message: 'timeout' } }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(out.status).toBe('failed');
    expect(out.errorMessage).toBe('timeout');
  });
});

// ─── detectRunnerKind ───────────────────────────────────────────────────────

describe('detectRunnerKind', () => {
  it('returns playwright when the spec imports @playwright/test', () => {
    const path = writeSpecFile("import { test, expect } from '@playwright/test';");
    expect(detectRunnerKind(path)).toBe('playwright');
  });

  it('returns vitest by default', () => {
    const path = writeSpecFile("import { it, expect } from 'vitest';");
    expect(detectRunnerKind(path)).toBe('vitest');
  });

  it('returns vitest when the file is missing', () => {
    expect(detectRunnerKind('/tmp/this-file-does-not-exist.spec.ts')).toBe('vitest');
  });
});

// ─── buildRunCommand ────────────────────────────────────────────────────────

describe('buildRunCommand', () => {
  it('builds vitest run for vitest specs', () => {
    const path = writeSpecFile("import { it } from 'vitest';");
    const out = buildRunCommand(specForFile(path));
    expect(out.cmd).toBe('pnpm');
    expect(out.args).toEqual(['exec', 'vitest', 'run', path, '--reporter=json']);
  });

  it('builds playwright test for playwright specs', () => {
    const path = writeSpecFile("import { test } from '@playwright/test';");
    const out = buildRunCommand(specForFile(path));
    expect(out.cmd).toBe('pnpm');
    expect(out.args).toEqual(['exec', 'playwright', 'test', path, '--reporter=json']);
  });
});

// ─── SubprocessTestRunner end-to-end with mock executor ─────────────────────

describe('SubprocessTestRunner', () => {
  function runResult(canned: Partial<ExecResult>): ExecResult {
    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 12,
      ...canned,
    };
  }

  it('returns passed for a green vitest spec', async () => {
    const path = writeSpecFile("import { it } from 'vitest';");
    const exec = new MockExecutor(
      runResult({
        stdout: JSON.stringify({
          numFailedTests: 0,
          numPassedTests: 1,
          numPendingTests: 0,
        }),
      }),
    );
    const runner = new SubprocessTestRunner({ executor: exec });
    const out = await runner.runSpec(specForFile(path));
    expect(out.status).toBe('passed');
    expect(out.durationMs).toBe(12);
    expect(out.artifacts).toMatchObject({ runnerKind: 'vitest', exitCode: 0 });
    expect(exec.calls[0]?.cmd).toBe('pnpm');
    expect(exec.calls[0]?.opts?.timeoutMs).toBe(DEFAULT_SPEC_TIMEOUT_MS);
  });

  it('returns failed for a red vitest spec and lifts the message', async () => {
    const path = writeSpecFile("import { it } from 'vitest';");
    const exec = new MockExecutor(
      runResult({
        exitCode: 1,
        stdout: JSON.stringify({
          numFailedTests: 1,
          numPassedTests: 0,
          numPendingTests: 0,
          testResults: [
            {
              assertionResults: [
                {
                  status: 'failed',
                  failureMessages: ['boom\n  at x.ts:1'],
                },
              ],
            },
          ],
        }),
      }),
    );
    const runner = new SubprocessTestRunner({ executor: exec });
    const out = await runner.runSpec(specForFile(path));
    expect(out.status).toBe('failed');
    expect(out.errorMessage).toBe('boom');
    expect(out.errorStack).toContain('at x.ts');
  });

  it('returns failed with timeout message when executor reports timedOut', async () => {
    const path = writeSpecFile("import { it } from 'vitest';");
    const exec = new MockExecutor(
      runResult({ exitCode: null, timedOut: true, durationMs: 60_000 }),
    );
    const runner = new SubprocessTestRunner({ executor: exec, timeoutMs: 60_000 });
    const out = await runner.runSpec(specForFile(path));
    expect(out.status).toBe('failed');
    expect(out.errorMessage).toContain('timeout');
    expect(out.errorMessage).toContain('60000ms');
  });

  it('returns failed when the runner crashed (exitCode null, not timed out)', async () => {
    const path = writeSpecFile("import { it } from 'vitest';");
    const exec = new MockExecutor(
      runResult({ exitCode: null, stderr: 'enoent: pnpm not found' }),
    );
    const runner = new SubprocessTestRunner({ executor: exec });
    const out = await runner.runSpec(specForFile(path));
    expect(out.status).toBe('failed');
    expect(out.errorMessage).toContain('pnpm not found');
  });

  it('routes a Playwright spec to the playwright reporter', async () => {
    const path = writeSpecFile("import { test } from '@playwright/test';");
    const exec = new MockExecutor(
      runResult({
        stdout: JSON.stringify({
          stats: { expected: 1, unexpected: 0, skipped: 0 },
          suites: [],
        }),
      }),
    );
    const runner = new SubprocessTestRunner({ executor: exec });
    const out = await runner.runSpec(specForFile(path));
    expect(out.status).toBe('passed');
    expect(out.artifacts).toMatchObject({ runnerKind: 'playwright' });
    expect(exec.calls[0]?.args).toContain('playwright');
  });

  it('returns skipped when a vitest run reports only pending tests', async () => {
    const path = writeSpecFile("import { it } from 'vitest';");
    const exec = new MockExecutor(
      runResult({
        stdout: JSON.stringify({
          numFailedTests: 0,
          numPassedTests: 0,
          numPendingTests: 1,
        }),
      }),
    );
    const runner = new SubprocessTestRunner({ executor: exec });
    const out = await runner.runSpec(specForFile(path));
    expect(out.status).toBe('skipped');
  });

  it('passes cwd through to the executor when configured', async () => {
    const path = writeSpecFile("import { it } from 'vitest';");
    const exec = new MockExecutor(
      runResult({
        stdout: JSON.stringify({
          numFailedTests: 0,
          numPassedTests: 1,
          numPendingTests: 0,
        }),
      }),
    );
    const runner = new SubprocessTestRunner({
      executor: exec,
      cwd: '/some/where',
    });
    await runner.runSpec(specForFile(path));
    expect(exec.calls[0]?.opts?.cwd).toBe('/some/where');
  });
});
