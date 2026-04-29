/**
 * DodSelfCheck — CODING-006 unit tests.
 *
 * Stubbed exec + fs let us run the checklist deterministically. Covers
 * each check's pass + fail path + the runAll aggregator.
 *
 * 14 cases.
 */

import { DodSelfCheck } from '../src/dod-self-check';
import type { Bundle } from '../src/bundle-reader';
import type { Worktree } from '../src/worktree-manager';
import type { RunResult } from '../src/local-test-runner';
import type { OpenPrResult } from '../src/diff-committer';

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    story: {
      id: 's_test',
      title: '',
      description: '',
      status: 'pending',
      rootPromptId: null,
      parentEntityId: null,
      parentEntityType: null,
      bucketId: null,
      templateVersion: 'v1',
      templateValidationStatus: 'pending',
      templateValidationErrors: null,
      enrichedAt: null,
      updatedAt: null,
    },
    ticket: {
      claims: { files: ['apps/dashboard/app/health/route.ts'], schemas: [], apiRoutes: [], domains: [] },
      testCases: [{ id: 'TC-001', title: 'happy', category: 'happy' }],
    },
    ticketParseError: null,
    prompt: null,
    requirement: null,
    bucket: null,
    labels: [],
    dependencies: { upstream: [], downstream: [] },
    inputDependencies: [],
    ...overrides,
  };
}

function makeWorktree(): Worktree {
  return {
    storyId: 's_test',
    path: '/tmp/wt/s_test',
    branch: 'feat/s_test',
    integrationBranch: 'main',
    createdAt: 0,
  };
}

function makeRunResult(passed = true): RunResult {
  return {
    results: [{ phase: 'unit', command: 'pnpm test', exitCode: passed ? 0 : 1, durationMs: 100, stdoutTail: '', stderrTail: '', passed }],
    passed,
    totalDurationMs: 100,
    logPath: '/tmp/wt/s_test/.test-output.log',
  };
}

function makePr(): OpenPrResult {
  return { prNumber: 42, prUrl: 'https://github.com/x/y/pull/42' };
}

