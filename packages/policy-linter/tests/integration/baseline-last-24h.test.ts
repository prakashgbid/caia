/**
 * Integration test — run the 7 default policies against every task brief
 * touched in the last 24h under `~/Documents/projects/agent-memory/` and
 * surface the baseline violation rate per policy.
 *
 * This test does NOT gate (it is a baseline metric, not an assertion). It
 * passes as long as the linter runs without crashing across every input.
 *
 * The output is captured in console.log so CI / local runs see the baseline.
 * If `POLICY_LINTER_BASELINE_OUT` is set, the metrics are also written to
 * that path as JSON for downstream tooling.
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPolicies } from '../../src/index.js';
import { PolicyEngine } from '../../src/policy-engine.js';
import type { DispatchContext } from '../../src/types.js';

const MEMORY_DIR = join(homedir(), 'Documents', 'projects', 'agent-memory');
const WINDOW_MS = 24 * 60 * 60 * 1000;

async function listRecentBriefs(dir: string, since: Date): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const p = join(dir, name);
    let s;
    try {
      s = await stat(p);
    } catch {
      continue;
    }
    if (s.isFile() && s.mtimeMs >= since.getTime()) out.push(p);
  }
  return out;
}

interface Baseline {
  briefsScanned: number;
  perPolicy: Record<string, { fails: number; passes: number }>;
  worstByBrief: Array<{ brief: string; worst: string; violationCount: number }>;
}

describe('integration: baseline violation rate over last 24h briefs', () => {
  it('runs the linter across recent briefs without crashing', async () => {
    const since = new Date(Date.now() - WINDOW_MS);
    const briefs = await listRecentBriefs(MEMORY_DIR, since);
    const engine = new PolicyEngine(defaultPolicies);
    const baseline: Baseline = {
      briefsScanned: briefs.length,
      perPolicy: {},
      worstByBrief: []
    };
    for (const p of defaultPolicies) {
      baseline.perPolicy[p.id] = { fails: 0, passes: 0 };
    }

    for (const briefPath of briefs) {
      let briefMd = '';
      try {
        briefMd = await readFile(briefPath, 'utf8');
      } catch {
        continue;
      }
      const ctx: DispatchContext = {
        callerAgentId: 'integration-baseline',
        briefMd,
        toolList: [],
        estimatedTokens: 0,
        estimatedCost: 0,
        targetRepos: ['caia'],
        intent: 'build',
        metadata: { eaGateGracePeriod: true, dodBootstrapExempt: true }
      };
      const report = await engine.run(ctx);
      baseline.worstByBrief.push({
        brief: briefPath.replace(`${homedir()}/`, '~/'),
        worst: report.worstOutcome,
        violationCount: report.violationCount
      });
      for (const r of report.results) {
        const bucket = baseline.perPolicy[r.policyId];
        if (!bucket) continue;
        if (r.verdict.ok) bucket.passes++;
        else bucket.fails++;
      }
    }

    // Always log so the baseline is visible in CI output.
    // eslint-disable-next-line no-console
    console.log('[policy-linter baseline]', JSON.stringify(baseline, null, 2));

    const outPath = process.env['POLICY_LINTER_BASELINE_OUT'];
    if (outPath) {
      await writeFile(outPath, JSON.stringify(baseline, null, 2), 'utf8');
    }

    // The only assertion: the engine itself did not crash. Baseline metric
    // can be anything — including 100% failure rate (which is the point:
    // before this PR lands, briefs were not validated).
    expect(baseline.briefsScanned).toBeGreaterThanOrEqual(0);
    expect(Object.keys(baseline.perPolicy)).toHaveLength(defaultPolicies.length);
  });
});
