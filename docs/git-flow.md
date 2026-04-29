# CAIA git flow — operator runbook

> **Mechanically enforced.** GitHub branch protection + scheduled Actions + a required CI check + Husky hooks + the `caia-flow` script (`pnpm flow`) form a defence-in-depth stack. This is the only allowed path. Reference: [`feedback_git_flow_enforced.md`](../agent/memory/feedback_git_flow_enforced.md), DoD item 14 in [`feedback_definition_of_done.md`](../agent/memory/feedback_definition_of_done.md).

## The flow

```
                           ┌────────────────────────┐
                           │ <prefix>/<id>-<slug>   │ ◄── cut from origin/develop
                           │   (feat, fix, chore,   │     (never from main)
                           │    arch, harden, …)    │
                           └─────────────┬──────────┘
                                         │ commit, push
                                         │
                                         │ pnpm flow ready
                                         ▼
                              ┌────────────────────┐
                              │ PR  →  develop     │ gitflow-conformance
                              │ (squash, auto)     │ + CI green
                              └─────────┬──────────┘
                                        │ pnpm flow ship
                                        ▼
                              ┌────────────────────┐
                              │   develop          │  ← integration branch
                              └─────────┬──────────┘
                                        │ end-of-day
                                        │ pnpm flow release
                                        ▼
                              ┌────────────────────┐
                              │ release/<date>     │
                              │     PR → main      │
                              └─────────┬──────────┘
                                        │ merge
                                        ▼
                              ┌────────────────────┐
                              │       main         │  ← release branch
                              └────────────────────┘

           backup/<reason>      preservation only — NEVER merged
```

## Approved branch prefixes

Every feature/fix/chore branch must start with one of these prefixes. The
separator after the prefix may be `/` or `-` (legacy CAIA branches use `-`,
new branches should prefer `/`).

| Family                  | Prefixes                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| Conventional Commits    | `feat`, `feature`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, `ci` |
| CAIA work-stream        | `harden`, `arch`, `acr`, `freg`, `bucket`, `lai`, `dash`, `gate`, `phase2e`, `coding`, `taskmgr`, `val` |
| Release / preservation  | `release/<date>` (PRs to main), `backup/<reason>` (preservation, never merged) |

The canonical regex (server-side and client-side):

```
^(feat|feature|fix|chore|docs|refactor|perf|test|build|ci|harden|arch|acr|freg|bucket|lai|dash|gate|phase2e|coding|taskmgr|val)(/|-)
```

`feat/` is preferred (Conventional Commits); `feature/` is accepted for
backward compatibility with the runbook examples.

## Lifecycle — the only allowed path

```
start  →  work  →  ready  →  ship  →  (release at end of day)
```

| Step      | Command                          | What happens                                                                                                  |
| --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `start`   | `pnpm flow start <id>-<slug>`    | `git fetch origin develop && git checkout -b <prefix>/<id>-<slug> origin/develop` (default prefix `feature/`) |
| `work`    | edit, commit                     | Husky pre-commit blocks any commit on `main` or `develop`.                                                    |
| `push`    | `git push`                       | Husky pre-push blocks any push to `main` or `develop`.                                                        |
| `ready`   | `pnpm flow ready`                | Pushes the branch and opens (or marks ready) a PR vs `develop`.                                               |
| `ship`    | `pnpm flow ship`                 | `gh pr merge --squash --auto --delete-branch`. Lands automatically when CI is green; remote branch is gone.   |
| `release` | `pnpm flow release [--auto]`     | Opens (or merges) `release/<date>` PR `develop → main`.                                                       |
| `archive` | `pnpm flow archive <reason>`     | Renames the current branch to `backup/<branch>-<reason>`, pushes, deletes the original — work is preserved.   |
| `recover` | `pnpm flow recover <backup-ref>` | Cuts a fresh `feature/recover-<stem>` from a backup ref so abandoned work can be resurrected without merging. |
| `status`  | `pnpm flow status`               | Current branch, dirtiness, PR, draft state, CI rollup.                                                        |

## Branches

