# post-merge deployment signal — INT.1.A1 / Guardrail #7

Closes the "merged but not deployed" gap from DoD v2 (`reports/definition_of_done_v2_2026-05-14.md` §3.a Guardrail 7).

## Pipeline

```
PR merged on develop|main
        │
        ▼
.github/workflows/post-merge-signal.yml      (in caia + stolution)
        │  appends one JSON-Lines row to queue.jsonl
        │  on the orphan branch `post-merge-queue`
        ▼
GitHub: <repo>/post-merge-queue/queue.jsonl
        │  read via `gh api repos/<repo>/contents/queue.jsonl?ref=post-merge-queue`
        ▼
~/.caia/post-merge/post-merge-watcher.sh     (launchd, 60 s)
        │  pops new rows (deduped by merge_sha against ~/.caia/post-merge/seen.jsonl)
        ▼
~/.caia/post-merge/post-merge-deploy.sh <row>
        │  per-repo deploy actions (today: stub, just records "saw merge $sha")
        ▼
~/.caia/post-merge/log.jsonl + ~/.caia/post-merge/<repo>.deploy.log
```

## Queue row format (JSON-Lines)

```json
{
  "schema_version": 2,
  "pr_number": 451,
  "repo": "prakashgbid/caia",
  "merge_sha": "5c077f4...",
  "base_branch": "develop",
  "ts": "2026-05-15T00:00:00Z",
  "pr_title": "feat(observability): a.10.6 + a.10.9 router/optimizer/audit-cron emit-points",
  "pr_author": "claude-spawned",
  "pr_body": "...PR body, truncated to 4 KB..."
}
```

`schema_version: 2` adds `pr_body` (4 KB max) so the deploy stub can scan
for institutionalized deploy tags (e.g. `ROUTER-DAEMON-RELOAD-REQUIRED`)
without an extra `gh pr view` round-trip. v1 rows still parse — body
just resolves to empty.

## Adoption scan stage

After the per-repo deploy hook fires for `prakashgbid/caia`, the deploy
script also runs the **adoption-enforcement substrate** for the merge:

```
~/.caia/post-merge/post-merge-deploy.sh <row>
    │
    ├── (existing) router-daemon kickstart, if title/body matches
    │
    ├── dispatch_adoption_scan         ← p3-adoption-scan-engine phase 5
    │     │   30 s budget, runs in background, idempotent.
    │     │   Writes scan.json + scan.log under ~/.caia/post-merge/work/<sha>/.
    │     │   On success, chains directly into the xref step (60 s budget)
    │     │   so a single merge produces both scan.json and xref.json.
    │     │
    │     ▼
    │   caia-adoption-run scan --pr <num> --sha <sha> \
    │       --out ~/.caia/post-merge/work/<sha>/ \
    │       --repo $CAIA_REPO_ROOT
    │
    └── dispatch_adoption_xref         ← p3-adoption-cross-ref phase 4
          fallback path — only runs xref when scan.json was dropped
          out-of-band (i.e. the chained xref above did not produce it).
```

`scan.json` is a small JSON document the substrate uses as its
canonical "what's new in this merge" surface:

```json
{
  "version": 1,
  "sha": "5c077f4...",
  "pr": 451,
  "generated_at": "2026-05-17T16:50:00Z",
  "summary": {
    "artefact_count": 3,
    "new_package_count": 1,
    "new_export_count": 2,
    "new_external_agent_count": 0
  },
  "artefacts": [
    { "kind": "new_package",  "package": "@chiefaia/foo", "identifier": "@chiefaia/foo", "source_path": "packages/foo/package.json" },
    { "kind": "new_export",   "package": "@chiefaia/foo", "identifier": "frobnicate",    "source_path": "packages/foo/src/index.ts", "decl_kind": "function", "isTypeOnly": false },
    { "kind": "new_export",   "package": "@chiefaia/foo", "identifier": "FooConfig",     "source_path": "packages/foo/src/index.ts", "decl_kind": "interface", "isTypeOnly": true }
  ]
}
```

The detectors that produce these rows live in
`packages/adoption-enforcement/src/scan/` and are stitched together by
`src/cli/scan.ts`:

| Row kind              | Detector                                  | Triggers when                                                  |
|-----------------------|-------------------------------------------|----------------------------------------------------------------|
| `new_package`         | `detectNewPackages(pr)`                   | PR adds `packages/<X>/package.json` with name `@chiefaia/*`.   |
| `new_export`          | `detectNewExports(indexPath)`             | PR modifies an existing `packages/<X>/src/index.ts`, OR a new package is added (every export is then "new" by definition). |
| `new_external_agent`  | `detectNewExternalAgents(repoRoot)`       | PR touches `<repo>/.adoption/external-agents.yaml`.            |

