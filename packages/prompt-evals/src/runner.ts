/**
 * Runner — invokes the `promptfoo` CLI against each `evals/<agent>.yaml`
 * and aggregates the per-agent results into a single CI-friendly summary.
 *
 * We shell to `promptfoo eval --output <json> --config <yaml>` rather
 * than calling the JS API directly so the package keeps a thin contract
 * that survives Promptfoo major-version bumps. The JSON output schema
 * is stable across recent versions.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diffAgainstBaseline } from './baseline.js';
import { evalsDir } from './paths.js';
import type {
  AgentEvalResult,
  BaselineDiff,
  PromptfooTestResult,
  RunSummary
} from './types.js';

export interface RunOptions {
  /** Resolved evals dir; defaults to package's `evals/`. */
  readonly evalsDir?: string;
  /** Resolved baselines dir; defaults to package's `baselines/`. */
  readonly baselinesDir?: string;
  /** Subset of agent slugs to run; defaults to "all .yaml files". */
  readonly only?: readonly string[];
  /** Custom promptfoo binary path. Defaults to `promptfoo` on PATH. */
  readonly promptfooBin?: string;
}

interface PromptfooRawResult {
  results: {
    results: Array<{
      success: boolean;
      description?: string;
      response?: { error?: string };
      gradingResult?: { reason?: string };
    }>;
    stats: { successes: number; failures: number };
  };
}

function listAgentsFromYamls(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .sort();
}

function runOneAgent(
  agent: string,
  evalsDirArg: string,
  promptfooBin: string
): AgentEvalResult {
  const yamlPath = join(evalsDirArg, `${agent}.yaml`);
  if (!existsSync(yamlPath)) {
    throw new Error(`[prompt-evals] missing eval YAML: ${yamlPath}`);
  }
  const tmpRunDir = mkdtempSync(join(tmpdir(), 'promptfoo-run-'));
  const outputPath = join(tmpRunDir, 'result.json');

  // promptfoo writes its output JSON when --output ends in .json. We
  // run with --no-cache + a unique --output-path each invocation so
  // there's no cross-run contamination.
  const pkgRoot = join(evalsDirArg, '..');
  const proc = spawnSync(
    promptfooBin,
    ['eval', '--config', yamlPath, '--output', outputPath, '--no-cache', '--no-write', '--no-progress-bar', '--no-table'],
    {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: pkgRoot,
      env: {
        ...process.env,
        PROMPTFOO_DISABLE_TELEMETRY: '1',
        PROMPTFOO_DISABLE_UPDATE: '1',
        PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION: '1',
        PROMPTFOO_CONFIG_DIR: tmpRunDir
      }
    }
  );

  if (!existsSync(outputPath)) {
    throw new Error(
      `[prompt-evals] promptfoo did not produce ${outputPath}\n` +
        `stdout:\n${proc.stdout ?? ''}\nstderr:\n${proc.stderr ?? ''}`
    );
  }

  const raw = JSON.parse(readFileSync(outputPath, 'utf-8')) as PromptfooRawResult;
  const tests: PromptfooTestResult[] = raw.results.results.map((r, i) => {
    const failureReason = r.success
      ? undefined
      : r.gradingResult?.reason ?? r.response?.error ?? 'assertion failed';
    return failureReason !== undefined
      ? {
          testIdx: i,
          description: r.description ?? `test #${i}`,
          success: r.success,
          failureReason
        }
      : {
          testIdx: i,
          description: r.description ?? `test #${i}`,
          success: r.success
        };
  });
  const totalTests = tests.length;
  const passedTests = tests.filter((t) => t.success).length;
  const failedTests = totalTests - passedTests;
  const passRate = totalTests === 0 ? 1 : passedTests / totalTests;
  return {
    agent,
    evalPath: yamlPath,
    totalTests,
    passedTests,
    failedTests,
    passRate,
    results: tests
  };
}

export function runAll(opts: RunOptions = {}): RunSummary {
  const dir = opts.evalsDir ?? evalsDir();
  const promptfooBin = opts.promptfooBin ?? 'promptfoo';
  const startedAt = new Date().toISOString();

  const allAgents = listAgentsFromYamls(dir);
  const only = opts.only && opts.only.length > 0 ? new Set(opts.only) : null;
  const agents = only ? allAgents.filter((a) => only.has(a)) : allAgents;

  const perAgent: AgentEvalResult[] = [];
  for (const agent of agents) {
    perAgent.push(runOneAgent(agent, dir, promptfooBin));
  }

  const totalTests = perAgent.reduce((acc, r) => acc + r.totalTests, 0);
  const totalPassed = perAgent.reduce((acc, r) => acc + r.passedTests, 0);
  const totalFailed = perAgent.reduce((acc, r) => acc + r.failedTests, 0);
  const overallPassRate = totalTests === 0 ? 1 : totalPassed / totalTests;

  const baselineDiffs: BaselineDiff[] = perAgent.map((r) =>
    opts.baselinesDir
      ? diffAgainstBaseline(r, opts.baselinesDir)
      : diffAgainstBaseline(r)
  );
  const ok = baselineDiffs.every((d) => d.status !== 'regression');

  return {
    startedAt,
    endedAt: new Date().toISOString(),
    agentCount: perAgent.length,
    totalTests,
    totalPassed,
    totalFailed,
    overallPassRate,
    perAgent,
    baselineDiffs,
    ok
  };
}

/**
 * Test seam — exposes the dump path so tests can pre-stage a run JSON
 * file without invoking promptfoo. Keeps the runner unit-testable.
 */
export function _runOneAgentForTest(
  agent: string,
  evalsDirArg: string,
  outputJsonPath: string
): AgentEvalResult {
  const raw = JSON.parse(readFileSync(outputJsonPath, 'utf-8')) as PromptfooRawResult;
  const tests: PromptfooTestResult[] = raw.results.results.map((r, i) => {
    const failureReason = r.success
      ? undefined
      : r.gradingResult?.reason ?? r.response?.error ?? 'assertion failed';
    return failureReason !== undefined
      ? {
          testIdx: i,
          description: r.description ?? `test #${i}`,
          success: r.success,
          failureReason
        }
      : {
          testIdx: i,
          description: r.description ?? `test #${i}`,
          success: r.success
        };
  });
  const totalTests = tests.length;
  const passedTests = tests.filter((t) => t.success).length;
  const failedTests = totalTests - passedTests;
  const passRate = totalTests === 0 ? 1 : passedTests / totalTests;
  const yamlPath = join(evalsDirArg, `${agent}.yaml`);
  return {
    agent,
    evalPath: yamlPath,
    totalTests,
    passedTests,
    failedTests,
    passRate,
    results: tests
  };
}

/**
 * Helper used by both the runtime + tests: write the file under the
 * standard `<tmp>/result.json` location.
 */
export function _stageRawResultForTest(
  raw: PromptfooRawResult
): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'promptfoo-stage-'));
  const path = join(dir, 'result.json');
  writeFileSync(path, JSON.stringify(raw), 'utf-8');
  return { dir, path };
}
