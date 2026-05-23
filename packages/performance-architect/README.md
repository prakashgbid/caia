# @caia/performance-architect

Architect #6 of CAIA's 17-architect EA fan-out. Senior frontend performance engineer focused on Core Web Vitals (LCP/INP/CLS), Lighthouse budgets, JavaScript bundle analysis, and image/font optimization.

## What it owns

`performance.*` slice of the `tickets.architecture` JSONB column:

- `performance.coreWebVitalsBudgets` — per-page-type LCP/INP/CLS/TTFB targets (mobile + desktop)
- `performance.bundleSizeBudget` — per-route gzip + brotli JavaScript budget
- `performance.imageOptimizationPlan` — `next/image` config (AVIF→WebP→fallback, breakpoints, LCP candidate)
- `performance.fontOptimizationPlan` — `next/font` config (display=swap, preload, subsetting, self-host)
- `performance.lazyLoadStrategy` — per-component eager/lazy/dynamic decisions
- `performance.cacheStrategy` — three-tier cache plan (CDN + browser + server)
- `performance.criticalRenderPath` — above-the-fold render priorities (preload, defer, inline-CSS)
- `performance.lighthouseBudgets` — Lighthouse category floors (Perf ≥ 90, SEO ≥ 95, A11y ≥ 95, BP ≥ 90)

## What it does NOT do

No component code. No database. No API endpoints. No CSS authoring. No test specs. Other architects own those concerns and the contract rejects out-of-namespace writes. This architect SPECIFIES the perf budgets the build must enforce — the Frontend coding worker and DevOps' `lighthouse-ci` gate are what enforce them.

## Depends on

Frontend Architect (`@caia/frontend-architect`, PR #537 — merged). Reads `frontend.framework`, `frontend.componentTree`, and `frontend.tokens` from the upstream output. If the Frontend upstream is absent, surfaces a `risks[]` callout and emits best-effort budgets from the design + ticket alone.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1). The EA Dispatcher spawns one of these per applicable ticket (Page, Widget, Story, Form, List). Each spawn calls `@chiefaia/claude-spawner` (subscription-only, no API-key billing) with Sonnet default. Returns a structured `ArchitectOutput` the Dispatcher composes into the ticket's `architecture` JSONB.

## Quick start

```ts
import { PerformanceArchitect } from '@caia/performance-architect';

const architect = new PerformanceArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: { frontend: frontendArchitectOutput } },
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

The test suite includes interface compliance, contract structural checks, registration disjointness, output validation, run() idempotency, dependency declaration, cross-architect invariants, and an end-to-end golden test against a known prakash-tiwari Widget ticket. The golden test verifies that Core Web Vitals budgets stay at the "Good" thresholds per page type (e.g., article-page LCP target ≤ 2.5s).

## Future tools

V1 has empty `tools = []`. A future Lighthouse-CI MCP tool will let the architect run lighthouse-ci against a synthesised preview at architect-spawn time (deterministic budget pre-check before the full build gate).
