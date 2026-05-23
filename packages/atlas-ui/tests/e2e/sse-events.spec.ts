/**
 * Spec §10.2 (extra) — SSE event rendering.
 */

import { test, expect } from '@playwright/test';
import { storyUrl, waitForReady } from './_shared.js';

test('SSE events render in the agent sidebar', async ({ page }) => {
  await page.goto(storyUrl('atlasshell--with-sidebar'));
  await waitForReady(page);

  const sidebar = page.locator('[data-testid="atlas-sidebar"]');
  await expect(sidebar).toBeVisible();

  // The sidebar reverses order — most recent first. The fixture has 3
  // events: agent.run-started, ticket.state-changed, agent.run-finished.
  await expect(sidebar.locator('[data-event-type="agent.run-started"]')).toHaveCount(1);
  await expect(sidebar.locator('[data-event-type="ticket.state-changed"]')).toHaveCount(1);
  await expect(sidebar.locator('[data-event-type="agent.run-finished"]')).toHaveCount(1);
});
