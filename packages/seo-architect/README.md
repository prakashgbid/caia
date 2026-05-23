# @caia/seo-architect

Architect **#4 of 17** in CAIA's EA fan-out. Owns the `seo.*` slice of the `tickets.architecture` JSONB column. Mirrors the canonical Frontend Architect template (merged PR #537).

## What it owns

- `seo.schemaOrgJsonLd` — schema.org JSON-LD payload (Article / BlogPosting / FAQPage / Person / Organization / Product / WebSite)
- `seo.canonicalUrl` — canonical absolute URL (mandatory; resolves duplicate-content)
- `seo.metaTags` — `<meta>` tags including `title`, `description`, viewport, robots, theme-color
- `seo.ogTags` — Open Graph tags (`og:title`, `og:description`, `og:type`, `og:url`, `og:image`)
- `seo.twitterCard` — Twitter Card tags (`twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`)
- `seo.sitemapEntry` — `sitemap.xml` entry shape (loc, lastmod, changefreq, priority)
- `seo.robotsDirective` — per-page robots rule (index/noindex, follow/nofollow, max-snippet, etc.)
- `seo.keywordTargets` — primary + secondary keyword targets (intent-tagged)
- `seo.pageType` — discriminator that drives the JSON-LD `@type` choice (Article / BlogPosting / FAQPage / Person / Organization / Product / WebSite / etc.)

## What it does NOT do

No component code (Frontend), no backend endpoints (Backend), no database schema (Database), no CSP rules (Security), no Core Web Vitals budgets (Performance). The contract rejects writes outside `seo.*`.

## How it runs

Implements `SpecialistArchitect` from `@caia/architect-kit` per spec §1.1. The EA Dispatcher spawns one of these per applicable Page ticket. Each spawn calls `@chiefaia/claude-spawner` (subscription-only, no API-key billing) with Sonnet default. Returns an `ArchitectOutput` the Dispatcher composes into the ticket's `architecture` JSONB.

Wave-1 architect (`dependsOn: []`). Precedence rank **4** per spec §5.2 — SEO is a locked playbook non-negotiable; ranks above Performance and Frontend, below Security/DevOps/A11y.

## Quick start

```ts
import { SeoArchitect, SeoArchitectContract } from '@caia/seo-architect';

const architect = new SeoArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: {} },
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Testing

```bash
pnpm test        # full Vitest suite (≥30 tests)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

The test suite covers interface compliance, contract structural checks, registration disjointness, output validation, run() idempotency, dependency declaration, cross-architect invariants, and a **golden test verifying schema.org JSON-LD validates against Google's Rich Results format constraints** (`@context`, `@type`, type-specific required props).

## SEO posture (locked)

- Exactly one canonical URL per page (mandatory; absolute, HTTPS).
- Exactly one schema.org JSON-LD payload per page (no orphan stub).
- `pageType` discriminator drives `@type`:
  - Article / BlogPosting → `headline`, `datePublished`, `author`, `image`
  - FAQPage → `mainEntity[]` with `Question`/`Answer` pairs
  - Person → `name`, optional `jobTitle`, `image`, `sameAs[]`
  - Organization → `name`, `url`, `logo`, optional `sameAs[]`
  - Product → `name`, `image`, `description`, `offers`
  - WebSite → `name`, `url`, optional `potentialAction` for sitelinks search
- OG image at 1200×630 (Facebook/LinkedIn) and a Twitter image at the same or larger ratio.
- Sitemap entry mandatory unless `robotsDirective.index === 'noindex'`.
- `keywordTargets` flag a single primary keyword + ≤5 secondary keywords.
