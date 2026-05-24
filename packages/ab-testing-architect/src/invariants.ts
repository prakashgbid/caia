/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * Cross-architect invariants (those that read fields owned by another
 * architect) treat absent foreign data as "cannot verify" and pass
 * trivially. The Reviewer's composed-output pass will exercise the
 * real check; the per-architect test pass exercises only the local
 * checks.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 */

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  contributor: string;
  reads: readonly string[];
  severity: InvariantSeverity;
  description: string;
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/**
 * Closed-form sample size per variant for a two-proportion z-test.
 *
 *   n ≈ ((Z_{α/2} + Z_β)^2 · (p1(1-p1) + p2(1-p2))) / (p1 - p2)^2
 *
 * For α=0.05 two-tailed, Z_{α/2} ≈ 1.96; for power=0.8, Z_β ≈ 0.8416.
 * (1.96 + 0.8416)^2 ≈ 7.85. With p1 = baseline and p2 = baseline·(1+mde),
 * delta = p1·mde.
 *
 * We accept any value within ±20% of the closed-form result. The wide
 * tolerance accommodates Wald vs. Wilson vs. continuity-corrected etc.
 * False-positives on this invariant are worse than false-negatives.
 */
export function computeReferenceSampleSize(
  baselinePct: number,
  mdePct: number,
  alpha = 0.05,
  power = 0.8
): number {
  // Z lookup tables for common values.
  const zAlpha =
    alpha <= 0.011 ? 2.5758
    : alpha <= 0.051 ? 1.96
    : 1.6449;
  const zBeta =
    power >= 0.945 ? 1.6449
    : power >= 0.895 ? 1.2816
    : 0.8416;
  const leading = Math.pow(zAlpha + zBeta, 2);

  const p1 = baselinePct / 100;
  const p2 = p1 * (1 + mdePct / 100);
  const delta = Math.abs(p1 - p2);
  if (delta <= 0) return Infinity;
  const variance = p1 * (1 - p1) + p2 * (1 - p2);
  return Math.ceil((leading * variance) / (delta * delta));
}

