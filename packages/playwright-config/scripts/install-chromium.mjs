#!/usr/bin/env node
/**
 * scripts/install-chromium.mjs
 *
 * Postinstall hook for `@chiefaia/playwright-config`. Runs
 * `playwright install chromium` so every developer + CI runner has
 * the pinned Chromium on disk after `pnpm install`.
 *
 * Idempotent: Playwright's CLI checks the cache first and is a no-op
 * if the binary is already present. The cache lives at:
 *   - Linux:   ~/.cache/ms-playwright
 *   - macOS:   ~/Library/Caches/ms-playwright
 *   - Windows: %LOCALAPPDATA%\ms-playwright
 *
 * Skips automatically when:
 *   - PLAYWRIGHT_SKIP_BROWSER_INSTALL is set (Playwright's own escape hatch)
 *   - PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set
 *   - CHIEFAIA_SKIP_PLAYWRIGHT_INSTALL is set (ours; for containerised
 *     CI that bakes browsers into the runner image)
 *   - We're inside another package's lifecycle (avoids running on
 *     transitive dep installs)
 *
 * Failures are non-fatal — `pnpm install` should not break if a
 * developer is offline. The first `playwright test` run will surface
 * the missing-binary error with Playwright's own clear message.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';

const SKIP_VARS = [
  'PLAYWRIGHT_SKIP_BROWSER_INSTALL',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
  'CHIEFAIA_SKIP_PLAYWRIGHT_INSTALL',
];

function shouldSkip() {
  for (const v of SKIP_VARS) {
    if (process.env[v]) {
      console.log(`[playwright-config] skipping chromium install (${v} set)`);
      return true;
    }
  }
  // npm/pnpm set npm_package_name during the install lifecycle. If our
  // postinstall is fired during another package's install (transitive
  // dep graph quirk), npm_package_name is the parent. We only want to
  // run when we are the package being installed.
  if (
    process.env['npm_package_name']
    && process.env['npm_package_name'] !== '@chiefaia/playwright-config'
  ) {
    console.log('[playwright-config] skipping chromium install (transitive)');
    return true;
  }
  return false;
}

/**
 * Resolve the path to `playwright/cli.js` — the JS entry point we can
 * invoke with `node`. Resolving via `createRequire` handles pnpm's
 * non-hoisted layout, npm's hoisted layout, and yarn's PnP equally
 * well. Returns null if the package is missing (offline install,
 * CI image without devDeps, etc.).
 */
function locatePlaywrightCli() {
  const require = createRequire(import.meta.url);
  // Try the canonical entry first.
  for (const spec of ['playwright/cli.js', 'playwright/lib/cli/program.js']) {
    try {
      return require.resolve(spec);
    } catch {
      // continue
    }
  }
  // Fallback: walk up from this file looking for a `playwright/cli.js`.
  const here = path.dirname(new URL(import.meta.url).pathname);
  for (const rel of [
    '../node_modules/playwright/cli.js',
    '../../playwright/cli.js',
    '../../../node_modules/playwright/cli.js',
    '../../../../node_modules/playwright/cli.js',
  ]) {
    const p = path.resolve(here, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

if (shouldSkip()) process.exit(0);

const cli = locatePlaywrightCli();
if (!cli) {
  console.warn('[playwright-config] playwright CLI not found; skipping install');
  console.warn('[playwright-config] (run `pnpm exec playwright install chromium` manually)');
  process.exit(0);
}

console.log('[playwright-config] running: node playwright/cli.js install chromium');
const result = spawnSync(
  process.execPath,
  [cli, 'install', 'chromium'],
  { stdio: 'inherit' },
);

if (result.error) {
  console.warn(`[playwright-config] install failed: ${result.error.message}`);
  process.exit(0); // non-fatal
}
if (typeof result.status === 'number' && result.status !== 0) {
  console.warn(`[playwright-config] install exited with code ${result.status}`);
  process.exit(0); // non-fatal — first test run will surface a clear error
}

console.log('[playwright-config] chromium installed (or already cached)');
