import { computeOrdinal, BAND_BASE, STEP } from '../../src/prioritization/placer';

describe('computeOrdinal', () => {
  it('P0 ordinal falls in P0 band (1_000_000 – 1_999_999)', () => {
    const ord = computeOrdinal('P0', 95, []);
    expect(ord).toBeGreaterThanOrEqual(BAND_BASE['P0']);
    expect(ord).toBeLessThan(BAND_BASE['P1']);
  });

  it('P1 ordinal falls in P1 band', () => {
    const ord = computeOrdinal('P1', 75, []);
    expect(ord).toBeGreaterThanOrEqual(BAND_BASE['P1']);
    expect(ord).toBeLessThan(BAND_BASE['P2']);
  });

  it('P2 ordinal falls in P2 band', () => {
    const ord = computeOrdinal('P2', 55, []);
    expect(ord).toBeGreaterThanOrEqual(BAND_BASE['P2']);
    expect(ord).toBeLessThan(BAND_BASE['P3']);
  });

  it('P3 ordinal falls in P3 band', () => {
    const ord = computeOrdinal('P3', 20, []);
    expect(ord).toBeGreaterThanOrEqual(BAND_BASE['P3']);
  });

  it('higher score yields lower ordinal within same bucket (front of queue)', () => {
    const highScore = computeOrdinal('P1', 89, []);
    const lowScore = computeOrdinal('P1', 70, []);
    expect(highScore).toBeLessThan(lowScore);
  });

  it('dep floor: ordinal >= max(depOrdinals) + STEP', () => {
    const depOrdinals = [2_500_000, 2_600_000];
    const ord = computeOrdinal('P1', 80, depOrdinals);
    expect(ord).toBeGreaterThanOrEqual(2_600_000 + STEP);
  });

  it('dep floor overrides band base when deps are very far ahead', () => {
    const depOrdinals = [3_999_000]; // P2 band, nearly at end
    // P1 task but dep is in P2 territory — dep floor wins
    const ord = computeOrdinal('P1', 80, depOrdinals);
    expect(ord).toBeGreaterThanOrEqual(3_999_000 + STEP);
  });

  it('no deps — ordinal is purely band + score slot', () => {
    const ord = computeOrdinal('P2', 50, []);
    const expected = BAND_BASE['P2'] + (100 - 50) * STEP;
    expect(ord).toBe(expected);
  });
});
