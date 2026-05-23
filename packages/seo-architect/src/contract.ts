/**
 * `SeoArchitectContract` — the canonical owned-fields declaration for
 * architect #4 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.4 (SEO Architect owns `seo.*`)
 *   - task brief (schemaOrgJsonLd, canonicalUrl, metaTags, ogTags,
 *     twitterCard, sitemapEntry, robotsDirective, keywordTargets, pageType)
 *
 * The owned set below tracks the task brief field names. Every field is
 * `required: true` because downstream architects (Performance, A11y,
 * Analytics) read these — missing fields cascade into broken Open Graph
 * cards, malformed sitemaps, and Rich Results validation errors.
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. The chosen keys all live under the `seo.*`
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
export const SEO_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'seo.schemaOrgJsonLd':
    'Emit a single JSON-LD object with @context "https://schema.org" and @type matching `pageType`. Include the required props for that @type (e.g. Article → headline+datePublished+author+image). Validate against Google Rich Results format.',
  'seo.canonicalUrl':
    'Always absolute HTTPS. One per page. If the page is a noindex variant, the canonical still points at the indexable version.',
  'seo.metaTags':
    'Always include {title, description, viewport, robots}. Title 50–60 chars; description 140–160 chars. theme-color picks up brand.primary from the business plan.',
  'seo.ogTags':
    'Required Open Graph keys: og:title, og:description, og:type, og:url, og:image. Image must be 1200×630 (Facebook/LinkedIn floor).',
  'seo.twitterCard':
    'Use twitter:card=summary_large_image when an OG image is present; otherwise summary. Mirror og:title/description.',
  'seo.sitemapEntry':
    'Always emit a sitemap entry unless robotsDirective.index === "noindex". Use ISO-8601 lastmod. priority defaults to 0.5; promote landing pages to 1.0.',
  'seo.robotsDirective':
    'Default to {index:"index", follow:"follow"}. Use noindex only for auth pages, search results, faceted listings, and similar non-canonical URLs.',
  'seo.keywordTargets':
    'Exactly one primary keyword (intent + search-volume tag). ≤5 secondary keywords. Tag intent: navigational | informational | transactional | commercial.',
  'seo.pageType':
    'Discriminator. Drives the schema.org @type choice. Allowed values: Article | BlogPosting | FAQPage | Person | Organization | Product | WebSite | LocalBusiness | Event | Recipe | CollectionPage.'
};

/**
 * The owned section specs in stable order.
 */
export const SEO_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'seo.pageType',
    description:
      'Discriminator that drives the schema.org @type choice — Article | BlogPosting | FAQPage | Person | Organization | Product | WebSite | LocalBusiness | Event | Recipe | CollectionPage.',
    required: true
  },
  {
    path: 'seo.schemaOrgJsonLd',
    description:
      'Schema.org JSON-LD payload. @context must be "https://schema.org"; @type must match `pageType`; required props per type must be present. Validates against Google Rich Results format.',
    required: true
  },
  {
    path: 'seo.canonicalUrl',
    description:
      'Canonical absolute HTTPS URL. Mandatory. Resolves duplicate-content collisions across query-string + locale variants.',
    required: true
  },
  {
    path: 'seo.metaTags',
    description:
      'HTML `<meta>` tags including title, description, viewport, robots, theme-color. Title 50–60 chars; description 140–160 chars.',
    required: true
  },
  {
    path: 'seo.ogTags',
    description:
      'Open Graph tags: og:title, og:description, og:type, og:url, og:image (1200×630). Drives link unfurls on Facebook + LinkedIn + Slack.',
    required: true
  },
  {
    path: 'seo.twitterCard',
    description:
      'Twitter Card tags: twitter:card, twitter:title, twitter:description, twitter:image. summary_large_image when og:image present; summary otherwise.',
    required: true
  },
  {
    path: 'seo.sitemapEntry',
    description:
      'sitemap.xml entry: loc (canonical URL), lastmod (ISO-8601), changefreq, priority (0..1). Omit when robotsDirective.index === "noindex".',
    required: true
  },
  {
    path: 'seo.robotsDirective',
    description:
      'Per-page robots rule: {index:"index"|"noindex", follow:"follow"|"nofollow", maxSnippet?, maxImagePreview?, maxVideoPreview?}.',
    required: true
  },
  {
    path: 'seo.keywordTargets',
    description:
      'Primary + secondary keyword targets with intent tags (navigational | informational | transactional | commercial).',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const SEO_OWNED_FIELD_KEYS: readonly string[] = SEO_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §3.3 — SEO only applies to Page tickets. Widgets and Form/List
 * sub-stories do not get their own SEO header set; they inherit from the
 * Page they're embedded under.
 */
export function seoArchitectAppliesPredicate(ticket: Ticket): boolean {
  return ticket.type === 'Page';
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * SEO is a wave-1 architect (`dependsOn: []`) per spec §2.4 table —
 * reads only the ticket + intake + design. Precedence rank 4 per spec
 * §5.2 — high; SEO posture is a locked playbook non-negotiable. Ranks
 * above Performance and Frontend; below Security/DevOps/A11y.
 */
export const SEO_ARCHITECT_META: ArchitectMeta = {
  dependsOn: [],
  precedenceLevel: 4,
  fanoutPolicy: 'always',
  appliesPredicate: seoArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const SeoArchitectContract: ArchitectSectionContract = {
  contractId: 'seo-architect.v1',
  architectName: 'seo',
  version: '0.1.0',
  sections: SEO_OWNED_SECTIONS,
  architectMeta: SEO_ARCHITECT_META
};
