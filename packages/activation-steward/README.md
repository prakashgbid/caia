# @caia/activation-steward

**Real-DoD Layer 2 — OpenTelemetry runtime call-path verifier.**

Spec: `research/real_definition_of_done_enforcement_2026.md` §4.2 (the
activation steward) + §12 Task A5 (build task) + §A.4 (TraceQL query
template). Sibling of the deploy-steward (Layer 1), usage-steward
(Layer 3, planned), and outcome-steward (Layer 4, planned).

## What it solves

Closes the "imported-but-never-called" gap. Code can be imported into
a module that is itself dead — static-analysis alone can't catch that.
The activation steward confirms every merged package's declared
entrypoints actually fire at runtime within the last N hours.

```
   Plan → Code → PR → Merged → Deployed
                                  ↓
                          ┌───────┴───────┐
                          ↓               ↓
                   usage-steward    activation-steward  ← THIS PACKAGE
                   (Layer 3)        (Layer 2)
                   "imported?"      "called?"
                          ↓               ↓
                          └───────┬───────┘
                                  ↓
                          outcome-steward
                          (Layer 4)
                          "moved the SLI?"
```

## How it works

1. **Trace collection.** Pluggable `TraceBackend` queries the configured
   OpenTelemetry sink (default Tempo via TraceQL; Jaeger fallback;
   `NullBackend` for sites without telemetry yet). Aggregates by
   `service.name` + `span.name` over the configured window (default
   last 24h).

2. **Manifest cross-check.** Reads `deploy_manifest.yaml` plus each
   package's `caia.activation.expectedCallPaths[]` declaration (or
   `activation.yaml` companion file). For each declared call-path:
   queries the trace store for hits; flags any path with zero hits
   in the window as a candidate cold path.

3. **Per-tenant isolation.** A path can be cold for one tenant and hot
   for another. The steward partitions every aggregation by the
   `tenant_id` semantic attribute and builds a per-`(package, tenant)`
   attestation matrix.

4. **Attestation.** Writes a JSONL run row to
   `~/.caia/activation-steward/runs.jsonl`, an atomic `status.json`
   snapshot, and a Postgres history row per (run × package × tenant ×
   callpath). Classification:
   - **green** — all expected paths hit
   - **yellow** — some hit (partial activation)
   - **red** — none hit OR a critical path missing
   - **no-telemetry** — backend reported `telemetry: absent` (this is
     NOT a failure; see "graceful degradation" below)

5. **Reporting.**
   - INBOX append under `## ACTIVATION-STEWARD FAILURES`.
   - Event-bus emits: `activation-steward.run.completed` (every run),
     `activation-steward.cold-path.detected` (per red cell),
     `activation-steward.no-telemetry.warning` (when backend is absent).
   - State-machine dashboard surface via `activation-steward.run.completed`.

## Graceful degradation

**Not every site has OpenTelemetry instrumented day 1.** The steward
explicitly does NOT fail closed when telemetry is absent:

- `TraceBackend.health()` returns `{ telemetry: 'absent' | 'degraded' | 'present' }`.
- On `absent`: emits `activation-steward.no-telemetry.warning`, writes
  a "no-telemetry" run row, skips attestation, surfaces a dashboard
  recommendation ("needs telemetry setup"). Exit code 0.
- On `degraded` (Tempo 5xx, timeout): writes "unknown" attestations
  (NOT red), retries next cron tick. After 3 consecutive `degraded`
  runs the steward escalates its own health as a
  `## ACTIVATION-STEWARD DEGRADED` INBOX entry (per spec §10).
- On `present`: full attestation applies.

For caia itself: tracing is real (`@chiefaia/tracing` ships today),
but Tempo deployment to K3s is Task A7 (spec §12). Until A7 lands,
caia's own activation-steward runs will produce `no-telemetry.warning`
events — which is the correct, intended behaviour.

## CLI

