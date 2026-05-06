/**
 * Baseline tracking — read/write `baselines/<agent>.json` and compute
 * per-agent diffs against the latest run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { baselinesDir } from './paths.js';
import type { AgentBaseline, AgentEvalResult, BaselineDiff } from './types.js';

const DEFAULT_REGRESSION_TOLERANCE = 0.05;

export function baselinePath(agent: string, dir: string = baselinesDir()): string {
  return join(dir, `${agent}.json`);
}

export function loadBaseline(
  agent: string,
  dir: string = baselinesDir()
): AgentBaseline | null {
  const path = baselinePath(agent, dir);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as AgentBaseline;
  return parsed;
}

export function writeBaseline(
  result: AgentEvalResult,
  dir: string = baselinesDir(),
  regressionTolerance: number = DEFAULT_REGRESSION_TOLERANCE
): AgentBaseline {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const baseline: AgentBaseline = {
    agent: result.agent,
    passRate: result.passRate,
    totalTests: result.totalTests,
    recordedAt: new Date().toISOString(),
    regressionTolerance
  };
  writeFileSync(baselinePath(result.agent, dir), JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
  return baseline;
}

export function diffAgainstBaseline(
  result: AgentEvalResult,
  dir: string = baselinesDir()
): BaselineDiff {
  const baseline = loadBaseline(result.agent, dir);
  if (!baseline) {
    return {
      agent: result.agent,
      baseline: null,
      current: result,
      status: 'no-baseline',
      delta: 0
    };
  }
  const delta = result.passRate - baseline.passRate;
  let status: BaselineDiff['status'];
  if (delta < -baseline.regressionTolerance) {
    status = 'regression';
  } else if (delta > baseline.regressionTolerance) {
    status = 'improved';
  } else {
    status = 'within-tolerance';
  }
  return { agent: result.agent, baseline, current: result, status, delta };
}
