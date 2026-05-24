/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari Widget ticket WITH a synthesised Frontend
 *     upstream output (since Analytics is wave-2 and depends on Frontend).
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari Widget fixture.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { ANALYTICS_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * The known-good Frontend upstream output for the prakash-tiwari hero
 * widget. Pinned here so the Analytics architect's tests don't depend
 * on the Frontend package being importable from tests (the workspace
 * symlink would work, but pinning is cheaper to maintain).
 *
 * Shape mirrors `frontend-architect`'s goldenExpectedOutput() exactly.
 * The component IDs must match: `hero`, `hero-portrait`, `hero-title`,
 * `hero-tagline`, `hero-cta-primary`, `hero-cta-secondary`. Of these,
 * only `hero-cta-primary` and `hero-cta-secondary` are interactive.
 */
function buildFrontendUpstreamOutput(): ArchitectOutput {
  return {
    architectName: 'frontend',
    architectureFields: {
      'frontend.framework': { name: 'next', version: '15.x', router: 'app' },
      'frontend.componentLibrary': {
        name: 'shadcn/ui',
        tailwindVersion: '3.x',
        radixVersion: '1.x'
      },
      'frontend.stateMgmt': {
        default: 'server',
        clientStore: 'zustand',
        forms: 'react-hook-form'
      },
      'frontend.routeConfig': {
        segment: 'app/artists/[slug]',
        layoutSegment: 'app/artists',
        loadingBoundary: true,
        errorBoundary: true,
        dynamicSegments: ['[slug]']
      },
      'frontend.tokens': {
        'color.brand.primary': '#0f3057',
        'color.brand.accent': '#e8c547',
        'color.text.body': '#1f1f1f',
        'color.bg.canvas': '#f7f5ef',
        'space.4': '16px',
        'space.8': '32px',
        'space.16': '64px',
        'radius.md': '8px',
        'radius.lg': '12px',
        'type.display.size': '48px',
        'type.body.size': '16px'
      },
      'frontend.breakpoints': ['sm', 'md', 'lg', 'xl'],
      'frontend.componentTree': [
        {
          id: 'hero',
          kind: 'section',
          propsContractRef: 'hero',
          children: [
            { id: 'hero-portrait', kind: 'Image', propsContractRef: 'hero-portrait' },
            { id: 'hero-title', kind: 'h1', propsContractRef: 'hero-title' },
            { id: 'hero-tagline', kind: 'p', propsContractRef: 'hero-tagline' },
            {
              id: 'hero-cta-primary',
              kind: 'Button',
              propsContractRef: 'hero-cta-primary'
            },
            {
              id: 'hero-cta-secondary',
              kind: 'Button',
              propsContractRef: 'hero-cta-secondary'
            }
          ]
        }
      ],
      'frontend.interactionStates': {
        'hero-cta-primary': {
          hover: 'darker brand fill',
          focus: 'visible ring',
          active: 'inset shadow',
          error: 'n/a',
          empty: 'n/a',
          loading: 'inline spinner replacing label',
          disabled: '50% opacity, no pointer events'
        },
        'hero-cta-secondary': {
          hover: 'darker accent fill',
          focus: 'visible ring',
          active: 'inset shadow',
          error: 'n/a',
          empty: 'n/a',
          loading: 'inline spinner replacing label',
          disabled: '50% opacity, no pointer events'
        }
      }
    },
    confidence: 0.88,
    notes: 'Frontend golden output for prakash-tiwari hero widget.',
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
 * The canonical fixture — a Widget ticket from the prakash-tiwari.com
 * marketing site (an `ArtistHeroBio` widget) with the Frontend upstream
 * output already populated.
 */
export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-001',
      type: 'Widget',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'CTA clicks emit cookieless events captured without consent gate.',
        'No PII (email, phone, name) appears in any event payload.',
        'Conversion funnel from page_view → cta_clicked → booking_started is defined.',
        'DNT + GPC signals trigger auto-deny with no banner shown.'
      ],
      business_requirements: {
        title: 'Artist hero bio widget',
        description:
          'Above-the-fold hero block for the artist profile page — portrait photo, name, tagline, primary CTA ("Book session"), secondary CTA ("View portfolio"). Primary goal: drive booking conversions.'
      },
      quality_tags: ['ui', 'analytics', 'privacy']
    },
    upstream: {
      outputs: {
        frontend: buildFrontendUpstreamOutput()
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
        },
        {
          anchorId: 'hero-cta-secondary',
          kind: 'button',
          bbox: { x: 820, y: 320, w: 200, h: 56 },
          meta: { variant: 'secondary' }
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
 * The known-good output for the prakash-tiwari Widget fixture. Covers
 * exactly the 14 owned `analytics.*` fields, scoped to the two
 * interactive components (the CTAs) + a single conversion funnel.
 *
 * IMPORTANT: this fixture is the golden "what good looks like" for the
 * no-PII-without-consent invariant. The privacy-compliance test reads
 * it and asserts no email/phone/name fields appear in any event
 * payload AND that consentMode.default.analytics_storage === 'denied'.
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'analytics',
    architectureFields: {
      'analytics.provider': {
        primary: 'plausible',
        secondary: 'ga4',
        cookielessBaseline: true,
        consentGatedAdvanced: true
      },
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
          payloadSchema: {
            componentId: 'string',
            variant: 'string',
            destination: 'string'
          },
          consentRequired: 'none',
          noPii: true,
          category: 'cta'
        },
        cta_clicked_secondary: {
          eventName: 'cta_clicked',
          trigger: 'hero-cta-secondary:click',
          payloadSchema: {
            componentId: 'string',
            variant: 'string',
            destination: 'string'
          },
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
        }
      },
      'analytics.userIdentificationStrategy': {
        defaultTier: 'anonymous',
        tiers: {
          anonymous: { idSource: 'none', scope: 'session' },
          pseudonymous: {
            idSource: 'clientId',
            consentRequired: 'analytics_storage',
            scope: 'persistent-30d'
          },
          authenticated: {
            idSource: 'authUserId',
            consentRequired: 'analytics_storage',
            scope: 'persistent',
            piiAllowedFields: []
          }
        }
      },
      'analytics.funnelDefinitions': {
        booking_funnel: {
          name: 'Booking conversion',
          steps: ['page_view', 'cta_clicked_primary', 'booking_started'],
          window: '7d'
        }
      },
      'analytics.consentMode': {
        version: 'v2',
        default: {
          analytics_storage: 'denied',
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
          functionality_storage: 'granted',
          security_storage: 'granted'
        },
        updatePolicy: 'on-user-grant',
        iabTcf: false
      },
      'analytics.consentGatingRules': {
        page: 'none',
        engagement: 'none',
        conversion: 'analytics_storage',
        content: 'none',
        commerce: 'analytics_storage',
        community: 'analytics_storage',
        cta: 'none'
      },
      'analytics.noPiiRule': {
        attested: true,
        denylistRegex: [
          '@\\S+\\.\\S+',
          '\\+?\\d{7,}',
          'ip:.*',
          'geo:precise',
          'userAgent:full'
        ],
        perEventNotes:
          'each event payload audited against denylist before emit; CI gate enforces in @chiefaia/analytics test suite'
      },
      'analytics.privacyCompliance': {
        gdpr: true,
        ccpa: true,
        cookieBanner: true,
        dntRespect: true,
        gpcRespect: true,
        dataMinimisation: true,
        retentionDays: 425,
        subjectAccessRequestEndpoint: '/api/privacy/sar'
      },
      'analytics.conversionGoals': {
        primary: 'booking_started',
        secondary: ['cta_clicked_primary']
      },
      'analytics.dashboardLinks': {
        plausible: 'https://plausible.io/prakash-tiwari',
        ga4: 'https://analytics.google.com/analytics/web/#/p<propertyId>'
      },
      'analytics.dataTrackAttributes': {
        'hero-cta-primary': {
          'data-track-event': 'cta_clicked_primary',
          'data-track-payload':
            '{"componentId":"hero-cta-primary","variant":"primary","destination":"/book"}'
        },
        'hero-cta-secondary': {
          'data-track-event': 'cta_clicked_secondary',
          'data-track-payload':
            '{"componentId":"hero-cta-secondary","variant":"secondary","destination":"/portfolio"}'
        }
      },
      'analytics.sessionStrategy': {
        windowMinutes: 30,
        identityTier: 'anonymous',
        crossDomain: false,
        crossDevice: false,
        reattributionWindow: '24h'
      },
      'analytics.customDimensions': {
        tenantId: { scope: 'event-or-user', pii: false },
        planTier: { scope: 'user', pii: false },
        persona: { scope: 'user', pii: false },
        locale: { scope: 'user', pii: false }
      },
      'analytics.dataResidencyRequirements': {
        plausible: { region: 'eu', subProcessors: ['plausible-eu'] },
        ga4: {
          region: 'europe-west',
          subProcessors: ['google-llc'],
          transferMechanism: 'SCC'
        }
      }
    },
    confidence: 0.9,
    notes:
      'Analytics spec for hero widget. Plausible (cookieless, EU) + GA4 (consent-gated). 4 events: page_view, two cta_clicked variants (cookieless), booking_started (consent-gated). Conversion funnel page_view → cta_clicked_primary → booking_started. EU residency. DNT + GPC respected. 14-month retention ceiling. Zero PII fields across every payload.',
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
 * Compose the Analytics output's architectureFields with a synthesised
 * Frontend slice so the cross-architect invariants can be exercised
 * against a "composed" view. Used by the invariants test pass.
 */
export function composedArchitectureForInvariants(): Readonly<Record<string, unknown>> {
  const analytics = goldenExpectedOutput().architectureFields;
  const frontend = buildFrontendUpstreamOutput().architectureFields;
  return { ...analytics, ...frontend };
}

/**
 * Asserts that the input covers every required owned field. Sanity check
 * for fixtures.
 */
export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of ANALYTICS_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
