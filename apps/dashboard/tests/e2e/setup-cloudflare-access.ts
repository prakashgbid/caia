/**
 * apps/dashboard/tests/e2e/setup-cloudflare-access.ts
 *
 * Cloudflare Access auth helper for the live-wizard-smoke spec.
 *
 * The production dashboard at https://dashboard.chiefaia.com sits behind
 * a Cloudflare Access application (app id `cb6d1de5-2ab6-4860-af9e-7395ca0a8381`,
 * allowlists `prakash.stolution@gmail.com`). Interactive SSO is not
 * scriptable from headless Chrome, so we support two non-interactive
 * paths:
 *
 *   1. `storageState` — a pre-captured browser session. The operator runs
 *      `pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture` once,
 *      signs in interactively in the launched browser, and a cookie jar
 *      + localStorage snapshot is written to disk. Subsequent runs reuse
 *      the file. Cookies expire (CF Access default = 24h), so the smoke
 *      runbook prompts to re-capture when the smoke's first request
 *      bounces to /sign-in.
 *
 *   2. `service-token` — Cloudflare Access service-token pair
 *      (`CF-Access-Client-Id` + `CF-Access-Client-Secret`) is passed via
 *      `extraHTTPHeaders` in playwright.live-smoke.config.ts. Service
 *      tokens are issued in the Cloudflare Zero Trust dashboard under
 *      Access → Service Auth → Service Tokens. They don't expire on a
 *      24h clock — they're long-lived secrets — which makes them the
 *      preferred path for CI nightly runs.
 *
 * This helper exposes:
 *
 *   - `ensureAuthMode()`    — assert at least one auth mode is configured;
 *                             throws a clear error otherwise. Called from
 *                             the spec's `beforeAll`.
 *
 *   - `getAuthMode()`       — return `'storageState' | 'service-token'`
 *                             for logging / runbook traceability.
 *
 *   - `captureStorageState()` — opens a real Chromium browser, navigates
 *                               to the live dashboard, and waits for the
 *                               operator to complete sign-in. Writes the
 *                               resulting storageState JSON to the path
 *                               in `PLAYWRIGHT_STORAGE_STATE`.
 *
 * Run with `pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture`.
 *
 * Reuse-first: this is a pure helper module — no new Playwright fork, no
 * new auth lib. We use `@playwright/test`'s `chromium.launch` and the
 * built-in `context.storageState({path})` API.
 */

import { chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type AuthMode = 'storageState' | 'service-token';

export const LIVE_DASHBOARD_URL =
  process.env.LIVE_DASHBOARD_URL ?? 'https://dashboard.chiefaia.com';

export interface AuthEnv {
  storageStatePath?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

export function readAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  return {
    storageStatePath: env.PLAYWRIGHT_STORAGE_STATE,
    cfAccessClientId: env.CF_ACCESS_CLIENT_ID,
    cfAccessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
  };
}

export function getAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode | null {
  const e = readAuthEnv(env);
  // storageState wins when both are set — it's a pre-resolved real user
  // session, which gives us the cleanest signal for tenant-provisioning
  // edge cases. Service-token is the fallback / CI default.
  if (e.storageStatePath && fs.existsSync(e.storageStatePath)) {
    return 'storageState';
  }
  if (e.cfAccessClientId && e.cfAccessClientSecret) {
    return 'service-token';
  }
  return null;
}

export class CloudflareAccessAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareAccessAuthError';
  }
}

/**
 * Asserts at least ONE non-interactive auth mode is configured. Called
 * from the smoke spec's `test.beforeAll` so the failure surfaces in the
 * test report instead of as a config-load stack trace.
 */
export function ensureAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const mode = getAuthMode(env);
  if (mode) return mode;
  const e = readAuthEnv(env);
  throw new CloudflareAccessAuthError(
    [
      'No Cloudflare Access auth mode configured for the live wizard smoke.',
      '',
      'Set ONE of the following:',
      '',
      '  1. PLAYWRIGHT_STORAGE_STATE=<path/to/state.json>',
      '       Capture with: pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture',
      '',
      '  2. CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET',
      '       Generate in Cloudflare Zero Trust → Access → Service Auth → Service Tokens',
      '',
      `Observed: storageStatePath=${e.storageStatePath ?? '(unset)'}, ` +
        `clientIdSet=${Boolean(e.cfAccessClientId)}, ` +
        `clientSecretSet=${Boolean(e.cfAccessClientSecret)}`,
    ].join('\n'),
  );
}

/**
 * Opens a real (headed) Chromium, lets the operator sign in to CF
 * Access, then snapshots cookies + localStorage to a JSON file. The
 * smoke spec re-uses the file on subsequent runs.
 *
 * Usage:
 *
 *   PLAYWRIGHT_STORAGE_STATE=./tests/e2e/.auth/live-state.json \
 *     pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture
 *
 * If the env var is unset, defaults to `./tests/e2e/.auth/live-state.json`.
 */
export async function captureStorageState(opts?: {
  storageStatePath?: string;
  liveDashboardUrl?: string;
}): Promise<string> {
  const outPath =
    opts?.storageStatePath ??
    process.env.PLAYWRIGHT_STORAGE_STATE ??
    path.join(process.cwd(), 'tests', 'e2e', '.auth', 'live-state.json');
  const url = opts?.liveDashboardUrl ?? LIVE_DASHBOARD_URL;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // eslint-disable-next-line no-console
  console.log(
    `[setup-cloudflare-access] Launching Chromium headed → ${url}\n` +
      `  Sign in via your Cloudflare Access SSO when prompted.\n` +
      `  Storage state will be written to: ${outPath}`,
  );

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });

  // Heuristic: we wait until the post-sign-in /wizard route is reached.
  // The dashboard middleware redirects un-authed users to /sign-in?from=…
  // Once the CF cookie lands, refreshing or navigating to /wizard
  // succeeds with a 200. We poll for up to 5 minutes (operator's SSO
  // round-trip + any 2FA prompts).
  // eslint-disable-next-line no-console
  console.log(
    '[setup-cloudflare-access] Waiting up to 5 min for sign-in to complete…',
  );
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await page.goto(`${url}/wizard/onboarding`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      // 200 means we cleared the CF Access gate AND the dashboard
      // middleware (which checks the CF_Authorization JWT).
      if (res && res.status() === 200 && !page.url().includes('/sign-in')) {
        break;
      }
    } catch {
      /* keep waiting */
    }
    await page.waitForTimeout(3_000);
  }

  if (page.url().includes('/sign-in')) {
    await browser.close();
    throw new CloudflareAccessAuthError(
      'Sign-in did not complete within 5 minutes. Aborting capture.',
    );
  }

  await context.storageState({ path: outPath });
  await browser.close();

  // eslint-disable-next-line no-console
  console.log(`[setup-cloudflare-access] Wrote storage state → ${outPath}`);
  return outPath;
}

// CLI entrypoint — keep this module importable AND runnable.
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--capture')) {
    captureStorageState()
      .then((p) => {
        // eslint-disable-next-line no-console
        console.log(`OK: ${p}`);
        process.exit(0);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
      });
  } else {
    // eslint-disable-next-line no-console
    console.log(
      'Usage:\n' +
        '  pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture\n' +
        '\n' +
        'Or, in CI: set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.',
    );
    process.exit(2);
  }
}
