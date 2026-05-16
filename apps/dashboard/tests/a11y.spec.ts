// apps/dashboard/tests/a11y.spec.ts
//
// axe-core accessibility audit over the dashboard's canonical routes.
// Zero serious + critical violations allowed. Warnings are logged
// to the report but do not fail the test (per evidence-gate doc).
//
// Run: pnpm test:a11y
// Doc: caia/docs/evidence-gate.md

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  '/',
  '/timeline',
  '/buckets',
  '/architecture',
  '/contracts',
  '/prompts',
];

for (const route of ROUTES) {
  test(`a11y: ${route} has zero serious or critical violations`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
    page.on('requestfailed', (req) => {
      // Ignore environmental failures we don't care about for a11y:
      //   1. ABORTED — RSC <Link> prefetches superseded by the next navigation.
      //      Playwright reports `net::ERR_ABORTED` (uppercase), hence the
      //      case-insensitive match.
      //   2. CONNECTION_REFUSED — the orchestrator at :7776 isn't running in
      //      CI or in the playwright test-server; the dashboard fetches from
      //      it fail-soft (catch -> render empty state), so this is not an
      //      a11y or page-error signal.
      //   3. NAME_NOT_RESOLVED — analogue for any externally-hosted asset.
      const f = req.failure();
      const text = (f?.errorText ?? '').toLowerCase();
      const ignorable = ['aborted', 'connection_refused', 'name_not_resolved'];
      if (f && !ignorable.some((s) => text.includes(s))) {
        errors.push(`request failed: ${req.url()} (${f.errorText})`);
      }
    });

    await page.goto(route, { waitUntil: 'networkidle' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const warnings = results.violations.filter(
      (v) => v.impact !== 'serious' && v.impact !== 'critical',
    );

    if (warnings.length > 0) {
      console.warn(
        `[a11y warn] ${route}: ${warnings.length} non-blocking violation(s):`,
      );
      for (const w of warnings) {
        console.warn(`  - [${w.impact}] ${w.id}: ${w.help} (${w.nodes.length} node(s))`);
      }
    }

    if (blocking.length > 0) {
      const summary = blocking
        .map(
          (v) =>
            `[${v.impact}] ${v.id}: ${v.help}\n      nodes: ${v.nodes
              .slice(0, 3)
              .map((n) => n.target.join(' '))
              .join(' | ')}`,
        )
        .join('\n    ');
      throw new Error(
        `Accessibility gate failed on ${route}: ${blocking.length} blocking violation(s).\n    ${summary}`,
      );
    }

    expect(errors, `console / network errors on ${route}`).toEqual([]);
  });
}
