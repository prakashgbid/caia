import { describe, expect, it } from 'vitest';

import {
  parseAxeViolations,
  parseLighthouseReport,
  parsePlaywrightJson,
  parseRunnerOutput,
  parseVitestJson,
  synthesiseRunnerError,
} from '../src/result-parser.js';
import type { RunPlan, RunnerRawOutput } from '../src/types.js';
import { makeTestCase } from './fixtures/ticket-fixture.js';

function makePlan(overrides: Partial<RunPlan> & Pick<RunPlan, 'runner'>): RunPlan {
  return {
    runner: overrides.runner,
    cases: overrides.cases ?? [],
    cwd: overrides.cwd ?? '/tmp/repo',
    ...(overrides.vitestFiles !== undefined ? { vitestFiles: overrides.vitestFiles } : {}),
    ...(overrides.playwrightFiles !== undefined ? { playwrightFiles: overrides.playwrightFiles } : {}),
    ...(overrides.url !== undefined ? { url: overrides.url } : {}),
    ...(overrides.performanceBudget !== undefined
      ? { performanceBudget: overrides.performanceBudget }
      : {}),
    ...(overrides.env !== undefined ? { env: overrides.env } : {}),
  };
}

function makeRaw(plan: RunPlan, jsonReport: unknown, opts: Partial<RunnerRawOutput> = {}): RunnerRawOutput {
  return {
    runner: plan.runner,
    exitCode: opts.exitCode ?? 0,
    stdout: opts.stdout ?? '',
    stderr: opts.stderr ?? '',
    durationMs: opts.durationMs ?? 42,
    plan,
    jsonReport,
  };
}

describe('parseVitestJson', () => {
  it('maps assertion results to test cases by id', () => {
    const cases = [
      makeTestCase({ id: 'TC-1', title: 'sums', category: 'happy', layer: 'unit' }),
      makeTestCase({ id: 'TC-2', title: 'rejects negatives', category: 'edge', layer: 'unit' }),
    ];
    const plan = makePlan({ runner: 'vitest', cases, vitestFiles: ['x.test.ts'] });
    const json = {
      testResults: [
        {
          name: '/repo/x.test.ts',
          assertionResults: [
            {
              fullName: 'sumOf TC-1 sums positives',
              status: 'passed',
              duration: 12,
              ancestorTitles: ['sumOf'],
              title: 'TC-1 sums positives',
              location: { file: '/repo/x.test.ts', line: 17 },
            },
            {
              fullName: 'sumOf TC-2 rejects negatives',
              status: 'failed',
              duration: 7,
              ancestorTitles: ['sumOf'],
              title: 'TC-2 rejects negatives',
              failureMessages: ['AssertionError: expected -1\n    at line 23'],
              location: { file: '/repo/x.test.ts', line: 23 },
            },
          ],
        },
      ],
    };
    const out = parseVitestJson(makeRaw(plan, json));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      caseId: 'TC-1',
      status: 'passed',
      file: '/repo/x.test.ts',
      line: 17,
      runner: 'vitest',
    });
    expect(out[1]).toMatchObject({
      caseId: 'TC-2',
      status: 'failed',
      line: 23,
      errorMessage: 'AssertionError: expected -1',
    });
  });

  it('returns [] when runner mismatches', () => {
    const plan = makePlan({ runner: 'playwright', cases: [] });
    expect(parseVitestJson(makeRaw(plan, {}))).toEqual([]);
  });

  it('returns [] when no testResults', () => {
    const plan = makePlan({ runner: 'vitest', cases: [] });
    expect(parseVitestJson(makeRaw(plan, { weird: true }))).toEqual([]);
  });

  it('falls back to parsing JSON from stdout', () => {
    const cases = [makeTestCase({ id: 'TC-A', title: 'a', category: 'happy', layer: 'unit' })];
    const plan = makePlan({ runner: 'vitest', cases });
    const stdout = JSON.stringify({
      testResults: [
        {
          name: 'x.test.ts',
          assertionResults: [
            { fullName: 'TC-A a', status: 'passed', duration: 1, title: 'TC-A a' },
          ],
        },
      ],
    });
    const out = parseVitestJson({
      runner: 'vitest',
      exitCode: 0,
      stdout,
      stderr: '',
      durationMs: 1,
      plan,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('passed');
  });
});

