/** Weighted composite math for the Prompt Reviewer rubric. */

import { REVIEWER_WEIGHTS, type ReviewerDimension } from '../types/reviewer.js';

export interface DimensionScores {
  coverage: number;
  specificity: number;
  target_fit: number;
  creativity_surface: number;
  no_drift: number;
  polish: number;
}

/** Compute the weighted composite from per-dimension scores. */
export function computeComposite(scores: DimensionScores): number {
  let total = 0;
  for (const k of Object.keys(REVIEWER_WEIGHTS) as ReviewerDimension[]) {
    const s = clamp01_100(scores[k]);
    total += s * REVIEWER_WEIGHTS[k];
  }
  // Round to 2 decimals to match Postgres NUMERIC(5,2).
  return Math.round(total * 100) / 100;
}

function clamp01_100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

/** Assert weights sum to 1.0 exactly — used in a config test. */
export function weightsSumIsOne(): boolean {
  const sum = Object.values(REVIEWER_WEIGHTS).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) < 1e-9;
}
