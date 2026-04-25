# Behavioral Testing Framework

## Philosophy

Tests in this system lock on **behavior and expectations**, not DOM structure.

**The rule**: If a test breaks because a `div` moved but the behavior is unchanged, fix the test, not the code. If behavior actually changed, the test correctly blocks the change.

This means:
- Use semantic HTML elements (`header`, `footer`, `main`, `h1`)
- Use ARIA roles and landmarks (`[role="banner"]`, `[aria-live]`)
- Use `data-test-id` attributes as the ONE place DOM hooks are explicitly permitted — these are the behavioral contract surface that sites must honor
- Never assert on CSS class names, exact DOM nesting, or internal component structure

---

## Architecture

```
plugins/behavior-suite/         ← Core package (@plugins/behavior-suite)
  src/
    types.ts                    ← LayoutContract, URLContract, JourneyStep
    expectations.ts             ← checkLayoutContract, checkUrlContract, checkA11y, BehaviorSuite
    runner.ts                   ← runBehaviorSuite(scope) — scoped Playwright runner
    conductor.ts                ← ConductorBehaviorClient — posts results to Conductor
  scripts/
    scope-tests.ts              ← Maps changed files → behavior test files
    gate-publish.sh             ← Pre-publish gate (non-bypassable)

poker-zeno/tests/behavior/      ← Site-specific tests
  REQUIREMENTS.yaml             ← Locked behavioral requirements manifest
  home.behavior.ts
  play.behavior.ts
  publications.behavior.ts
  layout-contract.behavior.ts
  playwright.behavior.config.ts

roulette-community/tests/behavior/  ← Same structure
```

---

## Writing a New Behavioral Test

### 1. Create the test file

```typescript
// my-feature.behavior.ts
// Scope: site:my-site feature:my-feature
// Domains: gameplay, accessibility

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('My Feature — behavioral contracts [my-site]', () => {
  test('user can see the thing they came for', async ({ page }) => {
    await page.goto('/my-route');

    // Check USER OUTCOME, not DOM structure
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText(/expected text/i);
  });

  test('my feature is WCAG 2.2 AA clean', async ({ page }) => {
    await page.goto('/my-route');
    await page.waitForLoadState('networkidle');
    
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    
    const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    expect(critical).toHaveLength(0);
  });
});
```

### 2. Add to REQUIREMENTS.yaml

```yaml
features:
  my-feature:
    scope: "site:my-site feature:my-feature"
    domains: [testing-qa]
    behaviors:
      - "User can see the thing they came for"
      - "Feature is WCAG 2.2 AA clean"
    layout_contract:
      must_have: [header, footer, main_content]
```

### 3. Register in Conductor (optional, for visibility)

```bash
# Via MCP tool
behavior_test_upsert({
  name: "User can see the thing they came for",
  feature: "my-feature",
  scope: "site:my-site feature:my-feature",
  expected_behavior: "User lands on /my-route and immediately sees the expected heading",
  domain_slugs: ["testing-qa"]
})
```

---

## Running Tests

### Local development

```bash
# Run all behavior tests for a site
cd poker-zeno
npm run behavior

# Run a specific feature
npx playwright test --config playwright.behavior.config.ts tests/behavior/home.behavior.ts

# Run the pre-publish gate (scoped to changed files)
npm run gate:publish
```

### CI

The `behavior-gate.yml` workflow runs automatically on every push and PR. It:
1. Builds the site
2. Starts the production server
3. Runs all behavior tests
4. Uploads the HTML report as an artifact
5. Fails the CI check if ANY behavioral test fails

### Scoped runs

The gate script infers which tests to run from `git diff HEAD`:

| Changed File                        | Tests Run                                 |
|-------------------------------------|-------------------------------------------|
| `src/app/page.tsx`                  | `home.behavior.ts`                        |
| `src/engine/**`                     | `play.behavior.ts`                        |
| `src/content/**`                    | `publications.behavior.ts`                |
| `src/components/layout/**`          | `layout-contract.behavior.ts`, `home.behavior.ts` |
| `src/components/**` (anything else) | `layout-contract.behavior.ts`             |
| Nothing / unknown                   | Full suite                                |

---

## Contracts

### LayoutContract

Asserts the semantic structure of a page without specifying DOM internals.

```typescript
const homeContract: LayoutContract = {
  must_have: ['header', 'hero', 'primary_cta', 'footer'],
  footer_link_groups: '>=3',
};

await checkLayoutContract(page, homeContract);
```

Available regions and their stable locators (first match wins):

| Region         | Selectors (stable contract hooks)                                    |
|----------------|----------------------------------------------------------------------|
| `header`       | `header`, `[role="banner"]`                                          |
| `footer`       | `footer`, `[role="contentinfo"]`                                     |
| `hero`         | `[data-test-id="hero"]`, `h1`                                        |
| `primary_cta`  | `[data-test-id="primary-cta"]`, `a[href="/play"]`                    |
| `game_root`    | `[data-test-id="game-root"]`, `[role="application"]`                 |
| `status_region`| `[data-test-id="status-region"]`, `[aria-live]`                      |

### URLContract

Asserts the behavioral properties of a URL response.

```typescript
await checkUrlContract(page, {
  url: '/play',
  max_ttfb_ms: 3000,
  must_not_redirect: true,
  expected_status: 200,
  required_test_ids: ['game-root'],  // ONLY place DOM hooks are required
});
```

### A11y

Every route must pass WCAG 2.2 AA. Use `checkA11y` or `new AxeBuilder({ page })` directly.

---

## Stability Rules

1. **Never assert on CSS classes** — they change with Tailwind refactors
2. **Never assert on exact element count** unless it's a behavioral invariant (e.g. "footer has ≥3 links")
3. **Use `getByRole`, `getByLabel`, `getByText`** before falling back to CSS selectors
4. **`data-test-id` is the ONLY allowed DOM contract hook** — if you need a stable selector, add a `data-test-id` to the component

---

## When a Test Fails

If a behavior test fails in CI:
1. Check if BEHAVIOR actually changed or just the DOM structure changed
   - DOM only: fix the test (more semantic selector)
   - Behavior changed: this is a real regression — fix the code
2. Failures auto-log to Conductor as `behavior_test.fail` events
3. Persistent failures (3+ runs) should have a Conductor blocker filed via `behavior_failure_file`

---

## Phase 2 Preview (not yet implemented)

Nightly agent swarm will:
- Take each feature in `REQUIREMENTS.yaml`
- Write comprehensive behavior tests for all requirements
- Add edge cases and stress cases
- File new tests via `behavior_test_upsert`
- PR results for review

Phase 3 will add self-evolution from production error logs.
