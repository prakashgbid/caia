/**
 * Dedupe — drop pairs whose `meta.contentSha256` was seen before.
 *
 * Stable: first occurrence wins. The aggregator already orders
 * artifacts deterministically per source, so dedupe is also stable
 * across runs.
 */

import type { InstructionPair } from './types.js';

export interface DedupeResult {
  kept: InstructionPair[];
  duplicates: InstructionPair[];
}

export function dedupePairs(pairs: ReadonlyArray<InstructionPair>): DedupeResult {
  const seen = new Set<string>();
  const kept: InstructionPair[] = [];
  const duplicates: InstructionPair[] = [];
  for (const p of pairs) {
    const key = p.meta.contentSha256;
    if (seen.has(key)) {
      duplicates.push(p);
      continue;
    }
    seen.add(key);
    kept.push(p);
  }
  return { kept, duplicates };
}