| Prefix                    | Cut from   | PRs into   | Lifespan          | Notes                                                                |
| ------------------------- | ---------- | ---------- | ----------------- | -------------------------------------------------------------------- |
| `feat/`, `feature/`       | `develop`  | `develop`  | ≤ 24h ideal, 7d max | New work. `feat/` is preferred (Conventional Commits).             |
| `fix/`                    | `develop`  | `develop`  | ≤ 24h            | Bug fixes; same lifecycle as feature.                                |
| `chore/`                  | `develop`  | `develop`  | ≤ 24h            | Cleanup, refactors, doc-only.                                        |
| `docs/`, `refactor/`, `perf/`, `test/`, `build/`, `ci/` | `develop` | `develop` | ≤ 24h | Conventional Commits scopes — same lifecycle as feature. |
| `harden/`, `arch/`, `acr/`, `freg/`, `bucket/`, `lai/`, `dash/`, `gate/`, `phase2e/`, `coding/`, `taskmgr/`, `val/` | `develop` | `develop` | ≤ 24h–7d | CAIA work-stream prefixes; legacy branches may use `-` separator. |
| `release/`                | `develop`  | `main`     | hours            | Optional staged release PRs; tagged on merge.                        |
| `backup/`                 | anywhere   | (never)    | forever           | Preservation only. Excluded from auto-PR + hygiene scanning.         |
| `main`                    | (release)  | (release)  | forever           | Stable release branch. Server-side protected.                        |
| `develop`                 | (start)    | (release)  | forever           | Integration branch. Server-side protected.                           |

## Mechanical enforcement layers

1. **GitHub branch protection** on `main` + `develop`:
   - Require PR (no direct pushes).
   - Required status checks: `Build · Test · Lint · Typecheck`, `gitflow-conformance` (strict / up-to-date).
   - Linear history (squash or rebase merge only).
   - No force-push, no deletion.
   - `enforce_admins: true`.
   - 0 required reviewers (solo founder; PR + CI gates are the protection).
   Configured by [`scripts/setup-branch-protection.sh`](../scripts/setup-branch-protection.sh) — idempotent.

