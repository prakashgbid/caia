/**
 * Playwright E2E — signin → tenant provisioned → wizard step 1 loads.
 *
 * This is the foundation-PR happy-path walk. It runs against a dev-mode
 * Next.js server (started by `playwright.config.ts`'s webServer) with the
 * middleware mocked into "always-authenticated" mode via the `MOCK_CF_AUTH`
 * env var (consumed by the middleware in `dev`/`test`). The mock injects
 * a synthetic `email` claim so we don't need a real Cloudflare Access
 * round-trip.
 *
 * Run: `pnpm --filter @caia-app/dashboard test:e2e`
 */
import { test, expect } from '@playwright/test';

test.describe('wizard-shell foundation E2E', () => {
  test('un-authed request lands on /sign-in', async ({ page }) => {
    const resp = await page.goto('/wizard/onboarding');
    // Without the cookie set, the middleware redirects. We follow it.
    expect(page.url()).toMatch(/\/sign-in/);
    await expect(page.getByTestId('sign-in-card')).toBeVisible();
  });

  test('sign-in page renders the @caia/ui Card + Continue button', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByTestId('sign-in-card')).toBeVisible();
    await expect(page.getByTestId('sign-in-continue')).toBeVisible();
  });

  test('with mock CF_Authorization cookie, /wizard/onboarding renders step 1 stub', async ({
    page,
    context,
  }) => {
    // The middleware accepts a synthetic dev-mode token when the
    // MOCK_CF_AUTH env var is set on the dev server (see middleware.ts).
    await context.addCookies([
      {
        name: 'CF_Authorization',
        value: 'mock.e2e.token',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/wizard/onboarding');
    // ComingSoon stub for step 1 (onboarding):
    await expect(page.getByTestId('wizard-step-stub-onboarding')).toBeVisible();
    // The 7-step progress nav is visible:
    await expect(page.getByRole('navigation', { name: 'wizard step indicator' })).toBeVisible();
  });

  test('unknown slug 404s', async ({ page, context }) => {
    await context.addCookies([
      {
        name: 'CF_Authorization',
        value: 'mock.e2e.token',
        domain: 'localhost',
        path: '/',
      },
    ]);
    const resp = await page.goto('/wizard/not-a-real-step');
    expect(resp?.status()).toBe(404);
  });
});
