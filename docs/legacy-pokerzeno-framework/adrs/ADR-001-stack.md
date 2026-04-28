# ADR-001: Frontend Stack

**Date**: 2026-04-01
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

We're building a network of card game community sites — poker strategy, roulette guides, blackjack tips. Sites are primarily content (articles, tip lists, rule explanations) with light interactivity: search, a quiz widget, and optional user accounts for saving progress. The stack needs to:

- Support 20-150 sites without per-site operational overhead
- Produce fast, SEO-friendly pages (organic search is the primary acquisition channel)
- Reuse components and logic across sites
- Work within a zero-server-cost constraint at the hosting layer

---

## Decision

**Next.js 15 with `output: 'export'`**, TypeScript strict mode, Tailwind CSS v4, React 19.

Key configuration choices that follow from this:
- `output: 'export'` in `next.config.ts` — generates static HTML files, no Node server
- `trailingSlash: true` — required for Cloudflare Pages SPA routing (see L-07)
- `images.unoptimized: true` — `next/image` optimization requires a server; we handle image optimization at build time via `sharp` directly (see L-02)
- No `app/api/` routes — they don't work with static export; use Supabase Edge Functions instead (see ADR-005)
- TypeScript strict mode (`"strict": true` in tsconfig) — non-negotiable across all sites

---

## Consequences

**Positive**:
- Zero cold-start latency — pages are HTML files on a CDN edge, not server renders
- Full Cloudflare Pages compatibility (static files only)
- React ecosystem: hooks, component libraries, testing tooling all available
- Next.js handles routing, metadata API, and link prefetching without custom setup

**Negative / Trade-offs**:
- Cannot do server-side user sessions in the traditional sense. Auth state is managed client-side via Supabase Auth JWT stored in `localStorage`/cookies — acceptable for our use case
- Dynamic routes (e.g., `/tips/[slug]`) must have all slugs known at build time via `generateStaticParams`. If content is added post-deploy, a rebuild is required
- `next/image` optimization disabled. We pre-optimize images at build time using a `scripts/optimize-images.ts` script

---

## Alternatives Considered

**Astro** — rejected. Astro is excellent for content sites but the component model (`.astro` files) creates friction when reusing React components from `@pokerzeno/ui`. Team already has React fluency. Migration cost outweighs the minor bundle-size benefit.

**Remix** — rejected. Remix requires a server. Even Cloudflare Workers deployment adds operational complexity and costs money at scale. The framework is fundamentally designed for server-side rendering; fighting it to produce static output is the wrong approach.

**Plain React (Vite SPA)** — rejected. No built-in routing (would need React Router), no metadata API, no `generateStaticParams` equivalent. We'd be rebuilding what Next.js provides. SSG with dynamic routes is a solved problem in Next.js; it isn't in a plain Vite setup.

**Gatsby** — rejected. Slower builds than Next.js at scale, smaller community, GraphQL data layer adds complexity we don't need.
