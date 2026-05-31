/**
 * @caia/qa-engineer/agent
 *
 * Subagent driver: spawns Playwright against a production URL via a
 * pluggable {@link PlaywrightAdapter}, parses the run output into a
 * normalised {@link PlaywrightRunResult}, and surfaces required-spec
 * failures so the api layer can decide pass/fail + rollback severity.
 *
 * The real adapter (`createSpawnPlaywrightAdapter`) shells out to
 * `playwright test --reporter=json`; tests inject deterministic stubs.
 * This file is True-Zero (no real network in tests).
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  PlaywrightAdapter,
  PlaywrightRunPlan,
  PlaywrightRunResult,
  PlaywrightRunStatus,
  PlaywrightSpecResult,
  ProductionTarget,
} from './types.js';
import { buildPlaywrightEnv } from './test-strategy.js';

// ─── Plan construction ──────────────────────────────────────────────────────

export interface BuildRunPlanOptions {
  readonly specFiles: ReadonlyArray<string>;
  readonly mode?: 'local' | 'browserless';
  readonly timeoutMs?: number;
  readonly extraEnv?: Readonly<Record<string, string>>;
}

/**
 * Compose a {@link PlaywrightRunPlan} for a target + its resolved specs.
 * Defaults: 5-minute timeout, mode auto-detected from `BROWSERLESS_WS_ENDPOINT`.
 */
export function buildRunPlan(
  target: ProductionTarget,
  opts: BuildRunPlanOptions,
): PlaywrightRunPlan {
  const mode = opts.mode ?? (process.env['BROWSERLESS_WS_ENDPOINT'] ? 'browserless' : 'local');
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  return {
    target,
    specFiles: opts.specFiles,
    mode,
    timeoutMs,
    env: buildPlaywrightEnv(target, opts.extraEnv ?? {}),
  };
}

// ─── Spawn-based adapter (production) ───────────────────────────────────────

export interface SpawnAdapterOptions {
  /** Absolute path to the `playwright` binary. Default `npx playwright`. */
  readonly playwrightBin?: string;
  /** cwd for the spawn. Default `process.cwd()`. */
  readonly cwd?: string;
  /** Override the spawn impl (tests). */
  readonly spawnImpl?: typeof spawn;
  /** Override the FS impl (tests). */
  readonly readFile?: (p: string, enc: 'utf8') => Promise<string>;
  /** Where to put the JSON report file. Default `<os.tmpdir>/<uuid>.json`. */
  readonly resolveReportPath?: (plan: PlaywrightRunPlan) => string;
  /** Clock injection. */
  readonly clock?: () => Date;
}

/**
 * Real Playwright adapter. Shells out to `playwright test` with
 * `--reporter=json`, writes the report to a temp file, parses it, and
 * normalises into {@link PlaywrightRunResult}.
 *
 * In tests use {@link createStubPlaywrightAdapter} instead; this adapter
 * actually spawns a child process and would violate True-Zero.
 */
export function createSpawnPlaywrightAdapter(
  opts: SpawnAdapterOptions = {},
): PlaywrightAdapter {
  const spawnImpl = opts.spawnImpl ?? spawn;
  const readFile = opts.readFile ?? ((p, enc) => fs.readFile(p, enc));
  const clock = opts.clock ?? ((): Date => new Date());

  return {
    async run(plan: PlaywrightRunPlan): Promise<PlaywrightRunResult> {
      const startedAt = clock();
      const reportPath =
        opts.resolveReportPath?.(plan)
        ?? path.join(os.tmpdir(), `caia-qa-engineer-${plan.target.ticketId}-${startedAt.getTime()}.json`);

      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        ...plan.env,
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
      };

      const args = [
        'playwright',
        'test',
        '--reporter=json',
        ...plan.specFiles,
      ];
      const cwd = opts.cwd ?? process.cwd();
      const bin = opts.playwrightBin ?? 'npx';

      const exit = await spawnAndWait(spawnImpl, bin, args, { cwd, env, timeoutMs: plan.timeoutMs });
      const finishedAt = clock();

      const raw = await safeReadJson(readFile, reportPath);
      const specs = raw ? parsePlaywrightJson(raw, plan) : [];
      const requiredFailures = countRequiredFailures(specs);
      const status: PlaywrightRunStatus =
        exit.timedOut
          ? 'errored'
          : requiredFailures === 0 && exit.code === 0
            ? 'passed'
            : exit.code === 0
              ? 'failed'
              : 'failed';

      return {
        status,
        specs,
        requiredFailures,
        totalDurationMs: finishedAt.getTime() - startedAt.getTime(),
        mode: plan.mode,
        startedAtIso: startedAt.toISOString(),
        finishedAtIso: finishedAt.toISOString(),
      };
    },
  };
}

interface SpawnExit {
  readonly code: number;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
}

function spawnAndWait(
  spawnImpl: typeof spawn,
  bin: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<SpawnExit> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(bin, args, { cwd: opts.cwd, env: opts.env, stdio: 'inherit' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }, opts.timeoutMs);

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 1 : 0), signal, timedOut });
    });
  });
}

