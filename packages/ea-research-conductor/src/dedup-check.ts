/**
 * Dedup checker — before dispatching new research, scan the EA Repository
 * for existing research / reference-architectures / ADRs on the same topic.
 *
 * Implementation: token-overlap on titles + filenames. Cheap and
 * deterministic; an LLM-driven semantic match would be more accurate but
 * would cost more per check.
 */

import { join } from 'node:path';

import type { FsAdapter } from '@caia/ea-architect';

import type { DedupCheckResult } from './types.js';

export class DedupChecker {
  constructor(private readonly repoRoot: string, private readonly fs: FsAdapter) {}

  check(topic: string): DedupCheckResult {
    const dirs = [
      'reference-architectures',
      'decisions',
      'lessons-learned'
    ];
    const tokens = tokenize(topic);
    if (tokens.length === 0) return { isDuplicate: false, confidence: 0, reason: 'topic too short to dedup' };

    let best: { path: string; score: number } | null = null;
    for (const dir of dirs) {
      const path = join(this.repoRoot, dir);
      if (!this.fs.exists(path)) continue;
      for (const entry of this.fs.readDir(path)) {
        if (!entry.endsWith('.md')) continue;
        const entryTokens = tokenize(entry.replace(/\.md$/, ''));
        const score = overlap(tokens, entryTokens);
        if (best === null || score > best.score) {
          best = { path: join(path, entry), score };
        }
      }
    }

    if (best === null) {
      return { isDuplicate: false, confidence: 0, reason: 'no matching files found' };
    }
    if (best.score >= 0.6) {
      return {
        isDuplicate: true,
        existingPath: best.path,
        confidence: best.score,
        reason: `title overlap ${(best.score * 100).toFixed(0)}% with ${best.path}`
      };
    }
    return {
      isDuplicate: false,
      confidence: best.score,
      reason: `best title overlap ${(best.score * 100).toFixed(0)}% below 60% threshold`
    };
  }
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'over', 'a', 'an', 'of']);
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}
function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bs = new Set(b);
  let hit = 0;
  for (const t of a) if (bs.has(t)) hit++;
  return hit / Math.max(a.length, b.length);
}
