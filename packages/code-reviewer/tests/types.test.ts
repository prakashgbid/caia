import { describe, it, expect } from 'vitest';
import {
  ALL_DIMENSIONS,
  DEFAULT_SEVERITY,
  SEVERITY_RANK,
  CRITIC_DENYLIST,
  ADVISORY_REVIEWER_DENYLIST
} from '../src/types.js';

describe('types — invariants', () => {
  it('SEVERITY_RANK is monotonic', () => {
    expect(SEVERITY_RANK.low).toBeLessThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeLessThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.critical);
  });

  it('DEFAULT_SEVERITY covers all dimensions', () => {
    for (const d of ALL_DIMENSIONS) {
      expect(DEFAULT_SEVERITY[d]).toBeDefined();
    }
  });

  it('ALL_DIMENSIONS has 7 entries', () => {
    // Per operator's domain list: correctness, bugs, style, type safety,
    // test coverage, naming, comments
    expect(ALL_DIMENSIONS).toHaveLength(7);
  });

  it('Critic denylist is non-empty and disjoint from our dimensions', () => {
    expect(CRITIC_DENYLIST.size).toBeGreaterThan(0);
    for (const d of ALL_DIMENSIONS) {
      expect(CRITIC_DENYLIST.has(d)).toBe(false);
    }
  });

  it('advisory Reviewer denylist is non-empty and disjoint from our dimensions', () => {
    expect(ADVISORY_REVIEWER_DENYLIST.size).toBeGreaterThan(0);
    for (const d of ALL_DIMENSIONS) {
      expect(ADVISORY_REVIEWER_DENYLIST.has(d)).toBe(false);
    }
  });

  it('Critic and advisory Reviewer denylists are themselves disjoint', () => {
    for (const d of CRITIC_DENYLIST) {
      expect(ADVISORY_REVIEWER_DENYLIST.has(d)).toBe(false);
    }
  });

  it('correctness/bug-risk default to high', () => {
    expect(DEFAULT_SEVERITY.correctness).toBe('high');
    expect(DEFAULT_SEVERITY['bug-risk']).toBe('high');
  });

  it('style/naming/comments default to low', () => {
    expect(DEFAULT_SEVERITY.style).toBe('low');
    expect(DEFAULT_SEVERITY.naming).toBe('low');
    expect(DEFAULT_SEVERITY.comments).toBe('low');
  });
});
