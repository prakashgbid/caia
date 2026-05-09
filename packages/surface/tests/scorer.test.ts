import { describe, it, expect } from 'vitest';

import { defaultScorer, applyScores } from '../src/scorer.js';
import type { Finding, ScoringContext } from '../src/types.js';

const ctx: ScoringContext = {
  sinceIso: '2026-05-08T00:00:00.000Z',
  untilIso: '2026-05-09T00:00:00.000Z'
};

function f(over: Partial<Finding> = {}): Omit<Finding, 'id' | 'importance'> {
  return {
    source: 'memory',
    kind: 'memory-updated',
    key: 'k',
    title: 't',
    tsIso: '2026-05-08T12:00:00.000Z',
    tags: [],
    ...over
  };
}

describe('importance scorer', () => {
  it('returns score in [0,1]', () => {
    const s = defaultScorer.score(f(), ctx);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('newer events score higher than older', () => {
    const newer = defaultScorer.score(f({ tsIso: '2026-05-08T23:00:00.000Z' }), ctx);
    const older = defaultScorer.score(f({ tsIso: '2026-05-08T01:00:00.000Z' }), ctx);
    expect(newer).toBeGreaterThan(older);
  });

  it('🚨 keyword bumps title weight', () => {
    const noEmoji = defaultScorer.score(f({ title: 'phase 0 live' }), ctx);
    const withEmoji = defaultScorer.score(f({ title: '🚨 phase 0 live' }), ctx);
    expect(withEmoji).toBeGreaterThan(noEmoji);
  });

  it('BLOCKED in title increases score', () => {
    const a = defaultScorer.score(f({ title: 'something' }), ctx);
    const b = defaultScorer.score(f({ title: 'BLOCKED something' }), ctx);
    expect(b).toBeGreaterThan(a);
  });

  it('feedback tag boosts above plain memory-updated', () => {
    const plain = defaultScorer.score(f({ tags: [] }), ctx);
    const fb = defaultScorer.score(f({ tags: ['feedback'] }), ctx);
    expect(fb).toBeGreaterThan(plain);
  });

  it('pr-stale severity is higher than pr-opened', () => {
    const opened = defaultScorer.score(f({ source: 'pr', kind: 'pr-opened' }), ctx);
    const stale = defaultScorer.score(f({ source: 'pr', kind: 'pr-stale' }), ctx);
    expect(stale).toBeGreaterThan(opened);
  });

  it('transcript-failure scored higher than transcript-handoff', () => {
    const ok = defaultScorer.score(f({ source: 'transcript', kind: 'transcript-handoff' }), ctx);
    const fail = defaultScorer.score(f({ source: 'transcript', kind: 'transcript-failure' }), ctx);
    expect(fail).toBeGreaterThan(ok);
  });

  it('NaN-ts tolerated', () => {
    const s = defaultScorer.score(f({ tsIso: 'garbage' }), ctx);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('unknown kind falls back to default severity', () => {
    const s = defaultScorer.score(f({ kind: 'connector-degraded' as never }), ctx);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it('size signal reflects sizeBytes meta', () => {
    const small = defaultScorer.score(f({ meta: { sizeBytes: 10 } }), ctx);
    const large = defaultScorer.score(f({ meta: { sizeBytes: 100_000 } }), ctx);
    expect(large).toBeGreaterThan(small);
  });

  it('applyScores attaches importance to every finding', () => {
    const arr = [f(), f({ tsIso: '2026-05-08T01:00:00.000Z' })].map((x, i) => ({
      ...x,
      id: `id-${i}`
    }));
    const scored = applyScores(arr, ctx);
    expect(scored.length).toBe(2);
    expect(scored[0]?.importance).toBeDefined();
    expect(scored[1]?.importance).toBeDefined();
  });

  it('determinism: identical input produces identical scores', () => {
    const x = f({ title: 'phase 0 live', tags: ['feedback', 'live'] });
    const a = defaultScorer.score(x, ctx);
    const b = defaultScorer.score(x, ctx);
    expect(a).toBe(b);
  });
});
