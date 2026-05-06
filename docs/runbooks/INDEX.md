# Runbook Library

> **Source**: distilled from `caia-enterprise-architecture-comprehensive-2026-05-06.md` §4.3.3.
> **Maintenance**: today this index is operator-curated; Lantern (master sequencing item 16.5) auto-detects new failure modes and proposes runbooks.

This is the runbook library scaffolding. Each runbook is a step-by-step recovery procedure for a specific failure or operational task. The intent is that, when a SLO breach or alert fires at 3am, the operator (or Claude on operator's behalf) opens this index, finds the matching runbook, and follows the procedure.

The 10 most likely runbook topics are scaffolded below as placeholders. Each will be authored as the corresponding system matures or its first incident lands.

## Status legend

- ✅ **Authored** — runbook is in this directory and current
- 📝 **Stub** — placeholder; first author trigger pending
- 📋 **Planned** — to be authored by a specific agent / phase

## Existing runbooks (already in `caia/docs/`)

| Topic | Path | Status |
|---|---|---|
| Evidence Gate | [`../evidence-gate.md`](../evidence-gate.md) | ✅ Authored |
| Steward Gatekeeper | [`../steward.md`](../steward.md) | ✅ Authored |
| Capability Broker | [`../capability-broker.md`](../capability-broker.md) | ✅ Authored |
| MCP Security | [`../mcp-security.md`](../mcp-security.md) | ✅ Authored |
| Spend Guard | [`../spend-guard.md`](../spend-guard.md) | ✅ Authored |
| Git Flow | [`../git-flow.md`](../git-flow.md) | ✅ Authored |
| Test Isolation | [`../test-isolation-runbook.md`](../test-isolation-runbook.md) | ✅ Authored |
| Prompt Injection Defense | [`../prompt-injection-defense.md`](../prompt-injection-defense.md) | ✅ Authored |
| Regression Testing | [`../regression-testing.md`](../regression-testing.md) | ✅ Authored |
| Safety Hardening | [`../safety_hardening_2026-04-29.md`](../safety_hardening_2026-04-29.md) | ✅ Authored |

## Top 10 runbook stubs (this leg of work)

| # | Runbook | First-author trigger | Slot |
|---|---|---|---|
| 1 | [Subscription cap exhausted](subscription-cap-exhausted.md) | First spend-guard 100%-cap pause event | First incident or Lantern Phase 1 |
| 2 | [Vault unsealed sequence](vault-unsealed-sequence.md) | First Vault container restart drill | DevOps Architect (item 11.9) |
| 3 | [PR auto-merge stuck](pr-auto-merge-stuck.md) | First Evidence-Gate + auto-merge stall | First incident |
| 4 | [Worktree corruption recovery](worktree-corruption-recovery.md) | First single-threaded-write violation observed | DevOps Architect |
| 5 | [Database migration failure](database-migration-failure.md) | First Steward failure-mode #1 fire | Database Architect (item 11.7) |
| 6 | [MCP saturation / timeout cascade](mcp-saturation.md) | First failure-mode #15 fire | Lantern Phase 1 |
| 7 | [Disaster recovery (DR drill)](disaster-recovery.md) | Pre-productisation milestone | Cross-cutting; pre-productisation |
| 8 | [Mac LaunchAgent supervision failure](launchagent-supervision-failure.md) | First daemon crash-loop | DevOps Architect |
| 9 | [GitHub PAT expiry](github-pat-expiry.md) | First Steward failure-mode #9 fire | DevOps Architect |
| 10 | [Apprentice adapter rollback](apprentice-adapter-rollback.md) | First adapter regression detection | Apprentice Phase 3 |

## Per-runbook template

Every runbook in this library follows the same shape:

```
# Runbook: <Name>

## Symptom
What the operator / Claude observes that triggers this runbook.

## Severity
SEV-1 (page operator), SEV-2 (operator review next session), SEV-3 (informational)

## Detection
How this is detected (alert source, dashboard panel, log pattern).

## Immediate response
Steps to stabilise the system. Time-bounded.

## Diagnosis
Steps to identify root cause.

## Resolution
Steps to fix.

## Post-mortem
Mentor incident classification + lesson-synthesis trigger.

## See also
Related runbooks, ADRs, memory files.
```

## Stub files

The 10 stub runbooks below are placeholders — they exist so cross-references resolve when a runbook is referenced before it is fully authored. Each will be expanded the first time its trigger fires.

- [`subscription-cap-exhausted.md`](subscription-cap-exhausted.md)
- [`vault-unsealed-sequence.md`](vault-unsealed-sequence.md)
- [`pr-auto-merge-stuck.md`](pr-auto-merge-stuck.md)
- [`worktree-corruption-recovery.md`](worktree-corruption-recovery.md)
- [`database-migration-failure.md`](database-migration-failure.md)
- [`mcp-saturation.md`](mcp-saturation.md)
- [`disaster-recovery.md`](disaster-recovery.md)
- [`launchagent-supervision-failure.md`](launchagent-supervision-failure.md)
- [`github-pat-expiry.md`](github-pat-expiry.md)
- [`apprentice-adapter-rollback.md`](apprentice-adapter-rollback.md)

## Re-evaluation triggers

1. **First Lantern Phase 1 alert** — review which runbooks were consulted; promote the most-used to "Authored" status.
2. **New systemic failure mode** observed → file a runbook stub.
3. **Pre-productisation milestone** — run a full DR drill; promote disaster-recovery.md to Authored.

## See also

- [`../slos.md`](../slos.md) — SLOs that gate runbook triggers
- [`../adr/ADR-012-steward-gatekeeper.md`](../adr/ADR-012-steward-gatekeeper.md) — 15 enumerated failure modes
- `agent/memory/steward_gatekeeper_directive.md` — failure-mode taxonomy
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §4.3.3 + §4.5.2 — full audit
