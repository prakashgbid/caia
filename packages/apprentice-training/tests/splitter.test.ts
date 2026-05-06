import { describe, it, expect } from 'vitest';
import { splitSamples } from '../src/splitter.js';
import { resolveConfig } from '../src/config.js';
import { fixtureSample, fixtureManifest } from './helpers/fakes.js';
import { InsufficientCorpusError } from '../src/types.js';

const N = 100;
const samples = Array.from({ length: N }, (_, i) => fixtureSample(`s-${String(i).padStart(3, '0')}`));

describe('splitSamples', () => {
  it('honours manifest.holdout when present', () => {
    const holdout = ['s-001', 's-005', 's-007'];
    const manifest = fixtureManifest({ outputDir: '/out', totalSamples: N, holdout });
    const cfg = resolveConfig({ minSamplesToTrain: 5 });
    const result = splitSamples(samples, manifest, cfg);
    expect(result.test.length).toBe(holdout.length);
    expect(new Set(result.test.map(s => s.id))).toEqual(new Set(holdout));
    expect(result.trace.holdoutFromManifest).toBe(holdout.length);
    expect(result.trace.holdoutFromIdHash).toBe(0);
  });

  it('falls back to id-hash test bucket when manifest.holdout is absent', () => {
    const manifest = fixtureManifest({ outputDir: '/out', totalSamples: N });
    const cfg = resolveConfig({ minSamplesToTrain: 5 });
    const result = splitSamples(samples, manifest, cfg);
    expect(result.test.length).toBeGreaterThan(0);
    expect(result.test.length).toBeLessThan(N);
    expect(result.trace.holdoutFromManifest).toBe(0);
    expect(result.trace.holdoutFromIdHash).toBe(result.test.length);
  });

  it('produces a deterministic split for identical inputs', () => {
    const manifest = fixtureManifest({ outputDir: '/out', totalSamples: N });
    const cfg = resolveConfig({ minSamplesToTrain: 5 });
    const a = splitSamples(samples, manifest, cfg);
    const b = splitSamples(samples, manifest, cfg);
    expect(a.train.map(s => s.id)).toEqual(b.train.map(s => s.id));
    expect(a.valid.map(s => s.id)).toEqual(b.valid.map(s => s.id));
    expect(a.test.map(s => s.id)).toEqual(b.test.map(s => s.id));
  });

  it('produces non-overlapping train / valid / test', () => {
    const manifest = fixtureManifest({ outputDir: '/out', totalSamples: N, holdout: ['s-001', 's-002'] });
    const cfg = resolveConfig({ minSamplesToTrain: 5 });
    const result = splitSamples(samples, manifest, cfg);
    const trainSet = new Set(result.train.map(s => s.id));
    const validSet = new Set(result.valid.map(s => s.id));
    const testSet = new Set(result.test.map(s => s.id));
    for (const id of trainSet) expect(validSet.has(id)).toBe(false);
    for (const id of trainSet) expect(testSet.has(id)).toBe(false);
    for (const id of validSet) expect(testSet.has(id)).toBe(false);
    expect(trainSet.size + validSet.size + testSet.size).toBe(N);
  });

  it('approximates the configured fractions when holdout is absent', () => {
    const manifest = fixtureManifest({ outputDir: '/out', totalSamples: N });
    const cfg = resolveConfig({
      trainSplitFraction: 0.8,
      validSplitFraction: 0.15,
      testSplitFraction: 0.05,
      minSamplesToTrain: 5
    });
    const result = splitSamples(samples, manifest, cfg);
    // Tolerance: id-hash bucketing won't exactly match; allow ±15% variance.
    expect(Math.abs(result.test.length / N - 0.05)).toBeLessThan(0.15);
    expect(Math.abs(result.valid.length / N - 0.15)).toBeLessThan(0.15);
  });

  it('throws InsufficientCorpusError when train split is too small', () => {
    const tiny = [fixtureSample('s-1'), fixtureSample('s-2')];
    const manifest = fixtureManifest({ outputDir: '/out', totalSamples: tiny.length });
    const cfg = resolveConfig({ minSamplesToTrain: 5 });
    expect(() => splitSamples(tiny, manifest, cfg)).toThrow(InsufficientCorpusError);
  });

  it('throws InsufficientCorpusError on empty corpus', () => {
    const manifest = fixtureManifest({ outputDir: '/out', totalSamples: 0 });
    const cfg = resolveConfig({});
    expect(() => splitSamples([], manifest, cfg)).toThrow(InsufficientCorpusError);
  });

  it('produces different splits for different splitSeed values', () => {
    const manifest = fixtureManifest({ outputDir: '/out', totalSamples: N });
    const cfgA = resolveConfig({ splitSeed: 42, minSamplesToTrain: 5 });
    const cfgB = resolveConfig({ splitSeed: 99, minSamplesToTrain: 5 });
    const a = splitSamples(samples, manifest, cfgA);
    const b = splitSamples(samples, manifest, cfgB);
    // Splits should differ — at least one of (train, valid, test) ordering changed.
    const trainDiff =
      JSON.stringify(a.train.map(s => s.id)) !== JSON.stringify(b.train.map(s => s.id));
    const validDiff =
      JSON.stringify(a.valid.map(s => s.id)) !== JSON.stringify(b.valid.map(s => s.id));
    const testDiff =
      JSON.stringify(a.test.map(s => s.id)) !== JSON.stringify(b.test.map(s => s.id));
    expect(trainDiff || validDiff || testDiff).toBe(true);
  });
});
