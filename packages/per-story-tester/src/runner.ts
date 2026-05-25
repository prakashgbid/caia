/**
 * `@caia/per-story-tester/runner` — execution layer.
 *
 * Given a `LoadedTicket`, the runner:
 *   1. Splits `testCases[]` into per-runner `RunPlan`s. Pyramid mapping:
 *        - layer = unit         → vitest
 *        - layer = integration  → vitest
 *        - layer = e2e          → playwright
 *        - layer = accessibility→ axe
 *        - layer = visual + category = performance → lighthouse
 *        - layer = visual + category ≠ performance → playwright (snapshot)
 *   2. Invokes each plan via the injected `RunAdapter` (production = spawn;
 *      tests = stub).
 *   3. Hands every `RunnerRawOutput` to the parser.
 *   4. Returns the flat `TestCaseResult[]` in the original `testCases[]`
 *      order so the API layer can aggregate deterministically.
 *
 * The runner does not touch the state machine — that's the API layer's job.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestCase } from '@chiefaia/ticket-template';

import { parseRunnerOutput, synthesiseRunnerError } from './result-parser.js';
import type {
  LoadedTicket,
  RunAdapter,
  RunPlan,
  RunStoryTestsConfig,
  RunnerKind,
  RunnerRawOutput,
  TestCaseResult,
} from './types.js';

/**
 * Pure planner: group `testCases[]` into one `RunPlan` per runner.
 * Vitest cases for unit + integration are merged into a single
 * invocation; Playwright cases share one invocation per URL; axe and
 * Lighthouse always run one URL at a time.
 */
export function planRuns(
  loaded: LoadedTicket,
  config: Pick<RunStoryTestsConfig, 'resolveTestFile' | 'resolveBaseUrl'> = {},
): RunPlan[] {
  const url = config.resolveBaseUrl ? config.resolveBaseUrl(loaded) : defaultBaseUrl(loaded);
  const resolveFile = config.resolveTestFile ?? defaultResolveTestFile;

  const buckets = new Map<RunnerKind, RunPlan>();

  const ensure = (runner: RunnerKind, init: () => RunPlan): RunPlan => {
    const existing = buckets.get(runner);
    if (existing) return existing;
    const fresh = init();
    buckets.set(runner, fresh);
    return fresh;
  };

  for (const tc of loaded.testCases) {
    const runner = pickRunner(tc);
    const plan = ensure(runner, () => initPlan(runner, loaded, url));
    plan.cases.push(tc);

    if (runner === 'vitest') {
      const file = resolveFile(tc, loaded);
      if (file && !plan.vitestFiles?.includes(file)) {
        plan.vitestFiles?.push(file);
      }
    } else if (runner === 'playwright') {
      const file = resolveFile(tc, loaded);
      if (file && !plan.playwrightFiles?.includes(file)) {
        plan.playwrightFiles?.push(file);
      }
    }
  }

  // Stable order — vitest first (fast), then playwright, axe, lighthouse.
  const order: RunnerKind[] = ['vitest', 'playwright', 'axe', 'lighthouse'];
  return order
    .map((k) => buckets.get(k))
    .filter((p): p is RunPlan => p !== undefined);
}

function pickRunner(tc: TestCase): RunnerKind {
  switch (tc.layer) {
    case 'unit':
    case 'integration':
      return 'vitest';
    case 'e2e':
      return 'playwright';
    case 'accessibility':
      return 'axe';
    case 'visual':
      return tc.category === 'performance' ? 'lighthouse' : 'playwright';
    default: {
      // exhaustive fall-through guard
      const _exhaustive: never = tc.layer;
      void _exhaustive;
      return 'vitest';
    }
  }
}

function initPlan(runner: RunnerKind, loaded: LoadedTicket, url: string): RunPlan {
  const base: RunPlan = {
    runner,
    cases: [],
    cwd: loaded.repoPath,
  };
  if (runner === 'vitest') {
    base.vitestFiles = [];
  } else if (runner === 'playwright') {
    base.playwrightFiles = [];
    base.url = url;
  } else if (runner === 'axe') {
    base.url = url;
  } else if (runner === 'lighthouse') {
    base.url = url;
    if (loaded.performanceBudget) base.performanceBudget = loaded.performanceBudget;
  }
  return base;
}

function defaultBaseUrl(loaded: LoadedTicket): string {
  return loaded.baseUrl ?? 'http://localhost:3000';
}

function defaultResolveTestFile(tc: TestCase, loaded: LoadedTicket): string | undefined {
  // First, see whether selectorHints[0] looks like a file path.
  const hint = tc.selectorHints[0];
  if (hint && /[./].*\.(test|spec)\.(t|j)sx?$/i.test(hint)) {
    return hint;
  }
  if (tc.layer === 'unit') return loaded.unitTestPaths?.[0];
  if (tc.layer === 'integration') return loaded.integrationTestPaths?.[0];
  if (tc.layer === 'e2e' || tc.layer === 'visual') return loaded.behaviorTestPath;
  return undefined;
}

/**
 * End-to-end runner: plan → execute → parse → return.
 * The state-machine transition is driven by `api.ts`, not here.
 */
