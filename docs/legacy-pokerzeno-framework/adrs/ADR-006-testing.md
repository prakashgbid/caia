# ADR-006: Testing Strategy

**Date**: 2026-04-20
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

With 20-150 sites sharing the same template and packages, a regression in a shared package can break every site simultaneously. We need automated quality gates that:

- Run fast enough to not impede development (< 2 minutes for unit + component tests)
- Catch accessibility regressions before deploy (a11y is non-negotiable — see locks/accessibility-lock.md)
- Validate the static build output, not just the source code
- Are consistent across all sites (same `verify:all` command everywhere)

---

## Decision

**Three-layer testing stack**:

### Layer 1: Vitest — Unit and Component Tests

For testing pure functions (card hand evaluators, odds calculators, content formatters) and React components in isolation.

```bash
pnpm run test          # run once
pnpm run test:watch    # watch mode
```

Configuration: `vitest.config.ts` in site root. Uses `@testing-library/react` for component tests. Coverage threshold: 80% for `@pokerzeno/backend-core`, 60% for site code.

### Layer 2: Playwright — E2E and Accessibility Smoke Tests

Runs against the locally-served static build (`pnpm run preview` — serves the `out/` directory). Not against a dev server.

```bash
pnpm run test:e2e
```

Every site must have at minimum:
- `homepage.spec.ts` — loads `/`, checks title, no console errors, no 404s on critical assets
- `a11y.spec.ts` — runs `axe-core` via `@axe-core/playwright` on the homepage and one content page
- `navigation.spec.ts` — clicks through main nav, verifies no broken links to key pages

Configuration: `playwright.config.ts` with `baseURL` from `process.env.BASE_URL` (defaults to `http://localhost:3000`). CI sets `BASE_URL` to the preview deployment URL.

### Layer 3: @pokerzeno/integrity-check — Static File Validation

Validates the `out/` directory after build. Checks every `.html` file for required structural elements.

```bash
pnpm run verify:integrity
```

Checks enforced:
- `<a href="#main-content">` (skip-to-content link) — must exist in every page
- `<main id="main-content">` — main landmark required
- `<html lang="...">` — language attribute required
- `<title>` — non-empty title required
- No `<img>` without `alt` attribute
- No `<input>` without `for`-linked `<label>` or `aria-label`

### The `verify:all` Command

```json
// package.json
"scripts": {
  "verify:all": "pnpm run build && pnpm run test && pnpm run test:e2e && pnpm run verify:integrity"
}
```

Pre-commit hook runs `verify:all`. CI runs `verify:all` on every push.

---

## Consequences

**Positive**:
- Fast feedback: Vitest runs in ~15s for typical site, Playwright smoke in ~30s
- `integrity-check` catches structural errors that unit tests miss (e.g., wrong template used for a route)
- Consistent: same `verify:all` command works identically in all sites and in CI
- Accessibility is structurally enforced, not just documented

**Negative / Trade-offs**:
- Playwright requires a browser binary (~150MB). Managed via `playwright install` in CI
- `verify:all` requires building first — total time ~90s on a fast CI runner. Acceptable
- Coverage thresholds require maintaining tests as code evolves; this is the intent

---

## Alternatives Considered

**Jest** — rejected. TypeScript compilation via babel-jest is slower than Vitest's native esbuild transform. No meaningful advantage for our use case.

**Cypress** — rejected. Heavier setup, requires a dev server running (not a production build), slower test execution than Playwright. The Playwright + `@axe-core/playwright` combination is more comprehensive for our a11y needs.

**Unit tests only** — rejected. Unit tests don't catch missing structural HTML elements in the built output. The integrity-check layer is specifically designed to catch build-time regressions that code-level testing can't see.
