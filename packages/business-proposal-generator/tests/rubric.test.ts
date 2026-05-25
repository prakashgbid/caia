import { describe, expect, it } from 'vitest';

import {
  REVIEWER_DIMENSIONS,
  REVIEWER_SHIP_THRESHOLD,
  REVIEWER_WEIGHTS,
} from '../src/types/reviewer.js';
import { computeComposite, weightsSumIsOne } from '../src/reviewer/rubric.js';

describe('rubric', () => {
  it('weights sum to 1.0', () => {
    expect(weightsSumIsOne()).toBe(true);
  });

  it('all six canonical dimensions are present', () => {
    expect([...REVIEWER_DIMENSIONS]).toEqual([
      'coverage',
      'specificity',
      'target_fit',
      'creativity_surface',
      'no_drift',
      'polish',
    ]);
  });

  it('composite of all-100 = 100', () => {
    expect(
      computeComposite({
        coverage: 100,
        specificity: 100,
        target_fit: 100,
        creativity_surface: 100,
        no_drift: 100,
        polish: 100,
      }),
    ).toBe(100);
  });

  it('composite of all-0 = 0', () => {
    expect(
      computeComposite({
        coverage: 0,
        specificity: 0,
        target_fit: 0,
        creativity_surface: 0,
        no_drift: 0,
        polish: 0,
      }),
    ).toBe(0);
  });

  it('composite is weighted', () => {
    const score = computeComposite({
      coverage: 100, // 25 pts
      specificity: 0,
      target_fit: 0,
      creativity_surface: 0,
      no_drift: 0,
      polish: 0,
    });
    expect(score).toBeCloseTo(25, 5);
  });

  it('clamps out-of-range dimension values', () => {
    expect(
      computeComposite({
        coverage: 200, // clamped to 100
        specificity: -50, // clamped to 0
        target_fit: 0,
        creativity_surface: 0,
        no_drift: 0,
        polish: 0,
      }),
    ).toBeCloseTo(100 * REVIEWER_WEIGHTS.coverage, 5);
  });

  it('ship threshold is 70', () => {
    expect(REVIEWER_SHIP_THRESHOLD).toBe(70);
  });
});
