import { describe, expect, it } from 'vitest';

import { dedupePairs } from '../src/dedupe.js';
import type { InstructionPair } from '../src/types.js';

function makePair(sha: string, idx: number): InstructionPair {
  return {
    id: sha,
    messages: [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: `a-${idx}` }
    ],
    meta: {
      source: 'memory',
      sourceId: `id-${idx}`,
      qualityScore: 0,
      distilled: false,
      redactedSpans: [],
      createdAt: '2026-05-06T00:00:00Z',
      contentSha256: sha
    }
  };
}

describe('dedupePairs', () => {
  it('first occurrence wins', () => {
    const a = makePair('h1', 0);
    const b = makePair('h2', 1);
    const c = makePair('h1', 2); // dup
    const r = dedupePairs([a, b, c]);
    expect(r.kept.map((p) => p.meta.sourceId)).toEqual(['id-0', 'id-1']);
    expect(r.duplicates.map((p) => p.meta.sourceId)).toEqual(['id-2']);
  });

  it('returns empty kept for empty input', () => {
    const r = dedupePairs([]);
    expect(r.kept).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });

  it('preserves order of kept pairs', () => {
    const xs = [makePair('h1', 0), makePair('h2', 1), makePair('h3', 2)];
    const r = dedupePairs(xs);
    expect(r.kept).toEqual(xs);
  });
});
