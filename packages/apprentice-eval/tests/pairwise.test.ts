import { describe, expect, it } from 'vitest';

import { aggregate } from '../src/pairwise.js';
import type { BaselineSnapshot, RubricResult } from '../src/types.js';

function rr(promptId: string, suiteId: string, score: number, adapter = 'base'): RubricResult {
  return {
    promptId,
    suiteId,
    adapter,
    passed: score >= 0.5 ? 1 : 0,
    failed: score >= 0.5 ? 0 : 1,
    weightedScore: score,
    assertions: []
  };
}

describe('aggregate — pairwise classification', () => {
  it('classifies wins / losses / ties using tieEpsilon', () => {
    const base = [rr('p1', 's', 0.5), rr('p2', 's', 0.8), rr('p3', 's', 0.2)];
    const adapter = [
      rr('p1', 's', 0.9, 'a'), // win
      rr('p2', 's', 0.79, 'a'), // tie (within 0.05)
      rr('p3', 's', 0.0, 'a') // loss
    ];
    const { winrate, pairwise } = aggregate({
      base,
      adapter,
      adapterName: 'a',
      tieEpsilon: 0.05,
      winRateThreshold: 0.6,
      forgettingThreshold: 0.1
    });
    expect(winrate.wins).toBe(1);
    expect(winrate.losses).toBe(1);
    expect(winrate.ties).toBe(1);
    expect(winrate.winRate).toBeCloseTo(0.5);
    expect(pairwise.map((p) => p.outcome)).toEqual(['win', 'tie', 'loss']);
  });

  it('returns NaN winRate when no decisive prompts', () => {
    const base = [rr('p1', 's', 0.5)];
    const adapter = [rr('p1', 's', 0.51, 'a')]; // tie within epsilon
    const { winrate } = aggregate({
      base,
      adapter,
      adapterName: 'a',
      tieEpsilon: 0.05,
      winRateThreshold: 0.6,
      forgettingThreshold: 0.1
    });
    expect(Number.isNaN(winrate.winRate)).toBe(true);
    expect(winrate.decision).toBe('reject-no-data');
  });

  it('skips prompts the base never saw', () => {
    const base = [rr('p1', 's', 0.5)];
    const adapter = [rr('p1', 's', 1.0, 'a'), rr('p2', 's', 1.0, 'a')];
    const { winrate, pairwise } = aggregate({
      base,
      adapter,
      adapterName: 'a',
      tieEpsilon: 0.05,
      winRateThreshold: 0.6,
      forgettingThreshold: 0.1
    });
    expect(pairwise).toHaveLength(1);
    expect(winrate.wins).toBe(1);
  });

  it('decides promote-canary when winRate ≥ threshold and no regressions', () => {
    const base = [rr('p1', 's', 0.4), rr('p2', 's', 0.4)];
    const adapter = [rr('p1', 's', 0.9, 'a'), rr('p2', 's', 0.9, 'a')];
    const { winrate } = aggregate({
      base,
      adapter,
      adapterName: 'a',
      tieEpsilon: 0.05,
      winRateThreshold: 0.6,
      forgettingThreshold: 0.1
    });
    expect(winrate.decision).toBe('promote-canary');
  });

  it('rejects on winrate when below threshold', () => {
    const base = [rr('p1', 's', 0.4), rr('p2', 's', 0.4)];
    const adapter = [rr('p1', 's', 0.9, 'a'), rr('p2', 's', 0.0, 'a')];
    const { winrate } = aggregate({
      base,
      adapter,
      adapterName: 'a',
      tieEpsilon: 0.05,
      winRateThreshold: 0.6,
      forgettingThreshold: 0.1
    });
    expect(winrate.winRate).toBe(0.5);
    expect(winrate.decision).toBe('reject-winrate');
  });

  it('flags + rejects on regression vs baseline', () => {
    const base = [rr('p1', 's', 0.5), rr('p2', 's', 0.5)];
    const adapter = [rr('p1', 's', 1.0, 'a'), rr('p2', 's', 0.1, 'a')];
    const baseline: BaselineSnapshot = {
      version: 1,
      adapter: 'a',
      recordedAt: '2026-05-06T00:00:00.000Z',
      entries: [
        { promptId: 'p1', suiteId: 's', weightedScore: 0.5, recordedAt: '2026-05-06T00:00:00.000Z' },
        { promptId: 'p2', suiteId: 's', weightedScore: 0.5, recordedAt: '2026-05-06T00:00:00.000Z' }
      ]
    };
    const { winrate } = aggregate({
      base,
      adapter,
      adapterName: 'a',
      tieEpsilon: 0.05,
      winRateThreshold: 0.6,
      forgettingThreshold: 0.1,
      baseline
    });
    expect(winrate.regressions).toHaveLength(1);
    expect(winrate.regressions[0]!.promptId).toBe('p2');
    expect(winrate.regressions[0]!.delta).toBeLessThan(-0.1);
    expect(winrate.decision).toBe('reject-regression');
  });

  it('does not penalise prompts the baseline never passed', () => {
    const base = [rr('p1', 's', 0.5)];
    const adapter = [rr('p1', 's', 0.0, 'a')];
    const baseline: BaselineSnapshot = {
      version: 1,
      adapter: 'a',
      recordedAt: '2026-05-06T00:00:00.000Z',
      entries: [
        { promptId: 'p1', suiteId: 's', weightedScore: 0, recordedAt: '2026-05-06T00:00:00.000Z' }
      ]
    };
    const { winrate } = aggregate({
      base,
      adapter,
      adapterName: 'a',
      tieEpsilon: 0.05,
      winRateThreshold: 0.6,
      forgettingThreshold: 0.1,
      baseline
    });
    expect(winrate.regressions).toHaveLength(0);
  });

  it('computes suitePassRate based on weightedScore ≥ 0.5', () => {
    const base = [rr('p1', 's', 0.0), rr('p2', 's', 0.0), rr('p3', 's', 0.0)];
    const adapter = [
      rr('p1', 's', 0.9, 'a'),
      rr('p2', 's', 0.6, 'a'),
      rr('p3', 's', 0.2, 'a')
    ];
    const { winrate } = aggregate({
      base,
      adapter,
      adapterName: 'a',
      tieEpsilon: 0.05,
      winRateThreshold: 0.6,
      forgettingThreshold: 0.1
    });
    expect(winrate.suitePassRate).toBeCloseTo(2 / 3);
  });
});
