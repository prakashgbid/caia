/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The Reviewer applies a fixed set of cross-architect predicates after
 * composition. This module enumerates SEO's contributions so the
 * Reviewer's `invariants-registry.ts` can collect them at process boot.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'seo.schemaOrgJsonLd'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `seo.*` path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path. This lets the
 * same invariants run inside the SEO package's own tests AND
 * inside the Reviewer's post-composition pass.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 */

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  /** Architect that contributed this invariant. */
  contributor: string;
  /** Other architects whose fields this invariant reads. */
  reads: readonly string[];
  /** Severity if the predicate returns false. */
  severity: InvariantSeverity;
  /** Operator-facing description for the Reviewer's audit log. */
  description: string;
  /**
   * The predicate. Receives the JSONB blob (flat-keyed
   * `architectureFields` view OR nested composed-architecture view).
   * Pure + synchronous.
   */
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

/**
 * Read a field from the architecture blob. Tries the flat dotted key
 * first (matches `architectureFields` shape), then falls back to walking
 * the nested object path (matches composed-architecture shape).
 */
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
 * Google Rich Results format — the per-`@type` required props the
 * Reviewer enforces. Sourced from
 * https://developers.google.com/search/docs/appearance/structured-data/
 * (Article, BlogPosting, FAQPage, Person, Organization, Product, WebSite).
 *
 * Exported so the golden test can call the same predicate directly and
 * the Reviewer can re-use it across tenants.
 */
export const RICH_RESULTS_REQUIRED_PROPS: Readonly<Record<string, readonly string[]>> = {
  Article: ['headline', 'datePublished', 'author', 'image'],
  BlogPosting: ['headline', 'datePublished', 'author', 'image'],
  FAQPage: ['mainEntity'],
  Person: ['name'],
  Organization: ['name', 'url', 'logo'],
  Product: ['name', 'image', 'description', 'offers'],
  WebSite: ['name', 'url'],
  LocalBusiness: ['name', 'address'],
  Event: ['name', 'startDate', 'location'],
  Recipe: ['name', 'image', 'recipeIngredient', 'recipeInstructions'],
  CollectionPage: ['name']
};

/**
 * Validate a single JSON-LD payload against Google Rich Results format.
 * Returns `true` iff:
 *   - `@context === "https://schema.org"`
 *   - `@type` matches the supplied `pageType`
 *   - `@type` is one of the known Rich Results types
 *   - every required prop for that `@type` is present and truthy
 *
 * Exported so the golden test can call it directly.
 */
