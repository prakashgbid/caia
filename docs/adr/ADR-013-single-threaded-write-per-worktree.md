# ADR-013 — Single-threaded write per worktree

## Status

**Accepted** — operator-authorised standing rule.

## Context

A 2026-04-29 → 2026-05-01 chaos audit (`feedback_operational_discipline.md`) surfaced that concurrent writes within a single worktree caused systematic merge conflicts, half-committed state, and corrupted file edits. Multiple Claude Code subagents writing to the same worktree at the same time produces unrecoverable state.

The fix is mechanical: any given worktree has at most one writer at any time. Multiple worktrees may exist (and writers may be parallel across worktrees), but each worktree is single-threaded for writes.

## Decision

**One writer per worktree.** Specifically:

1. **Each substantive code task** is given its own worktree under `.claude/worktrees/<name>/`.
2. **Within a single worktree**, only one Claude / Claude Code agent may have write permissions at a time.
3. **Reads** (Grep, Read, Glob, status checks) may happen concurrently within a worktree — read-only operations are safe.
4. **Across worktrees**, multiple writers are fine — that's how parallelism is achieved.
5. **Worktree count cap**: ≤8 alive (alarm threshold), ≤12 (hard block via Steward preflight).
6. **Substantial Mac-targeted concurrent task cap**: 2 (per `feedback_operational_discipline.md`).

When orchestrator spawns a coding task, it creates a fresh worktree, hands it to the agent, and never spawns a second writer into that worktree until the first agent has either:
- Merged its PR, or
- Closed/abandoned the work explicitly.

Pre-spawn checklist (Steward preflight per ADR-012) checks worktree-cap + concurrent-Mac-task-cap before approving spawn.

## Consequences

**Positive:**
- Eliminates the worst class of concurrent-write corruption observed in the chaos audit.
- Composes cleanly with Git Flow (ADR-015) — each worktree is a branch.
- Composes with Option E (ADR-006) — agent code is parameterised, but each agent invocation is bound to one worktree at runtime.
- Forces explicit parallelism design — orchestrator must explicitly partition work into separate worktrees, not naively fork threads.

**Negative:**
- Hard cap on per-task throughput within a single feature.
- Worktree count itself becomes a resource — must be policed (Steward failure mode #6).
- Spawning many worktrees has filesystem overhead.

**Neutral:**
- Compatible with Choreographer's eventual cross-project event-driven coordination — different projects naturally have different worktrees.

## Operational rules

- **Worktree-create cadence**: orchestrator creates worktree per substantive task; ephemeral / read-only tasks share the main worktree.
- **Worktree-destroy cadence**: after PR merged into develop, worktree is removed by Git Flow auto-cleanup. Steward weekly sweep removes orphaned worktrees.
- **Concurrent-write detection**: Steward semgrep rule + worktree lock file. Second writer sees lock, refuses spawn.
- **Recovery**: if a worktree is corrupted (merge conflict, partial edits), abandon → recreate from develop.

## Re-evaluation triggers

1. **Observed worktree-cap exhaustion** repeatedly under normal load → re-evaluate cap or partitioning strategy.
2. **Tooling matures** to allow safe concurrent writes (e.g., file-system-level transaction support) → re-evaluate.
3. **Productisation** — multi-tenant may require per-tenant worktree isolation; extends but doesn't break this rule.

## References

- Standing rule: `agent/memory/feedback_operational_discipline.md`
- Standing rule: `agent/memory/feedback_self_perpetuating_campaigns.md`
- Audit reference: `caia-enterprise-architecture-comprehensive-2026-05-06.md` §5.2.2 + §10.2.6
- Companion ADRs: ADR-006 (Option E shape), ADR-012 (Steward Gatekeeper), ADR-015 (Git Flow)
