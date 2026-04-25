import { test, expect } from '@playwright/test';

test.describe('Homepage A11y', () => {
  test('has skip-to-content link', async ({ page }) => {
    await page.goto('/');
    const skip = page.locator('a[href="#main-content"]');
    await expect(skip).toBeAttached();
  });

  test('has main landmark', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main#main-content')).toBeVisible();
  });

  test('page has title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });
});
