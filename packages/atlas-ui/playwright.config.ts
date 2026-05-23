/**
 * Playwright config for `@caia/atlas-ui` e2e + a11y suite.
 *
 * Tests run against the package's Storybook static build (deterministic,
 * no backend dependency). Storybook is started by `webServer` below.
 *
 * Spec §10.2 — four critical-path tests (design-click → ticket-highlight,
 * ticket-click → design-scope-box, drill up/down, submit prompt) plus
 * an SSE-event test and an axe-playwright sweep.
 */

import { defineConfig, devices } from '@playwright/test';

const STORYBOOK_PORT = Number(process.env['ATLAS_UI_SB_PORT'] ?? 6006);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 4 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: `http://localhost:${STORYBOOK_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npx http-server storybook-static -p ${STORYBOOK_PORT} -s --cors -c-1`,
    url: `http://localhost:${STORYBOOK_PORT}/iframe.html?id=atlasshell--default`,
    timeout: 120_000,
    reuseExistingServer: !process.env['CI'],
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