export function validateRichResults(
  jsonLd: unknown,
  pageType: unknown
): boolean {
  if (typeof jsonLd !== 'object' || jsonLd === null || Array.isArray(jsonLd)) return false;
  const obj = jsonLd as Record<string, unknown>;

  if (obj['@context'] !== 'https://schema.org') return false;

  const declaredType = obj['@type'];
  if (typeof declaredType !== 'string') return false;
  if (typeof pageType !== 'string' || pageType !== declaredType) return false;

  const required = RICH_RESULTS_REQUIRED_PROPS[declaredType];
  if (!required) return false; // unknown @type — Rich Results doesn't cover it

  for (const prop of required) {
    const val = obj[prop];
    if (val === undefined || val === null || val === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
  }

  // FAQPage extra structural check — mainEntity entries must be Q&A pairs.
  if (declaredType === 'FAQPage') {
    const main = obj.mainEntity;
    if (!Array.isArray(main) || main.length === 0) return false;
    for (const entry of main) {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as Record<string, unknown>;
      if (e['@type'] !== 'Question') return false;
      if (typeof e.name !== 'string' || e.name.length === 0) return false;
      const ans = e.acceptedAnswer;
      if (typeof ans !== 'object' || ans === null) return false;
      const a = ans as Record<string, unknown>;
      if (a['@type'] !== 'Answer') return false;
      if (typeof a.text !== 'string' || a.text.length === 0) return false;
    }
  }

  return true;
}

/**
 * SEO's contributed invariants. Listed in stable order.
 */
export const SEO_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'seo.schemaOrgJsonLd-validates-rich-results',
    contributor: 'seo',
    reads: ['seo.schemaOrgJsonLd', 'seo.pageType'],
    severity: 'fail',
    description:
      'The schema.org JSON-LD must validate against Google Rich Results format: @context = "https://schema.org", @type matches pageType, and every per-type required prop is populated.',
    detect(arch): boolean {
      const jsonLd = readField(arch, 'seo.schemaOrgJsonLd');
      const pageType = readField(arch, 'seo.pageType');
      return validateRichResults(jsonLd, pageType);
    }
  },
  {
    id: 'seo.canonicalUrl-is-https-absolute',
    contributor: 'seo',
    reads: ['seo.canonicalUrl'],
    severity: 'fail',
    description:
      'Canonical URL must be absolute and HTTPS. Relative URLs and HTTP variants cause duplicate-content penalties and broken share previews.',
    detect(arch): boolean {
      const url = readField(arch, 'seo.canonicalUrl');
      return typeof url === 'string' && url.startsWith('https://');
    }
  },
  {
    id: 'seo.metaTags-has-title-and-description',
    contributor: 'seo',
    reads: ['seo.metaTags'],
    severity: 'fail',
    description:
      'metaTags must include both `title` and `description`. Both are mandatory for any indexable page.',
    detect(arch): boolean {
      const tags = readField(arch, 'seo.metaTags');
      if (typeof tags !== 'object' || tags === null) return false;
      const obj = tags as Record<string, unknown>;
      return typeof obj.title === 'string' && typeof obj.description === 'string';
    }
  },
  {
    id: 'seo.ogTags-include-required-keys',
    contributor: 'seo',
    reads: ['seo.ogTags'],
    severity: 'fail',
    description:
      'Open Graph tags must include og:title, og:description, og:type, og:url, og:image. Missing keys break Facebook/LinkedIn/Slack link unfurls.',
    detect(arch): boolean {
      const tags = readField(arch, 'seo.ogTags');
      if (typeof tags !== 'object' || tags === null) return false;
      const obj = tags as Record<string, unknown>;
      const required = ['og:title', 'og:description', 'og:type', 'og:url', 'og:image'];
      for (const k of required) {
        if (typeof obj[k] !== 'string' || (obj[k] as string).length === 0) return false;
      }
      return true;
    }
  },
  {
    id: 'seo.twitterCard-mirrors-og',
    contributor: 'seo',
    reads: ['seo.twitterCard'],
    severity: 'advisory',
    description:
      'Twitter Card must declare twitter:card; if og:image is present, prefer summary_large_image. Missing twitter:card degrades the Twitter unfurl.',
    detect(arch): boolean {
      const tags = readField(arch, 'seo.twitterCard');
      if (typeof tags !== 'object' || tags === null) return false;
      const obj = tags as Record<string, unknown>;
      const card = obj['twitter:card'];
      return typeof card === 'string' && ['summary', 'summary_large_image', 'app', 'player'].includes(card);
    }
  },
  {
    id: 'seo.robotsDirective-has-index-and-follow',
    contributor: 'seo',
    reads: ['seo.robotsDirective'],
    severity: 'fail',
    description:
      'robotsDirective must declare both `index` and `follow`. Default to ("index","follow"); use noindex deliberately for non-canonical URLs.',
    detect(arch): boolean {
      const dir = readField(arch, 'seo.robotsDirective');
      if (typeof dir !== 'object' || dir === null) return false;
      const obj = dir as Record<string, unknown>;
      const idx = obj.index;
      const fol = obj.follow;
      return (
        (idx === 'index' || idx === 'noindex') &&
        (fol === 'follow' || fol === 'nofollow')
      );
    }
  },
  {
    id: 'seo.sitemapEntry-present-when-indexable',
    contributor: 'seo',
    reads: ['seo.sitemapEntry', 'seo.robotsDirective'],
    severity: 'advisory',
    description:
      'Indexable pages must declare a sitemap entry. If robotsDirective.index === "noindex" the entry can be omitted; otherwise it is mandatory.',
    detect(arch): boolean {
      const robots = readField(arch, 'seo.robotsDirective');
      const noindex =
        typeof robots === 'object' &&
        robots !== null &&
        (robots as Record<string, unknown>).index === 'noindex';
      const entry = readField(arch, 'seo.sitemapEntry');
      if (noindex) return true; // entry optional when noindex
      if (typeof entry !== 'object' || entry === null) return false;
      const obj = entry as Record<string, unknown>;
      return typeof obj.loc === 'string' && obj.loc.length > 0;
    }
  },
  {
    id: 'seo.keywordTargets-has-primary',
    contributor: 'seo',
    reads: ['seo.keywordTargets'],
    severity: 'fail',
    description:
      'keywordTargets must declare exactly one primary keyword and ≤5 secondary keywords.',
    detect(arch): boolean {
      const tgt = readField(arch, 'seo.keywordTargets');
      if (typeof tgt !== 'object' || tgt === null) return false;
      const obj = tgt as Record<string, unknown>;
      const primary = obj.primary;
      if (typeof primary !== 'object' || primary === null) return false;
      const p = primary as Record<string, unknown>;
      if (typeof p.keyword !== 'string' || p.keyword.length === 0) return false;
      const secondary = obj.secondary;
      if (secondary !== undefined && !Array.isArray(secondary)) return false;
      if (Array.isArray(secondary) && secondary.length > 5) return false;
      return true;
    }
  },
  {
    id: 'seo.pageType-is-known-rich-results-type',
    contributor: 'seo',
    reads: ['seo.pageType'],
    severity: 'fail',
    description:
      'pageType must be one of the known Rich Results @types — Article | BlogPosting | FAQPage | Person | Organization | Product | WebSite | LocalBusiness | Event | Recipe | CollectionPage.',
    detect(arch): boolean {
      const pt = readField(arch, 'seo.pageType');
      if (typeof pt !== 'string') return false;
      return Object.prototype.hasOwnProperty.call(RICH_RESULTS_REQUIRED_PROPS, pt);
    }
  }
];
