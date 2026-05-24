/**
 * `ABTestingArchitectContract` — the canonical owned-fields declaration
 * for architect #13 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.13 (A/B Testing Architect owns `abTesting.*`)
 *   - spec §5.2 / §11.A13 (precedenceLevel=6, dependsOn=[analytics, featureFlagging])
 *   - task brief (experimentDesign — hypothesis, primary metric, guardrail metrics,
 *     expected effect size, minimum-detectable-effect; variantRoutingStrategy —
 *     sticky-by-user-id, percentage split, geographic; sampleSizeRequirements
 *     per power-calc; randomizationUnit — user / session / pageview;
 *     holdoutAnalysisPlan; statisticalReadoutMethod — sequential testing,
 *     Bayesian, frequentist; experimentLifecycle — draft → running → analysis
 *     → decided → archived; featureFlagDependencies — forward-refs the
 *     Feature Flagging architect)
 *
 * The reconciled superset below combines the spec §2.13 stack-lock fields
 * (variantRouter, allocation, primaryMetric, secondaryMetrics, sampleSizeFloor,
 * winnerPromotionPolicy, statisticalTest, holdoutPercent, durationCap, srmCheck)
 * AND the task brief's per-ticket-structure fields. Every field is marked
 * `required: true` because the EA Reviewer's statistical-correctness lens
 * cascades on missing fields and the Feature Flagging architect reads
 * `featureFlagDependencies` to know which flag keys to provision.
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. The chosen keys all live under the `abTesting.*`
 * namespace and do not collide with any sibling architect's namespace.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

/**
 * Per-field operator fix-hints. The kit's `ArchitectSectionSpec` is
 * intentionally minimal (`path`, `description`, `required`); the fix-hint
 * dictionary lives next to the contract so the system-prompt builder and
 * the future EA Reviewer can surface it without changing kit shape.
 */
export const AB_TESTING_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'abTesting.experimentDesign':
    'Output {hypothesis, primaryMetricId, guardrailMetricIds, expectedEffectSizePct, minimumDetectableEffectPct, baselineConversionRatePct, direction}. Hypothesis MUST be a falsifiable one-sentence claim. MDE drives sample-size; default 10% relative if no interview answer.',
  'abTesting.variantRoutingStrategy':
    'Output {kind:"sticky-user"|"sticky-session"|"percentage"|"geographic", hashSeed, salt, stickinessKey, variants:[{id,name,allocationPct}]}. Sticky-by-user-id is the safe default. Geographic only when the experiment is region-specific.',
  'abTesting.sampleSizeRequirements':
    'Output {perVariantN, totalN, powerCalcMethod:"two-proportion-z-test"|"welch-t"|"bayesian-rope", alpha:0.05, power:0.8, mdePct, baselinePct, estimatedDurationDays}. Compute via @caia/power-calc when available; otherwise emit the closed-form two-proportion-z-test result.',
  'abTesting.randomizationUnit':
    'Output {unit:"user"|"session"|"pageview", reason}. User is the default (interference-free); session for ephemeral/anonymous flows; pageview only for cosmetic experiments where carryover is impossible.',
  'abTesting.holdoutAnalysisPlan':
    'Output {holdoutPct:5, holdoutGroupId, durationDays, analysisCadence:"weekly"|"monthly", successCriteria}. Default 5% global holdout never exposed to the winning variant; used to estimate true lift over time.',
  'abTesting.statisticalReadoutMethod':
    'Output {kind:"frequentist"|"bayesian"|"sequential", alpha:0.05, power:0.8, sequentialBoundary?:"obrien-fleming"|"pocock", priorDistribution?, multipleComparisonsCorrection?:"bonferroni"|"benjamini-hochberg"|"none"}. Frequentist two-proportion z-test is the locked default per spec §2.13.',
  'abTesting.experimentLifecycle':
    'Output {currentPhase:"draft"|"running"|"analysis"|"decided"|"archived", transitions, gateChecks}. The state machine is fixed: draft → running → analysis → decided → archived (with archived being terminal). Gate checks must fire before each transition.',
  'abTesting.featureFlagDependencies':
    'Output {flagKey, expectedFlagShape, requiredVariants, killSwitchKey, defaultVariantOnDisable}. Forward-references Feature Flagging Architect (`featureFlagging.flagsSchema`); flag key naming follows `exp_<short-id>_<yyyy_mm>` convention.',
  'abTesting.primaryMetric':
    'Output {eventId, metricType:"conversion"|"continuous"|"count", aggregation:"sum"|"mean"|"unique-users"|"rate", successDirection:"increase"|"decrease"}. eventId MUST exist in upstream `analytics.eventTaxonomy` and SHOULD match `analytics.conversionGoals.primary`.',
  'abTesting.secondaryMetrics':
    'Output [{eventId, metricType, aggregation, successDirection, guardrail:false}]. Each eventId MUST exist in upstream `analytics.eventTaxonomy`. Include at least one engagement + one retention metric where possible.',
  'abTesting.guardrailMetrics':
    'Output [{eventId, metricType, aggregation, direction:"non-decrease"|"non-increase", tolerancePct}]. Guardrails block winner promotion if violated. Default: latency, error rate, key engagement events. eventIds MUST exist in `analytics.eventTaxonomy`.',
  'abTesting.allocation':
    'Output {control:50, treatment:50, additionalVariants?}. 50/50 is the default. Three-way: 34/33/33. Allocations MUST sum to 100. The control variant MUST always be first and labeled "control".',
  'abTesting.winnerPromotionPolicy':
    'Output {auto:true|false, criteria:{pValueBelow:0.05, srmPass:true, minDurationDays, guardrailsRespected:true, sampleSizeFloorReached:true}, fallback:"manual-review"|"keep-control"}. Auto-promote only when ALL criteria pass.',
  'abTesting.durationCap':
    'Output {maxDays:28, hardStop:true, reasonForCap}. 4-week cap per spec §2.13. Hard-stop means the experiment auto-terminates regardless of significance — prevents indefinite running on a tied outcome.',
  'abTesting.srmCheck':
    'Output {enabled:true, alpha:0.001, schedule:"daily", actionOnFail:"halt-and-alert"}. Sample-Ratio-Mismatch check is mandatory; a failed SRM means the variant router is broken and the experiment data is invalid.'
};