2. **`gitflow-conformance` required check** ([`.github/workflows/gitflow-conformance.yml`](../.github/workflows/gitflow-conformance.yml)):
   - Branch name matches the canonical prefix regex (see above).
   - target=main → head ∈ {develop, release/*}.
   - target=develop → head matches an approved prefix, OR head=main (back-merge after release).
   - `backup/*` may never be merged.
   - No merge commits in PR history (rebase, don't merge).

3. **`auto-pr` watchdog** ([`.github/workflows/auto-pr.yml`](../.github/workflows/auto-pr.yml)):
   - Every 30 minutes + on every push to feature/, fix/, chore/.
   - Opens a draft PR vs develop for any branch with commits ahead of develop and no open PR.

4. **`hygiene-report` daily** ([`.github/workflows/hygiene-report.yml`](../.github/workflows/hygiene-report.yml)):
   - 17:00 UTC. Builds a punch list of branches >24h with no PR, idle PRs, branches >7d old.
   - Opens or updates a daily issue tagged `git-hygiene`.

5. **Husky hooks** ([`.husky/pre-commit`](../.husky/pre-commit), [`.husky/pre-push`](../.husky/pre-push)):
   - pre-commit: blocks commits on main/develop with the fix command.
   - pre-push: blocks pushes targeting main/develop, regardless of local branch.

6. **`caia-flow` script** ([`scripts/caia-flow.sh`](../scripts/caia-flow.sh)) — the only sanctioned wrapper.

## Common situations

### Start a new task

```
pnpm flow start fix-013-test-isolation       # cuts feature/fix-013-test-isolation
                                              # (default prefix is feature/ if you don't supply one)
pnpm flow start chore/clean-stale-tasks      # explicit prefix → cuts chore/clean-stale-tasks
pnpm flow start arch/l5-router               # explicit prefix → cuts arch/l5-router
# ...edit, commit, push as needed...
pnpm flow ready                              # opens PR
pnpm flow ship                               # auto-merge (squash) when green
```

### End-of-day release

```
pnpm flow release --auto                     # opens release/YYYY-MM-DD, merges to main when green
```

### Hotfix on main

A direct hotfix path is not provided — the same `feature/` flow applies, with a faster cycle:

```
pnpm flow start fix-hotfix-<slug>            # cut from develop
# fix the bug
pnpm flow ready
pnpm flow ship                               # land in develop immediately
pnpm flow release --auto                     # ship to main right away
```

### Abandon a branch (preservation)

```
git checkout feature/<wip>
pnpm flow archive replaced-by-feat-bar       # → backup/feature-wip-replaced-by-feat-bar
```

The branch is renamed to `backup/<...>`, pushed, the old remote branch is deleted, and any open PR is closed. The work is preserved indefinitely on origin and never auto-flagged.

### Recover from a backup branch

```
pnpm flow recover backup/feature-old-experiment
# prompts for new branch name; default: feature/recover-<stem>
git fetch && git rebase origin/develop       # bring it forward
```

### Resolve a conflict at merge time

GitHub's "Update branch" button doesn't preserve linear history (it creates a merge commit, which the conformance check rejects). Instead:

```
git fetch origin
git rebase origin/develop                    # resolve conflicts
git push --force-with-lease                  # update the PR
```

### A PR was opened on the wrong target

Retarget via:

```
gh pr edit <num> --base develop
```

Conformance re-runs and the protection rules accept the new target.

## Troubleshooting

### "✗ git-flow: direct commit to 'develop' is forbidden."

You're on `develop`. Switch to a feature branch:

```
pnpm flow start <id>-<slug>
```

### "gitflow-conformance: PRs to develop must come from an approved prefix branch …"

Your branch name doesn't match the canonical prefix regex. Rename the branch:

```
git branch -m feat/<id>-<slug>
git push origin --delete <old> && git push -u origin feat/<id>-<slug>
gh pr edit <num> --head feat/<id>-<slug>
```

The full prefix list is in the **Approved branch prefixes** section above.

### "gitflow-conformance: branch contains merge commits — use rebase, not merge."

The branch was updated via `git merge` instead of `git rebase`. Rebase and force-push:

```
git fetch origin
git rebase origin/develop
git push --force-with-lease
```

### "the base branch policy prohibits the merge"

A required status check is missing or red, or the branch is out of date. Check:

```
pnpm flow status
gh pr checks <num>
```

Common causes: CI failed, conformance failed, branch behind develop (run `git rebase origin/develop && git push --force-with-lease`).

### Branch protection rule violations

Re-apply the canonical rules:

```
scripts/setup-branch-protection.sh           # both branches
scripts/setup-branch-protection.sh main      # one only
```

The script is idempotent — running it again just refreshes the rules.

## `pnpm flow` cheatsheet

```
pnpm flow start <id>-<slug>          cut feature branch from develop
pnpm flow ready                      push + open PR vs develop
pnpm flow ship                       squash-merge PR when CI green; delete branch
pnpm flow release [--date YYYY-MM-DD] [--auto]
                                     open release/<date> PR develop → main
pnpm flow status                     current branch + PR + CI rollup
pnpm flow archive <reason>           preserve current branch as backup/<...>-<reason>
pnpm flow recover <backup-ref>       cut new feature/ branch from a backup/
pnpm flow help [<subcmd>]            top-level or per-subcommand help
```

## Reference

- [`feedback_git_flow_enforced.md`](../agent/memory/feedback_git_flow_enforced.md) — the standing rules.
- [`feedback_definition_of_done.md`](../agent/memory/feedback_definition_of_done.md) — DoD item 14: branch closed + merged.
- [`scripts/caia-flow.sh`](../scripts/caia-flow.sh)
- [`scripts/setup-branch-protection.sh`](../scripts/setup-branch-protection.sh)
- [`.github/workflows/gitflow-conformance.yml`](../.github/workflows/gitflow-conformance.yml)
- [`.github/workflows/auto-pr.yml`](../.github/workflows/auto-pr.yml)
- [`.github/workflows/hygiene-report.yml`](../.github/workflows/hygiene-report.yml)
- [`.husky/pre-commit`](../.husky/pre-commit), [`.husky/pre-push`](../.husky/pre-push)
