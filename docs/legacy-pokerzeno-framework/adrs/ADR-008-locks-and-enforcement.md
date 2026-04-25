# ADR-008: Locks and Enforcement

**Date**: 2026-04-20
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

At 20-150 sites, brand consistency breaks down without active enforcement. Past experience:
- The third site had different focus indicator styles from the first two (developer didn't read the brand doc)
- A template update introduced a skip-link wrapped in a `display:none` container — caught in code review but only after two sites were deployed
- Without a formal accessibility lock, there's no guarantee a11y standards are applied consistently

Two distinct problems:
1. **Structural accessibility requirements** — these can be checked programmatically. Failing these is a hard error.
2. **Brand consistency** — typography, color palette, voice. These require human judgment but benefit from a documented spec.

---

## Decision

**Two-tier enforcement system**:

### Tier 1: Machine-Enforced (accessibility-lock.md → integrity-check)

`locks/accessibility-lock.md` defines the required structural elements. `@pokerzeno/integrity-check` validates them in CI on every build. CI fails if checks don't pass.

Enforced automatically:
- `<a href="#main-content">` skip link must exist on every page
- `<main id="main-content">` landmark must exist on every page
- `<html lang="...">` must have a non-empty lang attribute
- No `<img>` missing `alt` attribute
- `<title>` must be non-empty on every page

CI failure message example:
```
❌ integrity-check failed on 3 pages:
  /strategy/advanced-bluffing — missing skip-to-content link
  /rules/texas-holdem — missing main landmark
  /about — img missing alt attribute
Build blocked.
```

### Tier 2: Human-Enforced (brand-lock.md + SITE_BRAND_LOCK.md)

`locks/pokerzeno-brand-lock.md` defines the framework-level brand spec (colors, typography, voice, iconography).

Each site has a `SITE_BRAND_LOCK.md` at its root. This is a human-maintained document specifying site-specific overrides (e.g., a blackjack site might use a different accent color). It is reviewed during PR and code review — not enforced by automation.

```markdown
# SITE_BRAND_LOCK.md for blackjackcommunity
Base brand: pokerzeno-brand-lock.md
Overrides:
  - Primary: #1a472a (forest green instead of royal purple)
  - Site name in nav: "Blackjack Community"
  - GA4 ID: G-XXXXXXXXXX
```

---

## Consequences

**Positive**:
- Accessibility regressions are caught before deploy — not in user reports
- New developers onboarding to a site have a documented spec to follow
- Brand evolution is explicit — changes to `locks/pokerzeno-brand-lock.md` are committed and reviewed
- The two-tier model is proportionate: hard rules are automated, soft rules are documented

**Negative / Trade-offs**:
- Tier 2 enforcement relies on human review. In a solo-founder setup, this means self-review. The discipline depends on making it a habit (checklist item in NEW_SITE_CHECKLIST.md)
- `integrity-check` adds ~5s to every build. Acceptable
- CSP headers in `_headers` may block GA4 or Supabase calls if not updated correctly. Each new site must update CSP allow-lists. Documented in locks/learnings.md (L-03)

---

## Alternatives Considered

**Style Dictionary** — rejected for brand tokens. Style Dictionary is a powerful tool for managing design tokens in multi-platform systems (iOS, Android, web). At our scale (web only), it adds overhead without proportionate benefit. A simple TypeScript `theme.ts` file and `SITE_BRAND_LOCK.md` document is sufficient.

**ESLint rules for JSX accessibility** — used but insufficient. `eslint-plugin-jsx-a11y` catches many issues at the source code level. However, it can't validate the final rendered HTML output (e.g., a component that conditionally renders a skip link might pass ESLint but fail in certain page configurations). `integrity-check` validates the built output, not the source.

**Runtime a11y monitoring (Sentry + custom events)** — rejected as primary mechanism. Runtime checks catch issues after users encounter them. Build-time checks prevent deployment of broken builds. Both can coexist but integrity-check is the primary gate.
