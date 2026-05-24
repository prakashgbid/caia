/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari Widget ticket WITH synthesised Analytics +
 *     Feature Flagging upstream outputs.
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari Widget fixture.
 *
 *   - `composedArchitectureForInvariants()` — combines the Analytics +
 *     Feature Flagging + A/B Testing slices into the composed view the
 *     EA Reviewer sees post-Dispatcher, exercising the cross-architect
 *     invariants.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { AB_TESTING_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * The known-good Analytics upstream output. The eventTaxonomy contains
 * page_view, cta_clicked_primary, cta_clicked_secondary, booking_started
 * PLUS page_load_time + error_emitted (added here so we have
 * guardrail-eligible events).
 */
function buildAnalyticsUpstreamOutput(): ArchitectOutput {
  return {
    architectName: 'analytics',
    architectureFields: {
      'analytics.eventTaxonomy': {
        page_view: {
          eventName: 'page_view',
          trigger: 'router:navigate',
          payloadSchema: { path: 'string', referrer: 'string?' },
          consentRequired: 'none',
          noPii: true,
          category: 'page'
        },
        cta_clicked_primary: {
          eventName: 'cta_clicked',
          trigger: 'hero-cta-primary:click',
          payloadSchema: { componentId: 'string', variant: 'string', destination: 'string' },
          consentRequired: 'none',
          noPii: true,
          category: 'cta'
        },
        cta_clicked_secondary: {
          eventName: 'cta_clicked',
          trigger: 'hero-cta-secondary:click',
          payloadSchema: { componentId: 'string', variant: 'string', destination: 'string' },
          consentRequired: 'none',
          noPii: true,
          category: 'cta'
        },
        booking_started: {
          eventName: 'booking_started',
          trigger: 'hero-cta-primary:downstream-route-loaded',
          payloadSchema: { entrySurface: 'string' },
          consentRequired: 'analytics_storage',
          noPii: true,
          category: 'conversion'
        },
        page_load_time: {
          eventName: 'page_load_time',
          trigger: 'navigation:complete',
          payloadSchema: { ms: 'number', path: 'string' },
          consentRequired: 'none',
          noPii: true,
          category: 'page'
        },
        error_emitted: {
          eventName: 'error_emitted',
          trigger: 'window:error',
          payloadSchema: { kind: 'string', count: 'number' },
          consentRequired: 'none',
          noPii: true,
          category: 'engagement'
        }
      },
      'analytics.funnelDefinitions': {
        booking_funnel: {
          name: 'Booking conversion',
          steps: ['page_view', 'cta_clicked_primary', 'booking_started'],
          window: '7d'
        }
      },
      'analytics.conversionGoals': {
        primary: 'booking_started',
        secondary: ['cta_clicked_primary']
      }
    },
    confidence: 0.9,
    notes: 'Analytics golden output for prakash-tiwari hero widget.',
    dependencies: [],
    risks: [],
    toolCalls: [],
    spend: {
      inputTokens: 0,
      outputTokens: 0,
      usdCost: 0,
      wallClockMs: 0,
      model: 'sonnet'
    },
    status: 'ok'
  };
}

/**
 * The known-good Feature Flagging upstream output. Pre-stages
 * `exp_hero_cta_2026_05` so the A/B Testing architect's flag-key choice
 * matches.
 */
function buildFeatureFlaggingUpstreamOutput(): ArchitectOutput {
  return {
    architectName: 'featureFlagging',
    architectureFields: {
      'featureFlagging.flagsSchema': {
        exp_hero_cta_2026_05: {
          kind: 'string-variant',
          variants: ['control', 'treatment'],
          defaultValue: 'control',
          killSwitch: 'exp_hero_cta_2026_05_kill',
          owner: 'experimentation-team'
        }
      }
    },
    confidence: 0.85,
    notes: 'Feature flag scaffolded for hero-cta experiment.',
    dependencies: [],
    risks: [],
    toolCalls: [],
    spend: {
      inputTokens: 0,
      outputTokens: 0,
      usdCost: 0,
      wallClockMs: 0,
      model: 'sonnet'
    },
    status: 'ok'
  };
}

/**
 * The canonical fixture — a Widget ticket from prakash-tiwari.com
 * marked experimental, with both Analytics and Feature Flagging upstream
 * outputs populated.
 */
export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-ab-001',
      type: 'Widget',
      scope: 'story',
      parent_id: null,
      experimental: true,
      quality_tags: ['ui', 'analytics', 'ab-test', 'experiment'],
      acceptance_criteria: [
        'Treatment CTA copy lifts booking_started conversion by ≥5% relative vs. control.',
        'Variant assignment is sticky per user across sessions.',
        'Experiment auto-terminates at 28 days regardless of significance.',
        'SRM check is active and halts the experiment on failure.',
        'Holdout group is preserved across the entire experiment lifecycle.'
      ],
      business_requirements: {
        title: 'A/B test hero CTA copy variants',
        description:
          'Experiment: does treatment CTA copy ("Book a session") drive more bookings than control ("Reserve your slot")? Baseline conversion rate ~12%. Interview answer: 10% relative lift would be meaningful.',
        experimentMetric: 'booking_started',
        mdePct: 10,
        baselineConversionRatePct: 12
      }
    },
    upstream: {
      outputs: {
        analytics: buildAnalyticsUpstreamOutput(),
        featureFlagging: buildFeatureFlaggingUpstreamOutput()
      }
    },
    businessPlan: {
      ventureName: 'Prakash Tiwari Studio',
      oneLiner: 'Bespoke artist session booking for the Prakash Tiwari portrait studio.',
      audience: "High-intent prospective sitters in the artist's metropolitan area.",
      goals: [
        'Drive contact-form submissions',
        'Project warm + grounded brand voice',
        "Make the booking CTA the page's primary action"
      ],
      brandVoice: 'warm + grounded',
      constraints: ['No third-party fonts beyond next/font defaults']
    },
    designVersion: {
      versionId: 'design-pt-v3-2026-05-22',
      snapshotUri: 's3://atlas/designs/design-pt-v3-2026-05-22.png',
      anchors: [
        {
          anchorId: 'hero',
          kind: 'section',
          bbox: { x: 0, y: 0, w: 1440, h: 720 },
          meta: { variant: 'hero', breakpoints: ['sm', 'md', 'lg', 'xl'] }
        },
        {
          anchorId: 'hero-cta-primary',
          kind: 'button',
          bbox: { x: 600, y: 320, w: 200, h: 56 },
          meta: { variant: 'primary' }
        }
      ],
      tokens: {
        'color.brand.primary': '#0f3057',
        'color.brand.accent': '#e8c547'
      },
      breakpoints: ['sm', 'md', 'lg', 'xl']
    },
    tenantContext: {
      tenantId: 'tenant-prakash-tiwari',
      schemaName: 'pt_001',
      vaultNamespace: 'tenant/prakash-tiwari',
      billingPosture: 'subscription',
      creditBalance: { usdAvailable: 25 },
      compliance: { dataResidency: 'EU' }
    },
    budget: {
      maxInputTokens: 60_000,
      maxOutputTokens: 8_000,
      maxWallClockMs: 60_000,
      preferredModel: 'sonnet',
      hardCostCeilingUsd: 0.5
    }
  };
}

