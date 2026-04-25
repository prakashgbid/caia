import type { PriorityBucket } from './types';

/**
 * Assign a priority bucket from composite score + hard-blocker count.
 *
 * P0: score ≥ 90  OR  dependentCount ≥ 5  (hard-blocker gate)
 * P1: 70-89
 * P2: 40-69
 * P3: < 40
 */
export function assignBucket(score: number, dependentCount: number): PriorityBucket {
  if (score >= 90 || dependentCount >= 5) return 'P0';
  if (score >= 70) return 'P1';
  if (score >= 40) return 'P2';
  return 'P3';
}

export const BUCKET_ORDER: Record<PriorityBucket, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};
