import { describe, expect, it } from 'vitest';

import {
  Forecaster,
  computeStageForecastFromSamples,
  stagesAfter,
} from '../src/forecaster.js';
import { MockPool } from './test-helpers.js';

describe('computeStageForecastFromSamples', () => {
  it('zeros for empty', () => {
    expect(computeStageForecastFromSamples([])).toEqual({ p50: 0, p90: 0, sampleSize: 0 });
  });
  it('one sample', () => {
    expect(computeStageForecastFromSamples([42])).toEqual({ p50: 42, p90: 42, sampleSize: 1 });
  });
  it('p50/p90 linear interpolation', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const r = computeStageForecastFromSamples(samples);
    expect(r.p50).toBeCloseTo(50.5, 3);
    expect(r.p90).toBeCloseTo(90.1, 3);
  });
  it('unsorted input', () => {
    const r = computeStageForecastFromSamples([100, 1, 50, 25, 75]);
    expect(r.p50).toBe(50);
  });
  it('duplicates', () => {
    const r = computeStageForecastFromSamples([10, 10, 10, 10, 10]);
    expect(r.p50).toBe(10);
    expect(r.p90).toBe(10);
  });
  it('p90 >= p50', () => {
    for (const n of [3, 7, 10, 50]) {
      const r = computeStageForecastFromSamples(Array.from({ length: n }, (_, i) => i + 1));
      expect(r.p90).toBeGreaterThanOrEqual(r.p50);
    }
  });
});

describe('stagesAfter', () => {
  it('empty for verified', () => { expect(stagesAfter('verified')).toEqual([]); });
  it('20 remaining from onboarding', () => { expect(stagesAfter('onboarding').length).toBe(20); });
  it('just verified after deployed', () => { expect(stagesAfter('deployed')).toEqual(['verified']); });
  it('empty for unknown', () => {
    // @ts-expect-error
    expect(stagesAfter('xxx')).toEqual([]);
  });
});

describe('Forecaster.confidenceLabel', () => {
  it('insufficient', () => {
    expect(Forecaster.confidenceLabel(0)).toContain('estimating');
    expect(Forecaster.confidenceLabel(9)).toContain('estimating');
  });
  it('rough 10-49', () => {
    expect(Forecaster.confidenceLabel(10)).toBe('Rough estimate');
  });
  it('decent 50-199', () => {
    expect(Forecaster.confidenceLabel(50)).toBe('Decent estimate');
  });
  it('reliable 200+', () => {
    expect(Forecaster.confidenceLabel(200)).toBe('Reliable estimate');
  });
});

describe('Forecaster integration', () => {
  it('uses tenant samples', async () => {
    const pool = new MockPool();
    pool.on(/percentile_cont/, (_sql, params) => {
      if (params.length === 3) return { rows: [{ p50: 100, p90: 200, sample_size: 15 }] };
      return undefined;
    });
    const f = new Forecaster(pool as never);
    const r = await f.stageForecast('t1', 'coding-in-progress');
    expect(r.source).toBe('tenant-stat');
    expect(r.p50Seconds).toBe(100);
  });

  it('falls back to platform', async () => {
    const pool = new MockPool();
    pool.on(/percentile_cont/, (_sql, params) => {
      if (params.length === 3) return { rows: [{ p50: 0, p90: 0, sample_size: 2 }] };
      return { rows: [{ p50: 500, p90: 1000, sample_size: 50 }] };
    });
    const f = new Forecaster(pool as never);
    const r = await f.stageForecast('t1', 'coding-in-progress');
    expect(r.source).toBe('platform-fallback');
  });

  it('insufficient-data when both under-sampled', async () => {
    const pool = new MockPool();
    pool.on(/percentile_cont/, () => ({ rows: [{ p50: 0, p90: 0, sample_size: 1 }] }));
    const f = new Forecaster(pool as never);
    const r = await f.stageForecast('t1', 'coding-in-progress');
    expect(r.source).toBe('insufficient-data');
  });

  it('forecastProject sums remaining stages', async () => {
    const pool = new MockPool();
    pool.on(/percentile_cont/, () => ({ rows: [{ p50: 100, p90: 200, sample_size: 20 }] }));
    const f = new Forecaster(pool as never, { now: () => new Date('2026-05-24T00:00:00Z') });
    const r = await f.forecastProject({ tenantId: 't1', currentStage: 'deployed' });
    expect(r.source).toBe('tenant-stat');
    expect(r.p50At).toBe(new Date('2026-05-24T00:01:40Z').toISOString());
  });

  it('insufficient-data when no stage has samples', async () => {
    const pool = new MockPool();
    pool.on(/percentile_cont/, () => ({ rows: [{ p50: 0, p90: 0, sample_size: 1 }] }));
    const f = new Forecaster(pool as never);
    const r = await f.forecastProject({ tenantId: 't1', currentStage: 'onboarding' });
    expect(r.source).toBe('insufficient-data');
    expect(r.p50At).toBeNull();
  });

  it('at verified returns immediate completion', async () => {
    const pool = new MockPool();
    const f = new Forecaster(pool as never, { now: () => new Date('2026-05-24T00:00:00Z') });
    const r = await f.forecastProject({ tenantId: 't1', currentStage: 'verified' });
    expect(r.p50At).toBe('2026-05-24T00:00:00.000Z');
  });
});
