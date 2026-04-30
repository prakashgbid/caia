// apps/dashboard/playwright.config.ts
//
// Playwright config for the dashboard's a11y + visual-regression checks.
// Boots `next start -p 7777` and runs against localhost.
//
// Used by the evidence-gate workflow's `axe` and `visual` jobs.
// Scripts: `pnpm test:a11y`, `pnpm test:visual`, `pnpm visual:update`.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  // Visual snapshots live alongside tests, but we ALSO keep a stable
  // "approved baselines" mirror under __visual_baselines__/ so the
  // evidence-gate doc has a single canonical location to point at.
  snapshotPathTemplate: '{testDir}/__visual_baselines__/{testFilePath}/{arg}{ext}',
  expect: {
    // 0.1% pixel-difference threshold per the mandate.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: 'http://localhost:7777',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  // The dashboard's Next.js production server.
  webServer: {
    command: 'pnpm --filter @caia-app/dashboard start',
    url: 'http://localhost:7777',
    timeout: 90_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
