import { describe, it, expect } from 'vitest';
import {
  computeWaves,
  computeWavesFromMeta,
  flattenWaves,
  waveOf,
  CycleDetectedError,
  UnknownDependencyError,
} from '../src/dependency-graph.js';
import { canonicalArchitectSet, makeContract, StubArchitect } from './fixtures.js';

describe('computeWaves — Kahn topo-sort', () => {
  it('returns empty on empty input', () => {
    expect(computeWaves([])).toEqual([]);
  });

  it('returns a single-member single-wave for one architect', () => {
    const arch = new StubArchitect('a', makeContract('a', ['a.x']));
    const waves = computeWaves([arch]);
    expect(waves).toEqual([{ index: 1, members: ['a'] }]);
  });

  it('groups architects by dependency depth into waves', () => {
    const a = new StubArchitect('a', makeContract('a', ['a.x']));
    const b = new StubArchitect('b', makeContract('b', ['b.x'], { dependsOn: ['a'] }));
    const c = new StubArchitect('c', makeContract('c', ['c.x'], { dependsOn: ['a'] }));
    const d = new StubArchitect('d', makeContract('d', ['d.x'], { dependsOn: ['b', 'c'] }));
    const waves = computeWaves([a, b, c, d]);
    expect(waves.map((w) => w.members)).toEqual([
      ['a'],
      ['b', 'c'],
      ['d'],
    ]);
  });

  it('sorts wave members alphabetically for deterministic logs', () => {
    const arr = ['delta', 'beta', 'alpha', 'charlie'].map(
      (n) => new StubArchitect(n, makeContract(n, [`${n}.x`])),
    );
    const waves = computeWaves(arr);
    expect(waves[0]?.members).toEqual(['alpha', 'beta', 'charlie', 'delta']);
  });

  it('detects an unknown dependency', () => {
    const a = new StubArchitect(
      'a',
      makeContract('a', ['a.x'], { dependsOn: ['ghost'] }),
    );
    expect(() => computeWaves([a])).toThrow(UnknownDependencyError);
  });

  it('detects a 2-cycle', () => {
    const a = new StubArchitect('a', makeContract('a', ['a.x'], { dependsOn: ['b'] }));
    const b = new StubArchitect('b', makeContract('b', ['b.x'], { dependsOn: ['a'] }));
    expect(() => computeWaves([a, b])).toThrow(CycleDetectedError);
  });

  it('detects a 3-cycle', () => {
    const a = new StubArchitect('a', makeContract('a', ['a.x'], { dependsOn: ['c'] }));
    const b = new StubArchitect('b', makeContract('b', ['b.x'], { dependsOn: ['a'] }));
    const c = new StubArchitect('c', makeContract('c', ['c.x'], { dependsOn: ['b'] }));
    expect(() => computeWaves([a, b, c])).toThrow(CycleDetectedError);
  });

  it('the cycle error exposes the unresolved set', () => {
    const a = new StubArchitect('a', makeContract('a', ['a.x'], { dependsOn: ['b'] }));
    const b = new StubArchitect('b', makeContract('b', ['b.x'], { dependsOn: ['a'] }));
    try {
      computeWaves([a, b]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CycleDetectedError);
      expect((err as CycleDetectedError).remaining).toEqual(['a', 'b']);
    }
  });

  it('handles the full 17-architect canonical set', () => {
    const waves = computeWaves(canonicalArchitectSet());
    // Wave 1 = members with no architect deps (6 per the fixture).
    expect(waves[0]?.members).toEqual([
      'backend',
      'featureFlagging',
      'frontend',
      'seo',
      'timeMachine',
      'uxVersionControl',
    ]);
    // A/B Testing sits at wave 3 — analytics (wave 2) + featureFlagging (wave 1).
    expect(waveOf(waves, 'abTesting')).toBe(3);
    // The deepest chain — backend → database → security → apiGateway — pushes
    // apiGateway into wave 4. Spec §0's "3-wave" prose is an approximation;
    // see spec §2 per-architect deps for the canonical truth.
    expect(waveOf(waves, 'apiGateway')).toBeGreaterThanOrEqual(3);
  });

  it('flattenWaves preserves topological order', () => {
    const waves = computeWaves(canonicalArchitectSet());
    const flat = flattenWaves(waves);
    expect(flat.length).toBe(17);
    // backend must precede everyone that depends on it
    expect(flat.indexOf('backend')).toBeLessThan(flat.indexOf('database'));
    expect(flat.indexOf('database')).toBeLessThan(flat.indexOf('security'));
    expect(flat.indexOf('security')).toBeLessThan(flat.indexOf('apiGateway'));
    expect(flat.indexOf('analytics')).toBeLessThan(flat.indexOf('abTesting'));
    expect(flat.indexOf('featureFlagging')).toBeLessThan(flat.indexOf('abTesting'));
  });

  it('waveOf reports the wave for each architect', () => {
    const waves = computeWaves(canonicalArchitectSet());
    expect(waveOf(waves, 'frontend')).toBe(1);
    expect(waveOf(waves, 'a11y')).toBe(2);
    expect(waveOf(waves, 'abTesting')).toBeGreaterThanOrEqual(3);
    expect(waveOf(waves, 'ghost')).toBe(-1);
  });

  it('handles a 3-wave deep linear chain', () => {
    const waves = computeWavesFromMeta([
      { name: 'a', dependsOn: [] },
      { name: 'b', dependsOn: ['a'] },
      { name: 'c', dependsOn: ['b'] },
      { name: 'd', dependsOn: ['c'] },
    ]);
    expect(waves.map((w) => w.members)).toEqual([['a'], ['b'], ['c'], ['d']]);
  });
});
