# ADR-007: Content Strategy

**Date**: 2026-04-20
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

Every new PokerZeno site needs rich SEO-ready content from day one. A poker tips site launched with 3 articles won't rank. A new site needs 40-80 pieces of quality content to be viable. The challenge:

- Writing 60 articles manually per site at 2-3 sites per month is unsustainable
- Content must be structured (filterable by skill level, topic, game type) — not just blog posts
- Content needs to be fast to seed but easy to edit by humans afterward
- Some sites may eventually need a CMS for non-developer edits; the architecture should not block this

---

## Decision

**YAML-driven content seeding via `@pokerzeno/content-engine`**. Content lives in TypeScript arrays in `src/data/*.ts`. The `content-engine` CLI generates initial seed content; humans edit after.

```
pnpm dlx @pokerzeno/content-engine seed --site poker-tips --count 60
```

This generates `src/data/tips.ts`, `src/data/articles.ts`, `src/data/faqs.ts` with structured TypeScript arrays. Each content item has:

```typescript
type Tip = {
  id: string;
  title: string;
  slug: string;         // used in generateStaticParams
  body: string;         // markdown string
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  tags: string[];
  publishedAt: string;  // ISO date
};
```

Routes are statically generated from these arrays via `generateStaticParams`. No database reads at build time.

### Content Editing Workflow

After seed:
1. Developer opens `src/data/tips.ts` in their editor
2. Edits/expands content manually or with AI assistance
3. Commits and deploys — build regenerates all pages

For sites that need live CMS editing later, a migration path exists:
- `src/data/*.ts` arrays can be replaced by a `content-engine` adapter that reads from Sanity or Contentlayer
- The page components don't change — they still receive typed content arrays as props
- This is a future upgrade, not a day-one requirement

---

## Consequences

**Positive**:
- New site gets 60 seeded articles in < 5 minutes
- Content is type-safe — title can't be undefined, slug format is validated at TypeScript level
- `generateStaticParams` uses the same arrays — routing and content are always in sync
- No external CMS dependency at launch — faster setup, no API keys, no rate limits at build time

**Negative / Trade-offs**:
- Adding content requires a code change + redeploy. This is a constraint but acceptable for a solo founder who is already making code changes regularly. CI/CD deploys in ~3 minutes
- Content is in the repository — each site's repo will grow as content grows. At 500 articles with average 800-word bodies (~4KB each), that's ~2MB of content. Acceptable
- Seeded content requires human editing to be genuinely useful. The seed is a scaffold, not finished copy

---

## Alternatives Considered

**Headless CMS (Sanity, Contentful, Hygraph)** — rejected for MVP. Adds a paid service dependency (Contentful free tier is limited, Sanity is generous but still a dependency), requires CMS schema setup per site, and adds an API call at build time. The abstraction layer in `content-engine` means we can add Sanity later for any site without changing page components.

**Markdown files in `/content` directory** — considered. Simpler than TypeScript arrays, familiar pattern. Rejected because TypeScript arrays are: (a) type-safe, (b) importable without filesystem reads at build time, (c) easier to generate programmatically. Markdown frontmatter parsing adds a dependency (gray-matter or remark).

**Database-driven content** — rejected. Requires network call at build time (or at runtime which isn't possible with `output: 'export'`). Static content arrays are faster and simpler for sites that don't update content in real-time.
