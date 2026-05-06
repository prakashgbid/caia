# ADR-015 — Git Flow enforcement (feature → develop → main)

## Status

**Accepted** — operator-authorised standing rule. Inviolate.

## Context

Many small Claude PRs landing daily, plus periodic operator interventions, plus auto-perpetuating multi-leg campaigns, demand a predictable branching discipline. Without one:

- Features bypass develop and merge directly to main → broken main.
- Branches alive without PRs accumulate → orphan-branch sprawl.
- Force-pushes lose history → dependent branches break.
- "What's in the next release?" becomes unanswerable.

Trunk-based development (single `main` branch) was considered but doesn't compose with weekly release-candidate windows. GitHub Flow (feature → main) was considered but doesn't compose with the need for a release-staging branch where Evidence Gate has the last word.

Git Flow (feature → develop → main, with release/* and hotfix/* branches) matches CAIA's release rhythm.

## Decision

CAIA enforces a Git Flow variant. Mechanical rules:

### Branch structure

- `main` — always-deployable. Receives merges from `release/*` and `hotfix/*` only.
- `develop` — integration branch. Receives merges from `feature/*`, `docs/*`, `chore/*`, `fix/*`.
- `feature/*` — short-lived (≤7d). One PR per branch. Branched from `develop`, merged into `develop`.
- `docs/*` — same lifecycle as feature/* but for documentation.
- `release/<date>` — branched from `develop`; merged into `main` AND back-merged into `develop`. Weekly cadence.
- `hotfix/<issue>` — branched from `main`; merged into `main` AND back-merged into `develop`.

### Hard rules

- 🚨 **NEVER push to `main` or `develop` directly.**
- 🚨 **NEVER leave a branch alive without an open PR.**
- 🚨 **NEVER call work "done" until merged into develop AND main, branch + worktree gone.**
- 🚨 **NEVER `git push --force` literal** — use `git push origin "+HEAD:<branch>"` refspec syntax. (Reason: literal `--force` flag was found to behave inconsistently with some hooks; refspec is reliable.)
- 🚨 **NEVER use `gh pr update-branch`** — it can produce phantom merge commits in feature PRs that fail `gitflow-conformance`.
- 🚨 **Squash-and-merge for feature/docs PRs.** Release PRs use merge-commit (preserves history).

### Branch protection

- `main`: requires all 6 Evidence Gate required contexts green; requires conventional-commit on merge; squash forbidden.
- `develop`: requires all 6 Evidence Gate required contexts green. Linear-history requirement disabled (2026-05-03) to allow classic back-merges.
- `gitflow-conformance` semgrep check verifies branch source/target conforms to rules above; rejects unwanted merge commits in feature PRs.

### Definition of Done

Item 14: branch merged into develop AND main, branch + worktree gone (per `feedback_definition_of_done.md`).

## Consequences

**Positive:**
- Predictable releases — `release/<date>` branches give a staging surface.
- `develop` is always the latest integrated state — cherry-picking and rollbacks are clean.
- Branch protection + Evidence Gate + squash-merge keep history readable.
- Steward Gatekeeper failure modes #5, #6, #10 (orphan branches, worktree hygiene, PR staleness) operationalise the rules.

**Negative:**
- More overhead per change (feature → develop → release → main is 3 merges, not 1).
- Hotfixes require explicit `hotfix/*` discipline.
- New contributors must learn the branch structure (operator does not code, but Claude leg handoffs require this knowledge).

**Neutral:**
- Compatible with auto-perpetuating multi-leg campaigns — each leg files its own feature/* branch.

## Enforcement

- GitHub branch protection rules on `main` and `develop`.
- `.github/workflows/evidence-gate.yml` runs all 6 required contexts.
- `.semgrep/caia-rules.yml` includes `gitflow-conformance` check.
- Operator runbook: [`git-flow.md`](../git-flow.md).
- Steward Gatekeeper: pre-spawn check for branch source target validity.

## Re-evaluation triggers

1. **Release cadence change** — if the weekly cadence changes to per-PR continuous deploy, re-evaluate the release/* layer.
2. **Branch-protection drift** — Steward catches; re-evaluate enforcement layer.
3. **Hotfix volume sustained** — >2 hotfixes/week sustained 4 weeks → re-evaluate develop's stability bar.

## References

- Standing rule: `agent/memory/feedback_git_flow_enforced.md`
- Operator runbook: `caia/docs/git-flow.md`
- Definition of Done: `agent/memory/feedback_definition_of_done.md`
- Audit reference: `caia-enterprise-architecture-comprehensive-2026-05-06.md` §5.2.1
- Companion ADRs: ADR-005 (Test-Fix-Commit), ADR-011 (Evidence Gate), ADR-012 (Steward Gatekeeper)
