/**
 * Cross-architect invariants tests.
 */

import { describe, it, expect } from 'vitest';

import { TESTING_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('TESTING_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(TESTING_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable, unique id', () => {
    const seen = new Set<string>();
    for (const inv of TESTING_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `testing`', () => {
    for (const inv of TESTING_INVARIANTS) {
      expect(inv.contributor).toBe('testing');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of TESTING_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of TESTING_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of TESTING_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('TESTING_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of TESTING_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('strategy-pyramid-shape-allowed fails on a forbidden shape (diamond)', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.strategy-pyramid-shape-allowed');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'testing.testingStrategy': {
        ...(goldenArch['testing.testingStrategy'] as Record<string, unknown>),
        pyramidShape: 'diamond'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('strategy-pyramid-shape-allowed fails on a forbidden shape (trophy)', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.strategy-pyramid-shape-allowed');
    const corrupted = {
      ...goldenArch,
      'testing.testingStrategy': {
        ...(goldenArch['testing.testingStrategy'] as Record<string, unknown>),
        pyramidShape: 'trophy'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('mix-covers-all-six-types fails when a test type is missing', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.mix-covers-all-six-types');
    const corrupted = {
      ...goldenArch,
      'testing.testTypeMixPercentages': {
        Story: { unit: 70, integration: 20, e2e: 10 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('mix-sums-to-100 fails when percentages do not sum to 100', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.mix-sums-to-100');
    const corrupted = {
      ...goldenArch,
      'testing.testTypeMixPercentages': {
        Story: { unit: 70, integration: 20, e2e: 10, visual: 5, a11y: 3, perf: 2 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('mix-is-realistic-not-100-pct-unit fails on a 100% unit pyramid', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.mix-is-realistic-not-100-pct-unit');
    const corrupted = {
      ...goldenArch,
      'testing.testTypeMixPercentages': {
        Story: { unit: 100, integration: 0, e2e: 0, visual: 0, a11y: 0, perf: 0 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('mix-is-realistic-not-100-pct-unit fails on zero e2e share', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.mix-is-realistic-not-100-pct-unit');
    const corrupted = {
      ...goldenArch,
      'testing.testTypeMixPercentages': {
        Story: { unit: 80, integration: 20, e2e: 0, visual: 0, a11y: 0, perf: 0 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('mix-is-realistic-not-100-pct-unit fails on >50% e2e (unmaintainable)', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.mix-is-realistic-not-100-pct-unit');
    const corrupted = {
      ...goldenArch,
      'testing.testTypeMixPercentages': {
        Story: { unit: 20, integration: 10, e2e: 60, visual: 5, a11y: 3, perf: 2 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('mix-is-realistic-not-100-pct-unit fails on <30% unit', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.mix-is-realistic-not-100-pct-unit');
    const corrupted = {
      ...goldenArch,
      'testing.testTypeMixPercentages': {
        Story: { unit: 25, integration: 30, e2e: 30, visual: 5, a11y: 5, perf: 5 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('mutation-kill-floor-meets-min fails on kill score < 50', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.mutation-kill-floor-meets-min');
    const corrupted = {
      ...goldenArch,
      'testing.mutationTestingThresholds': {
        ...(goldenArch['testing.mutationTestingThresholds'] as Record<string, unknown>),
        killScoreFloor: 30
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('mutation-tool-allowed fails on an unknown tool', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.mutation-tool-allowed');
    const corrupted = {
      ...goldenArch,
      'testing.mutationTestingThresholds': {
        ...(goldenArch['testing.mutationTestingThresholds'] as Record<string, unknown>),
        tool: 'my-custom-mutator'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('perf-lighthouse-delta-bounded fails on > 10% budget', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.perf-lighthouse-delta-bounded');
    const corrupted = {
      ...goldenArch,
      'testing.perfRegressionBudgets': {
        ...(goldenArch['testing.perfRegressionBudgets'] as Record<string, unknown>),
        lighthouseDeltaPct: 25
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('e2e-runner-allowed fails on Cypress', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.e2e-runner-allowed');
    const corrupted = {
      ...goldenArch,
      'testing.e2ePatterns': {
        ...(goldenArch['testing.e2ePatterns'] as Record<string, unknown>),
        runner: 'cypress'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('e2e-page-objects-mandatory fails when pageObjects is false', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.e2e-page-objects-mandatory');
    const corrupted = {
      ...goldenArch,
      'testing.e2ePatterns': {
        ...(goldenArch['testing.e2ePatterns'] as Record<string, unknown>),
        pageObjects: false
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('coverage-floor-meets-min fails when globalFloor.lines < 70', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.coverage-floor-meets-min');
    const corrupted = {
      ...goldenArch,
      'testing.coverageThresholds': {
        ...(goldenArch['testing.coverageThresholds'] as Record<string, unknown>),
        globalFloor: { lines: 60, branches: 75, functions: 80, statements: 80 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('coverage-floor-meets-min fails when a per-ticket-type branch is < 70', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.coverage-floor-meets-min');
    const corrupted = {
      ...goldenArch,
      'testing.coverageThresholds': {
        globalFloor: { lines: 80, branches: 75, functions: 80, statements: 80 },
        perTicketType: {
          Story: { lines: 80, branches: 50, functions: 80, statements: 80 }
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('flake-retry-rate-bounded fails on > 2% retry rate', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.flake-retry-rate-bounded');
    const corrupted = {
      ...goldenArch,
      'testing.flakeTolerance': {
        ...(goldenArch['testing.flakeTolerance'] as Record<string, unknown>),
        maxRetryRatePct: 5
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('fixtures-determinism-mandates-clock-mock fails when clockMock=false', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.fixtures-determinism-mandates-clock-mock');
    const corrupted = {
      ...goldenArch,
      'testing.fixturesStrategy': {
        ...(goldenArch['testing.fixturesStrategy'] as Record<string, unknown>),
        determinism: { clockMock: false, idGenerator: 'uuid-v7-fixed-seed', rngSeed: 42 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('covers-frontend-interactive-components passes trivially when frontend output is absent', () => {
    const inv = TESTING_INVARIANTS.find(i => i.id === 'testing.covers-frontend-interactive-components');
    const stripped = { 'testing.testingStrategy': goldenArch['testing.testingStrategy'] };
    expect(inv!.detect(stripped)).toBe(true);
  });
});
