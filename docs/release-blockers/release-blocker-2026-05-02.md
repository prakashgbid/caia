# Release blocker — 2026-05-02 cleanup wave (PR #281)

**Status:** BLOCKED. Release PR cannot merge in current state. Operator action required.

**PR:** https://github.com/prakashgbid/caia/pull/281
**Source branch:** `release/2026-05-02-cleanup` @ `22fdb1d9157146d630ccd7e87e688b1581a0c126` (= origin/develop)
**Target:** `main` @ `c426116f221105a73bb88303e503742c41ee9633`
**Detected:** 2026-05-03 by automated release agent (sequential / unattended)
**Reference audit:** `~/Documents/projects/reports/full-state-audit-2026-05-01.md`

---

## TL;DR

Three independent, blocking issues stacked on this release. The agent did NOT bypass any of them (per operator policy: no `--admin`, no `--no-verify`, no force-push, no on-the-spot code fixes on the release branch).

1. **Hard merge conflicts** between `develop` and `main` — three files diverge. PR `mergeStateStatus = DIRTY`, `mergeable = CONFLICTING`. This is the root blocker.
2. **Semgrep blocking gate fails** with 133 real findings on the `develop → main` diff. These findings have lived on develop for some time but were never caught because per-PR semgrep delta scans only checked the small per-PR delta against develop. Scanning the whole 48-PR delta against main surfaces them in aggregate.
3. **Evidence Gate workflows did not fire on the release branch** at all — neither on push nor on PR open/reopen. The status checks visible on PR #281 are stale, inherited from the develop-tip push event of 2026-05-01T19:19:38Z. Cause unconfirmed; possibly GitHub Actions de-dup by SHA, or a queue / token issue.

Each is described below with concrete evidence and a suggested remediation.

---

## Issue 1 — DIRTY merge state (root cause)

`develop` has diverged from `main` because previous release PRs to main were squash-merged, creating new commit OIDs on main that never made it back to develop. Files that have been touched since the fork point on both branches (independently) are now in conflict.

### Conflicting files

```
apps/orchestrator/src/db/migrations/meta/_journal.json
apps/orchestrator/src/db/schema.ts
pnpm-lock.yaml
```

### Evidence

```
$ git merge-base origin/main HEAD
d05b93ac254814d4b21960ba8c17fb1ca9391325

$ git log --oneline origin/develop..origin/main | head
c426116 release(2026-04-30-obs-foundation): merge develop -> main (#270)
5413177 release(2026-04-30-no-api-key-compliance): cherry-picked LAI-001 + decomposer-widening + scaffolder-fix + routing-default → main (#256)
7ce17a3 release(2026-04-30-broker-wireup): broker wireup — develop → main (#235)
759e0f2 release(2026-04-30): EA mesh P0 + tail of develop → main (#229)
084fba3 release(2026-04-30-po-decomposer-p0-v2): PO recursive decomposer P0 → main (#219)

$ git merge-tree d05b93ac... HEAD origin/main
changed in both
  base   apps/orchestrator/src/db/migrations/meta/_journal.json
  our    apps/orchestrator/src/db/migrations/meta/_journal.json
  their  apps/orchestrator/src/db/migrations/meta/_journal.json
... <conflict markers> ...
changed in both
  base   apps/orchestrator/src/db/schema.ts
  ...
changed in both
  base   pnpm-lock.yaml
  ...
```

### Why this happens

Squash-merge release strategy without a "merge main back to develop" sync step lets the two branches drift on any file that gets touched on both sides between releases. PR #256 in particular was a cherry-pick set onto main that never replayed onto develop.

### Remediation (operator)

Option A — recommended: `git merge --no-ff origin/main` into develop locally, resolve the three files (lockfile via `pnpm install`, _journal.json by union-merge, schema.ts by hand), commit, push develop. Then **re-open** a fresh release PR (the fix-up commit will be what makes it mergeable). Keep the squash-merge contract for the eventual main merge.

Option B — alternative: open a sync PR `chore(sync): merge main → develop` first, get it through Evidence Gate as a normal PR, then this release PR will be re-evaluated as clean by GitHub.

Either way, after the sync, the next develop → main release PR should NOT be DIRTY.

---

## Issue 2 — Semgrep gate fails (133 blocking findings)

The Evidence Gate's `semgrep` job is REQUIRED on main. On the develop-tip push run (`Evidence Gate` run id `25229174614`, conclusion `failure`), the semgrep step exited 1 with `133 findings (133 blocking)`.

### Sample findings

```
packages/integrity-check/src/scaffolder.ts:81
  ❯❱ javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  81┆ file: path.join(projectDir, 'src', 'app', urlPath.slice(1), 'page.tsx'),

packages/integrity-check/src/crawl/route-discovery.ts:14,15,44
  ❯❱ path-join-resolve-traversal
  14┆ path.join(projectDir, 'src', 'app'),
  15┆ path.join(projectDir, 'app'),
  44┆ filePath: path.join(appDir, file),

packages/integrity-check/src/index.ts:20
  ❯❱ path-join-resolve-traversal
  20┆ const absDir = path.resolve(projectDir);

packages/integrity-check/src/report/json.ts:13
  ❯❱ path-join-resolve-traversal
  13┆ path.join(dir, `integrity-${...}.json`);

packages/integrity-check/src/static/rules/unresolved-import.ts:11
  ❯❱ path-join-resolve-traversal
  11┆ const abs = path.resolve(dir, source);

packages/seo-program/src/cli.ts:51
  ❱ javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
  51┆ console.error(`Error auditing ${url}:`, err);

packages/seo-program/src/reporter.ts:50,60
  ❯❱ path-join-resolve-traversal
  50┆ const path = join(dir, filename);
  60┆ const path = join(dir, filename);

packages/ticket-template/src/validation-rubric.ts:558
  ❯❱ javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  558┆ const re = new RegExp(`\\b${escaped}\\b`, 'i');
```