export const AB_TESTING_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'abTesting.srmCheck-enabled',
    contributor: 'abTesting',
    reads: ['abTesting.srmCheck'],
    severity: 'fail',
    description:
      'Sample-Ratio-Mismatch check MUST be enabled. A disabled SRM lets a broken variant router silently contaminate the dataset.',
    detect(arch): boolean {
      const srm = readField(arch, 'abTesting.srmCheck');
      if (typeof srm !== 'object' || srm === null) return false;
      return (srm as Record<string, unknown>).enabled === true;
    }
  },
  {
    id: 'abTesting.allocation-sums-to-100',
    contributor: 'abTesting',
    reads: ['abTesting.allocation'],
    severity: 'fail',
    description:
      'Variant allocation percentages MUST sum to exactly 100. Otherwise the variant router cannot deterministically partition traffic.',
    detect(arch): boolean {
      const alloc = readField(arch, 'abTesting.allocation');
      if (typeof alloc !== 'object' || alloc === null) return false;
      let sum = 0;
      for (const v of Object.values(alloc as Record<string, unknown>)) {
        if (typeof v !== 'number' || Number.isNaN(v)) return false;
        sum += v;
      }
      return Math.abs(sum - 100) < 0.0001;
    }
  },
  {
    id: 'abTesting.variantRouting-allocations-sum-to-100',
    contributor: 'abTesting',
    reads: ['abTesting.variantRoutingStrategy'],
    severity: 'fail',
    description:
      'Per-variant allocations within `variantRoutingStrategy.variants` MUST sum to 100.',
    detect(arch): boolean {
      const route = readField(arch, 'abTesting.variantRoutingStrategy');
      if (typeof route !== 'object' || route === null) return false;
      const variants = (route as Record<string, unknown>).variants;
      if (!Array.isArray(variants)) return false;
      let sum = 0;
      for (const v of variants) {
        if (typeof v !== 'object' || v === null) return false;
        const a = (v as Record<string, unknown>).allocationPct;
        if (typeof a !== 'number' || Number.isNaN(a)) return false;
        sum += a;
      }
      return Math.abs(sum - 100) < 0.0001;
    }
  },
  {
    id: 'abTesting.variantRouting-control-first',
    contributor: 'abTesting',
    reads: ['abTesting.variantRoutingStrategy'],
    severity: 'fail',
    description:
      'The first variant in `variantRoutingStrategy.variants` MUST be the control. Downstream readout assumes index-0 = baseline.',
    detect(arch): boolean {
      const route = readField(arch, 'abTesting.variantRoutingStrategy');
      if (typeof route !== 'object' || route === null) return false;
      const variants = (route as Record<string, unknown>).variants;
      if (!Array.isArray(variants) || variants.length === 0) return false;
      const first = variants[0];
      if (typeof first !== 'object' || first === null) return false;
      const id = (first as Record<string, unknown>).id;
      return id === 'control';
    }
  },
  {
    id: 'abTesting.holdout-nonzero',
    contributor: 'abTesting',
    reads: ['abTesting.holdoutAnalysisPlan'],
    severity: 'fail',
    description:
      'Holdout percentage MUST be ≥ 1. Zero holdout means no long-tail / novelty-effect estimation is possible.',
    detect(arch): boolean {
      const hop = readField(arch, 'abTesting.holdoutAnalysisPlan');
      if (typeof hop !== 'object' || hop === null) return false;
      const pct = (hop as Record<string, unknown>).holdoutPct;
      return typeof pct === 'number' && pct >= 1;
    }
  },
  {
    id: 'abTesting.durationCap-under-28d',
    contributor: 'abTesting',
    reads: ['abTesting.durationCap'],
    severity: 'fail',
    description:
      'Duration cap MUST be ≤ 28 days per spec §2.13. Prevents indefinite running on tied outcomes.',
    detect(arch): boolean {
      const dc = readField(arch, 'abTesting.durationCap');
      if (typeof dc !== 'object' || dc === null) return false;
      const m = (dc as Record<string, unknown>).maxDays;
      return typeof m === 'number' && m <= 28;
    }
  },
  {
    id: 'abTesting.durationCap-hardstop',
    contributor: 'abTesting',
    reads: ['abTesting.durationCap'],
    severity: 'fail',
    description:
      'Duration cap MUST have `hardStop: true`. Otherwise the cap is advisory and the experiment can run indefinitely.',
    detect(arch): boolean {
      const dc = readField(arch, 'abTesting.durationCap');
      if (typeof dc !== 'object' || dc === null) return false;
      return (dc as Record<string, unknown>).hardStop === true;
    }
  },
  {
    id: 'abTesting.winnerPromotion-all-criteria',
    contributor: 'abTesting',
    reads: ['abTesting.winnerPromotionPolicy'],
    severity: 'fail',
    description:
      'Auto-promotion policy MUST declare all five criteria: pValueBelow, srmPass, minDurationDays, guardrailsRespected, sampleSizeFloorReached. Missing criteria mean unsafe auto-promotion.',
    detect(arch): boolean {
      const wpp = readField(arch, 'abTesting.winnerPromotionPolicy');
      if (typeof wpp !== 'object' || wpp === null) return false;
      const criteria = (wpp as Record<string, unknown>).criteria;
      if (typeof criteria !== 'object' || criteria === null) return false;
      const req = [
        'pValueBelow',
        'srmPass',
        'minDurationDays',
        'guardrailsRespected',
        'sampleSizeFloorReached'
      ];
      const got = new Set(Object.keys(criteria as Record<string, unknown>));
      for (const r of req) if (!got.has(r)) return false;
      return true;
    }
  },
  {
    id: 'abTesting.sampleSize-matches-mde',
    contributor: 'abTesting',
    reads: ['abTesting.sampleSizeRequirements', 'abTesting.experimentDesign'],
    severity: 'fail',
    description:
      'Per-variant sample size MUST agree with the closed-form two-proportion z-test result (within ±20%) given the declared baseline + MDE + α + power. This is the GOLDEN statistical-rigor invariant.',
    detect(arch): boolean {
      const ssr = readField(arch, 'abTesting.sampleSizeRequirements');
      if (typeof ssr !== 'object' || ssr === null) return false;
      const o = ssr as Record<string, unknown>;
      const perVariantN = o.perVariantN;
      const mdePct = o.mdePct;
      const baselinePct = o.baselinePct;
      const alpha = typeof o.alpha === 'number' ? o.alpha : 0.05;
      const power = typeof o.power === 'number' ? o.power : 0.8;
      if (typeof perVariantN !== 'number' || perVariantN <= 0) return false;
      if (typeof mdePct !== 'number' || mdePct <= 0) return false;
      if (typeof baselinePct !== 'number' || baselinePct <= 0) return false;
      const reference = computeReferenceSampleSize(baselinePct, mdePct, alpha, power);
      if (!Number.isFinite(reference)) return false;
      const lower = reference * 0.8;
      const upper = reference * 1.2;
      return perVariantN >= lower && perVariantN <= upper;
    }
  },
  {
    id: 'abTesting.sampleSize-totalN-matches-perVariant',
    contributor: 'abTesting',
    reads: ['abTesting.sampleSizeRequirements', 'abTesting.variantRoutingStrategy'],
    severity: 'fail',
    description:
      '`sampleSizeRequirements.totalN` MUST equal `perVariantN × number-of-variants`. Total mismatch signals the calc is detached from the routing strategy.',
    detect(arch): boolean {
      const ssr = readField(arch, 'abTesting.sampleSizeRequirements');
      const route = readField(arch, 'abTesting.variantRoutingStrategy');
      if (typeof ssr !== 'object' || ssr === null) return false;
      if (typeof route !== 'object' || route === null) return true;
      const perVariantN = (ssr as Record<string, unknown>).perVariantN;
      const totalN = (ssr as Record<string, unknown>).totalN;
      const variants = (route as Record<string, unknown>).variants;
      if (typeof perVariantN !== 'number' || typeof totalN !== 'number') return false;
      if (!Array.isArray(variants) || variants.length === 0) return false;
      const expected = perVariantN * variants.length;
      return Math.abs(totalN - expected) <= variants.length;
    }
  },
  {
    id: 'abTesting.experimentLifecycle-valid-state',
    contributor: 'abTesting',
    reads: ['abTesting.experimentLifecycle'],
    severity: 'fail',
    description:
      'Current lifecycle phase MUST be one of {draft, running, analysis, decided, archived}. Other values mean the state machine is broken.',
    detect(arch): boolean {
      const lc = readField(arch, 'abTesting.experimentLifecycle');
      if (typeof lc !== 'object' || lc === null) return false;
      const phase = (lc as Record<string, unknown>).currentPhase;
      const allowed = new Set(['draft', 'running', 'analysis', 'decided', 'archived']);
      return typeof phase === 'string' && allowed.has(phase);
    }
  },
  {
    id: 'abTesting.experimentDesign-falsifiable-hypothesis',
    contributor: 'abTesting',
    reads: ['abTesting.experimentDesign'],
    severity: 'advisory',
    description:
      'Hypothesis SHOULD contain a direction word (increase / decrease / lift / drop / improve / reduce / raise / lower / by X%). Vague hypotheses degrade readout interpretability.',
    detect(arch): boolean {
      const ed = readField(arch, 'abTesting.experimentDesign');
      if (typeof ed !== 'object' || ed === null) return false;
      const h = (ed as Record<string, unknown>).hypothesis;
      if (typeof h !== 'string' || h.length < 5) return false;
      return /\b(increase|decrease|lift|drop|improve|reduce|raise|lower|grow|shrink|boost|cut|by\s+\d)/i.test(h);
    }
  },
  {
    id: 'abTesting.primaryMetric-exists-in-analytics',
    contributor: 'abTesting',
    reads: ['abTesting.primaryMetric', 'analytics.eventTaxonomy'],
    severity: 'fail',
    description:
      'Primary metric eventId MUST exist in upstream `analytics.eventTaxonomy`. Otherwise the runtime tracker has no event to read. Trivially passes if analytics upstream is absent.',
    detect(arch): boolean {
      const pm = readField(arch, 'abTesting.primaryMetric');
      const tax = readField(arch, 'analytics.eventTaxonomy');
      if (typeof pm !== 'object' || pm === null) return false;
      const eventId = (pm as Record<string, unknown>).eventId;
      if (typeof eventId !== 'string') return false;
      if (typeof tax !== 'object' || tax === null) return true;
      const eventIds = new Set(Object.keys(tax as Record<string, unknown>));
      return eventIds.has(eventId);
    }
  },
  {
    id: 'abTesting.secondaryMetrics-exist-in-analytics',
    contributor: 'abTesting',
    reads: ['abTesting.secondaryMetrics', 'analytics.eventTaxonomy'],
    severity: 'fail',
    description:
      'Every secondary metric eventId MUST exist in upstream `analytics.eventTaxonomy`. Trivially passes if analytics upstream is absent.',
    detect(arch): boolean {
      const sm = readField(arch, 'abTesting.secondaryMetrics');
      const tax = readField(arch, 'analytics.eventTaxonomy');
      if (!Array.isArray(sm)) return false;
      if (typeof tax !== 'object' || tax === null) return true;
      const eventIds = new Set(Object.keys(tax as Record<string, unknown>));
      for (const entry of sm) {
        if (typeof entry !== 'object' || entry === null) return false;
        const eventId = (entry as Record<string, unknown>).eventId;
        if (typeof eventId !== 'string' || !eventIds.has(eventId)) return false;
      }
      return true;
    }
  },
  {
    id: 'abTesting.guardrailMetrics-exist-in-analytics',
    contributor: 'abTesting',
    reads: ['abTesting.guardrailMetrics', 'analytics.eventTaxonomy'],
    severity: 'fail',
    description:
      'Every guardrail metric eventId MUST exist in upstream `analytics.eventTaxonomy`. Trivially passes if analytics upstream is absent.',
    detect(arch): boolean {
      const gm = readField(arch, 'abTesting.guardrailMetrics');
      const tax = readField(arch, 'analytics.eventTaxonomy');
      if (!Array.isArray(gm)) return false;
      if (typeof tax !== 'object' || tax === null) return true;
      const eventIds = new Set(Object.keys(tax as Record<string, unknown>));
      for (const entry of gm) {
        if (typeof entry !== 'object' || entry === null) return false;
        const eventId = (entry as Record<string, unknown>).eventId;
        if (typeof eventId !== 'string' || !eventIds.has(eventId)) return false;
      }
      return true;
    }
  },
  {
    id: 'abTesting.guardrails-non-empty',
    contributor: 'abTesting',
    reads: ['abTesting.guardrailMetrics'],
    severity: 'fail',
    description:
      'At least one guardrail metric MUST be declared. A treatment with zero guardrails can promote despite degrading latency, errors, or core engagement.',
    detect(arch): boolean {
      const gm = readField(arch, 'abTesting.guardrailMetrics');
      return Array.isArray(gm) && gm.length > 0;
    }
  },
  {
    id: 'abTesting.featureFlagDependencies-key-naming',
    contributor: 'abTesting',
    reads: ['abTesting.featureFlagDependencies'],
    severity: 'advisory',
    description:
      'Feature-flag key SHOULD match the `exp_<id>_<yyyy_mm>` convention. Mismatched keys make experiment provenance hard to audit.',
    detect(arch): boolean {
      const ffd = readField(arch, 'abTesting.featureFlagDependencies');
      if (typeof ffd !== 'object' || ffd === null) return false;
      const key = (ffd as Record<string, unknown>).flagKey;
      if (typeof key !== 'string') return false;
      return /^exp_[a-z0-9_]+_\d{4}_\d{2}$/.test(key);
    }
  },
  {
    id: 'abTesting.featureFlagDependencies-control-default',
    contributor: 'abTesting',
    reads: ['abTesting.featureFlagDependencies'],
    severity: 'fail',
    description:
      'When the flag is disabled, the default variant MUST be `control`. Defaulting to the treatment on flag-off exposes users to an untested arm during outages.',
    detect(arch): boolean {
      const ffd = readField(arch, 'abTesting.featureFlagDependencies');
      if (typeof ffd !== 'object' || ffd === null) return false;
      return (ffd as Record<string, unknown>).defaultVariantOnDisable === 'control';
    }
  },
  {
    id: 'abTesting.featureFlag-bound-to-existing-flag',
    contributor: 'abTesting',
    reads: ['abTesting.featureFlagDependencies', 'featureFlagging.flagsSchema'],
    severity: 'advisory',
    description:
      'The `featureFlagDependencies.flagKey` SHOULD exist in upstream `featureFlagging.flagsSchema`. Trivially passes if Feature Flagging upstream is absent — common during forward-ref builds.',
    detect(arch): boolean {
      const ffd = readField(arch, 'abTesting.featureFlagDependencies');
      const schema = readField(arch, 'featureFlagging.flagsSchema');
      if (typeof ffd !== 'object' || ffd === null) return false;
      const key = (ffd as Record<string, unknown>).flagKey;
      if (typeof key !== 'string') return false;
      if (typeof schema !== 'object' || schema === null) return true;
      const flagKeys = new Set(Object.keys(schema as Record<string, unknown>));
      return flagKeys.has(key);
    }
  },
  {
    id: 'abTesting.statisticalReadout-alpha-power-sane',
    contributor: 'abTesting',
    reads: ['abTesting.statisticalReadoutMethod'],
    severity: 'fail',
    description:
      'Statistical-readout alpha MUST be in (0, 0.1] and power MUST be in [0.7, 0.99]. Otherwise the test is either under-powered or accepts unreasonable Type-I error.',
    detect(arch): boolean {
      const srm = readField(arch, 'abTesting.statisticalReadoutMethod');
      if (typeof srm !== 'object' || srm === null) return false;
      const o = srm as Record<string, unknown>;
      const alpha = o.alpha;
      const power = o.power;
      if (typeof alpha !== 'number' || alpha <= 0 || alpha > 0.1) return false;
      if (typeof power !== 'number' || power < 0.7 || power > 0.99) return false;
      return true;
    }
  }
];
