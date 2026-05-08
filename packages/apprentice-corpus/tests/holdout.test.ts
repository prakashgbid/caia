import { describe, expect, it } from 'vitest';

import { mulberry32, splitHoldout } from '../src/holdout.js';
import type { InstructionPair } from '../src/types.js';

function pair(id: string): InstructionPair {
  return {
    id,
    messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' }
    ],
    meta: {
      source: 'memory',
      sourceId: id,
      qualityScore: 0.5,
      distilled: false,
      redactedSpans: [],
      createdAt: '2026-05-06T00:00:00Z',
      contentSha256: id
    }
  };
}

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) {
      expect(a()).toBeCloseTo(b(), 10);
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).not.toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('splitHoldout', () => {
  it('returns the input unchanged when fraction is 0', () => {
    const pairs = [pair('a'), pair('b'), pair('c')];
    const r = splitHoldout({ pairs, fraction: 0 });
    expect(r.trainable).toEqual(pairs);
    expect(r.holdoutIds).toEqual([]);
  });

  it('returns the input unchanged when pairs is empty', () => {
    const r = splitHoldout({ pairs: [], fraction: 0.5 });
    expect(r.trainable).toEqual([]);
    expect(r.holdoutIds).toEqual([]);
  });

  it('selects approximately `fraction` of pairs', () => {
    const pairs = Array.from({ length: 100 }, (_, i) => pair(`p${i}`));
    const r = splitHoldout({ pairs, fraction: 0.1, seed: 7 });
    expect(r.holdoutIds.length).toBe(10);
    expect(r.trainable.length).toBe(90);
  });

  it('produces the same holdout for the same seed', () => {
    const pairs = Array.from({ length: 50 }, (_, i) => pair(`p${i}`));
    const a = splitHoldout({ pairs, fraction: 0.2, seed: 42 });
    const b = splitHoldout({ pairs, fraction: 0.2, seed: 42 });
    expect(a.holdoutIds).toEqual(b.holdoutIds);
  });

  it('produces different holdouts for different seeds', () => {
    const pairs = Array.from({ length: 50 }, (_, i) => pair(`p${i}`));
    const a = splitHoldout({ pairs, fraction: 0.2, seed: 1 });
    const b = splitHoldout({ pairs, fraction: 0.2, seed: 999 });
    expect(a.holdoutIds).not.toEqual(b.holdoutIds);
  });

  it('is invariant to input ordering (sorts by id internally)', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${String(i).padStart(3, '0')}`);
    const ordered = ids.map(pair);
    const reversed = [...ordered].reverse();
    const a = splitHoldout({ pairs: ordered, fraction: 0.2, seed: 5 });
    const b = splitHoldout({ pairs: reversed, fraction: 0.2, seed: 5 });
    expect(a.holdoutIds).toEqual(b.holdoutIds);
  });

  it('always holds out at least one pair when fraction > 0', () => {
    const pairs = [pair('a'), pair('b'), pair('c')];
    const r = splitHoldout({ pairs, fraction: 0.001, seed: 1 });
    expect(r.holdoutIds.length).toBe(1);
  });

  it('returns sorted holdout ids for stable manifest output', () => {
    const pairs = Array.from({ length: 20 }, (_, i) => pair(`pair-${i}`));
    const r = splitHoldout({ pairs, fraction: 0.3, seed: 13 });
    const sorted = [...r.holdoutIds].sort();
    expect(r.holdoutIds).toEqual(sorted);
  });

  it('clamps fraction to [0, 1]', () => {
    const pairs = [pair('a'), pair('b'), pair('c'), pair('d')];
    const r1 = splitHoldout({ pairs, fraction: 1.5, seed: 1 });
    expect(r1.trainable).toEqual([]);
    expect(r1.holdoutIds.length).toBe(4);
    const r2 = splitHoldout({ pairs, fraction: -1, seed: 1 });
    expect(r2.trainable).toEqual(pairs);
    expect(r2.holdoutIds).toEqual([]);
  });
});
