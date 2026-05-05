# Local Preview Orchestrator

Always-on local preview deployments for the three CAIA-affiliated sites:

| Site | Local URL | Source repo |
|---|---|---|
| **CAIA dashboard** | http://localhost:5173 | `caia/apps/dashboard` |
| **poker-zeno** | http://localhost:5174 | `~/Documents/projects/poker-zeno` |
| **roulette-community** | http://localhost:5175 | `~/Documents/projects/roulette-community` |
| **status dashboard** | http://localhost:5170 | this app |

When installed, every merge to `develop` of any of the three site repos is
auto-deployed to the corresponding local URL within 60 seconds, with atomic
symlink-swap, instant rollback on health-check failure, and ten-build retention
for manual rollback.

Subscription-only by design — no external services, no API keys, no paid
tunnels. The deploy daemon polls `git fetch` every 30s.

## Quick start

```bash
# 1. Build the orchestrator
pnpm -F @caia-app/local-preview-orchestrator build

# 2. Install the LaunchAgents (5 plists go into ~/Library/LaunchAgents/)
./apps/local-preview-orchestrator/scripts/install.sh

# 3. Visit the status dashboard
open http://127.0.0.1:5170/
```

The first deploy fires on its own within 30s. Watch progress via the dashboard
or via:

```bash
./apps/local-preview-orchestrator/scripts/status.sh
```

## Architecture

Five LaunchAgents work together:

```
com.stolution.local-preview.deploy-daemon       — poll-loop daemon (one process for all 3 sites)
com.stolution.local-preview.status-dashboard    — HTTP server on 5170
com.stolution.local-preview.dashboard           — site supervisor: localhost:5173
com.stolution.local-preview.poker-zeno          — site supervisor: localhost:5174
com.stolution.local-preview.roulette-community  — site supervisor: localhost:5175
```

The deploy daemon polls each site's repo every 30s. When it sees a new
`origin/develop` SHA, it:

1. `git worktree add` a fresh build copy
2. runs the configured `buildCmd`
3. copies the resulting artifacts into the per-site install dir at
   `~/Library/Application Support/Stolution/local-preview/<site>/builds/<sha>/`
4. atomically swaps the `current` symlink to point at the new build
5. SIGTERMs the running site supervisor (launchd `KeepAlive` re-spawns it
   pointed at the new build)
6. polls the site's health endpoint with backoff
7. on failure: swaps `current ← previous`, restarts again, logs an incident,
   leaves a note for the Steward analyzer to surface

State for each site lives at:

```
~/Library/Application Support/Stolution/local-preview/<site>/
├── builds/<sha>/                 # per-deploy artifact directory (last 10)
├── current → builds/<sha>/       # symlink to the live build
├── previous → builds/<sha>/      # symlink to the last-known-good build
├── pid                           # PID of the running site supervisor
└── state.json                    # what /api/status reads
```

Incident log (one JSON-line per event):

```
~/Library/Application Support/Stolution/local-preview/_incidents/<site>.jsonl
```

## CLI

The `local-preview` binary (built to `dist/cli.js`) accepts:

| Subcommand | What it does |
|---|---|
| `poll-loop` | Long-running daemon. Same thing the LaunchAgent runs. |
| `status-dashboard` | HTTP server on `${LOCAL_PREVIEW_DASHBOARD_PORT:-5170}` |
| `deploy <site>` | One-shot deploy of a single site (handy for debugging) |
| `status` | Print one-line JSON status to stdout |

Env var overrides:

| Var | Default | What |
|---|---|---|
| `LOCAL_PREVIEW_INSTALL_ROOT` | `~/Library/Application Support/Stolution/local-preview` | Per-site install root |
| `LOCAL_PREVIEW_BUILD_WORKSPACE` | `/private/tmp/local-preview-build` | Ephemeral build worktrees |
| `LOCAL_PREVIEW_DASHBOARD_PORT` | `5170` | Status dashboard port |

## Status dashboard API

| Method | Path | Result |
|---|---|---|
| `GET` | `/` | static dashboard HTML |
| `GET` | `/healthz` | `200 ok` |
| `GET` | `/api/status` | JSON state for all sites |
| `GET` | `/api/logs/<site>` | last 200 lines of incident log |
| `POST` | `/api/redeploy/<site>` | enqueue a forced deploy |
| `POST` | `/api/rollback/<site>` | swap `current ← previous`, restart |

Bound to `127.0.0.1` only — host = auth boundary, no auth needed.

## Steward integration

A daily Steward analyzer at `packages/steward-analyzers/src/local-preview-health.ts`
checks:

1. dashboard is reachable
2. each configured site has a `current_sha` pinned
3. the most recent deploy is in a `success`/`noop` state
4. the most recent health check is < 10 minutes old
5. the most recent health check status is `ok`

Wired into the existing daily Steward cron via the `local-preview-health`
subcommand of `bin/steward-gatekeeper.mjs`. Run manually:

```bash
node packages/steward-analyzers/bin/steward-gatekeeper.mjs local-preview-health
```

Findings flow into the daily Steward report issue.

## Uninstalling

```bash
./apps/local-preview-orchestrator/scripts/uninstall.sh           # bootout + remove plists
./apps/local-preview-orchestrator/scripts/uninstall.sh --purge   # also delete build artifacts
```

## References

- Spec: `agent/memory/steward_local_preview_deploys_directive.md`
- Design: `~/Documents/projects/reports/local-preview-deploys-analysis.md`
- LaunchAgent pattern: `agent/memory/daemon_repoint_2026-04-30.md`
- Subscription mandate: `agent/memory/feedback_no_api_key_billing.md`
