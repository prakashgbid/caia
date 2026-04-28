# Migration Status

CAIA is the single site/app/IT-system building platform. **Everything generic (non-site-specific) lives in this monorepo.** Each site stays in its own repo and consumes `@chiefaia/*` from public npm.

## Conductor lift complete (2026-04-28)

Gate 1 — full conductor lift into CAIA — is complete. Per the matrix at `docs/legacy-conductor-reports/` (originally at `~/Documents/projects/reports/conductor-to-caia-capability-matrix-2026-04-28.md`), all 40 LIFT items have landed across 10 PRs (#48 through #58 plus the parallel #49 for `@chiefaia/local-llm-router`):

| Batch | PR | Items | Lines lifted |
|---|---|---|---|
| A — Quick wins (plist, health test, gitleaks, reports) | [#48](https://github.com/prakashgbid/caia/pull/48) | LIFT-001/002/004/005/006/007 | 7,159 |
| B — Executor Phase-2 routing + telemetry | [#50](https://github.com/prakashgbid/caia/pull/50) | LIFT-008/003 | 464 |
| C — Internal packages (classifier/decomposer/dedup-engine) | [#51](https://github.com/prakashgbid/caia/pull/51) | LIFT-010/011/012 | 1,249 |
| (parallel) — `@chiefaia/local-llm-router` | [#49](https://github.com/prakashgbid/caia/pull/49) | LIFT-013 | (handled by parallel task) |
| D — DB migrations 0015–0019 + schema + agents seed | [#52](https://github.com/prakashgbid/caia/pull/52) | LIFT-014/015/016/017/018/019 | 1,011 |
| E — Event taxonomy (12 types + payload typedefs) | [#53](https://github.com/prakashgbid/caia/pull/53) | LIFT-020/021 | 179 |
| F — Agents code + agents/stats routes + app.ts wiring | [#54](https://github.com/prakashgbid/caia/pull/54) | LIFT-022/023/024/025 | 1,701 |
| G — Diverged routes (prompts/task-runs/stories/executor) + requirements/manager | [#55](https://github.com/prakashgbid/caia/pull/55) | LIFT-026/027/028/029/030 | 431 |
| H — Dashboard pages + agents page + drift fixes | [#56](https://github.com/prakashgbid/caia/pull/56) | LIFT-031/032/033 | 3,610 |
| I — `@stolution/mcp-server` + ops scripts | [#57](https://github.com/prakashgbid/caia/pull/57) | LIFT-034/035/036 | 1,714 |
| J — Doc + config polish + workflow move + close | [#58](https://github.com/prakashgbid/caia/pull/58) | LIFT-037/038/039/040 | (this PR) |

**Result:** every capability that existed in `prakashgbid/conductor` (per archive branches `archive/conductor-claude-exec-token-phase2-2026-04-28` and `archive/conductor-claude-priceless-cohen-ab221c-2026-04-28`, both pinned at `71a02a6`) is now present in CAIA, plus the untracked `apps/stolution-mcp/` and ops scripts that lived only in the conductor working tree. Conductor can now be archived without capability loss.

> The matrix listed 9 agents in Section 1.3, but only 6 (`scaffolder`, `po-agent`, `ba-agent`, `task-scheduler`, `testing-agent`, `release-agent`) actually had source files in either archive branch. The other 3 (`ea-agent`, `dba-agent`, `platform-agent`) were planned-only in `caia-agent-team-architecture.md` and never written. Lifting those 3 is not a regression — they were never implemented.

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
- `classifier` — domain taxonomy + label assignment (lifted in #51)
- `decomposer` — NL → Initiative→Epic→Module→Story→Task; rule-based + claude-driven (lifted in #51)
- `dedup-engine` — Jaccard similarity + temporal decay + entity-label overlap (lifted in #51)
- `local-llm-router` — Claude/Ollama routing (lifted in #49)

**Stolution-bound:**
- `apps/stolution-mcp/` (`@stolution/mcp-server`) — MCP server exposing the stolution remote (filesystem, shell, docker, pm2, vault, postgres) over SSH stdio. Lifted in #57.

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
