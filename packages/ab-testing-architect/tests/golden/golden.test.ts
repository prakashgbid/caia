/**
 * Golden test — the canonical known-good A/B-Testing-architect artifact
 * for a known prakash-tiwari Widget ticket. Includes the
 * **golden experiment-design rigor test** (sample size matches expected
 * effect size, falsifiable hypothesis, all-criteria auto-promotion gate,
 * mandatory SRM + holdout + duration cap).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ABTestingArchitect } from '../../src/architect.js';
import { AB_TESTING_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { AB_TESTING_INVARIANTS, computeReferenceSampleSize } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden — prakash-tiwari hero-CTA A/B test Widget ticket', () => {
  it('input-ticket.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, 'input-ticket.json'), 'utf-8'));
    const fixture = buildFakeInput().ticket;
    expect(raw).toEqual(fixture);
  });

  it('input-businessplan.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-businessplan.json'), 'utf-8')
    );
    const fixture = buildFakeInput().businessPlan;
    expect(raw).toEqual(fixture);
  });

  it('input-designversion.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-designversion.json'), 'utf-8')
    );
    const fixture = buildFakeInput().designVersion;
    expect(raw).toEqual(fixture);
  });

  it('assistant text validates cleanly', () => {
    const result = validateArchitectOutput(goldenAssistantText(), AB_TESTING_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ABTestingArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    expect(out.architectName).toBe('abTesting');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    for (const k of AB_TESTING_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.dependencies).toEqual(expected.dependencies);
    expect(out.risks).toEqual(expected.risks);
  });

  it('output passes every A/B Testing invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ABTestingArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of AB_TESTING_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ABTestingArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });
});

/**
 * Golden experiment-design rigor lens — locks the EA Reviewer's
 * statistical-correctness invariants against the canonical fixture.
 * This is the test the operator referenced in the task brief
 * ("golden test verifying experiment design rigor (e.g., sample size
 * matches expected effect size)").
 */
