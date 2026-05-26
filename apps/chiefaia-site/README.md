# @caia-app/chiefaia-site

ChiefAIA marketing site — Next.js 15 + App Router.

## What's here

| Surface | Path | Status |
|---------|------|--------|
| Home | `/` | Live (operator-confirmed copy) |
| Pricing | `/pricing` | Live (tier copy confirmed; $$ TBD) |
| Docs index | `/docs` | Live (cards) |
| Docs category | `/docs/<slug>` | "Coming soon" stub |
| Blog index | `/blog` | Live |
| Blog post | `/blog/<slug>` | Live (1 launch post) |
| Changelog | `/changelog` | Auto-generated from `git log origin/develop` |
| Contact | `/contact` | Live (form → `/api/contact` stub) |
| Sign-in | `/sign-in` | Server-redirects to dashboard.chiefaia.com (Cloudflare Access) |
| Sitemap | `/sitemap.xml` | Auto |
| Robots | `/robots.txt` | Auto |
| Manifest | `/manifest.webmanifest` | Auto |

## Reuse-first

All UI primitives come from `@caia/ui` (operator-locked 2026-05-25, ADR-065).
Inline shadcn / Radix / Tailwind component-copying is refused by the
`reuse-advisory-blocking` CI gate. Frame-level layout classes (header, footer,
grid) are intentional and live exactly once in `components/site-shell.tsx`.

## No fabricated content

Per `agent-memory/feedback_action_research_outputs.md` and the operator
standing rule: no fabricated metrics, no fabricated testimonials, no
fabricated authorship. The blog has no per-post author byline by design
(the publisher entity is the byline via `schema.org/Organization`).

## Run locally

```bash
pnpm --filter @caia-app/chiefaia-site dev    # http://localhost:7878
pnpm --filter @caia-app/chiefaia-site build
pnpm --filter @caia-app/chiefaia-site start
pnpm --filter @caia-app/chiefaia-site test
pnpm --filter @caia-app/chiefaia-site lighthouse
```

The `prebuild` and `predev` hooks regenerate `lib/changelog.data.json` from
`git log origin/develop` (last 30 PR-shaped commits).

## SEO surface

- `app/layout.tsx` — OpenGraph + Twitter Card metadata
- `app/sitemap.ts` — `MetadataRoute.Sitemap` generator
- `app/robots.ts` — `MetadataRoute.Robots` generator
- `app/manifest.ts` — `MetadataRoute.Manifest` (PWA shell)
- `lib/jsonld.ts` — schema.org `Organization` + `WebSite` graph rendered in
  the root layout `<head>`

## Lighthouse

`lighthouserc.cjs` boots `next start -p 7878` and asserts performance ≥ 0.90,
accessibility ≥ 0.90, best-practices ≥ 0.90, SEO ≥ 0.90 across the canonical
routes.
