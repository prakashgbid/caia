/**
 * Position-ordinal placement.
 *
 * Rules (from spec):
 *  1. min ordinal = max(ordinal_of_deps) + STEP
 *  2. within same dep-group, order by score DESC
 *  3. P0 → ordinal below all P1/P2/P3
 *  4. P1 → before any P2/P3
 *
 * We use ordinal bands so buckets never interleave:
 *   P0: 1_000_000 – 1_999_999
 *   P1: 2_000_000 – 2_999_999
 *   P2: 3_000_000 – 3_999_999
 *   P3: 4_000_000 – 4_999_999
 *
 * Within a band, lower ordinal = higher priority.
 * We place at (band_base + (100 - score) * 1000) so score DESC = ordinal ASC.
 * Dependency floor: the task must sit at ordinal ≥ (max dep ordinal + STEP).
 */

import type { PriorityBucket } from './types';

const BAND_BASE: Record<PriorityBucket, number> = {
  P0: 1_000_000,
  P1: 2_000_000,
  P2: 3_000_000,
  P3: 4_000_000,
};

const STEP = 1_000;

export function computeOrdinal(
  bucket: PriorityBucket,
  score: number,
  depOrdinals: number[],
): number {
  const base = BAND_BASE[bucket];
  // Higher score → lower position number (closer to front)
  const scoreSlot = base + (100 - score) * STEP;
  const depFloor = depOrdinals.length > 0
    ? Math.max(...depOrdinals) + STEP
    : 0;
  return Math.max(scoreSlot, depFloor);
}

export { BAND_BASE, STEP };
