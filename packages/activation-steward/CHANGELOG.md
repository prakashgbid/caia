# @caia/activation-steward

## 0.1.0 — 2026-05-24

Initial release. Layer 2 of the Real Definition-of-Done enforcement stack
(spec: `research/real_definition_of_done_enforcement_2026.md` §4.2 + Task A5).

Ships:

- `src/trace-collector.ts` — pluggable `TraceBackend` (Tempo via TraceQL,
  Jaeger fallback, Null backend for sites without telemetry).
- `src/manifest-cross-check.ts` — joins deploy_manifest entries +
  per-package `expected_call_paths` against trace aggregates; emits
  hit/miss per `(package, tenant, callpath)`.
- `src/per-tenant-isolation.ts` — partitions every aggregation by tenant;
  builds the per-`(package, tenant)` attestation matrix.
- `src/attestation.ts` — atomic JSONL append (`~/.caia/activation-steward/runs.jsonl`)
  + atomic `status.json` snapshot + green/yellow/red/no-telemetry
  classifier.
- `src/reporter.ts` — INBOX append under `## ACTIVATION-STEWARD FAILURES`;
  event-bus emit (`activation-steward.run.completed`,
  `.cold-path.detected`, `.no-telemetry.warning`); state-machine
  dashboard surface.
- `bin/activation-steward-run` — CLI runner, invoked hourly by
  `launchd/com.caia.activation-steward-hourly.plist`.
- `migrations/001_activation_attestations.sql` — Postgres history table.
- `scripts/register-activation-steward.sh` — bootstrap (creates dirs,
  installs plist, runs one cycle).

Graceful-degradation contract: sites without OpenTelemetry are NOT
fail-closed; the steward emits `activation-steward.no-telemetry.warning`
and skips attestation, surfacing a "needs telemetry setup" dashboard
recommendation.

Verification: 41 vitest unit tests + 2 integration tests (caia-real-traces
graceful-degradation + simulated cold-path injection) + launchd smoke.