/**
 * The owned section specs in stable order.
 */
export const AB_TESTING_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'abTesting.experimentDesign',
    description:
      'Hypothesis statement + primary metric + guardrail metric IDs + expected effect size + MDE + baseline conversion rate + direction. The single source of truth for "what are we testing and what would we accept as evidence".',
    required: true
  },
  {
    path: 'abTesting.variantRoutingStrategy',
    description:
      'Variant assignment strategy: sticky-by-user-id (default), sticky-by-session, percentage split, or geographic. Includes hash seed + salt + the stickiness key + per-variant allocations.',
    required: true
  },
  {
    path: 'abTesting.sampleSizeRequirements',
    description:
      'Per-variant N + total N + power-calc method + alpha + power + MDE + baseline + estimated duration days. Computed via deterministic power calc; the EA Reviewer cross-checks against expected effect size.',
    required: true
  },
  {
    path: 'abTesting.randomizationUnit',
    description:
      'Unit of randomization: user (default), session, or pageview. Drives the variant-router stickiness key and the analysis unit. User is interference-free for most product changes.',
    required: true
  },
  {
    path: 'abTesting.holdoutAnalysisPlan',
    description:
      'Holdout-group definition + percentage (default 5%) + holdout duration + analysis cadence + success criteria. The holdout never sees the winning variant; used to measure true long-tail lift.',
    required: true
  },
  {
    path: 'abTesting.statisticalReadoutMethod',
    description:
      'Statistical method: frequentist (default two-proportion z-test), Bayesian, or sequential testing with O\'Brien-Fleming/Pocock boundaries. Includes alpha, power, multiple-comparisons correction, and prior (Bayesian only).',
    required: true
  },
  {
    path: 'abTesting.experimentLifecycle',
    description:
      'Lifecycle state machine: draft → running → analysis → decided → archived. Includes per-transition gate checks (SRM passing, sample-size reached, duration cap not hit, guardrails respected).',
    required: true
  },
  {
    path: 'abTesting.featureFlagDependencies',
    description:
      'Forward-references to Feature Flagging Architect: which flag keys this experiment expects, the variants the flag must expose, the kill-switch flag, and the default variant when the flag is disabled.',
    required: true
  },
  {
    path: 'abTesting.primaryMetric',
    description:
      'Primary success metric: eventId (must exist in upstream `analytics.eventTaxonomy`), metric type (conversion / continuous / count), aggregation, and success direction. Drives sample-size and winner-promotion logic.',
    required: true
  },
  {
    path: 'abTesting.secondaryMetrics',
    description:
      'Secondary metrics tracked alongside the primary (engagement, retention, downstream conversions). Each eventId must exist in upstream `analytics.eventTaxonomy`. Non-blocking — informational only.',
    required: true
  },
  {
    path: 'abTesting.guardrailMetrics',
    description:
      'Guardrail metrics that BLOCK winner promotion if violated: latency, error rate, core engagement. Each guardrail declares a tolerance percentage and direction (non-decrease / non-increase).',
    required: true
  },
  {
    path: 'abTesting.allocation',
    description:
      'Variant traffic allocation. Default 50/50 control vs. treatment. Multi-variant allocations must sum to 100 and the control variant must always be first.',
    required: true
  },
  {
    path: 'abTesting.winnerPromotionPolicy',
    description:
      'Auto-promotion policy: auto-promote only when p < alpha AND SRM passes AND minimum duration met AND guardrails respected AND sample-size floor reached. Fallback to manual review or keep-control on any failure.',
    required: true
  },
  {
    path: 'abTesting.durationCap',
    description:
      'Maximum experiment duration (default 28 days per spec §2.13) with hard-stop flag. Hard-stop prevents indefinite running on tied outcomes; reason-for-cap is operator-facing.',
    required: true
  },
  {
    path: 'abTesting.srmCheck',
    description:
      'Sample-Ratio-Mismatch check: enabled by default with alpha=0.001 and daily schedule. A failed SRM signals a broken variant router and halts the experiment with an operator alert.',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const AB_TESTING_OWNED_FIELD_KEYS: readonly string[] = AB_TESTING_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §3.4 + §2.13 — A/B Testing runs only on tickets explicitly marked
 * for experimentation: either `quality_tags` contains `ab-test` /
 * `experiment` / `ab` / `experimental`, OR `business_requirements`
 * mentions A/B / experiment / variant / treatment / control / lift,
 * OR `ticket.experimental === true`. This keeps the wave-3 cost off
 * tickets that don't need it.
 */
export function abTestingArchitectAppliesPredicate(ticket: Ticket): boolean {
  if (ticket.experimental === true) return true;

  const tags = ticket.quality_tags;
  if (Array.isArray(tags)) {
    const tagSet = new Set(tags.map(t => String(t).toLowerCase()));
    if (tagSet.has('ab-test') || tagSet.has('experiment') || tagSet.has('ab') ||
        tagSet.has('experimental') || tagSet.has('a/b-test') || tagSet.has('a/b')) {
      return true;
    }
  }

  const br = ticket.business_requirements;
  if (br && typeof br === 'object') {
    const haystack = JSON.stringify(br).toLowerCase();
    if (/\ba\/?b[- ]?test/.test(haystack) ||
        /\bexperiment\b/.test(haystack) ||
        /\bvariant\b/.test(haystack) ||
        /\btreatment\b/.test(haystack) ||
        /\bcontrol\s+(group|arm|variant)/.test(haystack) ||
        /\blift\b/.test(haystack) ||
        /minimum[- ]detectable[- ]effect/.test(haystack)) {
      return true;
    }
  }

  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * A/B Testing is a wave-3 architect — the lone wave-3 entry per spec §3.3.
 * Depends on Analytics (`eventTaxonomy`, `funnelDefinitions`,
 * `conversionGoals`) and Feature Flagging (`flagsSchema`) per spec §2.13.
 * Precedence rank 6 per the canonical ladder — statistical-correctness
 * outranks operability concerns but sits below security, devops,
 * accessibility, SEO, and performance because incorrect-but-significant
 * experiment results are recoverable while a security/legal breach is not.
 */
export const AB_TESTING_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['analytics', 'featureFlagging'],
  precedenceLevel: 6,
  fanoutPolicy: 'conditional',
  appliesPredicate: abTestingArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const ABTestingArchitectContract: ArchitectSectionContract = {
  contractId: 'ab-testing-architect.v1',
  architectName: 'abTesting',
  version: '0.1.0',
  sections: AB_TESTING_OWNED_SECTIONS,
  architectMeta: AB_TESTING_ARCHITECT_META
};
