# `@caia/usage-steward` — Implementation Plan

**Submission to `@caia/ea-architect.submitPlan`**
**Plan type:** `implementation`
**Caller agent:** `usage-steward-builder`
**Spec:** `research/real_definition_of_done_enforcement_2026.md` §4.1 + §12 Task A4
**Affected components:** `@caia/usage-steward`, `@caia/state-machine` (consumer of events), `agent-memory/INBOX.md`, `agent-memory/deploy_manifest.yaml`

## Summary

Build Layer 1 of the Real Definition-of-Done system — a static-analysis dead-code verifier
that runs hourly (launchd) against the caia monorepo. Confirms every merged solution has a
transitive import path from a production entry-point and every declared export is reachable.

## Mirror

`@caia/activation-steward` (Layer 2, merged in #566). Same envelope shape: JSONL audit
+ status snapshot + green-id attestation list + INBOX failure routing + event-bus signals
+ state-machine integration. We are not inventing new infrastructure — we are extending
the existing steward shape.

## Scope

**In scope (this PR):**
- `src/scanners/` — wrappers around `knip`, `depcheck`, `ts-prune`, `dependency-cruiser`.
  Each emits structured `UsageFinding` records.
- `src/manifest.ts` + `src/manifest-cross-check.ts` — joins per-package
  `expectedImports` / `expectedExports` against the deploy manifest and the scanner
  findings; classifies into `green` / `yellow` / `red` / `no-tooling` / `unknown`.
- `src/attestation.ts` — atomic JSONL append + atomic status snapshot + green-id
  attestation list (feeds the SPS 5th-AND completion gate).
- `src/reporter.ts` — INBOX append (under `## USAGE-STEWARD FAILURE`), event-bus
  emit (5 event types), state-machine surface.
- `src/run.ts` — orchestrator.
- `bin/usage-steward-run` — CLI; exits 0 on red (failure surface is INBOX + bus,
  not exit code).
- `launchd/com.caia.usage-steward-hourly.plist` — hourly cron.
- `migrations/001_usage_steward_attestations.sql` — three tables
  (`usage_attestations`, `usage_steward_runs`, `usage_green_attestations`)
  + a `usage_attestations_latest` view.
- `scripts/register-usage-steward.sh` — idempotent launchd install.
- 93 vitest unit + 1 integration test.

**Out of scope (deferred to follow-ups):**
- Customer-site repo scanning (the steward's `packagesRoot` is configurable; just
  invoke it a second time with a different root).
- `vulture` (Python) + `libyear` integration — spec §4.1 mentions these as
  "future cost-zero additions"; not in the four-scanner Layer-1 core.
- K3s systemd timer twin — spec §4.1 dual-writer pattern; Mac launchd ships first,
  K3s follows in a later PR. JSONL append-only semantics make dual-write safe.
- OPA policy + EA Agent gating — spec §12 task A11, depends on this + activation +
  outcome stewards all being live.

## Risks + mitigations

1. **Scanner binaries not on PATH.** Steward emits `no-tooling` for the missing
   scanner's cell and a `usage-steward.scanner.degraded` warning event — it never
   marks a package red because of its own missing tools. Same posture as
   `activation-steward` for the no-telemetry case.
2. **Knip / depcheck JSON shape drifts across minor versions.** Parsers tolerate
   leading log noise and accept the common subset of fields; unknown fields are
   ignored. Tests pin parser behaviour against a frozen sample shape.
3. **120+ packages × 4 scanners = slow.** Scanners run in parallel per-package,
   packages walk serially to keep load bounded. A full monorepo scan is well
   under five minutes; the spec's hourly cron has 60 minutes of headroom.
4. **False positives flood INBOX.** Reporter is idempotent — re-running with the
   same `runId` does not re-append. Only first-time red cells produce an INBOX
   entry; subsequent runs add new entries only for cells that flip to red.

## Verification done locally (before merge)

- `pnpm --filter @caia/usage-steward build` — green (TypeScript strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`).
- `pnpm --filter @caia/usage-steward typecheck` — green.
- `pnpm --filter @caia/usage-steward test` — **93 / 93 passing**, including a real-monorepo integration test that surfaced **22 ship-and-forget candidates** out of 120 scanned packages (the 2026-05-20 stack-teardown lesson predicted ~30; the heuristic underestimates because it only flags zero-deps packages).

## State-machine integration

The steward emits `usage-steward.run.completed` on every cron tick. The
state-machine's `Solution` lifecycle FSM (PR #567) already lists `usage-steward`
as a stable steward id, so consumption is wire-level: no new contract is being
introduced. The reporter also emits four targeted events:
`usage-steward.orphan.detected`, `usage-steward.declared-import.missing`,
`usage-steward.scanner.degraded`, `usage-steward.no-tooling.warning`.

## ADR implications

This PR does not introduce a new architectural decision — it implements the
plan already accepted in `research/real_definition_of_done_enforcement_2026.md`
(Layer 1 of the Real-DoD framework). No new ADR is filed. The package's
description aligns with the spec's §4.1 description verbatim.

## Reversibility

Reversible. The launchd plist is opt-in (the operator runs `scripts/register-usage-steward.sh`);
the steward writes only to `~/.caia/usage-steward/` and the optional
`caia_meta.usage_*` Postgres tables, both of which can be deleted without
affecting any consumer. The package is independent — nothing else in the
workspace imports it yet (until the lifecycle-conductor / OPA policy land).
