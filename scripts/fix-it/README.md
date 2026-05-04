# scripts/fix-it/

CI helpers for the Fix-It Test Agent's sharded test runs (FIX-012).

## Files

| File | Purpose |
|---|---|
| `aggregate-shard-results.mjs` | Combines per-shard blob reports → `shard-summary.json` for the dashboard (FIX-013) |
| `aggregate-shard-results.test.mjs` | Unit tests for the aggregator |
| `validate-workflow.test.mjs` | Asserts the `fix-it-sharded-tests.yml` workflow is structurally sound |
| `run-sharded-locally.sh` | Reproduces the sharded run on a developer box |

## How sharding works

1. The `prepare` job in `.github/workflows/fix-it-sharded-tests.yml`
   computes a JSON array `[1, 2, …, N]` and exposes it as a
   `strategy.matrix` input.
2. The `shard` job fans out across `[self-hosted, stolution]` runners.
   Each runner installs deps, points Playwright at the local
   Browserless container (FIX-007) via
   `BROWSERLESS_WS_ENDPOINT=ws://127.0.0.1:13000/playwright/chromium`,
   then runs `playwright test --shard=i/N --reporter=blob`.
3. Each shard uploads its blob as an artifact named
   `blob-report-shard-<i>`.
4. The `merge` job (`if: always()`) downloads every shard's blob,
   runs `playwright merge-reports` to assemble a single HTML report,
   and runs `aggregate-shard-results.mjs` to emit
   `shard-summary.json`.
5. Both artifacts are uploaded — HTML for humans, JSON for the
   FIX-013 dashboard.

## Local dev

```bash
./scripts/fix-it/run-sharded-locally.sh 5
# runs 5 shards, writes blob-report-{1..5}/, then aggregates
```

If you set `BROWSERLESS_WS_ENDPOINT` + `BROWSERLESS_TOKEN`, the local
script behaves exactly like CI — useful for reproducing flaky shards
before pushing.

## Why N=5 by default?

Phase B doc target. Each shard takes ~30 tests; 5 shards = ~150 tests
in parallel; total wall-clock < 10 minutes on the stolution box. Trip
to 10 shards via `workflow_dispatch` if a PR doubles the corpus.

## Aggregator output

`shard-summary.json`:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-04-29T...",
  "runId": "12345",
  "shaRef": "abc...",
  "branch": "feat/fix-012-sharded-ci",
  "shards": [
    { "index": 1, "passed": 12, "failed": 0, "skipped": 0,
      "flaky": 0, "durationMs": 8230, "sizeBytes": 84231 }
  ],
  "totals": {
    "passed": 60, "failed": 0, "skipped": 2, "flaky": 1,
    "durationMs": 41200, "shardCount": 5, "unknownShards": 0
  }
}
```

The FIX-013 dashboard reads this JSON to render the per-shard panel.

## Tests

```
node scripts/fix-it/aggregate-shard-results.test.mjs   # 7 tests
node scripts/fix-it/validate-workflow.test.mjs         # 13 tests
```

The meta workflow `.github/workflows/fix-it-sharded-tests-meta.yml`
runs both on every PR touching this directory.
