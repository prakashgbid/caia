# Behavior Testing Lock

**Status**: Enforced by CI — behavior gate runs on every PR  
**Standard**: Playwright behavior tests (BDD-style, not unit tests)  
**Enforcement**: `behavior-gate.yml` CI workflow; PR blocked if tests fail

---

## What Behavior Tests Cover

Every site must have behavior tests for:

1. **Navigation** — all top-level nav links resolve and render a page (no 404)
2. **Layout contract** — `<header>`, `<main>`, `<footer>` present on every page
3. **Accessibility gate** — no critical axe violations on home page (automated WCAG 2.1 AA)
4. **Publications** — at least one publication renders without JS errors

---

## File Location

```
tests/behavior/
  layout-contract.behavior.ts   # header/main/footer on every route
  play.behavior.ts               # core user journey (navigate → play/read)
  publications.behavior.ts       # content rendering
playwright.behavior.config.ts    # Playwright config for behavior tests only
```

---

## CI Workflow

```yaml
# .github/workflows/behavior-gate.yml
# Runs: npx playwright test tests/behavior/
# Required: true (blocks merge)
# Runs on: push to main, PR to main
```

---

## Rules

- Behavior tests use real browser (Playwright) — no mocks, no jsdom.
- Tests start the Next.js dev server (`next dev`) before running.
- Tests must pass against `next build && next start` before any release.
- No skipping behavior tests with `test.skip` without filing a blocker.
- New routes require a corresponding `layout-contract` test update.

---

## Adding Tests for a New Site

When scaffolding with `new-site.sh`, behavior tests are included in `site-template`.
After scaffold:
1. Update `tests/behavior/play.behavior.ts` with site-specific journey
2. Verify tests pass locally: `npx playwright test tests/behavior/`
3. Push — CI behavior gate will confirm
