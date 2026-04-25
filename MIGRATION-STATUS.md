# Migration Status

CAIA is the single site/app/IT-system building platform. **Everything generic (non-site-specific) lives in this monorepo.** Each site stays in its own repo and consumes `@chiefaia/*` from public npm.

## Source Repos

| Source repo | Status | Destination in CAIA | Notes |
|-------------|--------|---------------------|-------|
| `prakashgbid/conductor` | **merged (squash-import)** | `apps/orchestrator/` + `apps/{executor,db-backup,task-run-poller,story-backfiller,pipeline-pulse,orchestrator-middleware}/` + `apps/dashboard/` | Conductor engine, all sub-apps, dashboard. Internal sub-packages → `packages/event-bus-internal`, `packages/events-taxonomy-internal` (private). |
| `prakashgbid/image-provider` | **merged (squash-import)** | `packages/image-provider/` | Renamed to `@chiefaia/image-provider`. Changeset for v0.1.0 added. Will be published on next release. |
| `prakashgbid/conductor-state` | **archived** | — (state is filesystem-only at `~/.conductor/`, no repo needed) | Archive on GitHub. |
| `prakashgbid/framework` | **partial → docs/legacy-framework/** | `docs/legacy-framework/` | Framework was mostly governance docs (ADRs, runbooks, lock specs). Useful bits captured under `docs/`. Repo archived. |
| `prakashgbid/pokerzeno-framework` | **partial → docs/legacy-pokerzeno-framework/** | `docs/legacy-pokerzeno-framework/` | Same pattern as `framework`. Repo archived. |
| `prakashgbid/pokerzeno-plugins` | **merged (squash-import)** | `packages/{analytics,backend-core,cast-bridge,content-engine,dev-inspector,integrity-check,seo-program}/` | 7 sub-packages lifted as-is with `@pokerzeno/*` scope retained (sites consume from npm). Inner `image-provider` and `conductor` duplicates skipped (handled separately). |
| `prakashgbid/site-template` | **merged** | `templates/site/` | Replaces previous stub. `file:../*` deps rewritten as `workspace:*`. |
| `prakashgbid/pokerzeno-site-template` | **merged** | `templates/site-pokerzeno/` | Lifted as-is. |
| `prakashgbid/conductor` (plugins/) | **merged** | `apps/completeness-sentinel/` (daemon) + `packages/{secrets-broker,story-decomposer,dead-shell-detector,behavior-suite}/` (libs) | The `plugins/` workspace inside conductor repo. `@plugins/*` scope rewritten to `@chiefaia/*`. |

## Site Repos (UNCHANGED)

These stay in their own repos and consume `@chiefaia/*` from npm:

- `prakashgbid/pokerzeno`
- `prakashgbid/ROULETTECOMMUNITY`
- `prakashgbid/poker-247`
- `prakashgbid/stolution` (remote-only, never lifted)

Future sites: `chiefaia.com`, `prakash-tiwari`, `ankitatiwari`, `edisoncricket`.

## New Apps in `caia/apps/`

| App | Purpose | Daemon source |
|-----|---------|---------------|
| `orchestrator/` | Conductor engine: CLI, API, pump, prioritization, requirements, prompts | `node dist/src/cli/index.js` |
| `executor/` | Task executor daemon | `node dist/executor-daemon.js` |
| `dashboard/` | Next.js admin dashboard for completeness/stories/standards/backups | `next start` |
| `completeness-sentinel/` | Periodic completeness sweep daemon (every 2h) | `node dist/daemon.cjs` |
| `db-backup/` | Hourly conductor SQLite DB backup | `bash run-backup.sh` |
| `task-run-poller/` | Polls task runs for completion + emits events | `node index.cjs` |
| `story-backfiller/` | Periodic story backfill from blockers | `node index.cjs` |
| `pipeline-pulse/` | Pipeline pulse health checker | (inline) |
| `orchestrator-middleware/` | HTTP/MCP middleware for orchestrator | `node dist/index.js` |

## New Packages in `caia/packages/`

**Published (`@chiefaia/*`):**
- `image-provider` (new in this PR — v0.1.0)

**Existing published:** `cli`, `config`, `errors`, `events`, `logger`, `metrics`, `secrets`, `test-kit`, `tracing`

**Internal-only (`@chiefaia/*-internal`, `private: true`):**
- `event-bus-internal` — runtime event bus shared by orchestrator apps
- `events-taxonomy-internal` — events registry + types (synced with `events.yaml`)

**Lifted libs (`@chiefaia/*`, `private: true` until published):**
- `secrets-broker` — vault-backed secret broker
- `story-decomposer` — story decomposition utilities
- `dead-shell-detector` — dead shell detection
- `behavior-suite` — behavior testing kit

**Pokerzeno-scoped libs (sites consume from npm):**
- `analytics`, `backend-core`, `cast-bridge`, `content-engine`, `dev-inspector`, `integrity-check`, `seo-program`

## Templates

- `templates/site/` — generic site template (Next.js, Tailwind, Playwright)
- `templates/site-pokerzeno/` — pokerzeno-style brand-locked template
- `templates/utility/` — utility-package starter (existing)

## Launchd Cutover

After this PR is merged to `main` and `caia/` is updated locally, the following launchd jobs need to be re-pointed from `/Users/MAC/Documents/projects/conductor/...` and `/Users/MAC/Documents/projects/plugins/...` to `/Users/MAC/Documents/projects/caia/apps/...`:

| Plist | Old path | New path |
|-------|----------|----------|
| `com.conductor.executor` | `conductor/dist/src/cli/index.js exec daemon` | `caia/apps/orchestrator/dist/src/cli/index.js exec daemon` |
| `com.conductor.mcp` | `conductor/dist/cli/index.js mcp` | `caia/apps/orchestrator/dist/cli/index.js mcp` |
| `com.conductor.completeness-sentinel` | `plugins/completeness-sentinel/dist/daemon.cjs` | `caia/apps/completeness-sentinel/dist/daemon.cjs` |
| `com.conductor.db-backup` | `conductor/apps/db-backup/run-backup.sh` | `caia/apps/db-backup/run-backup.sh` |
| `com.conductor.story-backfiller` | `conductor/apps/story-backfiller/index.cjs` | `caia/apps/story-backfiller/index.cjs` |
| `com.conductor.task-run-poller` | `conductor/apps/task-run-poller/index.cjs` | `caia/apps/task-run-poller/index.cjs` |

Cutover script: `scripts/migrate-launchd.sh` (lands in this PR).

## Build Status (post-import)

`pnpm install` succeeds across all 39 workspace projects (1119 deps resolved).

Per-package `tsc --noEmit` has **known pre-existing issues** carried over from source repos:
- `packages/behavior-suite` — tsconfig `rootDir`/`include` mismatch (scripts/ vs src/)
- Other lifted packages may have similar config drift

These are tracked as follow-up issues, not blockers for the import PR. The structural consolidation is complete.
