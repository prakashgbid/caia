// apps/dashboard/tests/visual.spec.ts
//
// Visual regression suite for the dashboard. Captures a full-page
// screenshot per route and asserts ≤ 0.1% pixel-difference vs the
// approved baseline under __visual_baselines__/.
//
// Baselines update flow: `pnpm visual:update` (NEVER auto-update in CI).
// Run: pnpm test:visual
// Doc: caia/docs/evidence-gate.md

import { test, expect } from '@playwright/test';

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
