/**
 * Cross-architect invariants — verifies A/B Testing's contributions to
 * the EA Reviewer's invariant registry (per spec §6.2).
 *
 * Includes the golden statistical-correctness tests: sample size matches
 * the closed-form two-proportion z-test, SRM enabled, allocations
 * sum-to-100, all-criteria auto-promotion.
 */

import { describe, it, expect } from 'vitest';

import {
  AB_TESTING_INVARIANTS,
  computeReferenceSampleSize
} from '../src/invariants.js';
import {
  composedArchitectureForInvariants,
  goldenExpectedOutput
} from './helpers/fakes.js';

describe('AB_TESTING_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(AB_TESTING_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of AB_TESTING_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `abTesting`', () => {
    for (const inv of AB_TESTING_INVARIANTS) {
      expect(inv.contributor).toBe('abTesting');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of AB_TESTING_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of AB_TESTING_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of AB_TESTING_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('AB_TESTING_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of AB_TESTING_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('srmCheck-enabled fails when SRM is disabled', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.srmCheck-enabled');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.srmCheck': { enabled: false, alpha: 0.001, schedule: 'daily' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('allocation-sums-to-100 fails on a 60/30 split', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.allocation-sums-to-100');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.allocation': { control: 60, treatment: 30 }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('allocation-sums-to-100 passes on a 50/50 split', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.allocation-sums-to-100');
    expect(inv).toBeDefined();
    expect(inv!.detect(goldenArch)).toBe(true);
  });

  it('allocation-sums-to-100 passes on 34/33/33 three-way', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.allocation-sums-to-100');
    const variant = {
      ...goldenArch,
      'abTesting.allocation': { control: 34, treatment_a: 33, treatment_b: 33 }
    };
    expect(inv!.detect(variant)).toBe(true);
  });

  it('variantRouting-allocations-sum-to-100 fails when variant allocations don\'t sum', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.variantRouting-allocations-sum-to-100'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.variantRoutingStrategy': {
        kind: 'sticky-user',
        hashSeed: 'x',
        salt: 'y',
        stickinessKey: 'userId',
        variants: [
          { id: 'control', name: 'C', allocationPct: 40 },
          { id: 'treatment', name: 'T', allocationPct: 40 }
        ]
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('variantRouting-control-first fails when control is not the first variant', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.variantRouting-control-first');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.variantRoutingStrategy': {
        kind: 'sticky-user',
        hashSeed: 'x',
        salt: 'y',
        stickinessKey: 'userId',
        variants: [
          { id: 'treatment', name: 'T', allocationPct: 50 },
          { id: 'control', name: 'C', allocationPct: 50 }
        ]
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('holdout-nonzero fails when holdoutPct is 0', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.holdout-nonzero');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.holdoutAnalysisPlan': { holdoutPct: 0, holdoutGroupId: 'x', durationDays: 90 }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('durationCap-under-28d fails when maxDays > 28', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.durationCap-under-28d');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.durationCap': { maxDays: 60, hardStop: true, reasonForCap: 'x' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('durationCap-hardstop fails when hardStop is false', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.durationCap-hardstop');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.durationCap': { maxDays: 28, hardStop: false, reasonForCap: 'x' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('winnerPromotion-all-criteria fails when a criterion is missing', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.winnerPromotion-all-criteria'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.winnerPromotionPolicy': {
        auto: true,
        criteria: {
          pValueBelow: 0.05,
          srmPass: true
          // missing minDurationDays, guardrailsRespected, sampleSizeFloorReached
        },
        fallback: 'manual-review'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('sampleSize-matches-mde passes on golden (12% baseline, 10% MDE → ~12k per variant)', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.sampleSize-matches-mde');
    expect(inv).toBeDefined();
    expect(inv!.detect(goldenArch)).toBe(true);
  });

  it('sampleSize-matches-mde fails when perVariantN is wildly off (e.g. 100)', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.sampleSize-matches-mde');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.sampleSizeRequirements': {
        perVariantN: 100,
        totalN: 200,
        powerCalcMethod: 'two-proportion-z-test',
        alpha: 0.05,
        power: 0.8,
        mdePct: 10,
        baselinePct: 12,
        estimatedDurationDays: 1
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('sampleSize-matches-mde fails when perVariantN is too large (10x reference)', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.sampleSize-matches-mde');
    const ref = computeReferenceSampleSize(12, 10, 0.05, 0.8);
    const corrupted = {
      ...goldenArch,
      'abTesting.sampleSizeRequirements': {
        perVariantN: ref * 10,
        totalN: ref * 20,
        powerCalcMethod: 'two-proportion-z-test',
        alpha: 0.05,
        power: 0.8,
        mdePct: 10,
        baselinePct: 12,
        estimatedDurationDays: 28
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('sampleSize-totalN-matches-perVariant fails when totalN ≠ perVariantN × variants', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.sampleSize-totalN-matches-perVariant'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.sampleSizeRequirements': {
        perVariantN: 12000,
        totalN: 12000, // ← wrong: should be 24000 for 2 variants
        powerCalcMethod: 'two-proportion-z-test',
        alpha: 0.05,
        power: 0.8,
        mdePct: 10,
        baselinePct: 12,
        estimatedDurationDays: 12
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('experimentLifecycle-valid-state fails on unknown phase', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.experimentLifecycle-valid-state'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.experimentLifecycle': { currentPhase: 'flying' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('experimentDesign-falsifiable-hypothesis fails on a vague hypothesis', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.experimentDesign-falsifiable-hypothesis'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.experimentDesign': {
        ...((goldenArch['abTesting.experimentDesign'] as object) ?? {}),
        hypothesis: 'Make things better.'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('primaryMetric-exists-in-analytics passes against composed view', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.primaryMetric-exists-in-analytics'
    );
    expect(inv).toBeDefined();
    expect(inv!.detect(composedArchitectureForInvariants())).toBe(true);
  });

  it('primaryMetric-exists-in-analytics passes trivially when analytics upstream absent', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.primaryMetric-exists-in-analytics'
    );
    // The per-architect view (goldenArch alone) has no analytics.eventTaxonomy.
    // The invariant should pass trivially (cross-arch lax mode).
    expect(inv!.detect(goldenArch)).toBe(true);
  });

  it('primaryMetric-exists-in-analytics fails on a dangling primary metric reference (composed)', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.primaryMetric-exists-in-analytics'
    );
    const composed = { ...composedArchitectureForInvariants() };
    composed['abTesting.primaryMetric'] = {
      eventId: 'NOT_A_REAL_EVENT',
      metricType: 'conversion',
      aggregation: 'unique-users',
      successDirection: 'increase'
    };
    expect(inv!.detect(composed)).toBe(false);
  });

  it('secondaryMetrics-exist-in-analytics fails on a dangling secondary metric (composed)', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.secondaryMetrics-exist-in-analytics'
    );
    const composed = { ...composedArchitectureForInvariants() };
    composed['abTesting.secondaryMetrics'] = [
      {
        eventId: 'NOT_A_REAL_EVENT',
        metricType: 'engagement',
        aggregation: 'sum',
        successDirection: 'increase',
        guardrail: false
      }
    ];
    expect(inv!.detect(composed)).toBe(false);
  });

  it('guardrailMetrics-exist-in-analytics fails on a dangling guardrail (composed)', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.guardrailMetrics-exist-in-analytics'
    );
    const composed = { ...composedArchitectureForInvariants() };
    composed['abTesting.guardrailMetrics'] = [
      {
        eventId: 'NOT_A_REAL_EVENT',
        metricType: 'continuous',
        aggregation: 'mean',
        direction: 'non-increase',
        tolerancePct: 5
      }
    ];
    expect(inv!.detect(composed)).toBe(false);
  });

  it('guardrails-non-empty fails when no guardrails declared', () => {
    const inv = AB_TESTING_INVARIANTS.find(i => i.id === 'abTesting.guardrails-non-empty');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.guardrailMetrics': []
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('featureFlagDependencies-key-naming advisory fires on bad key', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.featureFlagDependencies-key-naming'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.featureFlagDependencies': {
        flagKey: 'random-name-not-conventional',
        expectedFlagShape: 'string-variant',
        requiredVariants: ['control', 'treatment'],
        killSwitchKey: 'x',
        defaultVariantOnDisable: 'control'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('featureFlagDependencies-control-default fails when default-on-disable is treatment', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.featureFlagDependencies-control-default'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.featureFlagDependencies': {
        flagKey: 'exp_x_2026_05',
        expectedFlagShape: 'string-variant',
        requiredVariants: ['control', 'treatment'],
        killSwitchKey: 'x',
        defaultVariantOnDisable: 'treatment'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('statisticalReadout-alpha-power-sane fails when alpha > 0.1', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.statisticalReadout-alpha-power-sane'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'abTesting.statisticalReadoutMethod': { kind: 'frequentist', alpha: 0.25, power: 0.8 }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('statisticalReadout-alpha-power-sane fails when power < 0.7', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.statisticalReadout-alpha-power-sane'
    );
    const corrupted = {
      ...goldenArch,
      'abTesting.statisticalReadoutMethod': { kind: 'frequentist', alpha: 0.05, power: 0.5 }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});

describe('AB_TESTING_INVARIANTS — composed (with Analytics + Feature Flagging) view', () => {
  it('featureFlag-bound-to-existing-flag passes when the flag exists in upstream schema', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.featureFlag-bound-to-existing-flag'
    );
    expect(inv).toBeDefined();
    expect(inv!.detect(composedArchitectureForInvariants())).toBe(true);
  });

  it('featureFlag-bound-to-existing-flag fails when the flag is not in upstream schema (composed)', () => {
    const inv = AB_TESTING_INVARIANTS.find(
      i => i.id === 'abTesting.featureFlag-bound-to-existing-flag'
    );
    const composed = { ...composedArchitectureForInvariants() };
    composed['abTesting.featureFlagDependencies'] = {
      flagKey: 'exp_does_not_exist_2026_05',
      expectedFlagShape: 'string-variant',
      requiredVariants: ['control', 'treatment'],
      killSwitchKey: 'x',
      defaultVariantOnDisable: 'control'
    };
    expect(inv!.detect(composed)).toBe(false);
  });

  it('every fail-severity invariant passes against the fully composed view', () => {
    const composed = composedArchitectureForInvariants();
    for (const inv of AB_TESTING_INVARIANTS) {
      if (inv.severity === 'fail') {
        expect(inv.detect(composed), `${inv.id} should pass on composed view`).toBe(true);
      }
    }
  });
});

describe('computeReferenceSampleSize — sanity', () => {
  it('grows when MDE shrinks', () => {
    const big = computeReferenceSampleSize(12, 5, 0.05, 0.8);
    const small = computeReferenceSampleSize(12, 20, 0.05, 0.8);
    expect(big).toBeGreaterThan(small);
  });

  it('grows when power increases', () => {
    const lo = computeReferenceSampleSize(12, 10, 0.05, 0.8);
    const hi = computeReferenceSampleSize(12, 10, 0.05, 0.9);
    expect(hi).toBeGreaterThan(lo);
  });

  it('grows when alpha tightens', () => {
    const lax = computeReferenceSampleSize(12, 10, 0.1, 0.8);
    const tight = computeReferenceSampleSize(12, 10, 0.01, 0.8);
    expect(tight).toBeGreaterThan(lax);
  });

  it('returns a finite positive integer for sane inputs', () => {
    const n = computeReferenceSampleSize(12, 10, 0.05, 0.8);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it('returns Infinity when MDE is 0 (cannot detect zero effect)', () => {
    const n = computeReferenceSampleSize(12, 0, 0.05, 0.8);
    expect(n).toBe(Infinity);
  });
});
