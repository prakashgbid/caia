---
"caia": patch
---

docs+feat(dashboard): test-isolation runbook + dashboard panel (FIX-013)

Adds:

1. `docs/test-isolation-runbook.md` — comprehensive operator guide
   covering the FIX-007..012 stack: architecture diagram, the four
   guarantees, health-check commands ranked by utility, common
   scenarios (flaky CI, stuck shard, disk pressure, saturation,
   token rotation), and the configuration env-var index.

2. `apps/dashboard/app/test-isolation/page.tsx` — live dashboard
   panel with three cards:
   - **Browserless**: active/max, queue, CPU, memory; warns red at
     90% utilisation
   - **Per-test SQLite**: total / stale (>1h) / disk usage / recent
     files table
   - **Last shard run**: pass/fail/skip/flaky/duration from
     `shard-summary.json`
   Refreshes every 5 s while the tab is visible (Page Visibility API).

3. `apps/dashboard/app/api/test-isolation/route.ts` — the API the
   panel reads. Best-effort merging of:
   - Browserless `/pressure` (3 s timeout; null on unreachable)
   - `os.tmpdir()` scan for `caia-test-*.sqlite` files
   - Optional `shard-summary.json` from `SHARD_SUMMARY_PATH`

The runbook is the canonical reference for "the testing infra is
acting up" — first stop for any operator. The dashboard is the
real-time view that points operators at the right command.

Phase B (FIX-013). Final piece of the FIX-007..013 infrastructure
track. Once FIX-001..006 (Fix-It Agent itself) lands, the agent
consumes everything below it automatically.
