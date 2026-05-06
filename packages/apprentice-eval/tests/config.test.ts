import { describe, expect, it } from 'vitest';

import { resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('fills in CAIA defaults when given an empty input', () => {
    const cfg = resolveConfig({}, '/pkg');
    expect(cfg.baseModel).toBe('qwen2.5-coder:7b');
    expect(cfg.ollamaBaseUrl).toBe('http://127.0.0.1:11434');
    expect(cfg.judgeEnabled).toBe(false);
    expect(cfg.judgeBudget).toBe(50);
    expect(cfg.winRateThreshold).toBe(0.6);
    expect(cfg.forgettingThreshold).toBeCloseTo(0.1);
    expect(cfg.tieEpsilon).toBeCloseTo(0.05);
    expect(cfg.warmupRuns).toBe(2);
    expect(cfg.adapters).toEqual([]);
    expect(cfg.suiteRoot).toBe('/pkg/suites');
    expect(cfg.baselineRoot).toBe('/pkg/baselines');
    expect(cfg.onlySuites).toBeNull();
    expect(cfg.onlyAdapters).toBeNull();
  });

  it('respects user overrides', () => {
    const cfg = resolveConfig(
      {
        baseModel: 'foo:1b',
        winRateThreshold: 0.8,
        judgeEnabled: true,
        adapters: [{ name: 'a', kind: 'foo:1b', path: '/a' }],
        onlySuites: ['x']
      },
      '/pkg'
    );
    expect(cfg.baseModel).toBe('foo:1b');
    expect(cfg.winRateThreshold).toBe(0.8);
    expect(cfg.judgeEnabled).toBe(true);
    expect(cfg.adapters).toHaveLength(1);
    expect(cfg.onlySuites).toEqual(['x']);
  });

  it('treats empty onlySuites/onlyAdapters arrays as null', () => {
    const cfg = resolveConfig({ onlySuites: [], onlyAdapters: [] }, '/pkg');
    expect(cfg.onlySuites).toBeNull();
    expect(cfg.onlyAdapters).toBeNull();
  });

  it('rejects out-of-range thresholds', () => {
    expect(() => resolveConfig({ winRateThreshold: 1.5 }, '/pkg')).toThrow();
    expect(() => resolveConfig({ winRateThreshold: -0.1 }, '/pkg')).toThrow();
    expect(() => resolveConfig({ forgettingThreshold: 2 }, '/pkg')).toThrow();
    expect(() => resolveConfig({ tieEpsilon: -0.01 }, '/pkg')).toThrow();
    expect(() => resolveConfig({ judgeBudget: -1 }, '/pkg')).toThrow();
    expect(() => resolveConfig({ warmupRuns: -1 }, '/pkg')).toThrow();
  });
});
