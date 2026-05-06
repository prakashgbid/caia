import { describe, expect, it } from 'vitest';

import { estimateTokens } from '../src/token-estimate.js';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up to be conservative', () => {
    // 4 chars / 3.7 = 1.08 → 2 (Math.ceil)
    expect(estimateTokens('abcd')).toBe(2);
  });

  it('scales linearly with input length', () => {
    const a = estimateTokens('x'.repeat(100));
    const b = estimateTokens('x'.repeat(200));
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(a * 2 + 1);
  });

  it('is deterministic — same input always yields same output', () => {
    const text = 'CAIA Primer\n\n## Standing Instructions\n- rule\n';
    expect(estimateTokens(text)).toBe(estimateTokens(text));
  });
});
