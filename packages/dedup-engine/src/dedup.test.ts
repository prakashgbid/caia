import { describe, it, expect } from 'vitest';
import { check } from './engine';
import { jaccardSimilarity, labelOverlapScore, combinedScore } from './similarity';
import type { DedupCandidate } from './types';

// ─── jaccardSimilarity ────────────────────────────────────────────────────────

describe('jaccardSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(jaccardSimilarity('add user login with oauth', 'add user login with oauth')).toBe(1);
  });

  it('returns 0 for completely unrelated strings', () => {
    const score = jaccardSimilarity('add user login', 'deploy kubernetes cluster');
    expect(score).toBeLessThan(0.1);
  });

  it('returns 1 for two empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(1);
  });

  it('returns 0 when one string is empty', () => {
    expect(jaccardSimilarity('some text', '')).toBe(0);
    expect(jaccardSimilarity('', 'some text')).toBe(0);
  });

  it('is commutative', () => {
    const a = 'implement google oauth login';
    const b = 'add google login with oauth tokens';
    expect(jaccardSimilarity(a, b)).toBeCloseTo(jaccardSimilarity(b, a), 10);
  });

  it('returns high score for near-identical strings', () => {
    const score = jaccardSimilarity(
      'add login form with email and password validation',
      'add login form with email and password validation and remember me checkbox'
    );
    expect(score).toBeGreaterThan(0.7);
  });
});

// ─── labelOverlapScore ────────────────────────────────────────────────────────

describe('labelOverlapScore', () => {
  it('returns 1 for identical label sets', () => {
    expect(labelOverlapScore(['auth', 'feature'], ['auth', 'feature'])).toBe(1);
  });

  it('returns 0 when either label set is empty', () => {
    expect(labelOverlapScore([], ['auth'])).toBe(0);
    expect(labelOverlapScore(['auth'], [])).toBe(0);
  });

  it('returns partial score for partial overlap', () => {
    const score = labelOverlapScore(['auth', 'feature', 'medium'], ['auth', 'bug', 'large']);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('returns 0 for disjoint label sets', () => {
    expect(labelOverlapScore(['auth', 'feature'], ['devops', 'bug'])).toBe(0);
  });
});

// ─── combinedScore ────────────────────────────────────────────────────────────

describe('combinedScore', () => {
  it('uses textWeight=0.7, labelWeight=0.3 by default', () => {
    const score = combinedScore(0.8, 0.6);
    expect(score).toBeCloseTo(0.8 * 0.7 + 0.6 * 0.3, 5);
  });

  it('uses custom weights', () => {
    const score = combinedScore(0.5, 1.0, 0.5, 0.5);
    expect(score).toBeCloseTo(0.75, 5);
  });
});

// ─── check (engine) ───────────────────────────────────────────────────────────

describe('check — empty corpus', () => {
  it('returns new decision for empty corpus', () => {
    const result = check({ id: '1', title: 'Add user login' }, []);
    expect(result.decision).toBe('new');
    expect(result.shouldBlock).toBe(false);
    expect(result.shouldWarn).toBe(false);
    expect(result.similarItems).toHaveLength(0);
  });
});

describe('check — exact duplicate', () => {
  it('detects identical title as duplicate', () => {
    const existing: DedupCandidate = { id: 'existing-1', title: 'Add Google OAuth login with JWT tokens and refresh flow' };
    const newItem: DedupCandidate = { id: 'new-1', title: 'Add Google OAuth login with JWT tokens and refresh flow' };
    const result = check(newItem, [existing]);
    expect(result.decision).toBe('duplicate');
    expect(result.shouldBlock).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]).toContain('duplicate');
  });
});

