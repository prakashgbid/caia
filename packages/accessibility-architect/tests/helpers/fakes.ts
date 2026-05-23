/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari Widget ticket WITH a synthesised Frontend
 *     upstream output (since A11y is wave-2 and depends on Frontend).
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari Widget fixture.
 */

import type { ArchitectInput, ArchitectOutput } from '../src/types.js';

import { A11Y_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * The known-good Frontend upstream output for the prakash-tiwari hero
 * widget. Pinned here so the A11y architect's tests don't depend on the
 * Frontend package being importable from tests (the workspace symlink
 * would work, but pinning is cheaper to maintain).
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
      'frontend.a11yFloor': {
        'hero-cta-primary': { element: 'button', tabOrder: 1, focusTrap: false },
        'hero-cta-secondary': { element: 'button', tabOrder: 2, focusTrap: false }
      },
      'frontend.motionPreference': {
        reducedMotionGate: true,
        gateThresholdMs: 200,
        alwaysOnAnimations: []
      },
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
        'Hero CTA "Book session" is keyboard-reachable in <2 Tab presses from page load.',
        'On <640px viewports, portrait stacks above bio text.',
        'All design tokens trace back to the intake IR; no invented values.',
        'Reduced-motion users see no animation on hover.'
      ],
      business_requirements: {
        title: 'Artist hero bio widget',
        description:
          'Above-the-fold hero block for the artist profile page — portrait photo, name, tagline, primary CTA ("Book session"), secondary CTA ("View portfolio").'
      },
      quality_tags: ['ui', 'a11y']
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
          anchorId: 'hero-portrait',
          kind: 'image',
          bbox: { x: 80, y: 80, w: 480, h: 600 },
          meta: { aspect: '4/5' }
        },
        {
          anchorId: 'hero-title',
          kind: 'heading',
          bbox: { x: 600, y: 120, w: 700, h: 80 },
          meta: { level: 1 }
        },
        {
          anchorId: 'hero-tagline',
          kind: 'text',
          bbox: { x: 600, y: 220, w: 700, h: 60 }
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
 * The known-good output for the prakash-tiwari Widget fixture. Covers
 * exactly the 9 owned `a11y.*` fields, scoped to the two interactive
 * components (the CTAs).
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'accessibility',
    architectureFields: {
      'a11y.wcagLevel': '2.2 AA',
      'a11y.ariaRoles': {
        // Both CTAs are native <button> — no role override needed.
        // Empty map is the correct V1 output for this ticket.
      },
      'a11y.ariaLabels': {
        'hero-cta-primary': {
          source: 'visibleText',
          value: 'prop:label'
        },
        'hero-cta-secondary': {
          source: 'visibleText',
          value: 'prop:label'
        }
      },
      'a11y.keyboardNavigationPlan': {
        'hero-cta-primary': {
          tabOrder: 1,
          keys: { Enter: 'activate', Space: 'activate' }
        },
        'hero-cta-secondary': {
          tabOrder: 2,
          keys: { Enter: 'activate', Space: 'activate' }
        }
      },
      'a11y.focusManagementNotes': {
        'hero-cta-primary': {
          trap: false,
          initialFocus: null,
          returnFocusTo: null,
          ringSpec: 'focus-visible: 2px ring color.brand.primary offset 2px'
        },
        'hero-cta-secondary': {
          trap: false,
          initialFocus: null,
          returnFocusTo: null,
          ringSpec: 'focus-visible: 2px ring color.brand.accent offset 2px'
        }
      },
      'a11y.colorContrastRequirements': {
        'hero-cta-primary.label': {
          fg: 'color.bg.canvas',
          bg: 'color.brand.primary',
          minRatio: 4.5,
          rule: 'wcag-2.2-AA-1.4.3'
        },
        'hero-cta-secondary.label': {
          fg: 'color.text.body',
          bg: 'color.brand.accent',
          minRatio: 4.5,
          rule: 'wcag-2.2-AA-1.4.3'
        },
        'hero-title.text': {
          fg: 'color.text.body',
          bg: 'color.bg.canvas',
          minRatio: 3,
          rule: 'wcag-2.2-AA-1.4.3-large'
        },
        'hero-tagline.text': {
          fg: 'color.text.body',
          bg: 'color.bg.canvas',
          minRatio: 4.5,
          rule: 'wcag-2.2-AA-1.4.3'
        }
      },
      'a11y.screenReaderAnnouncementPoints': {
        'hero-cta-primary': {
          liveRegion: 'off',
          events: ['async-loaded']
        },
        'hero-cta-secondary': {
          liveRegion: 'off',
          events: []
        }
      },
      'a11y.reducedMotionConsiderations': {
        animations: []
      },
      'a11y.formAccessibilitySpec': {
        // Hero widget has no forms — empty object is the correct V1 output.
      }
    },
    confidence: 0.9,
    notes:
      'Accessibility spec for hero widget. Native <button> semantics — no ARIA role overrides needed. Both CTAs spec keyboard + focus + contrast. No forms, no live regions beyond async-load announcement on the primary CTA. No animations >200ms in the design.',
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
 * Compose the A11y output's architectureFields with a synthesised
 * Frontend slice so the cross-architect invariants can be exercised
 * against a "composed" view. Used by the invariants test pass.
 */
export function composedArchitectureForInvariants(): Readonly<Record<string, unknown>> {
  const a11y = goldenExpectedOutput().architectureFields;
  const frontend = buildFrontendUpstreamOutput().architectureFields;
  return { ...a11y, ...frontend };
}

/**
 * Asserts that the input covers every required owned field. Sanity check
 * for fixtures.
 */
export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of A11Y_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
