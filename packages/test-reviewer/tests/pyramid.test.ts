import { describe, it, expect } from 'vitest';
import { resolveMix, runPyramidLens } from '../src/lenses/pyramid.js';
import { cleanComposedArchitecture, makeTestCase } from './fixtures.js';
import type { TestCase } from '@chiefaia/ticket-template';

function build(layers: Array<TestCase['layer']>): TestCase[] {
  return layers.map((l, i) =>
    makeTestCase({ id: `p-${i}`, category: 'happy', layer: l }),
  );
}

describe('resolveMix', () => {
  it('returns null when ticketType is undefined', () => {
    expect(
      resolveMix(cleanComposedArchitecture(), undefined),
    ).toBeNull();
  });

  it('returns null when the architect has no mix for ticketType', () => {
    expect(resolveMix(cleanComposedArchitecture(), 'Widget')).toBeNull();
  });

  it('returns null when the testing.testTypeMixPercentages key is absent', () => {
    expect(resolveMix({}, 'Page')).toBeNull();
  });

  it('folds perf% into unit + integration proportionally', () => {
    const mix = resolveMix(cleanComposedArchitecture(), 'Page');
    expect(mix).not.toBeNull();
    // unit 60 + perf 2 * (60/80) = 60 + 1.5 = 61.5
    expect(mix?.unit).toBeCloseTo(61.5, 1);
    // integration 20 + perf 2 * (20/80) = 20 + 0.5 = 20.5
    expect(mix?.integration).toBeCloseTo(20.5, 1);
    // a11y (3) maps to accessibility
    expect(mix?.accessibility).toBe(3);
  });
});

describe('runPyramidLens — no architect mix', () => {
  it('emits no findings when test-cases is empty', () => {
    expect(
      runPyramidLens({
        testCases: [],
        ticketType: 'Page',
        composedArchitecture: {},
      }),
    ).toEqual([]);
  });

  it('fires the unit-floor finding for a 100% e2e suite', () => {
    const findings = runPyramidLens({
      testCases: build(['e2e', 'e2e', 'e2e', 'e2e']),
      ticketType: 'Page',
      composedArchitecture: {},
    });
    const layers = findings.map((f) => f.layer);
    expect(layers).toContain('unit');
    expect(layers).toContain('e2e'); // also exceeds e2e ceiling
  });

  it('fires the e2e-ceiling finding for a 60% e2e suite', () => {
    const findings = runPyramidLens({
      testCases: build([
        'e2e',
        'e2e',
        'e2e',
        'unit',
        'unit',
      ]),
      ticketType: 'Page',
      composedArchitecture: {},
    });
    expect(findings.some((f) => f.layer === 'e2e')).toBe(true);
  });

  it('passes a balanced suite with no architect mix', () => {
    const findings = runPyramidLens({
      testCases: build([
        'unit',
        'unit',
        'unit',
        'unit',
        'unit',
        'unit',
        'integration',
        'integration',
        'e2e',
        'e2e',
      ]),
      ticketType: 'Page',
      composedArchitecture: {},
    });
    expect(findings).toEqual([]);
  });
});

describe('runPyramidLens — with architect mix', () => {
  it('flags layers far below target', () => {
    const findings = runPyramidLens({
      // All 10 cases are e2e — unit/integration are 0% vs 60/20% targets.
      testCases: build([
        'e2e',
        'e2e',
        'e2e',
        'e2e',
        'e2e',
        'e2e',
        'e2e',
        'e2e',
        'e2e',
        'e2e',
      ]),
      ticketType: 'Page',
      composedArchitecture: cleanComposedArchitecture(),
    });
    // Hard-floor unit + hard-ceiling e2e + below-target unit + below-target integration
    expect(findings.length).toBeGreaterThanOrEqual(3);
  });

  it('emits an advisory (overfill) at >200% target', () => {
    const findings = runPyramidLens({
      // 50% e2e — target is 10% → 5x over.
      testCases: build([
        'unit',
        'unit',
        'unit',
        'unit',
        'unit',
        'e2e',
        'e2e',
        'e2e',
        'e2e',
        'e2e',
      ]),
      ticketType: 'Page',
      composedArchitecture: cleanComposedArchitecture(),
    });
    const e2eFinding = findings.find((f) => f.layer === 'e2e');
    expect(e2eFinding).toBeDefined();
    expect(e2eFinding?.targetPct).not.toBeNull();
  });

  it('honors custom severities', () => {
    const findings = runPyramidLens({
      testCases: build(['e2e', 'e2e', 'e2e', 'e2e']),
      ticketType: 'Page',
      composedArchitecture: {},
      underfillSeverity: 'P0',
    });
    expect(findings.every((f) => f.severity === 'P0')).toBe(true);
  });
});
