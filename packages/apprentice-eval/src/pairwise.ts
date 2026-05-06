/**
 * pairwise — winrate aggregator + regression detector.
 *
 * Per DESIGN.md §7b (winrate) + §7c (regression detection).
 *
 * winRate(adapter) := wins / (wins + losses)        # ties excluded
 *
 * regressionFlag fires when:
 *   - the candidate's score on a prompt drops by > forgettingThreshold
 *     compared to that prompt's stored baseline score
 *   - the baseline existed and was non-zero (we don't penalise prompts
 *     that the baseline never passed in the first place)
 */

import type {
  AdapterWinrate,
  BaselineSnapshot,
  PairwiseOutcome,
  PairwiseResult,
  RegressionFlag,
  RubricResult
} from './types.js';

export interface AggregateOpts {
  readonly base: ReadonlyArray<RubricResult>;
  readonly adapter: ReadonlyArray<RubricResult>;
  readonly adapterName: string;
  readonly tieEpsilon: number;
  readonly winRateThreshold: number;
  readonly forgettingThreshold: number;
  readonly baseline?: BaselineSnapshot | null;
}

function classify(
  baseScore: number,
  adapterScore: number,
  tieEpsilon: number
): { outcome: PairwiseOutcome; delta: number } {
  const delta = adapterScore - baseScore;
  if (Math.abs(delta) <= tieEpsilon) return { outcome: 'tie', delta };
  if (delta > 0) return { outcome: 'win', delta };
  return { outcome: 'loss', delta };
}

function key(r: { suiteId: string; promptId: string }): string {
  return `${r.suiteId}::${r.promptId}`;
}

export function aggregate(opts: AggregateOpts): {
  pairwise: ReadonlyArray<PairwiseResult>;
  winrate: AdapterWinrate;
} {
  // Index base by (suite, prompt).
  const baseByKey = new Map<string, RubricResult>();
  for (const r of opts.base) baseByKey.set(key(r), r);

  // Pairwise comparisons against every adapter prompt.
  const pairwise: PairwiseResult[] = [];
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let suiteHits = 0;
  let suiteTotal = 0;
  for (const a of opts.adapter) {
    const b = baseByKey.get(key(a));
    if (!b) continue; // adapter saw a prompt the base didn't — skip from winrate
    const { outcome, delta } = classify(b.weightedScore, a.weightedScore, opts.tieEpsilon);
    pairwise.push({
      promptId: a.promptId,
      suiteId: a.suiteId,
      adapter: opts.adapterName,
      baseScore: b.weightedScore,
      adapterScore: a.weightedScore,
      outcome,
      delta
    });
    if (outcome === 'win') wins += 1;
    else if (outcome === 'loss') losses += 1;
    else ties += 1;

    // Suite pass-rate (rubric-only, ignoring base).
    suiteTotal += 1;
    if (a.weightedScore >= 0.5) suiteHits += 1;
  }

  const decisive = wins + losses;
  const winRate = decisive > 0 ? wins / decisive : Number.NaN;
  const suitePassRate = suiteTotal > 0 ? suiteHits / suiteTotal : 0;

  // Regression detection — check baseline if provided.
  const regressions: RegressionFlag[] = [];
  if (opts.baseline) {
    const baselineByKey = new Map<string, number>();
    for (const e of opts.baseline.entries) {
      baselineByKey.set(`${e.suiteId}::${e.promptId}`, e.weightedScore);
    }
    for (const a of opts.adapter) {
      const prior = baselineByKey.get(key(a));
      if (prior === undefined || prior <= 0) continue;
      const delta = a.weightedScore - prior;
      if (delta < -opts.forgettingThreshold) {
        regressions.push({
          promptId: a.promptId,
          suiteId: a.suiteId,
          adapter: opts.adapterName,
          priorScore: prior,
          currentScore: a.weightedScore,
          delta
        });
      }
    }
  }

  let decision: AdapterWinrate['decision'];
  if (decisive === 0) decision = 'reject-no-data';
  else if (regressions.length > 0) decision = 'reject-regression';
  else if (winRate >= opts.winRateThreshold) decision = 'promote-canary';
  else decision = 'reject-winrate';

  return {
    pairwise,
    winrate: {
      adapter: opts.adapterName,
      wins,
      losses,
      ties,
      winRate,
      suitePassRate,
      regressions,
      decision
    }
  };
}

export const __TEST_ONLY = { classify, key };
