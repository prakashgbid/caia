---
"caia": patch
---

ci(fix-it): sharded Playwright runs on the self-hosted stolution runner (FIX-012)

Adds the `fix-it sharded tests` GitHub Actions workflow and its
helper scripts under `scripts/fix-it/`.

The workflow:
1. `prepare` — emits a JSON shard array (default 5; bounded 1..30 via
   `workflow_dispatch` input).
2. `shard` — fans out across `[self-hosted, stolution]` runners.
   Each shard sets `BROWSERLESS_WS_ENDPOINT` to the local Browserless
   container (FIX-007), reads `BROWSERLESS_TOKEN` from the repo
   secret, runs `playwright test --shard=i/N --reporter=blob`, and
   uploads its blob as `blob-report-shard-<i>`.
3. `merge` — runs `if: always()` so failed shards still get
   aggregated. Downloads every blob, runs `playwright merge-reports`
   for a unified HTML, runs `aggregate-shard-results.mjs` for the
   JSON summary, uploads both as artifacts.

The aggregator (`scripts/fix-it/aggregate-shard-results.mjs`) emits
`shard-summary.json` consumed by the FIX-013 dashboard panel:
schemaVersion + per-shard counts + grand totals + run/branch/sha
context. Exits 1 if any shard reports failed tests.

Helper scripts:
- `run-sharded-locally.sh` — same shard layout for laptop reproductions
- `aggregate-shard-results.test.mjs` — 7 self-contained tests
- `validate-workflow.test.mjs` — 13 structural assertions on the YAML

A meta workflow (`fix-it-sharded-tests-meta.yml`) runs the script
tests on every PR touching `.github/workflows/fix-it-sharded-tests.yml`
or `scripts/fix-it/**`.

Phase B (FIX-012). Coordinates with FIX-007 (Browserless on
stolution) for the WS endpoint, FIX-010/011 for the
playwright-config + pool, and FIX-013 for the dashboard panel that
reads `shard-summary.json`.
