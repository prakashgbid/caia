# ADR-010: Auto-Push Discipline

**Date**: 2026-04-20
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

As a solo founder, development sessions are often interrupted — a phone call, a context switch to Stolution, or simply closing the laptop. On two occasions, committed work wasn't pushed and was effectively "lost" (the machine wasn't accessible and the commits weren't on GitHub). Local commits that haven't been pushed are at risk.

The goal: every local commit should automatically reach GitHub without requiring a conscious `git push` step.

Constraints:
- The auto-push must be non-blocking — a failed push (network issue, force-push protection) must not prevent the commit from completing
- The auto-push must be silent — no output during normal operation; only errors when something actually needs attention
- The pre-commit hook must remain the quality gate — `verify:all` runs before commit, not after

---

## Decision

**`hooks/post-commit` auto-push** with `|| true` to ensure non-blocking behavior.

`hooks/post-commit`:
```bash
#!/usr/bin/env bash
# Auto-push to origin main after every commit.
# Silent and non-blocking — if push fails, commit is still safe locally.
git push origin "$(git symbolic-ref --short HEAD)" --quiet 2>/dev/null || true
```

`hooks/pre-commit`:
```bash
#!/usr/bin/env bash
# Quality gate — must pass before commit is created
pnpm run verify:all
```

Both hooks are installed via `scripts/install-hooks.sh`:
```bash
#!/usr/bin/env bash
HOOKS_DIR="$(git rev-parse --git-dir)/hooks"
cp scripts/hooks/pre-commit "$HOOKS_DIR/pre-commit"
cp scripts/hooks/post-commit "$HOOKS_DIR/post-commit"
chmod +x "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/post-commit"
echo "Hooks installed."
```

`scripts/install-hooks.sh` is called in step 2 of NEW_SITE_CHECKLIST.md and is idempotent (safe to run multiple times).

### What This Is Not

The auto-push does **not** replace:
- Explicit `git push --force` for rebasing/amending (this should never be done automatically)
- Branch management (PRs, code review) — the auto-push is `main`-branch only by design
- A backup strategy — GitHub is the backup but this is not a substitute for a proper disaster recovery plan

---

## Consequences

**Positive**:
- Every commit is immediately on GitHub — no "lost commit" incidents
- Non-blocking: a network failure during push doesn't disrupt the development flow
- The commit hash is always available in GitHub for referencing in issues or messages

**Negative / Trade-offs**:
- Every commit is publicly visible on GitHub immediately (for public repos). For private repos, this is fine. For public repos: think before committing a messy work-in-progress (though `verify:all` as pre-commit gate largely prevents broken commits)
- Pushes to `main` directly without PR. This is intentional for a solo founder workflow. For any future team member, the workflow would need to switch to feature branches + PR

---

## Alternatives Considered

**CI-triggered sync** — rejected. A GitHub Action that detects unpushed commits and syncs them is not a real pattern. The problem is explicitly that commits need to reach GitHub without manual intervention.

**Manual push discipline** — rejected. Already failed twice. A process that relies on human memory in a context-switching environment is not reliable.

**`git config push.autoSetupRemote true`** — insufficient. This config option helps with `git push` when no upstream is set, but still requires the developer to run `git push` manually.

**Pre-push hook for `verify:all`** — considered but rejected as the primary gate. Moving the quality check to pre-push (instead of pre-commit) means the local commit exists in an unverified state. If the push is auto-triggered post-commit, the pre-push hook would serve the same purpose as pre-commit. However, pre-commit is the industry standard and gives faster feedback (errors before the commit object is created).
