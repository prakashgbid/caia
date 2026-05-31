// apps/dashboard/playwright.live-smoke.config.ts
//
// Playwright config — live-cluster wizard smoke test.
//
// This config is the operator-runnable smoke that walks all 7 wizard
// steps against a deployed dashboard (default: dashboard.chiefaia.com).
// It is INTENTIONALLY separate from `playwright.config.ts` so:
//
//   - The default config's `webServer: pnpm start` block never fires
//     when we're targeting a live deployment.
//   - The visual/a11y/e2e CI jobs (evidence-gate) never accidentally hit
//     a live cluster.
//   - The live smoke can run on a schedule (nightly) or on-demand
//     (workflow_dispatch) without disturbing PR CI.
//
// Auth: Cloudflare Access is in front of dashboard.chiefaia.com. We
// support TWO auth modes, picked by env at run time:
//
//   - `PLAYWRIGHT_STORAGE_STATE=<path>` — a previously-captured browser
//     storageState JSON (cookies + localStorage) from a real signed-in
//     session. Saved by the operator via `setup-cloudflare-access.ts`
//     in "capture" mode. This is the fastest, most reliable path.
//
//   - `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET` — Cloudflare
//     Access service-token. We pass these as extraHTTPHeaders so the
//     browser surfaces them to the CF edge worker; CF Access accepts
//     them in lieu of an interactive SSO round-trip. See:
//       https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/
//
// At least one of the two must be provided; the smoke spec asserts it
// at startup and bails with a clear error if neither is present.
//
// Default base URL is the production dashboard. Override with
// `LIVE_DASHBOARD_URL` for staging / preview / a tunneled local server.

import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

const baseURL =
  process.env.LIVE_DASHBOARD_URL ?? 'https://dashboard.chiefaia.com';

// Storage state path. If unset, the spec will fall back to
// CF-Access-Client-* headers, which are injected below.
const storageStatePath = process.env.PLAYWRIGHT_STORAGE_STATE;

// Cloudflare Access service-token headers — passed via extraHTTPHeaders
// so every fetch from the browser carries them. Empty headers are
// stripped automatically by Playwright; we deliberately do NOT throw
// here even if both are missing — the spec's `test.beforeAll` does the
// auth-mode assertion so the error message is visible in the test
// report instead of in a pre-run stack trace.
const extraHTTPHeaders: Record<string, string> = {};
if (process.env.CF_ACCESS_CLIENT_ID) {
  extraHTTPHeaders['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
}
if (process.env.CF_ACCESS_CLIENT_SECRET) {
  extraHTTPHeaders['CF-Access-Client-Secret'] =
    process.env.CF_ACCESS_CLIENT_SECRET;
}

export default defineConfig({
  testDir: './tests/e2e',
  // Match ONLY the live smoke — keep room for future live specs by
  // listing them explicitly rather than catching everything.
  testMatch: ['live-wizard-smoke.spec.ts'],
  // The live smoke is sequential by design — Step N depends on Step N-1
  // having advanced the FSM. No parallel workers.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retries — a flaky smoke against live infra is a signal we want
  // to see, not paper over.
  retries: 0,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: 'playwright-report-live-smoke',
        open: 'never',
      },
    ],
    [
      'json',
      {
        outputFile: 'playwright-report-live-smoke/results.json',
      },
    ],
  ],
  outputDir: 'test-results-live-smoke',
  expect: {
    // Live-network steps need more headroom than localhost. Claude calls
    // (Step 3 Interview, Step 4 IA, Step 5 Proposal) can take 60-120s.
    timeout: 30_000,
  },
  // Overall per-test timeout — the spec walks ALL 7 steps in a single
  // test, including up to ~120s for the IA agent call (Step 4). Budget
  // generously: 7 steps × ~2 minutes each = 14 minutes, doubled for
  // slack = 30 min. CI workflow has its own job-level timeout.
  timeout: 30 * 60 * 1000,
  use: {
    baseURL,
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
    // Live infra: longer action / nav timeouts than local.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    storageState: storageStatePath
      ? path.resolve(storageStatePath)
      : undefined,
    extraHTTPHeaders:
      Object.keys(extraHTTPHeaders).length > 0 ? extraHTTPHeaders : undefined,
    // Avoid HTTPS noise on staging / self-signed previews.
    ignoreHTTPSErrors: process.env.LIVE_SMOKE_IGNORE_TLS === '1',
  },
  projects: [
    {
      name: 'live-smoke',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  // NO webServer — we target a live deployment. This is the load-bearing
  // difference from `playwright.config.ts`.
});