**Idempotency.** `dispatch_adoption_scan` short-circuits when
`scan.json` already exists in the per-sha work dir. Same for the
chained xref step (`xref.json`). Re-runs against the same merge_sha
are safe and cheap.

**Docs-only PRs are a no-op.** A merge that doesn't touch any
`packages/<X>/src/index.ts`, doesn't add any `packages/<X>/package.json`,
and doesn't touch `.adoption/external-agents.yaml` produces a
`scan.json` with `summary.artefact_count = 0` and no downstream rows
reach the cross-reference or PR-generator stages. Hand-tested against
PR #492 (the DoD-v2 addendum, docs-only) to confirm this behaviour.

**Ledger.** Each background run appends one row to
`~/.caia/post-merge/adoption.jsonl`:

```
{"ts":"...","event":"scan_done","sha":"...","artefact_count":3}
{"ts":"...","event":"xref_done","sha":"...","artefact_count":3,"candidate_count":12}
```

(or `scan_failed` / `xref_failed` with `rc` on failure.) This is the
minimum-viable surface that the future DoD-v2 adoption gate's reader
will consume.

**Environment overrides.**

| Variable          | Default                                        | Used by                  |
|-------------------|------------------------------------------------|--------------------------|
| `CAIA_REPO_ROOT`  | `$HOME/Documents/projects/caia`                | scan + xref `--repo`     |
| `NODE_BIN`        | `/opt/homebrew/opt/node@22/bin/node`           | runs `caia-adoption-run` |
| `POSTMERGE_HOME`  | `$HOME/.caia/post-merge`                       | work-dir root + ledger   |

## Institutionalized deploy tags

| Tag | Effect |
|-----|--------|
| `ROUTER-DAEMON-RELOAD-REQUIRED` | After merge, `launchctl kickstart -k com.chiefaia.local-llm-router` so the operator's Mac picks up the new binary. Also auto-fires when the PR title matches `local-llm-router` or `router-daemon`. |

Add a tag in the PR body when an explicit deploy action must run that
isn't obvious from the title (e.g. a config change in another package
that nonetheless mandates a router restart). Tags are matched
case-sensitively as substrings of `pr_body`.

## Install (one-shot, idempotent)

```bash
~/Documents/projects/caia/scripts/post-merge/install.sh
```

This copies `post-merge-watcher.sh` + `post-merge-deploy.sh` into `~/.caia/post-merge/`, renders the plist template into `~/Library/LaunchAgents/com.caia.post-merge-watcher.plist`, and bootstraps the launchd label.

Re-running is safe: each step bootouts before bootstrap.

## Verify

```bash
launchctl print gui/$(id -u)/com.caia.post-merge-watcher
~/.caia/post-merge/post-merge-watcher.sh --health-check
~/.caia/post-merge/post-merge-deploy.sh   --health-check
tail -n 20 ~/.caia/post-merge/log.jsonl
```

## Why pull (not push)

GHA cloud runners cannot reach the operator's Mac directly (no public ingress). Two options were on the table:

1. **Push:** GHA runner SSHes to a Tailscale-reachable host using a runner-side SSH key.
2. **Pull (chosen):** GHA writes a row to the `post-merge-queue` branch via `GITHUB_TOKEN`; the local watcher pulls.

Pull wins because:

- No SSH key on GHA → no key to rotate/revoke.
- No Tailscale exposure of the Mac → no surface for runners to abuse.
- `GITHUB_TOKEN` is auto-scoped per workflow; no operator PAT.
- Replay-safe: the queue is append-only and the watcher dedupes on `merge_sha`.

## Operator extension points

- **Per-repo deploy command:** edit the `case "$repo" in` block in `post-merge-deploy.sh` to invoke the right deploy command (e.g. `kubectl rollout restart`, `ssh stolution …/deploy.sh`, `pnpm -C packages/<x> install:postmerge`).
- **Per-package install scripts:** when a `caia/packages/<x>/scripts/install-postmerge.sh` exists, invoke it from the `prakashgbid/caia` branch of the case statement, gated on whether the merge touched that package (see `git diff <merge_sha>^..<merge_sha> --name-only`).
- **Add a tracked repo:** prepend it to `POSTMERGE_REPOS` in `post-merge-watcher.sh` (or set the env var in the plist).

## Tracked repos (today)

- `prakashgbid/caia`
- `prakashgbid/stolution`
