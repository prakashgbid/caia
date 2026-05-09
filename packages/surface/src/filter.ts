/**
 * Filter rules — drop low-importance findings, then enforce a hard cap.
 *
 * Determinism: stable sort by (importance desc, tsIso desc, id asc).
 */

import type { Finding } from './types.js';

export interface FilterOptions {
  minImportance: number;
  /** Hard cap on findings count. */
  maxFindings: number;
}

export interface FilterResult {
  kept: readonly Finding[];
  dropped: readonly Finding[];
}

export function applyFilter(findings: readonly Finding[], opts: FilterOptions): FilterResult {
  const kept: Finding[] = [];
  const dropped: Finding[] = [];

  for (const f of findings) {
    if (f.importance < opts.minImportance) {
      dropped.push(f);
      continue;
    }
    kept.push(f);
  }

  // Stable ordering. Comparators all return -1/0/1.
  kept.sort(compareFinding);

  if (kept.length > opts.maxFindings) {
    const trimmed = kept.slice(0, opts.maxFindings);
    const overflow = kept.slice(opts.maxFindings);
    dropped.push(...overflow);
    return { kept: trimmed, dropped };
  }

  return { kept, dropped };
}

function compareFinding(a: Finding, b: Finding): number {
  if (a.importance !== b.importance) return a.importance < b.importance ? 1 : -1;
  if (a.tsIso !== b.tsIso) return a.tsIso < b.tsIso ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}