async function safeReadJson(
  readFile: (p: string, enc: 'utf8') => Promise<string>,
  p: string,
): Promise<unknown> {
  try {
    const text = await readFile(p, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── Stub adapter (tests) ───────────────────────────────────────────────────

export interface StubAdapterOptions {
  readonly result: PlaywrightRunResult;
  readonly delayMs?: number;
}

/**
 * Test-only adapter that returns a pre-computed {@link PlaywrightRunResult}.
 * Useful for asserting api.ts behaviour without spawning real browsers.
 */
export function createStubPlaywrightAdapter(
  opts: StubAdapterOptions,
): PlaywrightAdapter {
  return {
    async run(_plan: PlaywrightRunPlan): Promise<PlaywrightRunResult> {
      if (opts.delayMs && opts.delayMs > 0) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      return opts.result;
    },
  };
}

// ─── Playwright JSON parser ─────────────────────────────────────────────────

/**
 * Parse the `playwright test --reporter=json` output schema into our
 * normalised {@link PlaywrightSpecResult} list.
 *
 * The schema (Playwright 1.59.x):
 *
 *   { suites: Array<{
 *       title, file, specs: Array<{
 *         id, title, ok, tests: Array<{
 *           status, results: Array<{
 *             status: 'passed'|'failed'|'timedOut'|'skipped'|'interrupted',
 *             duration: number, error?: { message }
 *           }>,
 *           expectedStatus, annotations: Array<{ type, description }>
 *         }>
 *       }>,
 *       suites?: SubSuites[]
 *     }>
 *   }
 *
 * Spec is "required" by default (Playwright doesn't natively mark
 * required-ness); we lower from `plan.target.labels.required-specs`
 * (a comma-separated id list) if present. Anything not in that list is
 * still considered required by default — the conservative choice for a
 * production verifier.
 */
export function parsePlaywrightJson(
  raw: unknown,
  plan: PlaywrightRunPlan,
): ReadonlyArray<PlaywrightSpecResult> {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as { suites?: unknown };
  const suites = Array.isArray(root.suites) ? root.suites : [];
  const requiredIds = parseRequiredIds(plan.target.labels?.['required-specs']);
  const out: PlaywrightSpecResult[] = [];
  for (const suite of suites) {
    collectSpecs(suite, out, requiredIds);
  }
  return out;
}

function collectSpecs(
  suiteUnknown: unknown,
  acc: PlaywrightSpecResult[],
  requiredIds: ReadonlySet<string> | null,
): void {
  if (!suiteUnknown || typeof suiteUnknown !== 'object') return;
  const suite = suiteUnknown as {
    title?: unknown;
    file?: unknown;
    specs?: unknown;
    suites?: unknown;
  };
  const file = typeof suite.file === 'string' ? suite.file : 'unknown.spec.ts';
  if (Array.isArray(suite.specs)) {
    for (const specRaw of suite.specs) {
      const spec = normaliseSpec(specRaw, file, requiredIds);
      if (spec) acc.push(spec);
    }
  }
  if (Array.isArray(suite.suites)) {
    for (const sub of suite.suites) collectSpecs(sub, acc, requiredIds);
  }
}

function normaliseSpec(
  specRaw: unknown,
  file: string,
  requiredIds: ReadonlySet<string> | null,
): PlaywrightSpecResult | null {
  if (!specRaw || typeof specRaw !== 'object') return null;
  const spec = specRaw as {
    id?: unknown;
    title?: unknown;
    line?: unknown;
    tests?: unknown;
  };
  const specId =
    typeof spec.id === 'string' && spec.id.length > 0
      ? spec.id
      : typeof spec.title === 'string'
        ? `${file}::${spec.title}`
        : `${file}::unknown`;
  const title = typeof spec.title === 'string' ? spec.title : specId;
  const line = typeof spec.line === 'number' ? spec.line : undefined;
  const required =
    requiredIds === null ? true : requiredIds.has(specId);

  const tests = Array.isArray(spec.tests) ? spec.tests : [];
  let durationMs = 0;
  let retries = 0;
  let status: PlaywrightSpecResult['status'] = 'skipped';
  let errorMessage: string | undefined;
  for (const t of tests) {
    if (!t || typeof t !== 'object') continue;
    const test = t as { results?: unknown };
    const results = Array.isArray(test.results) ? test.results : [];
    for (const r of results) {
      if (!r || typeof r !== 'object') continue;
      const res = r as { status?: unknown; duration?: unknown; error?: unknown };
      const d = typeof res.duration === 'number' ? res.duration : 0;
      durationMs += d;
      retries += 1;
      const rStatus = typeof res.status === 'string' ? res.status : 'unknown';
      const mapped = mapPlaywrightStatus(rStatus);
      if (mapped === 'failed' || mapped === 'errored') {
        status = mapped;
        const err = res.error as { message?: unknown } | undefined;
        if (err && typeof err.message === 'string') {
          errorMessage = err.message;
        }
      } else if (mapped === 'flaky') {
        if (status === 'skipped') status = 'flaky';
      } else if (mapped === 'passed') {
        if (status === 'skipped') status = 'passed';
      }
    }
  }

  const result: PlaywrightSpecResult = {
    specId,
    title,
    file,
    status,
    durationMs,
    required,
  };
  if (line !== undefined) (result as { line?: number }).line = line;
  if (retries > 1) (result as { retries?: number }).retries = retries;
  if (errorMessage !== undefined) (result as { errorMessage?: string }).errorMessage = errorMessage;
  return result;
}

function mapPlaywrightStatus(s: string): PlaywrightSpecResult['status'] {
  switch (s) {
    case 'passed': return 'passed';
    case 'failed': return 'failed';
    case 'timedOut': return 'errored';
    case 'interrupted': return 'errored';
    case 'skipped': return 'skipped';
    case 'flaky': return 'flaky';
    default: return 'errored';
  }
}

function parseRequiredIds(value: string | undefined): ReadonlySet<string> | null {
  if (!value) return null;
  const ids = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (ids.length === 0) return null;
  return new Set(ids);
}

export function countRequiredFailures(
  specs: ReadonlyArray<PlaywrightSpecResult>,
): number {
  let n = 0;
  for (const s of specs) {
    if (s.required && (s.status === 'failed' || s.status === 'errored')) n += 1;
  }
  return n;
}
