// apps/dashboard/tests/visual.spec.ts
//
// Visual regression suite for the dashboard. Captures a full-page
// screenshot per route and asserts <= 0.1% pixel-difference vs the
// approved baseline under __visual_baselines__/.
//
// Baselines update flow: `pnpm visual:update` (NEVER auto-update in CI).
// Baselines MUST be generated on Linux (matching the CI runner) so font
// rendering matches; Mac-generated baselines will fail the AA pixel
// threshold even on identical markup. Use the
// `.github/workflows/visual-baselines.yml` workflow_dispatch trigger to
// generate them on the CI runner and commit them back.
//
// Run: pnpm test:visual
// Doc: caia/docs/evidence-gate.md

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

// Playwright tests run with cwd set to the package root (apps/dashboard).
// The directory-level check is intentional: the per-file snapshot path is
// platform-suffixed by Playwright internals, and computing it here would
// couple this test to private snapshot-path implementation details.
const BASELINES_DIR = resolve(process.cwd(), 'tests/__visual_baselines__');
const BASELINES_PRESENT = existsSync(BASELINES_DIR);

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'timeline', path: '/timeline' },
  { name: 'buckets', path: '/buckets' },
  { name: 'architecture', path: '/architecture' },
  { name: 'contracts', path: '/contracts' },
  { name: 'prompts', path: '/prompts' },
];

test.describe('visual regression', () => {
  for (const r of ROUTES) {
    test(`route ${r.name}`, async ({ page }) => {
      // Bootstrap state — until the baselines are generated and committed
      // by the `visual-baselines.yml` workflow_dispatch run, every route
      // is reported as skipped. This keeps the `visual` evidence-gate
      // job green (matching its 'day-1 warn-only' intent in
      // .github/workflows/evidence-gate.yml) while the suite gets seeded.
      test.skip(
        !BASELINES_PRESENT,
        'Visual baselines not yet generated. Run the `Visual baselines` workflow on develop to seed apps/dashboard/tests/__visual_baselines__/.',
      );

      await page.goto(r.path, { waitUntil: 'networkidle' });
      // Settle: wait for fonts + any client-side hydration noise.
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      // Mask elements that change between runs (timestamps, request IDs,
      // queue counts). Add a `data-visual-mask="true"` attribute to any
      // element whose content is non-deterministic.
      const maskLocator = page.locator('[data-visual-mask="true"]');

      await expect(page).toHaveScreenshot(`${r.name}.png`, {
        fullPage: true,
        mask: [maskLocator],
        animations: 'disabled',
        caret: 'hide',
      });
    });
  }
});