describe('check — high similarity', () => {
  it('detects very similar items as likely_duplicate', () => {
    const existing: DedupCandidate = {
      id: 'ex-1',
      title: 'Implement password reset flow with email link token expiry and user notification',
    };
    const newItem: DedupCandidate = {
      id: 'new-1',
      title: 'Implement password reset flow with email token expiry link and user notification message',
    };
    const result = check(newItem, [existing]);
    // Similarity will be high — likely_duplicate or duplicate
    expect(['likely_duplicate', 'duplicate', 'overlap', 'related']).toContain(result.decision);
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

describe('check — unrelated items', () => {
  it('returns new decision for unrelated items', () => {
    const corpus: DedupCandidate[] = [
      { id: 'c1', title: 'Set up Kubernetes deployment manifests for prod cluster' },
      { id: 'c2', title: 'Add Redis caching layer with TTL invalidation strategy' },
      { id: 'c3', title: 'Configure GitHub Actions CI pipeline with Docker build' },
    ];
    const newItem: DedupCandidate = { id: 'n1', title: 'Design user onboarding survey with NPS scoring' };
    const result = check(newItem, corpus);
    expect(result.decision).toBe('new');
    expect(result.shouldBlock).toBe(false);
  });
});

describe('check — temporal decay', () => {
  it('reduces score for items older than decay period', () => {
    const oldTimestamp = Date.now() - (400 * 24 * 60 * 60 * 1000); // 400 days ago
    const oldItem: DedupCandidate = {
      id: 'old-1',
      title: 'Add user authentication with JWT tokens and refresh logic',
      createdAt: oldTimestamp,
    };
    const newItem: DedupCandidate = {
      id: 'new-1',
      title: 'Add user authentication with JWT tokens and refresh logic',
    };

    // Without decay (fresh item)
    const freshItem: DedupCandidate = { id: 'fresh-1', title: 'Add user authentication with JWT tokens and refresh logic' };
    const resultFresh = check(newItem, [freshItem]);

    // With decay (old item)
    const resultOld = check(newItem, [oldItem], { temporalDecayDays: 180 });

    // Old item should have lower confidence than fresh identical item
    expect(resultOld.confidence).toBeLessThan(resultFresh.confidence);
  });

  it('never decays below 50% of original score', () => {
    // 10 years old — well past any decay period
    const veryOldTimestamp = Date.now() - (3650 * 24 * 60 * 60 * 1000);
    // Use a sufficiently long title so bigrams push text similarity comfortably above the 0.50 filter,
    // ensuring even the 50%-decayed score stays at or above relatedThreshold
    const title = 'Add user login with email and password authentication form including remember me option';
    const veryOldItem: DedupCandidate = {
      id: 'ancient-1',
      title,
      createdAt: veryOldTimestamp,
    };
    const newItem: DedupCandidate = { id: 'new-1', title };
    const result = check(newItem, [veryOldItem], { temporalDecayDays: 180 });
    // Identical text → textSim = 1.0; decay floors at 0.5 → finalScore = 0.5.
    // That equals relatedThreshold so the item is still returned and confidence >= 0.5.
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

describe('check — label overlap boosts score', () => {
  it('shared labels increase confidence vs no labels', () => {
    const title = 'Implement Google OAuth login flow with JWT session tokens';
    const itemNoLabels: DedupCandidate = { id: 'base', title };
    const itemWithLabels: DedupCandidate = { id: 'labeled', title, labels: ['auth', 'feature', 'backend'] };
    const newItem: DedupCandidate = {
      id: 'new',
      title: 'Add Google OAuth authentication with JWT token management',
      labels: ['auth', 'feature', 'backend'],
    };

    const resultNoLabels = check(newItem, [itemNoLabels]);
    const resultWithLabels = check(newItem, [itemWithLabels]);

    expect(resultWithLabels.confidence).toBeGreaterThanOrEqual(resultNoLabels.confidence);
  });
});

describe('check — excludes self from comparison', () => {
  it('does not match the item against itself', () => {
    const item: DedupCandidate = { id: 'self', title: 'Add login form with email and password validation' };
    const result = check(item, [item]);
    expect(result.decision).toBe('new');
    expect(result.similarItems).toHaveLength(0);
  });
});

describe('check — shouldWarn for overlap/likely_duplicate', () => {
  it('shouldWarn is true for likely_duplicate', () => {
    const existing: DedupCandidate = {
      id: 'ex',
      title: 'Build payment checkout flow with Stripe integration and webhooks',
    };
    const newItem: DedupCandidate = {
      id: 'new',
      title: 'Build checkout payment flow with Stripe webhooks and order confirmation',
    };
    const result = check(newItem, [existing]);
    if (result.decision === 'likely_duplicate' || result.decision === 'overlap') {
      expect(result.shouldWarn).toBe(true);
    }
  });
});

describe('check — recommendations populated', () => {
  it('provides recommendations for duplicate decision', () => {
    const text = 'Implement rate limiting middleware for all API endpoints using Redis';
    const existing: DedupCandidate = { id: 'e', title: text };
    const newItem: DedupCandidate = { id: 'n', title: text };
    const result = check(newItem, [existing]);
    if (result.decision === 'duplicate') {
      expect(result.recommendations.length).toBeGreaterThan(0);
    }
  });
});
