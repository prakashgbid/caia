---
"caia": patch
---

feat(local-preview-001): LaunchAgent plists + install.sh + Steward analyzer (PR-D)

Closes the implementation phase of the Local-Preview-Deploys roadmap
(item 1 in the multi-day campaign roadmap). Adds the macOS-side
plumbing that turns the building blocks from PR-A/B/C (#312/#313/#314)
into an actual always-on local-preview system on the operator's Mac.

## What landed

**5 LaunchAgent plists** under `apps/local-preview-orchestrator/plists/`:

| Label | Role |
|---|---|
| `com.stolution.local-preview.deploy-daemon` | poll-loop daemon (one process for all 3 sites) |
| `com.stolution.local-preview.status-dashboard` | HTTP server on 127.0.0.1:5170 |
| `com.stolution.local-preview.dashboard` | site supervisor → localhost:5173 |
| `com.stolution.local-preview.poker-zeno` | site supervisor → localhost:5174 |
| `com.stolution.local-preview.roulette-community` | site supervisor → localhost:5175 |

All plists pass `plutil -lint`. They use placeholders (`__USER_HOME__`,
`__REPO__`, `__SITE_REPO_*__`) substituted at install-time.

**Install / uninstall scripts** under
`apps/local-preview-orchestrator/scripts/`:

- `install.sh` — backs up existing plists to `~/.caia-backups/`,
  templates the plist placeholders, mkdir's log+state dirs,
  `launchctl bootstrap`s each agent, then waits up to 30s for the
  status dashboard to respond on `/healthz`. Idempotent.
- `uninstall.sh` — `launchctl bootout` + delete plists.
  `--purge` also removes build artifacts.
- `status.sh` — `curl /api/status | python -m json.tool`.

All three pass `bash -n` syntax check.

**Steward analyzer**: new `local-preview-health.ts` in
`packages/steward-analyzers/`:

- `dashboard-unreachable` (high) — dashboard not responding
- `site-never-deployed` (medium) — no `current_sha` pinned
- `last-deploy-failed` (medium / high for `rollback-failed`) — last
  deploy in a failure state
- `health-check-stale` (medium) — last health check > 10m old
- `health-check-never-run` (low) — current_sha set but no health timestamp
- `health-check-failed` (high) — last health check failed

Wired into `bin/steward-gatekeeper.mjs` as the `local-preview-health`
subcommand. Runs by curl-ing `http://127.0.0.1:5170/api/status` and
feeding the parsed sites array into the analyzer.

**README** at `apps/local-preview-orchestrator/README.md` covering
quick-start, architecture, CLI, dashboard API, Steward integration,
and uninstall.

## Tests

- 10 new unit tests for `checkLocalPreviewHealth` (101 total in
  steward-analyzers).
- All 91 existing local-preview-orchestrator tests still pass (no
  source changes in this PR).

## Stage 6 (live verification on Mac) is intentionally NOT in this PR

Stage 6 = manual install on the operator's Mac + verifying the 3 sites
are continuously up and that 60s deploy latency / rollback / Mac-reboot
resilience all work. That's the next leg's first priority.

References: `~/Documents/projects/reports/local-preview-deploys-analysis.md`,
`agent/memory/steward_local_preview_deploys_directive.md`,
`agent/memory/daemon_repoint_2026-04-30.md`.
