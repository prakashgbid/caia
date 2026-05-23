/**
 * Axe-playwright WCAG 2.2 AA sweep across the core stories.
 *
 * Spec §9.5 — zero violations on each key flow.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { storyUrl, waitForReady } from './_shared.js';

const STORIES = [
  'atlasshell--default',
  'atlasshell--with-selection',
  'atlasshell--with-deep-selection',
  'atlasshell--with-sidebar',
  'ticketpane--small-tree',
  'promptdock--single',
  'promptdock--with-history3',
  'selectionbreadcrumb--deep',
  'agentstatussidebar--three-events',
  'scopeboxoverlay--multi-select',
];

for (const id of STORIES) {
  test(`axe: ${id} has no WCAG 2.2 AA violations`, async ({ page }) => {
    await page.goto(storyUrl(id));
    await page.waitForLoadState('domcontentloaded');
    if (id.startsWith('atlasshell--')) {
      await waitForReady(page).catch(() => {
        // Some shells take longer; axe doesn't need the iframe to
        // be alive to scan the parent — proceed.
      });
    }
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      // Exclude the design iframe — its contents are customer code,
      // not Atlas's responsibility.
      .exclude('[data-testid="atlas-design-iframe"]')
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}
