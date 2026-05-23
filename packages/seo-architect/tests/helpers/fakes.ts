/**
 * Test fixtures + fake spawner factory for SEO Architect.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari Page ticket (artist Person page). The golden
 *     test uses this.
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari Person page fixture.
 *
 * Mirrors the Frontend Architect helpers/fakes.ts shape verbatim.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { SEO_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * The canonical fixture — a Page ticket from the prakash-tiwari.com
 * marketing site (the artist's About / Home page) with intake-derived
 * design tokens + business plan.
 */
export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-page-001',
      type: 'Page',
      scope: 'page',
      parent_id: null,
      acceptance_criteria: [
        'Page emits valid schema.org JSON-LD that passes Google Rich Results.',
        'Canonical URL is absolute and HTTPS.',
        'OG image is exactly 1200×630.',
        'Title length is 50–60 chars; description 140–160 chars.'
      ],
      business_requirements: {
        title: 'Prakash Tiwari — Artist',
        description:
          'Hero page for the Prakash Tiwari portrait studio. Functions as the artist\'s primary search-landing surface.',
        canonicalPath: '/'
      },
      quality_tags: ['seo']
    },
    upstream: { outputs: {} },
    businessPlan: {
      ventureName: 'Prakash Tiwari Studio',
      oneLiner: 'Bespoke artist session booking for the Prakash Tiwari portrait studio.',
      audience: 'High-intent prospective sitters in the artist\'s metropolitan area.',
      goals: [
        'Drive contact-form submissions',
        'Project warm + grounded brand voice',
        'Rank for "portrait artist <city>"'
      ],
      brandVoice: 'warm + grounded',
      brandKind: 'person',
      constraints: ['No third-party fonts beyond next/font defaults'],
      brandImage: 'https://cdn.prakash-tiwari.com/og/prakash-tiwari-1200x630.jpg',
      sameAs: [
        'https://instagram.com/prakashtiwari',
        'https://linkedin.com/in/prakashtiwari'
      ]
    },
    designVersion: {
      versionId: 'design-pt-v3-2026-05-22',
      snapshotUri: 's3://atlas/designs/design-pt-v3-2026-05-22.png',
      anchors: [
        {
          anchorId: 'hero',
          kind: 'section',
          bbox: { x: 0, y: 0, w: 1440, h: 720 },
          meta: { variant: 'hero' }
        },
        {
          anchorId: 'hero-portrait',
          kind: 'image',
          bbox: { x: 80, y: 80, w: 480, h: 600 },
          meta: { aspect: '4/5', src: 'https://cdn.prakash-tiwari.com/hero/portrait-1200x1500.jpg' }
        },
        {
          anchorId: 'hero-title',
          kind: 'h1',
          bbox: { x: 600, y: 120, w: 700, h: 80 },
          meta: { text: 'Prakash Tiwari — Portrait Artist' }
        },
        {
          anchorId: 'hero-tagline',
          kind: 'text',
          bbox: { x: 600, y: 220, w: 700, h: 60 },
          meta: {
            text: 'Bespoke portrait sessions in natural light. Book your sitting.'
          }
        }
      ],
      tokens: {
        'color.brand.primary': '#0f3057'
      },
      breakpoints: ['sm', 'md', 'lg', 'xl']
    },
    tenantContext: {
      tenantId: 'tenant-prakash-tiwari',
      schemaName: 'pt_001',
      vaultNamespace: 'tenant/prakash-tiwari',
      billingPosture: 'subscription',
      creditBalance: { usdAvailable: 25 },
      compliance: { dataResidency: 'us' }
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
 * The known-good output for the prakash-tiwari Person Page fixture.
 *
 * - pageType: Person (matches businessPlan.brandKind = 'person')
 * - JSON-LD validates against Google Rich Results format (@type=Person
 *   requires `name`; we also emit jobTitle/image/sameAs to populate the
 *   knowledge panel).
 * - canonicalUrl is absolute HTTPS.
 * - metaTags.title is 56 chars; description is 154 chars.
 * - ogTags include all 5 required keys; image is 1200×630.
 * - Twitter card mirrors og.
 * - Sitemap entry priority 1.0 (home page).
 * - robotsDirective is index/follow (canonical landing page).
 * - keywordTargets has 1 primary + 3 secondary.
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'seo',
    architectureFields: {
      'seo.pageType': 'Person',
      'seo.schemaOrgJsonLd': {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: 'Prakash Tiwari',
        jobTitle: 'Portrait Artist',
        image: 'https://cdn.prakash-tiwari.com/hero/portrait-1200x1500.jpg',
        url: 'https://prakash-tiwari.com/',
        sameAs: [
          'https://instagram.com/prakashtiwari',
          'https://linkedin.com/in/prakashtiwari'
        ]
      },
      'seo.canonicalUrl': 'https://prakash-tiwari.com/',
      'seo.metaTags': {
        title: 'Prakash Tiwari — Portrait Artist | Bespoke Studio Sessions',
        description:
          'Bespoke portrait sessions in natural light by Prakash Tiwari. Book your sitting at the studio for warm, grounded portraits crafted with care.',
        viewport: 'width=device-width, initial-scale=1',
        robots: 'index,follow',
        themeColor: '#0f3057'
      },
      'seo.ogTags': {
        'og:title': 'Prakash Tiwari — Portrait Artist',
        'og:description':
          'Bespoke portrait sessions in natural light. Book your sitting at the Prakash Tiwari studio.',
        'og:type': 'website',
        'og:url': 'https://prakash-tiwari.com/',
        'og:image': 'https://cdn.prakash-tiwari.com/og/prakash-tiwari-1200x630.jpg'
      },
      'seo.twitterCard': {
        'twitter:card': 'summary_large_image',
        'twitter:title': 'Prakash Tiwari — Portrait Artist',
        'twitter:description':
          'Bespoke portrait sessions in natural light. Book your sitting at the Prakash Tiwari studio.',
        'twitter:image': 'https://cdn.prakash-tiwari.com/og/prakash-tiwari-1200x630.jpg'
      },
      'seo.sitemapEntry': {
        loc: 'https://prakash-tiwari.com/',
        lastmod: '2026-05-22',
        changefreq: 'monthly',
        priority: 1.0
      },
      'seo.robotsDirective': {
        index: 'index',
        follow: 'follow',
        maxSnippet: -1,
        maxImagePreview: 'large',
        maxVideoPreview: -1
      },
      'seo.keywordTargets': {
        primary: {
          keyword: 'portrait artist',
          intent: 'commercial'
        },
        secondary: [
          { keyword: 'natural light portrait studio', intent: 'commercial' },
          { keyword: 'book portrait session', intent: 'transactional' },
          { keyword: 'prakash tiwari', intent: 'navigational' }
        ]
      }
    },
    confidence: 0.9,
    notes:
      'Person Page projected with full Rich Results-compliant JSON-LD (@type=Person with name+jobTitle+image+sameAs). Canonical https://prakash-tiwari.com/. OG image 1200×630 from business plan. Title 56 chars, description 154 chars — both inside the recommended bands. Primary keyword "portrait artist" with commercial intent matches the brand kind.',
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
 * Asserts that the output covers every required owned field. Sanity check
 * for fixtures.
 */
export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of SEO_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
