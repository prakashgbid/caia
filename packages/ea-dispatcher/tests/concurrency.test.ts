/**
 * Concurrency tests — assert the dispatcher fans architects out in parallel
 * within a wave (not serially) and respects `maxConcurrentSpawns`.
 */
import { describe, it, expect } from 'vitest';
import { dispatch } from '../src/dispatcher.js';
import {
  MockArchitect,
  makeContract,
  seventeenArchitectSet,
  stubDispatch,
} from './fixtures.js';

describe('dispatcher concurrency', () => {
  it('runs wave-1 architects in parallel (total wall-clock ≈ slowest, not sum)', async () => {
    // Three architects with 100ms latency. Parallel ≈ 100ms; serial ≈ 300ms.
    const archs = [
      new MockArchitect('a', makeContract('a', ['a.x']), { latencyMs: 100 }),
      new MockArchitect('b', makeContract('b', ['b.x']), { latencyMs: 100 }),
      new MockArchitect('c', makeContract('c', ['c.x']), { latencyMs: 100 }),
    ];
    const start = Date.now();
    await dispatch({ architects: archs }, stubDispatch());
    const elapsed = Date.now() - start;
    // Generous upper bound — far less than 3 * 100ms = 300ms (serial baseline).
    expect(elapsed).toBeLessThan(250);
    expect(elapsed).toBeGreaterThanOrEqual(95);
  });

  it('serializes waves but parallelizes within (so 100ms + 100ms wave ≈ 200ms)', async () => {
    // wave 1 has one architect; wave 2 has one architect that depends on wave 1.
    const w1 = new MockArchitect('w1', makeContract('w1', ['w1.x']), { latencyMs: 100 });
    const w2 = new MockArchitect(
      'w2',
      makeContract('w2', ['w2.x'], { dependsOn: ['w1'] }),
      { latencyMs: 100 },
    );
    const start = Date.now();
    await dispatch({ architects: [w1, w2] }, stubDispatch());
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(190);
    expect(elapsed).toBeLessThan(350);
  });

  it('handles 17 architects in <= ~5 latency-units when graph is shallow', async () => {
    // Each architect has 50ms latency. The 17-architect graph has depth ~4.
    // Parallel sum should be roughly 4 * 50 = 200ms (plus dispatcher overhead).
    const archs = seventeenArchitectSet().map(
      (a) =>
        new MockArchitect(a.name, a.sectionContract, {
          latencyMs: 50,
          fields: Object.fromEntries(
            a.sectionContract.sections.map((s) => [s.path, 'x']),
          ),
        }),
    );
    const start = Date.now();
    const result = await dispatch({ architects: archs }, stubDispatch());
    const elapsed = Date.now() - start;
    expect(result.outputs.length).toBe(17);
    expect(elapsed).toBeLessThan(600); // generous — 4 waves of 50ms parallel
  });

  it('respects maxConcurrentSpawns by sub-batching a wide wave', async () => {
    const concurrencyHits: number[] = [];
    let active = 0;
    const wide = Array.from({ length: 10 }, (_, i) => {
      return new MockArchitect(
        `w${i}`,
        makeContract(`w${i}`, [`w${i}.x`]),
        {
          latencyMs: 30,
          onRun: () => {
            active += 1;
            concurrencyHits.push(active);
            setTimeout(() => {
              active -= 1;
            }, 30);
          },
        },
      );
    });
    await dispatch({ architects: wide }, stubDispatch(), { maxConcurrentSpawns: 3 });
    // We should observe waves of ≤3 concurrent runs, not 10.
    expect(Math.max(...concurrencyHits)).toBeLessThanOrEqual(3);
  });

  it('all 17 architects compose into 17 union of section paths', async () => {
    const archs = seventeenArchitectSet();
    const result = await dispatch({ architects: archs }, stubDispatch());
    const allDeclared = archs.flatMap((a) =>
      a.sectionContract.sections.map((s) => s.path),
    );
    // Every declared path appears in the composed architecture
    for (const p of allDeclared) {
      expect(result.composedArchitecture).toHaveProperty(p);
    }
    expect(Object.keys(result.composedArchitecture).length).toBe(allDeclared.length);
  });

  it('cap=1 forces serial execution (≈ sum of latencies)', async () => {
    const archs = [
      new MockArchitect('a', makeContract('a', ['a.x']), { latencyMs: 60 }),
      new MockArchitect('b', makeContract('b', ['b.x']), { latencyMs: 60 }),
      new MockArchitect('c', makeContract('c', ['c.x']), { latencyMs: 60 }),
    ];
    const start = Date.now();
    await dispatch({ architects: archs }, stubDispatch(), { maxConcurrentSpawns: 1 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(170);
  });
});
