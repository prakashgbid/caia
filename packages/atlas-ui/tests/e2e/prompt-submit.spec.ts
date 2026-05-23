/**
 * Spec §10.2.4 — Submit prompt.
 */

import { test, expect } from '@playwright/test';
import { storyUrl, waitForReady } from './_shared.js';

test('submitting a prompt clears the textarea', async ({ page }) => {
  await page.goto(storyUrl('atlasshell--with-selection'));
  await waitForReady(page);

  const dock = page.locator('[data-testid="atlas-prompt-dock"]');
  await expect(dock).toBeVisible({ timeout: 2000 });

  const ta = page.locator('[data-testid="atlas-prompt-input"]');
  await ta.fill('shorten the headline');

  // Use the explicit submit button — modifier keys differ between
  // browsers (Cmd vs Ctrl) and on CI runners. The button click goes
  // through the same code path as Cmd+Enter.
  await page.locator('[data-testid="atlas-prompt-submit"]').click();

  await expect(ta).toHaveValue('', { timeout: 2000 });
});
