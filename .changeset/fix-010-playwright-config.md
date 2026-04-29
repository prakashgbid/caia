---
"@chiefaia/playwright-config": minor
---

feat(playwright-config): shared local + browserless config factory (FIX-010)

New package `@chiefaia/playwright-config` exporting
`definePlaywrightConfig()` — a Playwright config factory that auto-
detects local vs Browserless mode based on
`process.env.BROWSERLESS_WS_ENDPOINT`.

Local mode:
  - 3 workers default (Phase B safe ceiling on 16 GB M1 Pro)
  - Override via `PLAYWRIGHT_LOCAL_WORKERS` or `localWorkers` option
  - Clamped to [1, 8]
  - Launch args mirror the Browserless container so failures
    reproduce in both places

Browserless mode:
  - 1 worker (parallelism from CI shards — FIX-012)
  - Connects to `browserless.stolution.local:13080/playwright/chromium`
    by default
  - Token auto-appended from `BROWSERLESS_TOKEN` (handles `?` vs `&`,
    skips if already in the URL)

Other defaults:
  - `fullyParallel: true`
  - 2 retries in CI, 0 locally
  - `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`,
    `video: 'retain-on-failure'`
  - CI reporter is blob+list (consumed by the FIX-012 shard aggregator)

Postinstall hook (`scripts/install-chromium.mjs`) runs
`playwright install chromium` so every dev + CI runner has the pinned
binary on disk after `pnpm install`. Idempotent (skips if already
cached); non-fatal on failure (first test run surfaces the missing-
binary error). Skippable via `PLAYWRIGHT_SKIP_BROWSER_INSTALL` or
`CHIEFAIA_SKIP_PLAYWRIGHT_INSTALL`.

Phase B (FIX-010). Consumed by FIX-011 (Fix-It mode selection) and
FIX-012 (sharded CI).
