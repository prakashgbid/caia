# `@caia/usage-steward`

Real Definition-of-Done **Layer 1** — static-analysis dead-code verifier.

## What it does

Confirms that every merged solution has:

1. **At least one transitive import path** from a production app entry-point.
2. **Every declared export reachable** (no orphans).
3. **No declared-shipped-but-unused** packages (cross-check against `deploy_manifest.yaml` + per-package `expectedImports`).

Wraps four off-the-shelf static-analysis tools and joins their output into a single
per-`(solutionId × site)` attestation matrix:

| Tool                  | What it catches                                                          |
| --------------------- | ------------------------------------------------------------------------ |
| `knip`                | unused files, unused exports, unused enum members, unused dependencies   |
| `depcheck`            | missing-in-package-json, declared-but-unused-in-prod                     |
| `ts-prune`            | unused TS exports (cross-check vs knip)                                  |
| `dependency-cruiser`  | circular deps, orphan modules, dev-dep-in-prod violations                |

Each scanner emits structured `UsageFinding` records that the cross-checker joins
against the manifest and each package's `expectedImports`. Findings are classified
into a per-package status: `green` (everything imported as declared), `yellow`
(amber drift — declared import lost in a refactor), `red` (orphan or declared-but-missing),
`unknown` (scanner failed to run), `no-tooling` (graceful degradation when tools absent).

## Where data lands

- `~/.caia/usage-steward/runs.jsonl` — append-only NDJSON, one row per cron-tick.
- `~/.caia/usage-steward/status.json` — atomic latest-snapshot.
- `~/.caia/usage-steward/attestations.jsonl` — append-only green-attestation list
  (feeds the SPS 5th-AND completion gate).
- `agent-memory/INBOX.md` — under `## USAGE-STEWARD FAILURE`, one entry per red.
- Postgres `caia_meta.usage_attestations` + `caia_meta.usage_steward_runs` (optional;
  one-shot SQL migration ships under `migrations/`).
- Event bus — three event types (`usage-steward.run.completed`,
  `usage-steward.orphan.detected`, `usage-steward.scanner.degraded`).

## Cron

`launchd/com.caia.usage-steward-hourly.plist` runs `bin/usage-steward-run`
once an hour. The runner is exit-0-on-red — the failure surface is the
INBOX + event bus, not the exit code, so launchd doesn't enter respawn
loops on a flaky scanner. Exit-1 is reserved for fatal config / I/O errors.

## Graceful degradation

If a scanner binary is missing (`which knip` returns nothing), the
steward emits a `no-tooling` attestation for that cell and a
`usage-steward.scanner.degraded` warning event. It never marks a cell
red because of its own missing tools — that's the same posture as
`@caia/activation-steward` for the no-telemetry case.

## Spec

See `/Users/macbook32/Documents/projects/research/real_definition_of_done_enforcement_2026.md` §4.1 + §12 Task A4.