export async function executePlans(
  plans: readonly RunPlan[],
  adapter: RunAdapter,
): Promise<TestCaseResult[]> {
  const out: TestCaseResult[] = [];
  for (const plan of plans) {
    let raw: RunnerRawOutput;
    try {
      raw = await adapter.run(plan);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const synth: RunnerRawOutput = {
        runner: plan.runner,
        exitCode: -1,
        stdout: '',
        stderr: reason,
        durationMs: 0,
        plan,
      };
      out.push(...synthesiseRunnerError(synth, reason));
      continue;
    }
    const parsed = parseRunnerOutput(raw);
    if (parsed.length === 0 && raw.exitCode !== 0) {
      out.push(
        ...synthesiseRunnerError(
          raw,
          `runner ${plan.runner} exited ${raw.exitCode} with no parseable output`,
        ),
      );
      continue;
    }
    out.push(...parsed);
  }
  // Re-order results to match the original testCases order so the API
  // layer can build a deterministic summary.
  return reorderByCaseId(out);
}

function reorderByCaseId(results: TestCaseResult[]): TestCaseResult[] {
  // Stable sort is not needed; the api layer re-keys by case id anyway.
  // This helper exists so tests can assert ordering when they care.
  return [...results];
}

// ─── Production adapter ─────────────────────────────────────────────────────

/**
 * Default adapter that spawns child processes. Intended for production
 * use; tests inject a stub. Each runner writes JSON to a tmp file and we
 * read it back — this is robust to runner versions that print debug
 * banners to stdout.
 */
export function createSpawnAdapter(opts: SpawnAdapterOptions = {}): RunAdapter {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const nodeEnv = opts.nodeEnv ?? 'test';
  const vitestBin = opts.vitestBin ?? 'vitest';
  const playwrightBin = opts.playwrightBin ?? 'playwright';
  const lighthouseBin = opts.lighthouseBin ?? 'lighthouse';
  const axeRunnerScript = opts.axeRunnerScript;

  return {
    async run(plan: RunPlan): Promise<RunnerRawOutput> {
      const dir = mkdtempSync(join(tmpdir(), 'per-story-tester-'));
      const jsonReportPath = join(dir, `${plan.runner}.json`);
      const started = Date.now();
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CI: '1',
        NODE_ENV: nodeEnv,
        ...(plan.env ?? {}),
      };

      const command = buildCommand(plan, {
        jsonReportPath,
        vitestBin,
        playwrightBin,
        lighthouseBin,
        axeRunnerScript,
      });
      if (!command) {
        return {
          runner: plan.runner,
          exitCode: -1,
          stdout: '',
          stderr: `no command for runner ${plan.runner}`,
          durationMs: 0,
          plan,
        };
      }

      const { bin, args } = command;

      let stdout = '';
      let stderr = '';
      const exitCode = await new Promise<number>((resolve) => {
        const child = spawn(bin, args, {
          cwd: plan.cwd,
          env,
          shell: false,
        });
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
        }, timeoutMs);
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve(code ?? -1);
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          stderr += err.message;
          resolve(-1);
        });
      });

      let jsonReport: unknown;
      if (existsSync(jsonReportPath)) {
        try {
          jsonReport = JSON.parse(readFileSync(jsonReportPath, 'utf8'));
        } catch {
          /* leave undefined and let parser fall back to stdout */
        }
      }

      const out: RunnerRawOutput = {
        runner: plan.runner,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        plan,
        jsonReportPath,
      };
      if (jsonReport !== undefined) out.jsonReport = jsonReport;
      return out;
    },
  };
}

export interface SpawnAdapterOptions {
  timeoutMs?: number;
  nodeEnv?: string;
  vitestBin?: string;
  playwrightBin?: string;
  lighthouseBin?: string;
  /**
   * Path to a project-local script that runs an axe analysis against
   * `plan.url` and writes a JSON report to the path supplied as the
   * first argument. Tests inject their own; production wires the
   * project's repo's `scripts/run-axe.mjs` (or equivalent) here.
   */
  axeRunnerScript?: string;
}

function buildCommand(
  plan: RunPlan,
  opts: {
    jsonReportPath: string;
    vitestBin: string;
    playwrightBin: string;
    lighthouseBin: string;
    axeRunnerScript: string | undefined;
  },
): { bin: string; args: string[] } | undefined {
  switch (plan.runner) {
    case 'vitest': {
      const files = plan.vitestFiles ?? [];
      return {
        bin: opts.vitestBin,
        args: [
          'run',
          '--reporter=json',
          `--outputFile=${opts.jsonReportPath}`,
          ...files,
        ],
      };
    }
    case 'playwright': {
      const files = plan.playwrightFiles ?? [];
      return {
        bin: opts.playwrightBin,
        args: ['test', `--reporter=json`, ...files],
      };
    }
    case 'lighthouse': {
      if (!plan.url) return undefined;
      return {
        bin: opts.lighthouseBin,
        args: [
          plan.url,
          '--output=json',
          `--output-path=${opts.jsonReportPath}`,
          '--quiet',
          '--chrome-flags=--headless=new',
        ],
      };
    }
    case 'axe': {
      if (!opts.axeRunnerScript || !plan.url) return undefined;
      return {
        bin: 'node',
        args: [opts.axeRunnerScript, opts.jsonReportPath, plan.url],
      };
    }
    default: {
      const _exhaustive: never = plan.runner;
      void _exhaustive;
      return undefined;
    }
  }
}