describe('parsePlaywrightJson', () => {
  it('maps suite specs and marks flaky on retries', () => {
    const cases = [
      makeTestCase({ id: 'TC-E1', title: 'login flow', category: 'happy', layer: 'e2e' }),
      makeTestCase({ id: 'TC-E2', title: 'broken flow', category: 'error', layer: 'e2e' }),
    ];
    const plan = makePlan({ runner: 'playwright', cases, url: 'http://localhost:3000' });
    const json = {
      suites: [
        {
          specs: [
            {
              title: 'TC-E1 login flow',
              file: 'tests/e2e/login.spec.ts',
              line: 5,
              tests: [
                {
                  results: [
                    { status: 'failed', duration: 100, retry: 0, errors: [{ message: 'first try', stack: 's' }] },
                    { status: 'passed', duration: 80, retry: 1 },
                  ],
                },
              ],
            },
            {
              title: 'TC-E2 broken flow',
              file: 'tests/e2e/broken.spec.ts',
              line: 12,
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 50,
                      retry: 0,
                      errors: [{ message: 'boom', stack: 'stk' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = parsePlaywrightJson(makeRaw(plan, json));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ caseId: 'TC-E1', status: 'flaky', flakeRetries: 1 });
    expect(out[1]).toMatchObject({
      caseId: 'TC-E2',
      status: 'failed',
      errorMessage: 'boom',
      errorStack: 'stk',
      line: 12,
    });
  });

  it('walks nested suites', () => {
    const cases = [makeTestCase({ id: 'TC-N', title: 'nested', category: 'happy', layer: 'e2e' })];
    const plan = makePlan({ runner: 'playwright', cases });
    const json = {
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  title: 'TC-N nested',
                  file: 'nested.spec.ts',
                  line: 3,
                  tests: [{ results: [{ status: 'passed', duration: 5 }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = parsePlaywrightJson(makeRaw(plan, json));
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('passed');
  });
});

describe('parseAxeViolations', () => {
  it('marks all cases passed when no violations', () => {
    const cases = [makeTestCase({ id: 'TC-A1', title: 'page a11y', category: 'accessibility', layer: 'accessibility' })];
    const plan = makePlan({ runner: 'axe', cases, url: 'http://localhost:3000' });
    const out = parseAxeViolations(makeRaw(plan, { violations: [] }));
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('passed');
    expect(out[0]?.axeViolations).toBeUndefined();
  });

  it('marks failure with violations & top error', () => {
    const cases = [makeTestCase({ id: 'TC-A1', title: 'a11y', category: 'accessibility', layer: 'accessibility' })];
    const plan = makePlan({ runner: 'axe', cases, url: 'http://localhost:3000' });
    const json = {
      violations: [
        {
          id: 'color-contrast',
          impact: 'serious',
          description: 'Contrast too low',
          helpUrl: 'https://example.com',
          nodes: [{ a: 1 }, { a: 2 }],
        },
      ],
    };
    const out = parseAxeViolations(makeRaw(plan, json));
    expect(out[0]?.status).toBe('failed');
    expect(out[0]?.axeViolations?.[0]).toMatchObject({
      id: 'color-contrast',
      impact: 'serious',
      nodes: 2,
    });
    expect(out[0]?.errorMessage).toContain('color-contrast');
  });
});

describe('parseLighthouseReport', () => {
  it('fails when perf score below floor', () => {
    const cases = [makeTestCase({ id: 'TC-P', title: 'perf', category: 'performance', layer: 'visual' })];
    const plan = makePlan({
      runner: 'lighthouse',
      cases,
      url: 'http://localhost:3000',
      performanceBudget: { lighthouseDeltaPct: 5, performanceScoreFloor: 0.9 },
    });
    const json = {
      categories: {
        performance: { score: 0.5 },
        accessibility: { score: 1 },
        'best-practices': { score: 1 },
        seo: { score: 1 },
      },
      audits: {
        'largest-contentful-paint': { score: 0.5, numericValue: 4500 },
        'cumulative-layout-shift': { score: 0.9, numericValue: 0.1 },
        'total-blocking-time': { score: 1, numericValue: 50 },
      },
    };
    const out = parseLighthouseReport(makeRaw(plan, json));
    expect(out[0]?.status).toBe('failed');
    expect(out[0]?.lighthouseAudit?.budgetFailed).toBe(true);
    expect(out[0]?.errorMessage).toContain('performance 0.50');
  });

  it('passes when no budget is provided', () => {
    const cases = [makeTestCase({ id: 'TC-P', title: 'perf', category: 'performance', layer: 'visual' })];
    const plan = makePlan({ runner: 'lighthouse', cases, url: 'http://localhost:3000' });
    const json = {
      categories: { performance: { score: 0.95 } },
      audits: {},
    };
    const out = parseLighthouseReport(makeRaw(plan, json));
    expect(out[0]?.status).toBe('passed');
    expect(out[0]?.lighthouseAudit?.performanceScore).toBe(0.95);
  });
});

describe('parseRunnerOutput dispatcher', () => {
  it('routes by runner kind', () => {
    const cases = [makeTestCase({ id: 'TC', title: 't', category: 'happy', layer: 'unit' })];
    const plan = makePlan({ runner: 'vitest', cases });
    const out = parseRunnerOutput(
      makeRaw(plan, {
        testResults: [
          {
            name: 'x.test.ts',
            assertionResults: [{ fullName: 'TC t', title: 'TC t', status: 'passed', duration: 1 }],
          },
        ],
      }),
    );
    expect(out).toHaveLength(1);
  });
});

describe('synthesiseRunnerError', () => {
  it('returns one errored result per case', () => {
    const cases = [
      makeTestCase({ id: 'TC1', title: 'a', category: 'happy', layer: 'unit' }),
      makeTestCase({ id: 'TC2', title: 'b', category: 'happy', layer: 'unit' }),
    ];
    const plan = makePlan({ runner: 'vitest', cases });
    const raw: RunnerRawOutput = {
      runner: 'vitest',
      exitCode: -1,
      stdout: '',
      stderr: 'spawn failed',
      durationMs: 5,
      plan,
    };
    const out = synthesiseRunnerError(raw, 'spawn failed');
    expect(out).toHaveLength(2);
    expect(out[0]?.status).toBe('errored');
    expect(out[0]?.errorMessage).toBe('spawn failed');
  });
});
