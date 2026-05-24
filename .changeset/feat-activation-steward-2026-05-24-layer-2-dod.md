---
"@caia/activation-steward": minor
---

feat(@caia/activation-steward): Real-DoD Layer 2 — OpenTelemetry runtime call-path verifier

Closes the "imported-but-never-called" gap in the Real Definition-of-Done enforcement
stack (spec: `research/real_definition_of_done_enforcement_2026.md` §4.2 + Task A5).

For every merged package that declares `caia.activation.expectedCallPaths[]`, this steward
confirms those entrypoints actually fire at runtime within the configured freshness window
(default 24h prod / "last green CI" for test). Joins span aggregates against the deploy
manifest, partitions per-tenant, emits a per-`(package, tenant)` attestation matrix, and
routes red cells to INBOX + event-bus + the state-machine dashboard.

Ships:

- `src/trace-collector.ts` — pluggable `TraceBackend`. Default `TempoBackend` talks Grafana
  Tempo's HTTP `/api/search` with TraceQL; `JaegerBackend` is the fallback; `NullBackend`
  is the graceful-degradation path for sites without telemetry yet; `MockBackend` is the
  test double.
- `src/manifest-cross-check.ts` — joins manifest entries + per-package
  `expected_call_paths` against trace aggregates, emits hit/miss per
  `(package, tenant, callpath)`.
- `src/per-tenant-isolation.ts` — partitions every aggregation by `tenant_id` semantic
  attribute; builds the per-`(package, tenant)` attestation matrix.
- `src/attestation.ts` — atomic JSONL append (`~/.caia/activation-steward/runs.jsonl`) +
  atomic `status.json` snapshot + green/yellow/red/no-telemetry/unknown classifier +
  Postgres-row flattener.
- `src/reporter.ts` — INBOX append under `## ACTIVATION-STEWARD FAILURES`, event-bus emit
  for `activation-steward.run.completed` + `.cold-path.detected` + `.no-telemetry.warning`
  + `.degraded.warning`, state-machine dashboard surface.
- `bin/activation-steward-run` — CLI runner (invoked hourly by launchd).
- `launchd/com.caia.activation-steward-hourly.plist` — mirrors the deploy-steward plist
  pattern (Label, StartInterval=3600, RunAtLoad, ThrottleInterval=60).
- `migrations/001_activation_attestations.sql` — Postgres history table with composite
  uniqueness on `(run_id, package_name, tenant_id, callpath)` + per-status indices +
  latest-attestation view.
- `scripts/register-activation-steward.sh` — idempotent bootstrap (build + bootstrap
  plist + kickstart one cycle + print status).

**Graceful degradation:** sites without OpenTelemetry are NOT fail-closed. The steward
emits `activation-steward.no-telemetry.warning`, writes a "no-telemetry" run row, and
surfaces a dashboard recommendation ("needs telemetry setup"). Exit code stays 0. For
caia itself: tracing is real (`@chiefaia/tracing` ships today), but Tempo deployment to
K3s is Task A7 — until A7 lands, caia's own steward runs produce
`no-telemetry.warning` events, which is the correct, intended behaviour.

**Verification:** 92 vitest tests (unit + 2 integration + cold-path injection) +
`tsc --noEmit` clean + end-to-end CLI smoke (real `~/Documents/projects/caia/packages`
root) + launchd `bootstrap + kickstart` smoke confirmed `~/.caia/activation-steward/`
populated with both `runs.jsonl` and atomically-written `status.json`. Integration
test #1 against caia's own packages root correctly emits `no-telemetry.warning`
(consistent with Tempo-not-yet-deployed reality). Integration test #2 (cold-path
injection) flags a phantom declared-but-never-called callpath as red within one cycle.

**Operator action required after merge:**
1. Run `psql "$DATABASE_URL" -f packages/activation-steward/migrations/001_activation_attestations.sql`.
2. Run `bash packages/activation-steward/scripts/register-activation-steward.sh` to install
   the LaunchAgent.
3. (Once Task A7 lands) set `ACTIVATION_STEWARD_TEMPO_URL` in the plist's
   `EnvironmentVariables` block.

EA Agent submission record: `agent-memory/ea_submissions/2026-05-24-activation-steward-plan.md`
(self-review mode — `@caia/ea-architect.submitPlan` API is design-only per spec §5.6).