### Blocking rule packs that fired

```
dockerfile.security.missing-user.missing-user
javascript.express.security.audit.express-check-csurf-middleware-usage
javascript.lang.security.audit.dangerous-spawn-shell.dangerous-spawn-shell
javascript.lang.security.audit.detect-non-literal-regexp
javascript.lang.security.audit.incomplete-sanitization
javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
javascript.lang.security.audit.unsafe-formatstring
javascript.lang.security.detect-child-process
javascript.lang.security.detect-insecure-websocket
typescript.react.security.react-insecure-request
yaml.docker-compose.security.no-new-privileges
yaml.docker-compose.security.writable-filesystem-service
yaml.github-actions.security.run-shell-injection
yaml.kubernetes.security.allow-privilege-escalation-no-securitycontext
yaml.kubernetes.security.run-as-non-root
```

### Why this is **NOT a flake**

`Findings: 133 (133 blocking) | Rules run: 1064 | Targets scanned: 1380 | Parsed lines: ~99.9%`. The scan ran cleanly and produced specific code locations. No re-run will change the result.

### Why per-PR Evidence Gate runs were green while this is red

`semgrep ci` chooses the comparison base from the event. On a `pull_request` event with `base = develop`, semgrep diff-scans only the new commits (typically a handful of files per feature PR). On a release PR with `base = main`, the comparison base is main, the scan covers the cumulative 48-PR diff, and pre-existing accumulated findings surface.

### Remediation (operator decision)

Three legitimate options, listed in increasing order of operator effort:

1. **Triage and `.semgrepignore` the false-positive ones** (most of the integrity-check / seo-program / ticket-template hits look like internal-tooling code where the "user input" is actually a developer-controlled CLI argument). Add path-specific suppressions with comments explaining why each is safe.
2. **Fix the real ones** — the regex in `validation-rubric.ts:558` already does `escapeRegExp` (`escaped`), so it's likely a false positive but should be annotated. The `child-process` and `spawn-shell` hits in tooling should be hard-pinned to non-shell `spawn` form.
3. **Lower semgrep severity** — not recommended; the gate is there for a reason.

This is the operator's call. The agent did NOT touch `.semgrepignore` or any source file because the release branch is supposed to contain zero new code.

---

## Issue 3 — Evidence Gate workflows did not fire on the release branch

After `git push -u origin release/2026-05-02-cleanup` and after `gh pr create`, no fresh workflow runs appeared for this branch. PR-level close/reopen was attempted (it does normally re-trigger `pull_request` workflows) — still no runs.

### Evidence

```
$ gh run list --branch release/2026-05-02-cleanup --limit 30
[]
```

Yet `Actions enabled: true, allowed_actions: all`. No `first-time-contributor` approval issue (the push is from the repo owner). The status checks on PR #281 are populated entirely by the prior `Evidence Gate` and `CI` runs from the develop-tip push at 2026-05-01T19:19:38Z (same SHA `22fdb1d`).

### Hypothesis

Either GitHub Actions de-duplicates runs by `head_sha` regardless of event/ref (most likely — the SHA matches develop's tip), or there is a queue / actions-token issue. Once the DIRTY merge state is fixed (Issue 1), the new commit will produce a new SHA and workflows should fire normally on the next push to the release branch.

### Remediation

No direct action needed. Resolving Issue 1 will cause a new SHA on the release branch, which will trigger fresh runs and surface a definitive Evidence Gate verdict (which, until Issue 2 is also addressed, will still fail on `semgrep`).

---

## Recommended order of operations for the operator

1. **Sync main → develop:**
   ```
   git checkout develop
   git pull --ff-only origin develop
   git merge --no-ff origin/main -m "chore(sync): merge main into develop to resolve squash divergence"
   # resolve conflicts in:
   #   apps/orchestrator/src/db/migrations/meta/_journal.json
   #   apps/orchestrator/src/db/schema.ts
   #   pnpm-lock.yaml  (regenerate via `pnpm install --no-frozen-lockfile && pnpm install --frozen-lockfile`)
   git push origin develop
   ```
   Open this as a PR if your workflow requires (it goes to develop, normal Evidence Gate applies; semgrep delta-scan will only check the merge resolution, not the cumulative 48-PR diff).
2. **Decide semgrep stance:** triage the 133 findings against `develop → main` baseline. Add `.semgrepignore` exemptions or fixes as appropriate. Land on develop.
3. **Re-attempt this release:** delete `release/2026-05-02-cleanup` (or update it from new develop), open fresh release PR develop → main. Evidence Gate should now fire fresh runs and pass.

## Caveats — what the agent did NOT do

- Did NOT use `--admin` to bypass branch protection.
- Did NOT use `--no-verify` to bypass commit hooks.
- Did NOT force-push (release/* is not in the `backup/*` force-push allowlist).
- Did NOT modify any source file to fix the semgrep findings on the spot — release branches are supposed to be code-frozen mirrors of develop.
- Did NOT touch the Vault.
- Did NOT touch the stolution server.
- Did NOT restart the orchestrator daemon.
- Did NOT modify branch protection.

The PR is left OPEN at `release/2026-05-02-cleanup` for the operator to inspect. This blocker report is also pushed to the release branch for visibility.

---

## Time spent

~25 min. Mostly on diagnosis. The mechanical PR creation took ~3 min; the rest was verifying that the failures are real, not transient.
