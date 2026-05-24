/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari Story ticket with upstream Frontend +
 *     Backend output. The golden test uses this.
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari Story fixture.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { FEATURE_FLAGGING_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * The canonical fixture — a Story ticket ("New booking flow") from the
 * prakash-tiwari.com marketing site. Includes upstream Frontend +
 * Backend output so the architect has something to flag.
 */
export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-042',
      type: 'Story',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'New booking flow ships behind a flag, default off in production.',
        'Operator can roll out canary → 10% → 50% → 100% with auto-promote on clean error rate.',
        'Kill switch flips in <30 seconds without a deploy.',
        'Every flag toggle emits an audit log entry to default Cloudwatch sink.'
      ],
      business_requirements: {
        title: 'New booking flow with A/B test',
        description:
          'Replace the legacy booking form with a streamlined three-step flow. Ship behind a feature flag; canary to 10% of tenants, observe completion rate vs. control, promote to 100% on win.'
      },
      quality_tags: ['flag', 'rollout', 'ab-test', 'payments']
    },
    upstream: {
      outputs: {
        frontend: {
          architectName: 'frontend',
          architectureFields: {
            'frontend.componentTree': [
              {
                id: 'booking-shell',
                kind: 'section',
                children: [
                  { id: 'booking-step-1', kind: 'Form' },
                  { id: 'booking-step-2', kind: 'Form' },
                  { id: 'booking-step-3', kind: 'Form' },
                  { id: 'booking-submit', kind: 'Button' }
                ]
              }
            ],
            'frontend.interactionStates': {
              'booking-submit': {
                hover: 'darker brand fill',
                focus: 'visible ring',
                active: 'inset shadow',
                error: 'inline error message',
                empty: 'n/a',
                loading: 'spinner replacing label',
                disabled: '50% opacity'
              }
            }
          },
          confidence: 0.9,
          notes: 'Booking shell projected as a single section.',
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
        },
        backend: {
          architectName: 'backend',
          architectureFields: {
            'backend.apiEndpoints': [
              {
                method: 'POST',
                path: '/api/v1/bookings',
                purpose: 'Create a booking — drives payment authorization.'
              },
              {
                method: 'GET',
                path: '/api/v1/bookings/[id]',
                purpose: 'Fetch a booking by id.'
              }
            ]
          },
          confidence: 0.85,
          notes: 'Two endpoints: POST creates + auths payment, GET reads.',
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
        }
      }
    },
    businessPlan: {
      ventureName: 'Prakash Tiwari Studio',
      oneLiner: 'Bespoke artist session booking for the Prakash Tiwari portrait studio.',
      audience: "High-intent prospective sitters in the artist's metropolitan area.",
      goals: [
        'Drive booking completions',
        'Reduce drop-off in the booking funnel',
        'Validate the streamlined three-step variant via A/B test'
      ],
      brandVoice: 'warm + grounded',
      constraints: ['Must not break legacy booking links in customer emails']
    },
    designVersion: {
      versionId: 'design-pt-v4-2026-05-23',
      snapshotUri: 's3://atlas/designs/design-pt-v4-2026-05-23.png',
      anchors: [
        {
          anchorId: 'booking-shell',
          kind: 'section',
          bbox: { x: 0, y: 0, w: 1440, h: 900 }
        }
      ],
      tokens: {
        'color.brand.primary': '#0f3057',
        'space.4': '16px'
      },
      breakpoints: ['sm', 'md', 'lg', 'xl']
    },
    tenantContext: {
      tenantId: 'tenant-prakash-tiwari',
      schemaName: 'pt_001',
      vaultNamespace: 'tenant/prakash-tiwari',
      billingPosture: 'subscription',
      creditBalance: { usdAvailable: 25 }
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
 * The known-good output for the prakash-tiwari Story fixture.
 *
 * Two flags:
 *   - `ticket-pt-042.new-booking-flow` (boolean) — gates the new UI shell;
 *     canary rollout; kill switch (blast radius: payments); drives A/B
 *     test.
 *   - `ticket-pt-042.payment-auth-on` (boolean) — kill switch for
 *     payment authorization itself (blast radius: payments); all-at-once
 *     rollout (it's always on by default; the switch exists for
 *     incident response).
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'featureFlagging',
    architectureFields: {
      'featureFlags.flagsSchema': [
        {
          name: 'ticket-pt-042.new-booking-flow',
          type: 'boolean',
          description: 'Gates the new three-step booking flow UI.',
          defaults: {
            dev: true,
            staging: false,
            production: false
          },
          audience: {
            kind: 'percentage',
            value: 0
          }
        },
        {
          name: 'ticket-pt-042.payment-auth-on',
          type: 'boolean',
          description: 'Kill switch for payment authorization in the booking flow.',
          defaults: {
            dev: true,
            staging: true,
            production: true
          },
          audience: {
            kind: 'everyone'
          }
        }
      ],
      'featureFlags.rolloutStrategies': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          kind: 'canary',
          steps: [
            { stage: 'canary', percent: 1, gateMetric: 'error_rate<0.5%', soakMinutes: 30 },
            { stage: 'early', percent: 10, gateMetric: 'error_rate<0.5%', soakMinutes: 60 },
            {
              stage: 'broad',
              percent: 50,
              gateMetric: 'error_rate<0.5%',
              soakMinutes: 120
            },
            { stage: 'ga', percent: 100 }
          ],
          autoPromote: true,
          rollbackTrigger: '5xx_rate>2x_baseline'
        },
        {
          flag: 'ticket-pt-042.payment-auth-on',
          kind: 'all-at-once',
          steps: [{ stage: 'ga', percent: 100 }],
          autoPromote: false,
          rollbackTrigger: 'manual-only'
        }
      ],
      'featureFlags.killSwitches': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          blastRadius: 'payments',
          instantToggle: true,
          bypassReviewQuorum: true,
          notificationChannels: ['pager:oncall', 'slack:#payments-incidents']
        },
        {
          flag: 'ticket-pt-042.payment-auth-on',
          blastRadius: 'payments',
          instantToggle: true,
          bypassReviewQuorum: true,
          notificationChannels: ['pager:oncall', 'slack:#payments-incidents']
        }
      ],
      'featureFlags.experimentationLinkage': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          abTestId: 'abtest-pending',
          variants: [
            { variantKey: 'control', flagValue: false, allocation: 0.5 },
            { variantKey: 'treatment', flagValue: true, allocation: 0.5 }
          ],
          holdoutPercent: 5,
          primaryMetric: 'booking_completed',
          startDate: '2026-06-01',
          durationCapDays: 28
        }
      ],
      'featureFlags.auditRequirements': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          toggleRoles: ['operator', 'oncall'],
          requiresChangeRecord: true,
          auditLogSink: 'default-cloudwatch',
          retentionDays: 365,
          reviewCadenceDays: 90
        },
        {
          flag: 'ticket-pt-042.payment-auth-on',
          toggleRoles: ['operator', 'oncall'],
          requiresChangeRecord: true,
          auditLogSink: 'default-cloudwatch',
          retentionDays: 365,
          reviewCadenceDays: 90
        }
      ]
    },
    confidence: 0.86,
    notes:
      'Two flags: the booking-flow gate (canary 1/10/50/100 with auto-promote on clean 5xx) and a payment-auth kill switch (always-on, manual flip only on incident). Both have kill switches because blast radius is "payments". Forward-references A/B Testing via experimentationLinkage with a 5% holdout. Audit posture: default Cloudwatch sink, 365-day retention, 90-day stale review.',
    dependencies: ['ticket-pt-041'],
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

/** The canonical assistant text — `JSON.stringify(goldenExpectedOutput())`. */
export function goldenAssistantText(): string {
  return JSON.stringify(goldenExpectedOutput());
}

/**
 * Fabricate an `ArchitectSpawnerFn` that returns the given text on every
 * call. Records every call for assertions.
 */
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

/** Fabricate a spawner that returns the canonical golden assistant text. */
export function fakeGoldenSpawner(): FakeSpawner {
  return fakeSpawnerReturning(goldenAssistantText());
}

/**
 * Asserts that the input covers every required owned field. Sanity check
 * for fixtures.
 */
export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of FEATURE_FLAGGING_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
