/**
 * Shared helpers for the Playwright e2e suite.
 *
 * Each test boots a single Storybook story (the URL form is the
 * built-in Storybook iframe form). Stories are deterministic — the
 * mock client is wired in via the harness.
 */

import { expect, type Page } from '@playwright/test';

/** URL for a specific story inside the static storybook build. */
export function storyUrl(storyId: string): string {
  return `/iframe.html?id=${storyId}&viewMode=story`;
}

/** Wait until the design iframe has booted and posted atlas:ready. */
export async function waitForReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  const frame = page.frameLocator('[data-testid="atlas-design-iframe"]');
  await expect(frame.locator('[data-atlas-id="PG-home"]').first()).toBeVisible({
    timeout: 10_000,
  });
}
