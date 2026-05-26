# ADR-016: `develop` is the canonical integration branch; `main` is a fast-forwarded mirror

**Status:** Accepted (operator-ratified 2026-05-25)
**Deciders:** Operator (Stolution) + reconcile agent
**Date:** 2026-05-25
**Supersedes:** ADR-015 (git-flow-enforcement) — supplements rather than replaces; ADR-015 still governs branch-naming and PR conformance, but `develop` replaces `main` as the gate target.
**Related:** `~/Documents/projects/agent-memory/standing_rule_develop_canonical_2026-05-25.md`, `reports/main_develop_reconcile_audit_2026-05-25.md`

## Context

By 2026-05-25, `origin/main` and `origin/develop` had **orphan histories** (no common ancestor): `main` carried the late-April/early-May architecture-registry → orchestrator → worker-coding → validator stack, while `develop` carried the post-rewrite Atlas + 17-architect + steward + lifecycle-conductor stack. 50 commits sat on `main` that weren't on `develop`; 89 commits sat on `develop` that weren't on `main`. 27+ PRs landed on develop on a single day (2026-05-25). PR #596 (`feature/wizard-steps-3-4-2026-05-25`) was opened against `main` by a sibling-task agent that cut from the wrong base — not an intentional split.

Two divergent canonical branches in a SaaS that ships from automation is institutional debt: every PR has to declare which branch it lives on; agents have to guess which is the "real" tip; merges across the two require a back-merge cycle that compounds drift.

## Decision

1. **`develop` is canonical.** All new feature branches cut from `origin/develop`. All new PRs target `develop`.
2. **`main` is a fast-forwarded mirror of `develop`.** No direct PRs to `main`. `main`'s tip is always equal to `develop`'s tip after every merge.
3. **Sync mechanism:** GitHub Actions workflow `.github/workflows/sync-main.yml` runs on every push to `develop` and fast-forwards `main` to match.
4. **Initial alignment:** force-align `main` to `develop` with `--force-with-lease=main:<sha>` (not `--force`) so we abort if `main` moves between audit and push.
5. **Old `main` history is abandoned** (not cherry-picked). The 50 unique commits on `main` are an old architecture that `develop` has superseded; cherry-picking would resurrect deleted abstractions. See `reports/main_develop_reconcile_audit_2026-05-25.md` for the full audit and the conflict probe.

## Consequences

### Positive
- Single source of truth for "what does production look like" — `develop` always equals `main` after the sync workflow runs.
- No more PR-base ambiguity. `gh pr create` will eventually default to `develop` once the operator flips the GitHub UI default-branch setting (operator TODO #2).
- The True-Zero admin-merge ritual continues to work — only the target branch changes.

### Negative / risks
- **Cloudflare Pages or other deploy automations against `main`** will start serving the `develop` tip after the force-align. This is the intended outcome (main = develop = production-ready), but should be confirmed by the operator before the workflow is allowed to fire repeatedly.
- **PR #596 and any other open PR targeting `main`** must be re-targeted at `develop` after main is aligned, or they'll merge no-op / auto-close. Sweep via `gh pr list --state open --base main` + `gh pr edit <n> --base develop`.
- **The GitHub UI default-branch flip is operator-only** — the agent can't change it via the API without `repo` + `admin:repo` scope on the PAT. Tracked as TODO #2 in `operator_todo_account_creations.md`.

### Neutral
- Agents must continue passing `--base develop` to `gh pr create` until the GitHub UI default is flipped. The CLI default tracks the UI default.
- Husky hook from ADR-015 already blocks direct commits to `main` and `develop`; that hook stays as a belt-and-braces guard alongside the auto-sync workflow.

## Implementation

1. Reconcile PR `chore: cherry-pick main-only commits to develop (reconcile divergent history)` against `develop` carries this ADR + the audit report.
2. Squash-merge the reconcile PR (True-Zero admin-merge).
3. `git push origin origin/develop:main --force-with-lease=main:<sha>` — captured SHA at the start of the reconcile cycle.
4. Auto-sync workflow lives at `.github/workflows/sync-main.yml`.
5. `AGENTS.md` carries a "Canonical branch" section pointing at this ADR.

## References
- Standing rule: `~/Documents/projects/agent-memory/standing_rule_develop_canonical_2026-05-25.md`
- Audit report (in-repo copy): `reports/main_develop_reconcile_audit_2026-05-25.md`
- ADR-015: `docs/adr/ADR-015-git-flow-enforcement.md`
