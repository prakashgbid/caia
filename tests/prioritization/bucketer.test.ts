import { assignBucket, BUCKET_ORDER } from '../../src/prioritization/bucketer';

describe('assignBucket', () => {
  it('P0 for score >= 90', () => {
    expect(assignBucket(90, 0)).toBe('P0');
    expect(assignBucket(100, 0)).toBe('P0');
  });

  it('P0 for dependentCount >= 5 regardless of score', () => {
    expect(assignBucket(20, 5)).toBe('P0');
    expect(assignBucket(0, 10)).toBe('P0');
  });

  it('P1 for score 70-89 with low dependents', () => {
    expect(assignBucket(70, 0)).toBe('P1');
    expect(assignBucket(89, 0)).toBe('P1');
  });

  it('P2 for score 40-69', () => {
    expect(assignBucket(40, 0)).toBe('P2');
    expect(assignBucket(69, 0)).toBe('P2');
  });

  it('P3 for score < 40', () => {
    expect(assignBucket(39, 0)).toBe('P3');
    expect(assignBucket(0, 0)).toBe('P3');
  });

  it('P1 with 4 dependents (below hard-blocker gate)', () => {
    expect(assignBucket(75, 4)).toBe('P1');
  });
});

describe('BUCKET_ORDER', () => {
  it('P0 has lowest order number (highest priority)', () => {
    expect(BUCKET_ORDER['P0']).toBeLessThan(BUCKET_ORDER['P1']);
    expect(BUCKET_ORDER['P1']).toBeLessThan(BUCKET_ORDER['P2']);
    expect(BUCKET_ORDER['P2']).toBeLessThan(BUCKET_ORDER['P3']);
  });
});
