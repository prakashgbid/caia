/**
 * Spec §10.2.2 — Click ticket in panel → highlight design.
 */

import { test, expect } from '@playwright/test';
import { storyUrl, waitForReady } from './_shared.js';

test('clicking a ticket in the panel highlights the design', async ({ page }) => {
  await page.goto(storyUrl('atlasshell--default'));
  await waitForReady(page);

  const row = page.locator('[data-ticket-id="SE-home-hero"]').first();
  await row.click();

  const box = page
    .locator('[data-testid="atlas-scope-overlay"]')
    .locator('g[data-domid="SE-home-hero"]');
  await expect(box).toBeVisible({ timeout: 2000 });
});