describe('GOLDEN EXPERIMENT-DESIGN RIGOR LENS', () => {
  const arch = goldenExpectedOutput().architectureFields;
  const design = arch['abTesting.experimentDesign'] as Record<string, unknown>;
  const sampleSize = arch['abTesting.sampleSizeRequirements'] as Record<string, unknown>;
  const routing = arch['abTesting.variantRoutingStrategy'] as Record<string, unknown>;
  const allocation = arch['abTesting.allocation'] as Record<string, number>;
  const wpp = arch['abTesting.winnerPromotionPolicy'] as Record<string, unknown>;
  const dc = arch['abTesting.durationCap'] as Record<string, unknown>;
  const srm = arch['abTesting.srmCheck'] as Record<string, unknown>;
  const hop = arch['abTesting.holdoutAnalysisPlan'] as Record<string, unknown>;
  const lifecycle = arch['abTesting.experimentLifecycle'] as Record<string, unknown>;
  const ffd = arch['abTesting.featureFlagDependencies'] as Record<string, unknown>;
  const primary = arch['abTesting.primaryMetric'] as Record<string, unknown>;
  const guardrails = arch['abTesting.guardrailMetrics'] as Array<Record<string, unknown>>;
  const readout = arch['abTesting.statisticalReadoutMethod'] as Record<string, unknown>;

  it('hypothesis is a falsifiable sentence with a direction word', () => {
    const h = design.hypothesis as string;
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(40);
    expect(h).toMatch(/\b(increase|decrease|lift|drop|improve|reduce|by\s+\d)/i);
  });

  it('hypothesis names a quantified effect size', () => {
    const h = design.hypothesis as string;
    expect(h).toMatch(/\d+\s*%/);
  });

  it('sample size matches the closed-form two-proportion z-test (±20% tolerance)', () => {
    const baseline = sampleSize.baselinePct as number;
    const mde = sampleSize.mdePct as number;
    const alpha = sampleSize.alpha as number;
    const power = sampleSize.power as number;
    const declared = sampleSize.perVariantN as number;
    const reference = computeReferenceSampleSize(baseline, mde, alpha, power);
    expect(declared).toBeGreaterThanOrEqual(reference * 0.8);
    expect(declared).toBeLessThanOrEqual(reference * 1.2);
  });

  it('sample size shrinks as MDE grows (sanity)', () => {
    const small = computeReferenceSampleSize(12, 5, 0.05, 0.8);
    const big = computeReferenceSampleSize(12, 20, 0.05, 0.8);
    expect(small).toBeGreaterThan(big);
  });

  it('sample size grows as power grows (sanity)', () => {
    const low = computeReferenceSampleSize(12, 10, 0.05, 0.8);
    const high = computeReferenceSampleSize(12, 10, 0.05, 0.9);
    expect(high).toBeGreaterThan(low);
  });

  it('totalN equals perVariantN × number of variants', () => {
    const variants = (routing.variants as Array<unknown>).length;
    const perVariantN = sampleSize.perVariantN as number;
    const totalN = sampleSize.totalN as number;
    expect(totalN).toBe(perVariantN * variants);
  });

  it('estimated duration is within the 28-day hard cap', () => {
    expect(sampleSize.estimatedDurationDays as number).toBeLessThanOrEqual(28);
  });

  it('allocation sums to exactly 100', () => {
    const sum = Object.values(allocation).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('variant-routing allocations sum to exactly 100', () => {
    const variants = routing.variants as Array<Record<string, unknown>>;
    const sum = variants.reduce((a, v) => a + (v.allocationPct as number), 0);
    expect(sum).toBe(100);
  });

  it('control variant is first', () => {
    const variants = routing.variants as Array<Record<string, unknown>>;
    expect(variants[0]?.id).toBe('control');
  });

  it('routing strategy is sticky-by-user by default', () => {
    expect(routing.kind).toBe('sticky-user');
    expect(routing.stickinessKey).toBe('userId');
  });

  it('SRM check is enabled at α=0.001 with daily schedule', () => {
    expect(srm.enabled).toBe(true);
    expect(srm.alpha).toBe(0.001);
    expect(srm.schedule).toBe('daily');
    expect(srm.actionOnFail).toBe('halt-and-alert');
  });

  it('holdout is ≥ 5% (non-zero by construction)', () => {
    expect(hop.holdoutPct as number).toBeGreaterThanOrEqual(5);
  });

  it('duration cap is 28 days with hard-stop', () => {
    expect(dc.maxDays).toBe(28);
    expect(dc.hardStop).toBe(true);
  });

  it('auto-promotion requires ALL five criteria (no shortcuts)', () => {
    expect(wpp.auto).toBe(true);
    const criteria = wpp.criteria as Record<string, unknown>;
    expect(criteria.pValueBelow).toBe(0.05);
    expect(criteria.srmPass).toBe(true);
    expect(criteria.minDurationDays).toBeGreaterThanOrEqual(1);
    expect(criteria.guardrailsRespected).toBe(true);
    expect(criteria.sampleSizeFloorReached).toBe(true);
    expect(wpp.fallback).toBe('manual-review');
  });

  it('lifecycle starts in draft and includes all five canonical phases', () => {
    expect(lifecycle.currentPhase).toBe('draft');
    const transitions = lifecycle.transitions as Array<Record<string, unknown>>;
    const allFroms = new Set(transitions.map(t => t.from));
    const allTos = new Set(transitions.map(t => t.to));
    expect(allFroms).toContain('draft');
    expect(allFroms).toContain('running');
    expect(allFroms).toContain('analysis');
    expect(allFroms).toContain('decided');
    expect(allTos).toContain('archived');
  });

  it('feature-flag dependency follows the `exp_<id>_<yyyy_mm>` naming convention', () => {
    expect(ffd.flagKey as string).toMatch(/^exp_[a-z0-9_]+_\d{4}_\d{2}$/);
  });

  it('default variant on flag-disable is control (safe fallback)', () => {
    expect(ffd.defaultVariantOnDisable).toBe('control');
  });

  it('primary metric eventId exists in the upstream Analytics taxonomy', () => {
    const input = buildFakeInput();
    const taxonomy = (input.upstream.outputs.analytics.architectureFields[
      'analytics.eventTaxonomy'
    ] as Record<string, unknown>);
    expect(taxonomy).toHaveProperty(primary.eventId as string);
  });

  it('every guardrail metric eventId exists in the upstream Analytics taxonomy', () => {
    const input = buildFakeInput();
    const taxonomy = (input.upstream.outputs.analytics.architectureFields[
      'analytics.eventTaxonomy'
    ] as Record<string, unknown>);
    for (const g of guardrails) {
      expect(taxonomy).toHaveProperty(g.eventId as string);
    }
  });

  it('every secondary metric eventId exists in the upstream Analytics taxonomy', () => {
    const input = buildFakeInput();
    const taxonomy = (input.upstream.outputs.analytics.architectureFields[
      'analytics.eventTaxonomy'
    ] as Record<string, unknown>);
    const secondaries = arch['abTesting.secondaryMetrics'] as Array<Record<string, unknown>>;
    for (const s of secondaries) {
      expect(taxonomy).toHaveProperty(s.eventId as string);
    }
  });

  it('guardrails are non-empty (at least one declared)', () => {
    expect(Array.isArray(guardrails)).toBe(true);
    expect(guardrails.length).toBeGreaterThan(0);
  });

  it('every guardrail declares a tolerance and a non-decrease/non-increase direction', () => {
    for (const g of guardrails) {
      expect(typeof g.tolerancePct).toBe('number');
      expect(['non-increase', 'non-decrease']).toContain(g.direction);
    }
  });

  it('statistical readout uses sensible alpha + power', () => {
    expect(readout.alpha as number).toBeGreaterThan(0);
    expect(readout.alpha as number).toBeLessThanOrEqual(0.05);
    expect(readout.power as number).toBeGreaterThanOrEqual(0.8);
    expect(readout.power as number).toBeLessThanOrEqual(0.99);
  });

  it('expected effect size matches the MDE (no over/under-claim)', () => {
    expect(design.expectedEffectSizePct).toBe(design.minimumDetectableEffectPct);
  });

  it('baseline conversion rate is declared in design AND sample-size requirements (consistent)', () => {
    expect(design.baselineConversionRatePct).toBe(sampleSize.baselinePct);
  });

  it('MDE is declared in design AND sample-size requirements (consistent)', () => {
    expect(design.minimumDetectableEffectPct).toBe(sampleSize.mdePct);
  });
});
