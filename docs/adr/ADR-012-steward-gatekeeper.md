# ADR-012 — Steward Gatekeeper (15 enumerated failure modes)

## Status

**Accepted** — operator-authorised 2026-05-04.

## Context

The Evidence Gate (ADR-011) catches per-PR regressions but cannot catch systemic, slow-burn failure modes that emerge across PRs and across time:

- A failed Drizzle migration that breaks future migrations (numbering collision).
- An orphan worktree squatting on memory while its branch is gone.
- A backup pipeline silently failing for weeks.
- Memory drift — `MEMORY.md` index out of sync with on-disk files.
- Stash bloat, dependabot DIRTY, token expiry, MCP saturation.

These are class-failures that compound. Catching them at PR-merge is too late (they are inter-PR phenomena). Catching them by hand is impossible at CAIA's cadence.

The Steward Gatekeeper is the source of truth on code, release, deployment, builds, and platform health.

## Decision

Steward Gatekeeper enumerates **15 failure modes** and surfaces three operational surfaces:

### 15 enumerated failure modes

1. **Migration breakpoints** — Drizzle migrations that won't apply or skip
2. **Graph divergence** — AKG entities desynced from source
3. **Numbering collisions** — duplicate migration numbers, duplicate ADR numbers
4. **Stash hygiene** — stale stash entries hoarding diff context
5. **Orphan branches** — branches alive without an open PR
6. **Worktree hygiene** — worktrees alive without a corresponding branch (or vice versa)
7. **Backup pipeline health** — Vault snapshots, DB hourly backups, memory weekly backups all current
8. **Audit log bounded growth** — `audit_log` table not growing unbounded
9. **Token expiry** — GitHub PAT, Anthropic OAuth, Vault AppRole tokens not within expiry window
10. **PR staleness** — PRs alive >7 days without merge or close
11. **Dependabot triage** — dependabot PRs not stuck in DIRTY merge state
12. **Memory drift** — `MEMORY.md` index entries match on-disk files; no orphaned topics
13. **Spend prediction** — spend trajectory exceeds 80% cap before week reset
14. **CI flake** — flake rate sustained >5% triggers investigation
15. **MCP saturation** — MCP timeout rate per hour vs 200/800 alarm thresholds

### Three operational surfaces

| Surface | Trigger | Behaviour |
|---|---|---|
| `steward-gatekeeper` CI check | Pre-merge (per PR) | Static analyzers — fast-fail subset of 15 (numbering collisions, stash hygiene, dependabot triage). Blocking. |
| `steward run` (daily/weekly) | Cron / LaunchAgent | Full 15-mode sweep. Posts daily digest to operator. Files PRs for auto-resolvable issues (Curator-style propose-only). |
| `steward preflight` | Pre-spawn hook | Before orchestrator spawns a substantial agent task: check spend prediction, MCP saturation, worktree count vs cap. Reject if unsafe. |

Each failure mode has:
- A **detector** (static analyzer or CLI script)
- A **classifier** (severity: BLOCKING, WARN, INFO)
- A **proposer** (Curator-style propose-only — PR through Evidence Gate, never auto-merge)

Architecture report: `~/Documents/projects/reports/steward-gatekeeper-architecture-2026-05-04.md`. Implementing engine: `@chiefaia/steward-core` (PR #285).

## Consequences

**Positive:**
- Inter-PR slow-burn failure modes caught before they cascade.
- Operator gets one digest, not 15 alarm streams.
- Pre-spawn preflight prevents wasteful spawns when system is unsafe.
- Composes with Mentor (incident-driven), Curator (opportunity-driven), Evidence Gate (per-PR), Lantern (observability) for a complete defensive stack.

**Negative:**
- Maintenance — adding a new failure mode requires writing a detector + classifier.
- False-positive risk — overly strict detectors create alert fatigue.
- Daily digest can become noise if not curated.

**Neutral:**
- Productisation will add tenant-isolation failure modes — extends the enumeration.

## Re-evaluation triggers

1. **New systemic failure mode** observed → add to enumeration; ≥3 new modes accumulated triggers review of taxonomy.
2. **False-positive rate >10%** sustained → re-tune detectors.
3. **Mentor surfaces a class of failure** that should be Steward-side rather than Mentor-side (post-hoc lesson) → migrate.

## References

- Standing rule: `agent/memory/steward_gatekeeper_directive.md`
- Architecture report: `~/Documents/projects/reports/steward-gatekeeper-architecture-2026-05-04.md`
- Implementing engine: `@chiefaia/steward-core` (PR #285)
- Operator runbook: `caia/docs/steward.md`
- Audit reference: `caia-enterprise-architecture-comprehensive-2026-05-06.md` §4.5
- Companion ADRs: ADR-010 (4-layer safety stack), ADR-011 (Evidence Gate)
