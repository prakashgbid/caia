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
