---
"@chiefaia/playwright-config": minor
---

feat(playwright-config): Browserless pool + retry for the Fix-It runner (FIX-011)

Adds `@chiefaia/playwright-config/pool` exporting:

- `createBrowserlessPool({ wsEndpoint, token, maxBrowsers, retries })`
  — connection pool that keeps warm `Browser` handles alive across
  jobs, saving the 80–150 ms CDP-handshake-per-spec cost in CI batch
  runs.
- `isTransientBrowserError(err)` — classifier that distinguishes
  remote-Chromium crashes / WS errors / `ECONNRESET` from real test
  failures (assertion errors, selector timeouts).
- `buildPoolWsEndpoint(endpoint, token)` — pure helper, exported for
  testing.

Pool semantics:

- `pool.run(fn)` leases a browser, runs the callback, returns the
  browser. On a transient error during connect or run, retries up to
  `retries` times (default 1). Non-transient errors propagate
  immediately.
- `maxBrowsers` (default 4) caps the pool size; concurrent requests
  beyond the cap queue.
- `dispose()` is idempotent; closes all browsers, rejects in-flight
  waiters.
- `onEvent` hook for the FIX-013 dashboard panel
  (`lease`/`release`/`connect-success`/`connect-fail`/`browser-crashed`/`dispose`).
- A new `expectClose` flag suppresses spurious `browser-crashed`
  events on intentional teardown — useful when the dashboard counts
  "real" crashes vs clean shutdowns.

**Version-pin coupling.** Bumps `playwright` and `@playwright/test`
from 1.59.1 → 1.58.2 to match the Browserless v2.40.0 image's bundled
`playwright-core` (FIX-007). 1.59 produces a `428 Precondition
Required` "Playwright version mismatch" on connect. The runbook in
`infra/browserless/README.md` already documents the upgrade
procedure; this PR is the first consumer to feel it.

Phase B (FIX-011). Stacks on FIX-010.
