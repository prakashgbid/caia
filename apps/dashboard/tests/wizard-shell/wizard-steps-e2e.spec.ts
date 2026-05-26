/**
 * Playwright E2E — walks the five wizard step paths shipped in this PR
 * (onboarding / grand-idea / proposal / design / atlas) under the dev
 * mock-CF cookie shortcut from PR #601.
 *
 * This is the canonical happy-path test that gates the wizard
 * step-pages PR. It runs against a production Next.js server started
 * by `playwright.config.ts`'s webServer; the middleware accepts the
 * synthetic `mock.e2e.token` cookie because `MOCK_CF_AUTH=1` is set
 * in the dev/test env (see `middleware.ts`).
 *
 * Run: `pnpm --filter @caia-app/dashboard test:e2e`.
 */
import { test, expect } from '@playwright/test';

test.describe('wizard step pages — happy-path walk', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: 'CF_Authorization',
        value: 'mock.e2e.token',
        domain: 'localhost',
        path: '/',
      },
    ]);
  });

  test('Step 1 onboarding page renders the canonical category catalog', async ({ page }) => {
    await page.goto('/wizard/onboarding');
    await expect(page.getByTestId('wizard-step-onboarding')).toBeVisible();
    // The OnboardingStepForm renders inside the page.
    await expect(page.getByTestId('onboarding-step-form')).toBeVisible();
  });

  test('Step 2 grand-idea page mounts the GrandIdeaForm', async ({ page }) => {
    await page.goto('/wizard/grand-idea');
    await expect(page.getByTestId('wizard-step-grand-idea')).toBeVisible();
    await expect(page.getByTestId('grand-idea-step-bridge')).toBeVisible();
    await expect(page.getByTestId('grand-idea-form')).toBeVisible();
  });

  test('Step 5 proposal page renders the Generate CTA', async ({ page }) => {
    await page.goto('/wizard/proposal');
    await expect(page.getByTestId('wizard-step-proposal')).toBeVisible();
    await expect(page.getByTestId('generate-proposal')).toBeVisible();
  });

  test('Step 5 proposal page renders accordion output after Generate', async ({ page }) => {
    await page.goto('/wizard/proposal');
    await page.getByTestId('generate-proposal').click();
    await expect(page.getByTestId('renderer-exec')).toBeVisible();
    await expect(page.getByTestId('renderer-full')).toBeVisible();
    await expect(page.getByTestId('renderer-onepager')).toBeVisible();
  });

  test('Step 6 design page renders the copy-prompt block', async ({ page }) => {
    await page.goto('/wizard/design');
    await expect(page.getByTestId('wizard-step-design')).toBeVisible();
    await expect(page.getByTestId('design-prompt-text')).toBeVisible();
    await expect(page.getByTestId('copy-prompt')).toBeVisible();
  });

  test('Step 6 design page opens the upload dialog', async ({ page }) => {
    await page.goto('/wizard/design');
    await page.getByTestId('open-upload-dialog').click();
    await expect(page.getByTestId('upload-dialog')).toBeVisible();
  });

  test('Step 7 atlas page mounts the AtlasShell', async ({ page }) => {
    await page.goto('/wizard/atlas/p_prakash_tiwari');
    await expect(page.getByTestId('wizard-step-atlas')).toBeVisible();
    await expect(page.getByTestId('atlas-wizard-client')).toBeVisible();
    await expect(page.getByTestId('atlas-shell')).toBeVisible();
  });

  test('the 7-step Progress nav stays visible across all five pages', async ({ page }) => {
    for (const slug of ['onboarding', 'grand-idea', 'proposal', 'design']) {
      await page.goto(`/wizard/${slug}`);
      await expect(
        page.getByRole('navigation', { name: 'wizard step indicator' }),
      ).toBeVisible();
    }
    await page.goto('/wizard/atlas/p_prakash_tiwari');
    await expect(
      page.getByRole('navigation', { name: 'wizard step indicator' }),
    ).toBeVisible();
  });
});
