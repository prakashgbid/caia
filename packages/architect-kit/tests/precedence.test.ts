import { describe, it, expect } from 'vitest';
import {
  CANONICAL_PRECEDENCE_LADDER,
  CANONICAL_ARCHITECT_COUNT,
  precedenceRank,
  comparePrecedence,
  higherPrecedence,
  assertLadderShape,
} from '../src/precedence.js';

describe('precedence ladder', () => {
  it('contains exactly 17 architects', () => {
    expect(CANONICAL_PRECEDENCE_LADDER.length).toBe(17);
    expect(CANONICAL_ARCHITECT_COUNT).toBe(17);
  });

  it('has unique entries', () => {
    const seen = new Set(CANONICAL_PRECEDENCE_LADDER);
    expect(seen.size).toBe(CANONICAL_PRECEDENCE_LADDER.length);
  });

  it('places security at rank 1', () => {
    expect(precedenceRank('security')).toBe(1);
  });

  it('places devops at rank 2 (spec §5.2: operator-on-hook for bad deploy)', () => {
    expect(precedenceRank('devops')).toBe(2);
  });

  it('places a11y above seo above performance above frontend', () => {
    const a11y = precedenceRank('a11y');
    const seo = precedenceRank('seo');
    const perf = precedenceRank('performance');
    const fe = precedenceRank('frontend');
    expect(a11y).toBeLessThan(seo);
    expect(seo).toBeLessThan(perf);
    expect(perf).toBeLessThan(fe);
  });

  it('places testing at the bottom (advisory)', () => {
    expect(precedenceRank('testing')).toBe(17);
  });

  it('precedenceRank returns Infinity for unknown architects', () => {
    expect(precedenceRank('not-a-real-architect')).toBe(Infinity);
  });

  it('comparePrecedence total-orders the ladder', () => {
    const sorted = [...CANONICAL_PRECEDENCE_LADDER].sort((a, b) => comparePrecedence(a, b));
    expect(sorted).toEqual([...CANONICAL_PRECEDENCE_LADDER]);
  });

  it('higherPrecedence picks the lower-ranked (higher-priority) architect', () => {
    expect(higherPrecedence('security', 'frontend')).toBe('security');
    expect(higherPrecedence('frontend', 'security')).toBe('security');
  });

  it('higherPrecedence returns null on tie', () => {
    expect(higherPrecedence('mystery-1', 'mystery-2')).toBe(null);
  });

  it('assertLadderShape passes the canonical ladder', () => {
    expect(() => assertLadderShape(CANONICAL_PRECEDENCE_LADDER)).not.toThrow();
  });

  it('assertLadderShape catches a wrong-size ladder', () => {
    expect(() => assertLadderShape(['a', 'b'], 17)).toThrow(/17/);
  });

  it('assertLadderShape catches duplicate entries', () => {
    expect(() => assertLadderShape(['a', 'a', ...Array(15).fill('x').map((_, i) => `n${i}`)], 17)).toThrow(
      /duplicate/,
    );
  });
});
