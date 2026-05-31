/**
 * Playwright E2E for the B8 GDPR export flow.
 *
 * Runs against the dev Next.js server (`pnpm dev -p 7788`). The test:
 *   1. Navigates to /settings/privacy with an x-tenant-id header so
 *      the route handler accepts the request.
 *   2. Clicks "Export my data".
 *   3. Asserts that the browser triggered a download whose filename
 *      starts with `caia-tenant-export-`.
 *
 * The Playwright `download` event captures the file without actually
 * persisting it, so the test does not pollute the local filesystem.
 *
 * Marked `.skip` when WIZARD_E2E_BASE_URL is not set so the unit-test
 * runner stays fast in dev.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env['WIZARD_E2E_BASE_URL'] ?? '';

test.describe('GDPR export — B8', () => {
  test.skip(
    () => BASE_URL.length === 0,
    'Set WIZARD_E2E_BASE_URL=http://localhost:7788 (or the deployed URL) to run.',
  );

  test('Export my data button triggers a download', async ({ page, context }) => {
    // Inject the tenant header for the dev path. In live mode the
    // Cloudflare Access edge sets this; in dev the wizard reads it
    // off the request directly.
    await context.setExtraHTTPHeaders({ 'x-tenant-id': 'tenant-e2e' });
    await page.goto(`${BASE_URL}/settings/privacy`);
    await expect(page.getByTestId('settings-privacy-page')).toBeVisible();
    await expect(page.getByTestId('privacy-export-button')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('privacy-export-button').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^caia-tenant-export-.*\.json$/);
  });
});
