import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

async function activateInspector(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as Window & { __devInspector?: { toggle: (on?: boolean) => void } }).__devInspector?.toggle(true);
  });
  await page.waitForSelector('[data-inspector-id]', { timeout: 8000 });
}

async function hoverCenterOfPage(page: import('@playwright/test').Page) {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  // Move to header area — reliably has content in both test sites
  await page.mouse.move(vp.width / 2, 80);
  // Small wait for React to process the mousemove
  await page.waitForTimeout(100);
}

test.describe('DevInspector E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    // Reset inspector state — prevents Alt+I from accidentally deactivating
    await page.evaluate(() => localStorage.removeItem('dev-inspector:active'));
    await page.waitForSelector('[title="Dev Inspector (Alt+I)"]', { timeout: 8000 });
  });

  test('inspect chip is visible on page load', async ({ page }) => {
    const chip = page.locator('[title="Dev Inspector (Alt+I)"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('○');
  });

  test('Alt+I toggles inspector on', async ({ page }) => {
    const chip = page.locator('[title="Dev Inspector (Alt+I)"]');
    await expect(chip).toContainText('○');
    await page.keyboard.press('Alt+i');
    await expect(chip).toContainText('◉', { timeout: 2000 });
  });

  test('hovering element shows red outline overlay', async ({ page }) => {
    await activateInspector(page);
    await hoverCenterOfPage(page);

    const overlay = page.locator('[data-dev-inspector-overlay]');
    await expect(overlay).toBeVisible({ timeout: 3000 });
  });

  test('badge shows component ID text', async ({ page }) => {
    await activateInspector(page);
    await hoverCenterOfPage(page);

    const overlay = page.locator('[data-dev-inspector-overlay]');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    const badge = overlay.locator('div').first();
    const badgeText = await badge.textContent();
    expect(badgeText).toBeTruthy();
    expect(badgeText!.length).toBeGreaterThan(0);
  });

  test('clicking badge copies ID to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await activateInspector(page);
    await hoverCenterOfPage(page);

    const overlay = page.locator('[data-dev-inspector-overlay]');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    const badge = overlay.locator('div').first();
    const expectedId = await badge.textContent();
    await badge.click({ force: true });

    // Toast appears
    const toast = page.getByText(`Copied: ${expectedId}`);
    await expect(toast).toBeVisible({ timeout: 2000 });

    // Clipboard has ID
    const clipText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipText).toBe(expectedId);
  });

  test('window.__devInspector.list() returns IDs', async ({ page }) => {
    await activateInspector(page);

    const ids = await page.evaluate(() =>
      (window as Window & { __devInspector?: { list: () => string[] } }).__devInspector?.list() ?? []
    );
    expect(ids.length).toBeGreaterThan(0);
  });

  test('inspector does not render in production build (smoke)', async ({ page }) => {
    if (!process.env.E2E_PROD_URL) test.skip();
    await page.goto(process.env.E2E_PROD_URL!);
    const chip = page.locator('[title="Dev Inspector (Alt+I)"]');
    await expect(chip).not.toBeVisible({ timeout: 3000 });
  });
});
