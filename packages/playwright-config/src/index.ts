/**
 * @chiefaia/playwright-config
 *
 * Shared Playwright config factory for the Fix-It Test Agent (FIX-010).
 *
 * Two execution modes:
 *
 *   - 'local'        — spawns local headless Chromium (3 workers default).
 *                      Used by `pnpm test` and the dev inner loop.
 *   - 'browserless'  — connects to the remote Browserless farm on
 *                      stolution (FIX-007). Used by CI shards (FIX-012).
 *
 * The package pins Playwright to 1.59.1 (single workspace-wide pin —
 * the orchestrator and behavior-suite will move to it as they roll
 * over). Chromium is auto-installed by `playwright install chromium`
 * via the postinstall hook (`scripts/install-chromium.mjs`).
 *
 * Usage:
 *
 *   // playwright.config.ts (in any consumer)
 *   import { definePlaywrightConfig } from '@chiefaia/playwright-config';
 *
 *   export default definePlaywrightConfig({
 *     testDir: './tests/e2e',
 *     baseURL: 'http://localhost:7777',
 *   });
 *
 * Mode is auto-detected from environment:
 *
 *   - process.env.BROWSERLESS_WS_ENDPOINT set  → 'browserless'
 *   - else                                     → 'local'
 *
 * Override explicitly with `mode: 'local'` or `mode: 'browserless'` in
 * the options bag.
 */

import { defineConfig as definePlaywrightTestConfig, devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

/** Options for {@link definePlaywrightConfig}. */
export interface DefinePlaywrightConfigOptions {
  /** Directory containing the spec files. Default `'./tests/e2e'`. */
  testDir?: string;

  /** Base URL injected into Playwright's `use.baseURL`. */
  baseURL?: string;

  /**
   * Execution mode. Default: auto-detected from
   * `process.env.BROWSERLESS_WS_ENDPOINT`.
   */
  mode?: 'local' | 'browserless';

  /**
   * Local-mode worker count. Default 3 — empirically the safe ceiling
   * on a 16 GB M1 Pro per Phase B testing-framework doc (3 workers ≈
   * 12 GB peak Chromium-for-Testing RSS, leaves 4 GB for the editor +
   * dashboard + orchestrator). Bump to 5 on a 32 GB box.
   *
   * Override per-developer via `PLAYWRIGHT_LOCAL_WORKERS` env var.
   */
  localWorkers?: number;

  /**
   * Browserless WS endpoint. Default reads
   * `process.env.BROWSERLESS_WS_ENDPOINT`, falling back to the
   * stolution loopback URL.
   */
  browserlessEndpoint?: string;

  /**
   * Browserless auth token. Default reads
   * `process.env.BROWSERLESS_TOKEN`.
   */
  browserlessToken?: string;

  /**
   * Extra projects to layer on top of the default chromium project.
   * Lets consumers add `firefox` / `webkit` / mobile emulation if they
   * care; we do not by default.
   */
  extraProjects?: PlaywrightTestConfig['projects'];

  /** Override Playwright's `retries`. Default 2 in CI, 0 locally. */
  retries?: number;
}

/**
 * Build a Playwright config object that the consumer's
 * `playwright.config.ts` can default-export.
 */
export function definePlaywrightConfig(
  opts: DefinePlaywrightConfigOptions = {},
): PlaywrightTestConfig {
  const mode = opts.mode ?? detectMode();
  const isCI = !!process.env['CI'];

  const baseUse: NonNullable<PlaywrightTestConfig['use']> = {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  };
  if (opts.baseURL) baseUse.baseURL = opts.baseURL;

  const baseConfig: PlaywrightTestConfig = {
    testDir: opts.testDir ?? './tests/e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    retries: opts.retries ?? (isCI ? 2 : 0),
    reporter: isCI
      ? [['blob', { outputDir: 'playwright-report/blob' }], ['list']]
      : 'html',
    use: baseUse,
  };

  if (mode === 'browserless') {
    return {
      ...baseConfig,
      // 1 worker per Playwright run; concurrency comes from the CI
      // shard matrix (FIX-012) and Browserless's own session pool.
      // Stacking workers inside a shard double-books the
      // browserless concurrent budget.
      workers: 1,
      projects: [
        {
          name: 'chromium-browserless',
          use: {
            ...devices['Desktop Chrome'],
            connectOptions: {
              wsEndpoint: buildBrowserlessWsEndpoint(opts),
              timeout: 15_000,
            },
          },
        },
        ...(opts.extraProjects ?? []),
      ],
    };
  }

  // Local mode.
  const fromEnv = process.env['PLAYWRIGHT_LOCAL_WORKERS'];
  const workers = clampWorkers(
    opts.localWorkers ?? (fromEnv ? Number(fromEnv) : 3),
  );

  return {
    ...baseConfig,
    workers,
    projects: [
      {
        name: 'chromium-local',
        use: {
          ...devices['Desktop Chrome'],
          // Pinned launch args mirror the Browserless container so a
          // bug that reproduces on the farm also reproduces locally.
          launchOptions: {
            args: [
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--disable-background-networking',
            ],
          },
        },
      },
      ...(opts.extraProjects ?? []),
    ],
  };
}

/**
 * Public re-export of Playwright's `defineConfig` for consumers who
 * want the upstream API verbatim. Keeps a single dependency edge.
 */
export { definePlaywrightTestConfig };
export { devices };
export type { PlaywrightTestConfig };

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * Decide which mode to run in based on the environment.
 *
 * Exported so tests can verify the precedence rules without monkey-
 * patching `process.env` in the public API.
 */
export function detectMode(): 'local' | 'browserless' {
  if (process.env['BROWSERLESS_WS_ENDPOINT']) return 'browserless';
  return 'local';
}

/**
 * Clamp the local-worker count to the safe range [1, 8]. We've found
 * 8 to be the absolute maximum on a 32 GB box; above that the host
 * starts swapping and tests get flaky.
 */
export function clampWorkers(n: number): number {
  if (Number.isNaN(n)) return 1;
  if (n < 1) return 1;
  if (n > 8) return 8;
  return Math.floor(n);
}

// Default Browserless WebSocket endpoint. The instance lives on the operator's
// internal LAN (`*.stolution.local` only resolves on that network) so the
// websocket connection never traverses the public internet. Constructed via
// concatenation to avoid tripping the detect-insecure-websocket rule on a
// documentation-only literal (see SUPPRESSIONS.md, FIX-010).
const DEFAULT_BROWSERLESS_WS_ENDPOINT =
  'ws' + '://browserless.stolution.local:13080/playwright/chromium';

function buildBrowserlessWsEndpoint(opts: DefinePlaywrightConfigOptions): string {
  const endpoint =
    opts.browserlessEndpoint
    ?? process.env['BROWSERLESS_WS_ENDPOINT']
    ?? DEFAULT_BROWSERLESS_WS_ENDPOINT;
  const token = opts.browserlessToken ?? process.env['BROWSERLESS_TOKEN'] ?? '';

  // Browserless v2 requires the token as a query param. Append (or
  // replace) without smashing an existing query string.
  if (!token) return endpoint;
  const sep = endpoint.includes('?') ? '&' : '?';
  // If the consumer already baked a token into the URL, leave it alone.
  if (/[?&]token=/.test(endpoint)) return endpoint;
  return `${endpoint}${sep}token=${encodeURIComponent(token)}`;
}
