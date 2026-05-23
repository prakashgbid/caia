/**
 * Spec §10.2.3 — Drill up & down via breadcrumb.
 */

import { test, expect } from '@playwright/test';
import { storyUrl, waitForReady } from './_shared.js';

test('breadcrumb segments drive drill-up', async ({ page }) => {
  await page.goto(storyUrl('atlasshell--with-deep-selection'));
  await waitForReady(page);

  const bc = page.locator('[data-testid="atlas-breadcrumb"]');
  await expect(bc).toBeVisible();

  // The deep selection seeds the stats-row ticket. Confirm breadcrumb
  // ends there.
  await expect(bc.locator('[data-ticket-id="WD-home-hero-slide-01-stats"]')).toBeVisible();

  // Click the Section segment — selection should narrow to that ticket.
  await bc.locator('[data-ticket-id="SE-home-hero"]').click();
  await expect(
    page.locator('[data-ticket-id="SE-home-hero"][aria-selected="true"]').first(),
  ).toBeVisible();

  // Click the Page segment — selection moves up.
  await bc.locator('[data-ticket-id="PG-home"]').click();
  await expect(
    page.locator('[data-ticket-id="PG-home"][aria-selected="true"]').first(),
  ).toBeVisible();
});