/**
 * The known-good output for the prakash-tiwari Widget fixture.
 *
 * Sample-size math (the golden statistical-rigor lock):
 *   baseline p1 = 0.12 ; relative MDE = 10% ⇒ p2 = 0.132 ; delta = 0.012
 *   alpha = 0.05 (two-tailed) ⇒ Z_{α/2} ≈ 1.96
 *   power = 0.8 ⇒ Z_β ≈ 0.8416
 *   leading constant (Z_{α/2} + Z_β)^2 ≈ 7.849
 *   variance term p1(1-p1) + p2(1-p2) = 0.1056 + 0.114576 = 0.220176
 *   perVariantN ≈ 7.849 · 0.220176 / (0.012)^2 ≈ 12,002
 * We round to 12,000 per variant; totalN = 24,000 (2 variants).
 *
 * IMPORTANT: this fixture is the golden "what good looks like" for the
 * sample-size-matches-MDE invariant. The `sampleSize-matches-mde` test
 * reads it and asserts the reference computation comes within ±20%.
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'abTesting',
    architectureFields: {
      'abTesting.experimentDesign': {
        hypothesis:
          'Treatment CTA copy ("Book a session") will increase booking_started conversion by at least 10% relative versus control ("Reserve your slot") within a 28-day window.',
        primaryMetricId: 'booking_started',
        guardrailMetricIds: ['page_load_time', 'error_emitted'],
        expectedEffectSizePct: 10,
        minimumDetectableEffectPct: 10,
        baselineConversionRatePct: 12,
        direction: 'increase'
      },
      'abTesting.variantRoutingStrategy': {
        kind: 'sticky-user',
        hashSeed: 'exp_hero_cta_2026_05',
        salt: 'pt-ab-2026-05-24',
        stickinessKey: 'userId',
        variants: [
          { id: 'control', name: 'Control — "Reserve your slot"', allocationPct: 50 },
          { id: 'treatment', name: 'Treatment — "Book a session"', allocationPct: 50 }
        ]
      },
      'abTesting.sampleSizeRequirements': {
        perVariantN: 12000,
        totalN: 24000,
        powerCalcMethod: 'two-proportion-z-test',
        alpha: 0.05,
        power: 0.8,
        mdePct: 10,
        baselinePct: 12,
        estimatedDurationDays: 12
      },
      'abTesting.randomizationUnit': {
        unit: 'user',
        reason:
          'User-level randomization prevents within-user carryover — booking is a once-per-week-ish action, sessions are too short to capture conversion.'
      },
      'abTesting.holdoutAnalysisPlan': {
        holdoutPct: 5,
        holdoutGroupId: 'holdout_exp_hero_cta_2026_05',
        durationDays: 90,
        analysisCadence: 'monthly',
        successCriteria:
          'Lift persists vs. holdout at p<0.05 across 90-day post-promotion window — confirms no novelty/Hawthorne decay.'
      },
      'abTesting.statisticalReadoutMethod': {
        kind: 'frequentist',
        alpha: 0.05,
        power: 0.8,
        multipleComparisonsCorrection: 'none'
      },
      'abTesting.experimentLifecycle': {
        currentPhase: 'draft',
        transitions: [
          {
            from: 'draft',
            to: 'running',
            gateChecks: [
              'srm-enabled',
              'sampleSize-computed',
              'guardrails-defined',
              'flag-provisioned'
            ]
          },
          {
            from: 'running',
            to: 'analysis',
            gateChecks: ['sampleSizeFloor-reached', 'srm-passing', 'duration-not-capped']
          },
          {
            from: 'analysis',
            to: 'decided',
            gateChecks: ['primary-metric-significant', 'guardrails-respected']
          },
          {
            from: 'decided',
            to: 'archived',
            gateChecks: ['promotion-applied', 'flag-archived']
          }
        ],
        gateChecks: {
          'srm-enabled': 'daily SRM check active with alpha=0.001',
          'sampleSize-computed': 'perVariantN matches closed-form z-test ±20%',
          'guardrails-defined': 'at least one guardrail metric declared',
          'flag-provisioned': 'featureFlagDependencies.flagKey exists in flagsSchema',
          'sampleSizeFloor-reached': 'perVariantN reached in observed data',
          'srm-passing': 'daily SRM chi-square > alpha',
          'duration-not-capped': 'wall-clock < durationCap.maxDays',
          'primary-metric-significant': 'p < alpha on primary metric',
          'guardrails-respected': 'no guardrail exceeded tolerance',
          'promotion-applied': 'flag default flipped to winning variant',
          'flag-archived': 'flag marked archived in flagsSchema'
        }
      },
      'abTesting.featureFlagDependencies': {
        flagKey: 'exp_hero_cta_2026_05',
        expectedFlagShape: 'string-variant',
        requiredVariants: ['control', 'treatment'],
        killSwitchKey: 'exp_hero_cta_2026_05_kill',
        defaultVariantOnDisable: 'control'
      },
      'abTesting.primaryMetric': {
        eventId: 'booking_started',
        metricType: 'conversion',
        aggregation: 'unique-users',
        successDirection: 'increase'
      },
      'abTesting.secondaryMetrics': [
        {
          eventId: 'cta_clicked_primary',
          metricType: 'count',
          aggregation: 'sum',
          successDirection: 'increase',
          guardrail: false
        },
        {
          eventId: 'cta_clicked_secondary',
          metricType: 'count',
          aggregation: 'sum',
          successDirection: 'increase',
          guardrail: false
        }
      ],
      'abTesting.guardrailMetrics': [
        {
          eventId: 'page_load_time',
          metricType: 'continuous',
          aggregation: 'mean',
          direction: 'non-increase',
          tolerancePct: 5
        },
        {
          eventId: 'error_emitted',
          metricType: 'count',
          aggregation: 'sum',
          direction: 'non-increase',
          tolerancePct: 10
        }
      ],
      'abTesting.allocation': {
        control: 50,
        treatment: 50
      },
      'abTesting.winnerPromotionPolicy': {
        auto: true,
        criteria: {
          pValueBelow: 0.05,
          srmPass: true,
          minDurationDays: 7,
          guardrailsRespected: true,
          sampleSizeFloorReached: true
        },
        fallback: 'manual-review'
      },
      'abTesting.durationCap': {
        maxDays: 28,
        hardStop: true,
        reasonForCap: 'Spec §2.13 — prevents indefinite running on tied outcomes.'
      },
      'abTesting.srmCheck': {
        enabled: true,
        alpha: 0.001,
        schedule: 'daily',
        actionOnFail: 'halt-and-alert'
      }
    },
    confidence: 0.9,
    notes:
      'A/B test spec for hero CTA copy. Sticky-by-user routing. Baseline 12%, 10% relative MDE → 12k per variant via two-proportion z-test (α=0.05, power=0.8). 50/50 split. Primary metric: booking_started. Guardrails: page_load_time (≤5%), error_emitted (≤10%). 5% holdout, 90-day post-promotion analysis. 28-day duration cap with hard-stop. SRM daily at α=0.001. Auto-promote on all-gates pass; otherwise manual review.',
    dependencies: [],
    risks: [],
    toolCalls: [],
    spend: {
      inputTokens: 0,
      outputTokens: 0,
      usdCost: 0,
      wallClockMs: 0,
      model: 'sonnet'
    },
    status: 'ok'
  };
}

export function goldenAssistantText(): string {
  return JSON.stringify(goldenExpectedOutput());
}

export interface FakeSpawner {
  fn: ArchitectSpawnerFn;
  calls: ArchitectSpawnInput[];
}

export function fakeSpawnerReturning(text: string, ok = true): FakeSpawner {
  const calls: ArchitectSpawnInput[] = [];
  const fn: ArchitectSpawnerFn = async (
    input: ArchitectSpawnInput
  ): Promise<ArchitectSpawnOutput> => {
    calls.push(input);
    return {
      text,
      inputTokens: 1000,
      outputTokens: 500,
      usdCost: 0.01,
      wallClockMs: 1234,
      model: input.budget.preferredModel,
      ok,
      diagnostic: ok ? null : 'forced failure'
    };
  };
  return { fn, calls };
}

export function fakeGoldenSpawner(): FakeSpawner {
  return fakeSpawnerReturning(goldenAssistantText());
}

export function composedArchitectureForInvariants(): Readonly<Record<string, unknown>> {
  const abTesting = goldenExpectedOutput().architectureFields;
  const analytics = buildAnalyticsUpstreamOutput().architectureFields;
  const featureFlagging = buildFeatureFlaggingUpstreamOutput().architectureFields;
  return { ...abTesting, ...analytics, ...featureFlagging };
}

export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of AB_TESTING_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