function makeExec(touched: string[], pkgDiff = '') {
  return ((bin: string, args: string[]) => {
    if (bin === 'git' && args[0] === 'diff' && args.includes('--name-only')) {
      return { status: 0, stdout: touched.join('\n'), stderr: '' };
    }
    if (bin === 'git' && args[0] === 'diff') {
      return { status: 0, stdout: pkgDiff, stderr: '' };
    }
    if (bin === 'bash') {
      return { status: 0, stdout: 'ok', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  }) as never;
}

describe('DodSelfCheck.checkLocalTestsPassed', () => {
  it('passes when test run passed', () => {
    const dod = new DodSelfCheck();
    const r = dod.checkLocalTestsPassed({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: 's_test TC-001',
    });
    expect(r.passed).toBe(true);
  });

  it('fails when test run failed', () => {
    const dod = new DodSelfCheck();
    const r = dod.checkLocalTestsPassed({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(false),
      pr: makePr(),
      prBody: 's_test TC-001',
    });
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('unit');
  });
});

describe('DodSelfCheck.checkClaimsFiles', () => {
  it('passes when touched files all in claims', () => {
    const exec = makeExec(['apps/dashboard/app/health/route.ts']);
    const dod = new DodSelfCheck({ execImpl: exec });
    const r = dod.checkClaimsFiles({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: '',
    });
    expect(r.passed).toBe(true);
  });

  it('fails when a file outside claims is touched', () => {
    const exec = makeExec(['apps/dashboard/app/health/route.ts', 'apps/orchestrator/src/x.ts']);
    const dod = new DodSelfCheck({ execImpl: exec });
    const r = dod.checkClaimsFiles({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: '',
    });
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('apps/orchestrator/src/x.ts');
  });

  it('always allows pnpm-lock.yaml and _journal.json + .test-output.log', () => {
    const exec = makeExec([
      'apps/dashboard/app/health/route.ts',
      'pnpm-lock.yaml',
      'apps/orchestrator/src/db/migrations/meta/_journal.json',
      '.test-output.log',
    ]);
    const dod = new DodSelfCheck({ execImpl: exec });
    const r = dod.checkClaimsFiles({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: '',
    });
    expect(r.passed).toBe(true);
  });

  it('passes (read-only mode) when ticket declares no claims', () => {
    const exec = makeExec(['apps/anything/whatever.ts']);
    const dod = new DodSelfCheck({ execImpl: exec });
    const bundle = makeBundle();
    (bundle.ticket as Record<string, unknown>).claims = {};
    const r = dod.checkClaimsFiles({
      bundle,
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: '',
    });
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('read-only');
  });
});

describe('DodSelfCheck.checkPrBodyReferencesStory', () => {
  it('passes when story id present in body', () => {
    const dod = new DodSelfCheck();
    const r = dod.checkPrBodyReferencesStory({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: 'Story: s_test\nDoes things',
    });
    expect(r.passed).toBe(true);
  });

  it('fails when story id missing', () => {
    const dod = new DodSelfCheck();
    const r = dod.checkPrBodyReferencesStory({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: 'No story id here',
    });
    expect(r.passed).toBe(false);
  });
});

describe('DodSelfCheck.checkPrBodyReferencesTestCases', () => {
  it('passes when every test case id appears', () => {
    const dod = new DodSelfCheck();
    const r = dod.checkPrBodyReferencesTestCases({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: 'TC-001 happy path',
    });
    expect(r.passed).toBe(true);
  });

  it('fails when some test case ids missing', () => {
    const dod = new DodSelfCheck();
    const bundle = makeBundle();
    (bundle.ticket as Record<string, unknown>).testCases = [
      { id: 'TC-001' }, { id: 'TC-002' }, { id: 'TC-003' },
    ];
    const r = dod.checkPrBodyReferencesTestCases({
      bundle,
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: 'mentions TC-001 only',
    });
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('TC-002');
  });

  it('skipped when no test cases on ticket', () => {
    const dod = new DodSelfCheck();
    const bundle = makeBundle();
    (bundle.ticket as Record<string, unknown>).testCases = [];
    const r = dod.checkPrBodyReferencesTestCases({
      bundle,
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: 'anything',
    });
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('skipped');
  });
});

describe('DodSelfCheck.checkPackageVersionNotBumped', () => {
  it('passes when no package.json touched', () => {
    const exec = makeExec(['apps/x/y.ts']);
    const dod = new DodSelfCheck({ execImpl: exec });
    const r = dod.checkPackageVersionNotBumped({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: '',
    });
    expect(r.passed).toBe(true);
  });

  it('fails when version line changed in touched package.json', () => {
    const exec = makeExec(['apps/x/package.json'], '+  "version": "0.2.0",\n-  "version": "0.1.0",\n');
    const dod = new DodSelfCheck({ execImpl: exec });
    const r = dod.checkPackageVersionNotBumped({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: '',
    });
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('version-line change');
  });

  it('passes when package.json touched but no version change', () => {
    const exec = makeExec(['apps/x/package.json'], '+  "scripts": { "x": "y" },\n');
    const dod = new DodSelfCheck({ execImpl: exec });
    const r = dod.checkPackageVersionNotBumped({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: '',
    });
    expect(r.passed).toBe(true);
  });
});

describe('DodSelfCheck.runAll', () => {
  it('aggregates check results', () => {
    const exec = makeExec(['apps/dashboard/app/health/route.ts']);
    const dod = new DodSelfCheck({ execImpl: exec });
    const report = dod.runAll({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(true),
      pr: makePr(),
      prBody: 'Story: s_test\nTC-001 yes',
      skipShellChecks: true,
    });
    expect(report.passed).toBe(true);
    expect(report.failureCount).toBe(0);
    expect(report.results.length).toBeGreaterThanOrEqual(6);
  });

  it('reports failureCount > 0 when any check fails', () => {
    const exec = makeExec(['out/of/scope.ts']);
    const dod = new DodSelfCheck({ execImpl: exec });
    const report = dod.runAll({
      bundle: makeBundle(),
      worktree: makeWorktree(),
      testRun: makeRunResult(false),         // tests failed
      pr: makePr(),
      prBody: 'no story id',                // body missing
      skipShellChecks: true,
    });
    expect(report.passed).toBe(false);
    expect(report.failureCount).toBeGreaterThanOrEqual(3);
  });
});
