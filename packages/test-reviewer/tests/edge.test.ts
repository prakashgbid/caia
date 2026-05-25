import { describe, it, expect } from 'vitest';
import { runEdgeLens } from '../src/lenses/edge.js';
import { makeTestCase } from './fixtures.js';

describe('runEdgeLens', () => {
  it('emits no findings on empty test-cases', () => {
    expect(runEdgeLens({ testCases: [] })).toEqual([]);
  });

  it('passes a small suite with one edge case', () => {
    expect(
      runEdgeLens({
        testCases: [
          makeTestCase({ category: 'happy' }),
          makeTestCase({ category: 'edge' }),
        ],
      }),
    ).toEqual([]);
  });

  it('fires when a 5-case suite has no edge cases', () => {
    const findings = runEdgeLens({
      testCases: [
        makeTestCase({ category: 'happy' }),
        makeTestCase({ category: 'happy' }),
        makeTestCase({ category: 'happy' }),
        makeTestCase({ category: 'happy' }),
        makeTestCase({ category: 'happy' }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toMatch(/no edge-case tests/);
  });

  it('scales with suite size — 20-case suite needs 2', () => {
    const cases = Array.from({ length: 20 }, () =>
      makeTestCase({ category: 'happy' }),
    );
    cases[0] = makeTestCase({ category: 'edge' });
    const findings = runEdgeLens({ testCases: cases });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toMatch(/only 1 edge-case test/);
  });

  it('passes when ratio is met for a large suite', () => {
    const cases = Array.from({ length: 30 }, (_, i) =>
      makeTestCase({ category: i < 3 ? 'edge' : 'happy' }),
    );
    expect(runEdgeLens({ testCases: cases })).toEqual([]);
  });

  it('honors a custom floor', () => {
    const findings = runEdgeLens({
      testCases: [
        makeTestCase({ category: 'happy' }),
        makeTestCase({ category: 'edge' }),
      ],
      floor: 3,
    });
    expect(findings).toHaveLength(1);
  });

  it('honors a custom severity', () => {
    const findings = runEdgeLens({
      testCases: [
        makeTestCase({ category: 'happy' }),
        makeTestCase({ category: 'happy' }),
      ],
      severity: 'P0',
    });
    expect(findings[0]?.severity).toBe('P0');
  });
});
