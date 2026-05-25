# @caia/outcome-steward

Real-DoD Layer 3 — Prometheus / Grafana metric verifier.

**Status: WIP / preserved-from-quota-cutoff.** All sub-modules
implemented; orchestrator glue + CLI + tests remaining. See
[`PLAN.md`](./PLAN.md) and the TODO comments inline.

## What's done

- `src/types.ts` — full type surface.
- `src/metric-collector.ts` — `PrometheusBackend`, `GrafanaBackend`,
  `MockBackend`, `NullBackend` + pure helpers (`computeSlope`,
  `compareThreshold`, `defaultStepSeconds`, `pickMostRecent`,
  `probeBackend`).
- `src/manifest.ts` — `loadDeployManifest`, `loadPackageExpectations`,
  `joinManifestAndExpectations`. Reads `caia.outcome.expectedSli` from
  `package.json` or sibling `outcome.yaml`.
- `src/manifest-cross-check.ts` — three checks per spec §4.3
  (existence / threshold / trend). Graceful synthetic row for packages
  without an `expectedSli` declaration.
- `src/matrix.ts` — attestation classifier
  (green / yellow / red / no-metric-declared / no-metric-store / unknown).
- `src/attestation.ts` — JSONL + status snapshot + green-id writers.
- `src/reporter.ts` — INBOX surface + 8 event types + state-machine event.
- `src/index.ts` — public API.
- `migrations/001_outcome_attestations.sql` — Postgres history table +
  per-run roll-up + green-attestations table + latest-per-(pkg, sli) view.
- `launchd/com.caia.outcome-steward-hourly.plist` — hourly cron.
- `bin/outcome-steward-run` — placeholder; needs to mirror
  `../activation-steward/bin/activation-steward-run`.

## What's TODO

- `src/run.ts` — top-level orchestrator (skeleton with full JSDoc
  recipe is committed; throws `TODO(next-session)` on call).
- `bin/outcome-steward-run` — CLI flag parsing + dispatch to `run()`.
- `tests/` — Vitest suite ≥40 tests + integration test against
  `status.chiefaia.com` + smoke test for launchd-load.
- Final verification + admin-merge.

## Sibling

Mirror of `@caia/activation-steward` shape. Read its `src/run.ts` and
`bin/activation-steward-run` to wire the equivalents here.

## Spec

`research/real_definition_of_done_enforcement_2026.md` §4.3 + §12 A8.

## EA Review

See [`EA_REVIEW.json`](./EA_REVIEW.json). Submission reached the EA
Architect Agent pipeline (real submissionId issued); critic LLM spawn
timed out in the build sandbox, not a substantive rejection.
