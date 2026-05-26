// apps/dashboard/playwright.config.ts
//
// Playwright config for the dashboard's a11y + visual-regression checks
// and the local-mode wizard-shell / wizard-steps E2E specs (PR #601 + #610).
//
// Boots `next start -p 7777` and runs against localhost. Used by the
// evidence-gate workflow's `axe`, `visual`, and `test:e2e` jobs.
//
// Live-cluster smoke (`tests/e2e/live-wizard-smoke.spec.ts`, PR
// "feature/live-wizard-smoke-2026-05-25") uses a SEPARATE config —
// `playwright.live-smoke.config.ts` — so:
//   - the visual/a11y jobs here never accidentally hit a live cluster, and
//   - the live job runs without the `webServer` block (we point at a
//     deployed dashboard, not a local boot).
// We achieve the partition by ignoring `tests/e2e/**` here. See that
// config for the live-smoke project setup.
//
// Scripts: `pnpm test:a11y`, `pnpm test:visual`, `pnpm visual:update`,
// `pnpm test:e2e`, and `pnpm test:live-smoke` (live).

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['tests/e2e/**'],
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
