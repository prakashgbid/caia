/**
 * Feature-scoped behavior test runner.
 *
 * Picks up *.behavior.ts files matching the scope and runs them via Playwright CLI.
 * Emits structured results and posts them to Conductor.
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export type RunScope =
  | `site:${string}`
  | `site:${string} feature:${string}`
  | `changed-since:${string}`;

export interface RunnerResult {
  feature: string;
  spec: string;
  status: 'pass' | 'fail' | 'skip' | 'flaky';
  duration: number;
  evidenceUrl?: string;
  failureExcerpt?: string;
}

export interface SuiteRunResult {
  scope: string;
  startedAt: string;
  endedAt: string;
  passed: number;
  failed: number;
  skipped: number;
  results: RunnerResult[];
  exitCode: number;
}

/**
 * Resolve which behavior test files match a given scope.
 *
 * Scope formats:
 *   site:poker-zeno                   → all tests/behavior/*.behavior.ts for that site
 *   site:poker-zeno feature:play      → tests/behavior/play.behavior.ts
 *   changed-since:HEAD~1              → infer from git diff
 */
export function resolveScope(scope: RunScope, cwd: string): string[] {
  const parts = scope.split(' ');
  const siteEntry = parts.find(p => p.startsWith('site:'));
  const featureEntry = parts.find(p => p.startsWith('feature:'));
  const changedEntry = parts.find(p => p.startsWith('changed-since:'));

  if (changedEntry) {
    const ref = changedEntry.replace('changed-since:', '');
    try {
      const changed = execSync(`git diff --name-only ${ref}`, { cwd, encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
      return inferTestsFromChangedFiles(changed, cwd);
    } catch {
      // Fall back to all tests
      return globBehaviorTests(cwd);
    }
  }

  if (siteEntry) {
    const siteName = siteEntry.replace('site:', '');
    const siteDir = path.resolve(cwd, '..', siteName);
    if (!fs.existsSync(siteDir)) return [];

    const behaviorDir = path.join(siteDir, 'tests', 'behavior');
    if (!fs.existsSync(behaviorDir)) return [];

    if (featureEntry) {
      const feature = featureEntry.replace('feature:', '');
      const specific = path.join(behaviorDir, `${feature}.behavior.ts`);
      return fs.existsSync(specific) ? [specific] : [];
    }

    return globBehaviorTests(siteDir);
  }

  return globBehaviorTests(cwd);
}

function globBehaviorTests(siteDir: string): string[] {
  const behaviorDir = path.join(siteDir, 'tests', 'behavior');
  if (!fs.existsSync(behaviorDir)) return [];
  return fs.readdirSync(behaviorDir)
    .filter(f => f.endsWith('.behavior.ts'))
    .map(f => path.join(behaviorDir, f));
}

/**
 * File-to-test mapping for changed-since scope.
 * Maps changed source files to the behavior tests that cover them.
 */
function inferTestsFromChangedFiles(changedFiles: string[], cwd: string): string[] {
  const behaviorDir = path.join(cwd, 'tests', 'behavior');
  if (!fs.existsSync(behaviorDir)) return [];

  const testFiles = new Set<string>();

  const mappings: Array<{ pattern: RegExp; test: string }> = [
    { pattern: /src\/app\/(?:page|layout)\.|src\/components\/home\//,    test: 'home.behavior.ts' },
    { pattern: /src\/engine\/|src\/app\/play\//,                         test: 'play.behavior.ts' },
    { pattern: /src\/content\/|src\/app\/publications\//,                test: 'publications.behavior.ts' },
    { pattern: /src\/components\/(?:layout|shell)\//,                    test: 'layout-contract.behavior.ts' },
    { pattern: /src\/components\//,                                      test: 'layout-contract.behavior.ts' },
  ];

  for (const file of changedFiles) {
    for (const { pattern, test: testFile } of mappings) {
      if (pattern.test(file)) {
        const full = path.join(behaviorDir, testFile);
        if (fs.existsSync(full)) testFiles.add(full);
      }
    }
  }

  // If nothing specific matched but something in src changed, run all
  const srcChanged = changedFiles.some(f => f.startsWith('src/'));
  if (srcChanged && testFiles.size === 0) {
    return globBehaviorTests(cwd);
  }

  return [...testFiles];
}

/**
 * Run the behavior suite for a given scope.
 * Invokes Playwright CLI and parses JSON reporter output.
 *
 * @param scope - Scope string
 * @param options.cwd - Working directory (site root)
 * @param options.ci - Whether running in CI mode
 * @param options.conductorUrl - Conductor API URL (optional, for posting results)
 */
export async function runBehaviorSuite(
  scope: string,
  options: { cwd?: string; ci?: boolean; conductorUrl?: string } = {}
): Promise<SuiteRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const startedAt = new Date().toISOString();

  const testFiles = resolveScope(scope as RunScope, cwd);

  if (testFiles.length === 0) {
    const endedAt = new Date().toISOString();
    console.log(`[behavior-suite] No tests matched scope: ${scope}`);
    return { scope, startedAt, endedAt, passed: 0, failed: 0, skipped: 0, results: [], exitCode: 0 };
  }

  const reporterPath = path.join(os.tmpdir(), `behavior-suite-${Date.now()}.json`);

  const playwrightArgs = [
    'playwright', 'test',
    '--config', 'playwright.behavior.config.ts',
    '--reporter', `json:${reporterPath}`,
    ...testFiles,
    ...(options.ci ? ['--forbid-only'] : []),
  ];

  console.log(`[behavior-suite] Running ${testFiles.length} behavior test file(s) for scope: ${scope}`);
  const result = spawnSync('npx', playwrightArgs, {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8',
    env: { ...process.env, CI: options.ci ? '1' : undefined },
  });

  const endedAt = new Date().toISOString();
  const exitCode = result.status ?? 1;

  const runResults: RunnerResult[] = [];

  if (fs.existsSync(reporterPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reporterPath, 'utf8')) as PlaywrightJSONReport;
      for (const suite of report.suites ?? []) {
        collectResults(suite, runResults);
      }
    } catch {
      // JSON parse failed — results not available
    }
    fs.unlinkSync(reporterPath);
  }

  const passed  = runResults.filter(r => r.status === 'pass').length;
  const failed  = runResults.filter(r => r.status === 'fail').length;
  const skipped = runResults.filter(r => r.status === 'skip').length;

  const suiteResult: SuiteRunResult = {
    scope, startedAt, endedAt, passed, failed, skipped,
    results: runResults, exitCode,
  };

  if (options.conductorUrl && runResults.length > 0) {
    try {
      await postResultsToConductor(options.conductorUrl, suiteResult);
    } catch (err) {
      console.warn('[behavior-suite] Could not post results to Conductor:', err);
    }
  }

  return suiteResult;
}

interface PlaywrightJSONReport {
  suites?: PlaywrightSuite[];
}

interface PlaywrightSuite {
  title: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  tests?: Array<{
    results?: Array<{
      status: string;
      duration: number;
      error?: { message?: string; stack?: string };
    }>;
  }>;
}

function collectResults(suite: PlaywrightSuite, out: RunnerResult[], feature = ''): void {
  const featureLabel = feature || suite.title;
  for (const spec of suite.specs ?? []) {
    const testResult = spec.tests?.[0]?.results?.[0];
    const status: RunnerResult['status'] =
      spec.ok ? 'pass'
      : testResult?.status === 'skipped' ? 'skip'
      : testResult?.status === 'flaky' ? 'flaky'
      : 'fail';

    out.push({
      feature: featureLabel,
      spec: spec.title,
      status,
      duration: testResult?.duration ?? 0,
      failureExcerpt: testResult?.error?.message?.slice(0, 500),
    });
  }
  for (const child of suite.suites ?? []) {
    collectResults(child, out, featureLabel);
  }
}

async function postResultsToConductor(
  conductorUrl: string,
  suiteResult: SuiteRunResult
): Promise<void> {
  const base = conductorUrl.replace(/\/$/, '');

  for (const r of suiteResult.results) {
    // Upsert the test definition
    const upsertRes = await fetch(`${base}/behavior-tests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: r.spec,
        feature: r.feature,
        scope: suiteResult.scope,
        expected_behavior: r.spec,
      }),
    });

    if (!upsertRes.ok) continue;
    const test = await upsertRes.json() as { id: string };

    // Record the run
    await fetch(`${base}/behavior-tests/${test.id}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: r.status,
        duration_ms: r.duration,
        failure_excerpt: r.failureExcerpt,
        run_at: suiteResult.startedAt,
      }),
    });
  }
}
