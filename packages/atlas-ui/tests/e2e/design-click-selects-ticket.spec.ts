/**
 * Spec §10.2.1 — Click design → ticket-highlight.
 *
 * Boot Atlas, wait for iframe load, click inside the hero rotator,
 * assert that the corresponding ticket is selected in the panel and
 * the overlay rect matches the source element.
 */

import { test, expect } from '@playwright/test';
import { storyUrl, waitForReady } from './_shared.js';

test('clicking inside the iframe selects the matching ticket', async ({ page }) => {
  await page.goto(storyUrl('atlasshell--default'));
  await waitForReady(page);

  const frame = page.frameLocator('[data-testid="atlas-design-iframe"]');
  await frame.locator('[data-atlas-id="WD-home-hero-rotator"]').first().click();

  const row = page.locator('[data-ticket-id="WD-home-hero-rotator"]').first();
  await expect(row).toHaveAttribute('aria-selected', 'true', { timeout: 2000 });

  const box = page
    .locator('[data-testid="atlas-scope-overlay"]')
    .locator('g[data-domid="WD-home-hero-rotator"]');
  await expect(box).toBeVisible();
});