```bash
# Standard hourly invocation (used by launchd)
activation-steward-run --quiet

# Dry-run (no JSONL write, no INBOX append, no event-bus emit)
activation-steward-run --dry-run

# Custom freshness window
activation-steward-run --window-hours 6

# Custom Tempo URL (default: http://localhost:3200)
activation-steward-run --tempo-url http://stolution.local:3200

# Custom INBOX path (default: ~/Documents/projects/agent-memory/INBOX.md)
activation-steward-run --inbox ~/notes/INBOX.md
```

## Layout

```
packages/activation-steward/
├── src/
│   ├── index.ts                  # public API re-exports
│   ├── types.ts                  # core types: Attestation, TraceMatch, etc.
│   ├── manifest.ts               # loads deploy_manifest + per-package expected_call_paths
│   ├── trace-collector.ts        # TraceBackend interface + Tempo/Jaeger/Null backends
│   ├── manifest-cross-check.ts   # joins manifest entries against trace aggregates
│   ├── per-tenant-isolation.ts   # builds per-(package, tenant) attestation matrix
│   ├── attestation.ts            # JSONL append + status.json + classification
│   ├── reporter.ts               # INBOX, event-bus, state-machine surfaces
│   └── run.ts                    # top-level orchestrator
├── bin/
│   └── activation-steward-run    # CLI entrypoint
├── launchd/
│   └── com.caia.activation-steward-hourly.plist
├── migrations/
│   └── 001_activation_attestations.sql
├── scripts/
│   └── register-activation-steward.sh
└── tests/
    ├── trace-collector.test.ts
    ├── manifest-cross-check.test.ts
    ├── per-tenant-isolation.test.ts
    ├── attestation.test.ts
    ├── reporter.test.ts
    ├── manifest.test.ts
    ├── run.test.ts
    ├── integration-no-telemetry.test.ts   # caia-real-stack graceful-degradation
    └── integration-cold-path.test.ts      # simulated cold-path injection
```

## Public API

```typescript
import {
  // Top-level orchestrator
  run, type RunResult, type RunOpts,

  // Trace backends
  type TraceBackend, type TraceMatch, type BackendHealth,
  TempoBackend, JaegerBackend, NullBackend, MockBackend,

  // Manifest
  loadDeployManifest, loadPackageExpectations,
  type ExpectedCallPath, type PackageExpectations,

  // Cross-check
  crossCheck, type CrossCheckResult,

  // Per-tenant
  partitionByTenant, buildAttestationMatrix,
  type AttestationMatrix, type AttestationCell,

  // Attestation
  appendRun, writeStatusSnapshot, classify,
  type Attestation, type RunRow,

  // Reporter
  reportToInbox, reportToEventBus, reportToStateMachine,
} from '@caia/activation-steward';
```

## Bootstrap

```bash
bash packages/activation-steward/scripts/register-activation-steward.sh
```

This:
1. Builds `@caia/activation-steward`.
2. Ensures `~/.caia/activation-steward/` exists.
3. Copies the plist into `~/Library/LaunchAgents/`.
4. `launchctl bootstrap gui/$(id -u) <plist>`.
5. `launchctl kickstart -k gui/$(id -u)/com.caia.activation-steward-hourly`.
6. Prints the first cycle's `status.json`.

## Database migration

```bash
psql "$DATABASE_URL" -f packages/activation-steward/migrations/001_activation_attestations.sql
```

Creates `caia_meta.activation_attestations` (per-run × per-package ×
per-tenant × per-callpath row).

## Reference

- `research/real_definition_of_done_enforcement_2026.md` §4.2, §A.4, §12 A5
- `agent-memory/feedback_real_definition_of_done.md`
- `agent-memory/ea_submissions/2026-05-24-activation-steward-plan.md` (this build's plan record)
- `packages/tracing/src/index.ts` (the `@chiefaia/tracing` wrapper that injects the `solution.id` attribute)
