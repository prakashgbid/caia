# @chiefaia/playwright-config

Shared Playwright config factory for the Fix-It Test Agent.

## What it does

```ts
// playwright.config.ts in any consumer
import { definePlaywrightConfig } from '@chiefaia/playwright-config';

export default definePlaywrightConfig({
  testDir: './tests/e2e',
  baseURL: 'http://localhost:7777',
});
```

You get one Playwright config that works in two modes:

| Mode | Trigger | Workers | Where Chromium runs |
|---|---|---|---|
| `local` (default) | unset `BROWSERLESS_WS_ENDPOINT` | 3 (override via `PLAYWRIGHT_LOCAL_WORKERS`) | local headless Chromium |
| `browserless` | `BROWSERLESS_WS_ENDPOINT` set | 1 per shard | remote Browserless on stolution |

## Why this exists (FIX-010)

Phase B of the testing-framework architecture
(`reports/testing-framework-architecture-2026-04-28.md`) calls for two
runner modes — local for fast inner-loop iteration, Browserless for
parallel CI batches. Letting every consumer hand-roll their own
`playwright.config.ts` produces drift (different worker counts,
different launch flags, different reporters), which leads to "passes
on my box, fails in CI" flakes that take hours to debug.

This package centralizes:

- The Playwright + Chromium version pin (1.59.1)
- The local-vs-browserless mode toggle
- Sensible default launch args (`--disable-dev-shm-usage`,
  `--disable-gpu`, etc.) that match the Browserless container
- The CI reporter format (blob — feeds the FIX-012 shard aggregator)
- The Browserless v2 connection URL shape
  (`/playwright/chromium?token=…`)

## Worker tuning

Default: 3 workers in local mode. That's the safe ceiling on a 16 GB
M1 Pro per the Phase B doc — 3 workers ≈ 12 GB Chromium-for-Testing
RSS, leaves 4 GB for the editor + dashboard + orchestrator. Bump to 5
on a 32 GB box; 8 is the absolute clamp.

Override per-developer:

```bash
PLAYWRIGHT_LOCAL_WORKERS=5 pnpm test
```

In code:

```ts
export default definePlaywrightConfig({ localWorkers: 5 });
```

## Browserless mode

When `BROWSERLESS_WS_ENDPOINT` is set in the environment, the factory
flips to Browserless mode automatically. Workers drop to 1 (the
parallelism comes from CI sharding — FIX-012), and Playwright connects
via WebSocket.

The connection URL is built from:

1. `opts.browserlessEndpoint` (explicit)
2. `process.env.BROWSERLESS_WS_ENDPOINT`
3. fallback: `ws://browserless.stolution.local:13080/playwright/chromium`

Token handling:

1. `opts.browserlessToken` (explicit)
2. `process.env.BROWSERLESS_TOKEN`
3. if neither is set, no token is appended (Browserless will reject
   the connection unless it's running unauthenticated, which it
   shouldn't be in any environment we care about)

The `?token=` is appended unless the URL already carries one — that
way operators can hard-code a per-CI URL with the token baked in.

## Postinstall hook

`pnpm install` runs `node scripts/install-chromium.mjs`, which calls
`playwright install chromium`. The Playwright CLI is idempotent — a
no-op if the binary at the pinned version is already cached:

- Linux: `~/.cache/ms-playwright`
- macOS: `~/Library/Caches/ms-playwright`
- Windows: `%LOCALAPPDATA%\ms-playwright`

Skip flags (set any of these to skip the install):

- `PLAYWRIGHT_SKIP_BROWSER_INSTALL` (Playwright's own flag)
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`
- `CHIEFAIA_SKIP_PLAYWRIGHT_INSTALL` (ours; for containerised CI that
  bakes browsers into the runner image)

Failures are non-fatal — `pnpm install` should not break if a
developer is offline. The first `playwright test` run will surface
the missing-binary error with Playwright's own clear message.

## Consumers

This config is consumed by:

- `apps/orchestrator` — E2E pipeline tests
- `apps/dashboard` — UI smoke tests
- The Fix-It Test Agent (FIX-001..006) — generated story specs (via FIX-011)

When any consumer's `playwright.config.ts` switches to this factory,
they pick up the same Playwright version, the same launch args, and
the same mode toggle.

## Related

- FIX-007 — Browserless on stolution (the remote farm this connects to)
- FIX-008/009 — per-test SQLite + ports (parallel-safety primitives)
- FIX-011 — Fix-It picks Browserless vs local based on `mode`
- FIX-012 — sharded CI on self-hosted runner

## Browserless pool (FIX-011)

For workloads that hammer Browserless with hundreds of jobs back-to-
back (the Fix-It Test Agent's batch mode), use the pool to keep warm
browsers alive across jobs:

```ts
import { createBrowserlessPool } from '@chiefaia/playwright-config/pool';

const pool = createBrowserlessPool({
  wsEndpoint: process.env.BROWSERLESS_WS_ENDPOINT!,
  token: process.env.BROWSERLESS_TOKEN!,
  maxBrowsers: 4,
  retries: 1,
});

const result = await pool.run(async (browser) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(...);
  return doStuff(page);
});

await pool.dispose();   // tear down at end of run
```

Why a pool:

- Each Playwright `chromium.connect()` to remote Browserless costs
  80–150 ms of CDP-handshake latency. At 1 000 jobs that's minutes.
- Reusing browsers across jobs amortizes the cost.

What the pool retries:

- WebSocket connect failures (`ECONNRESET`, `socket hang up`,
  `WebSocket error`)
- Mid-run remote-Chromium crashes (`Target page, context or browser
  has been closed`)

What it does NOT retry: assertion failures, selector timeouts, any
non-transient error. Those propagate on the first try.

`isTransientBrowserError(err)` is the classifier — exported so the
Fix-It runner can use the same rules to decide whether to mark a
test "flaky" vs "failed".

### Version pin coupling

Browserless v2.40.0 ships `playwright-core@1.58.2` as its default. We
pin our local Playwright to the matching minor version so connect
succeeds. Mismatch produces:

```
browserType.connect: WebSocket error: ws://… 428 Precondition Required
Playwright version mismatch
```

Upgrading is a coordinated change: bump the Browserless image SHA
(see `infra/browserless/README.md`), then bump this package's
`playwright` + `@playwright/test` deps in lockstep.
