import { describe, expect, it } from 'vitest';

import {
  __TEST_ONLY,
  buildScoreCards,
  buildSummaryMd,
  buildWinrateReport,
  writeRunReport
} from '../src/report-writer.js';
import type {
  AdapterWinrate,
  GenerateResult,
  PairwiseResult,
  RubricResult,
  RunConfigSnapshot
} from '../src/types.js';
import { InMemoryFs } from './helpers/fakes.js';

const baseGen: GenerateResult = { output: 'x', elapsedMs: 1, model: 'm', provider: 'fake' };

function rr(promptId: string, score: number, adapter: string): RubricResult {
  return {
    promptId,
    suiteId: 's',
    adapter,
    passed: score >= 0.5 ? 1 : 0,
    failed: score >= 0.5 ? 0 : 1,
    weightedScore: score,
    assertions: []
  };
}

describe('buildSummaryMd', () => {
  it('produces a markdown header + table with each adapter row', () => {
    const baseR = rr('p1', 0.6, 'base');
    const adapter: AdapterWinrate = {
      adapter: 'a',
      wins: 1,
      losses: 0,
      ties: 0,
      winRate: 1.0,
      suitePassRate: 1.0,
      regressions: [],
      decision: 'promote-canary'
    };
    const pairwise: PairwiseResult = {
      promptId: 'p1',
      suiteId: 's',
      adapter: 'a',
      baseScore: 0.6,
      adapterScore: 1,
      outcome: 'win',
      delta: 0.4
    };
    const md = buildSummaryMd({
      generatedAt: '2026-05-06',
      baseModel: 'm',
      base: { adapter: 'base', results: [baseR], outputs: [{ result: baseR, gen: baseGen }] },
      adapters: [
        {
          adapter: 'a',
          results: [rr('p1', 1, 'a')],
          outputs: [{ result: rr('p1', 1, 'a'), gen: baseGen }],
          pairwise: [pairwise],
          winrate: adapter
        }
      ]
    });
    expect(md).toMatch(/^# Apprentice eval run/);
    expect(md).toContain('| (base)');
    expect(md).toContain('| a |');
    expect(md).toContain('promote to canary');
    expect(md).toContain('Top wins (a over base)');
  });

  it('handles 0-adapter case', () => {
    const baseR = rr('p1', 0.5, 'base');
    const md = buildSummaryMd({
      generatedAt: '2026-05-06',
      baseModel: 'm',
      base: { adapter: 'base', results: [baseR], outputs: [{ result: baseR, gen: baseGen }] },
      adapters: []
    });
    expect(md).toContain('No adapters scored');
  });
});

describe('buildScoreCards', () => {
  it('flattens base + each adapter outputs', () => {
    const r = rr('p1', 1, 'base');
    const cards = buildScoreCards({
      generatedAt: 't',
      base: { adapter: 'base', results: [r], outputs: [{ result: r, gen: baseGen }] },
      adapters: [
        {
          adapter: 'a',
          results: [rr('p1', 0.8, 'a')],
          outputs: [{ result: rr('p1', 0.8, 'a'), gen: baseGen }],
          pairwise: [],
          winrate: { adapter: 'a', wins: 0, losses: 0, ties: 0, winRate: NaN, suitePassRate: 0, regressions: [], decision: 'reject-no-data' }
        }
      ]
    });
    expect(cards.entries).toHaveLength(2);
    expect(cards.version).toBe(1);
  });
});

describe('buildWinrateReport', () => {
  it('reports base suitePassRate + adapter winrates', () => {
    const baseR = rr('p1', 1, 'base');
    const wr = buildWinrateReport({
      generatedAt: 't',
      baseModel: 'm',
      base: { adapter: 'base', results: [baseR], outputs: [{ result: baseR, gen: baseGen }] },
      adapters: [
        {
          adapter: 'a',
          results: [rr('p1', 0.5, 'a')],
          outputs: [],
          pairwise: [],
          winrate: { adapter: 'a', wins: 0, losses: 0, ties: 0, winRate: NaN, suitePassRate: 0, regressions: [], decision: 'reject-no-data' }
        }
      ]
    });
    expect(wr.base.suitePassRate).toBe(1);
    expect(wr.adapters).toHaveLength(1);
  });
});

describe('writeRunReport', () => {
  it('emits all expected files', async () => {
    const fs = new InMemoryFs();
    const cfg: RunConfigSnapshot = {
      baseModel: 'm',
      adapters: [],
      suiteIds: ['s'],
      winRateThreshold: 0.6,
      forgettingThreshold: 0.1,
      judgeEnabled: false,
      judgeBudget: 0,
      seed: 1,
      tieEpsilon: 0.05
    };
    const baseR = rr('p1', 1, 'base');
    const out = await writeRunReport({
      outputDir: '/run',
      generatedAt: '2026-05-06',
      config: cfg,
      base: { adapter: 'base', results: [baseR], outputs: [{ result: baseR, gen: baseGen }] },
      adapters: [],
      writer: fs
    });
    expect(out.scoreCardsPath).toBe('/run/score-cards.json');
    expect(out.winrateReportPath).toBe('/run/winrate-report.json');
    expect(out.summaryPath).toBe('/run/summary.md');
    expect(out.configPath).toBe('/run/config.json');
    expect(fs.files.has('/run/outputs/base/s/p1.json')).toBe(true);
  });
});

describe('helpers', () => {
  it('fmtPct handles NaN', () => {
    expect(__TEST_ONLY.fmtPct(NaN)).toBe('n/a');
    expect(__TEST_ONLY.fmtPct(0.5)).toBe('50.0%');
  });
  it('suitePassRateForBase: empty → 0', () => {
    expect(__TEST_ONLY.suitePassRateForBase([])).toBe(0);
  });
});
