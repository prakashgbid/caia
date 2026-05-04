/**
 * `StructuredFailureDiagnoser` — FIX-004 contract tests.
 *
 * Three behaviours we pin:
 *
 *   1. The diagnoser always produces a TestFailureReport whose Zod
 *      schema parses without throwing — the orchestrator's IPC payload
 *      depends on this guarantee.
 *   2. Browser artifacts attached by the runner (tracePath, screenshot,
 *      console, network, DOM) flow through to the report.
 *   3. The heuristic cause inference catches the common error
 *      patterns the Coding Agent will see.
 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  StructuredFailureDiagnoser,
  inferCause,
  liftFailingAssertion,
  tailFile,
  tailLines,
} from '../src/failure-diagnoser';
import { TestFailureReportSchema } from '../src/types';
import type { RunResult } from '../src/stubs';
import type { TestCase } from '@chiefaia/ticket-template';

function makeCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'tc1',
    title: 'Login redirects to dashboard',
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
    ...overrides,
  };
}

describe('inferCause', () => {
  const cases: Array<[string, string]> = [
    ['Cannot find module "x"', 'missing-import'],
    ['ECONNREFUSED 127.0.0.1:5432', 'service-not-running'],
    ['ENOENT: no such file', 'missing-file'],
    ['Test timed out after 30s', 'timeout'],
    ['selector "button#login" not found', 'selector-not-found'],
    ['Expected: /dashboard\nReceived: /login', 'assertion-mismatch'],
    ['toEqual({ a: 1 })', 'assertion-mismatch'],
    ['axe found 3 violations', 'a11y-violation'],
    ['Screenshot comparison failed: expected page to have screenshot', 'visual-regression'],
    ['Got 401 Unauthorized', 'auth-failure'],
    ['Got 500 Internal Server Error', 'server-error'],
    ['Got 404 Not Found', 'not-found'],
    ['SyntaxError: unexpected token', 'syntax-error'],
    ['TypeError: x is not a function', 'type-error'],
    ['something completely unrelated', 'unknown'],
  ];
  for (const [msg, expected] of cases) {
    it(`infers ${expected} from "${msg.slice(0, 40)}"`, () => {
      expect(inferCause(msg, undefined)).toBe(expected);
    });
  }
});

describe('liftFailingAssertion', () => {
  it('extracts toEqual assertion', () => {
    expect(liftFailingAssertion('toEqual({ a: 1 })', undefined)).toBe(
      'toEqual({ a: 1 })',
    );
  });
  it('extracts toHaveURL assertion', () => {
    expect(liftFailingAssertion(undefined, 'expect(page).toHaveURL(/dashboard/)')).toContain(
      'toHaveURL',
    );
  });
  it('returns null when nothing matches', () => {
    expect(liftFailingAssertion('completely unrelated', undefined)).toBeNull();
  });
});

describe('tailLines', () => {
  it('returns the last N lines', () => {
    const s = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
    expect(tailLines(s, 3)).toEqual(['line7', 'line8', 'line9']);
  });
  it('returns [] when input is empty', () => {
    expect(tailLines(undefined)).toEqual([]);
    expect(tailLines('')).toEqual([]);
  });
});

describe('tailFile', () => {
  it('returns lines for an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caia-fix-004-'));
    const path = join(dir, 'log.txt');
    writeFileSync(path, 'a\nb\nc\nd\n', 'utf8');
    expect(tailFile(path, 2)).toEqual(['c', 'd']);
  });
  it('returns [] when file is missing', () => {
    expect(tailFile('/tmp/this-file-is-not-real.log')).toEqual([]);
  });
});

describe('StructuredFailureDiagnoser', () => {
  const diag = new StructuredFailureDiagnoser();

  it('produces a Zod-valid TestFailureReport for a vitest failure', async () => {
    const run: RunResult = {
      testCaseId: 'tc1',
      status: 'failed',
      durationMs: 12,
      errorMessage: 'Expected: /dashboard\nReceived: /login',
      errorStack:
        'AssertionError: expect(page).toHaveURL(/dashboard/)\n  at file.spec.ts:7',
      artifacts: {
        stdoutTail: 'a\nb\nc\nd\ne',
        stderrTail: 'X\nY',
        runnerKind: 'vitest',
      },
    };
    const report = await diag.diagnose(run, makeCase(), 1);
    const parsed = TestFailureReportSchema.parse(report);
    expect(parsed.errorMessage).toContain('/dashboard');
    expect(parsed.failingAssertion).toContain('toHaveURL');
    expect(parsed.inferredCause).toBe('assertion-mismatch');
    expect(parsed.artifacts.consoleLog).toEqual(['a', 'b', 'c', 'd', 'e', 'X', 'Y']);
    expect(parsed.attempt).toBe(1);
  });

  it('lifts browser artifacts (tracePath, screenshotUrl, console, network, DOM)', async () => {
    const run: RunResult = {
      testCaseId: 'tc1',
      status: 'failed',
      durationMs: 99,
      errorMessage: 'selector "button#login" not found',
      errorStack: 'Error\n  at frame.click',
      tracePath: '/tmp/trace.zip',
      artifacts: {
        screenshotUrl: 'file:///tmp/shot.png',
        consoleLog: ['warn: missing prop', 'log: render'],
        networkLog: [{ method: 'GET', url: '/api/x', status: 401 }],
        domSnapshot: '<html>...</html>',
        seedFixtures: { user: { id: 1 } },
      },
    };
    const report = await diag.diagnose(run, makeCase({ category: 'edge' }), 2);
    expect(report.artifacts.tracePath).toBe('/tmp/trace.zip');
    expect(report.artifacts.screenshotUrl).toBe('file:///tmp/shot.png');
    expect(report.artifacts.consoleLog).toContain('warn: missing prop');
    expect(report.artifacts.networkLog).toEqual([
      { method: 'GET', url: '/api/x', status: 401 },
    ]);
    expect(report.artifacts.domSnapshot).toBe('<html>...</html>');
    expect(report.artifacts.seedFixtures).toEqual({ user: { id: 1 } });
    expect(report.inferredCause).toBe('selector-not-found');
    expect(report.category).toBe('edge');
  });

  it('falls back gracefully when artifacts are absent', async () => {
    const run: RunResult = {
      testCaseId: 'tc1',
      status: 'failed',
      durationMs: 1,
      errorMessage: 'boom',
    };
    const report = await diag.diagnose(run, makeCase(), 1);
    expect(report.errorMessage).toBe('boom');
    expect(report.errorStack).toBeNull();
    expect(report.failingAssertion).toBeNull();
    expect(report.artifacts.consoleLog).toEqual([]);
    expect(report.artifacts.networkLog).toEqual([]);
    expect(report.artifacts.domSnapshot).toBeNull();
    expect(report.artifacts.screenshotUrl).toBeNull();
    expect(report.artifacts.tracePath).toBeNull();
    expect(report.inferredCause).toBe('unknown');
  });

  it('respects the logTailLines option', async () => {
    const run: RunResult = {
      testCaseId: 'tc1',
      status: 'failed',
      durationMs: 1,
      errorMessage: 'x',
      artifacts: {
        stdoutTail: Array.from({ length: 100 }, (_, i) => `out${i}`).join('\n'),
        stderrTail: '',
      },
    };
    const diag2 = new StructuredFailureDiagnoser({ logTailLines: 5 });
    const report = await diag2.diagnose(run, makeCase(), 1);
    expect(report.artifacts.consoleLog?.length).toBe(5);
    expect(report.artifacts.consoleLog?.[0]).toBe('out95');
  });

  it('uses runResult.status as errorMessage when none provided', async () => {
    const run: RunResult = {
      testCaseId: 'tc1',
      status: 'failed',
      durationMs: 1,
    };
    const report = await diag.diagnose(run, makeCase(), 1);
    expect(report.errorMessage).toBe('failed');
  });
});
