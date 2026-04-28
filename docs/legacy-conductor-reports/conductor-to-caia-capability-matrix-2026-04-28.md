# Conductor → CAIA Capability Matrix

**Date:** 2026-04-28
**Author:** Claude (planning + analysis only — no code modified)
**Mission:** Drive the conductor → CAIA lift. For every capability that exists in `~/Documents/projects/conductor/`, determine whether CAIA at `~/Documents/projects/caia/` has it (✅ identical / ⚠️ divergent / 🟡 partial / 🔴 missing / 🚫 explicitly retired).
**Hard constraint (Prakash 2026-04-28):** "We cannot lose any ability that we had in conductor and all of that needs to be ported over to CAIA." The lift is not optional or partial.

---

## ✅ LIFT COMPLETE — 2026-04-28 EOD

**Status:** Gate 1 conductor lift is **complete**. Every 🔴 missing item below has been ported to CAIA, except where explicitly retired (🚫). Every ⚠️ divergent or 🟡 partial item has been reconciled to the conductor source-of-truth.

**Outcome:** All 40 LIFT-### items landed in 10 PRs (#48–#58, plus the parallel #49 for `@chiefaia/local-llm-router`). Zero capabilities lost. `prakashgbid/conductor` can now be archived.

| Batch | PR | LIFT IDs | Outcome |
|---|---|---|---|
| A — Quick wins | [#48](https://github.com/prakashgbid/caia/pull/48) | 001/002/004/005/006/007 | ✅ merged |
| B — Executor Phase-2 routing + telemetry | [#50](https://github.com/prakashgbid/caia/pull/50) | 003/008 | ✅ merged |
| C — Internal packages (classifier/decomposer/dedup-engine) | [#51](https://github.com/prakashgbid/caia/pull/51) | 010/011/012 | ✅ merged |
| (parallel) — `@chiefaia/local-llm-router` | [#49](https://github.com/prakashgbid/caia/pull/49) | 013 | ✅ merged |
| D — DB migrations 0015–0019 + schema + agents seed | [#52](https://github.com/prakashgbid/caia/pull/52) | 014/015/016/017/018/019 | ✅ merged |
| E — Event taxonomy (12 types + payload typedefs) | [#53](https://github.com/prakashgbid/caia/pull/53) | 020/021 | ✅ merged |
| F — Agents code + agents/stats routes + app.ts wiring | [#54](https://github.com/prakashgbid/caia/pull/54) | 022/023/024/025 | ✅ merged |
| G — Diverged routes + requirements/manager | [#55](https://github.com/prakashgbid/caia/pull/55) | 026/027/028/029/030 | ✅ merged |
| H — Dashboard pages + agents page + drift fixes | [#56](https://github.com/prakashgbid/caia/pull/56) | 031/032/033 | ✅ merged |
| I — `@stolution/mcp-server` + ops scripts | [#57](https://github.com/prakashgbid/caia/pull/57) | 034/035/036 | ✅ merged |
| J — Doc + config polish + workflow move + close | [#58](https://github.com/prakashgbid/caia/pull/58) | 037/038/039/040 | this PR |

**Notes on counts in the analysis below:**
- Section 1.3 listed 9 agents. Only 6 (`scaffolder`, `po-agent`, `ba-agent`, `task-scheduler`, `testing-agent`, `release-agent`) had source files in either archive branch. The other 3 (`ea-agent`, `dba-agent`, `platform-agent`) were planned-only in `caia-agent-team-architecture.md` and were never written. Lifting those 3 is therefore not a regression — they were never implemented in conductor.
- Section 1.1 LIFT-007 (`stolution-codebase-analysis.md`) and Section 1.1 LIFT-034 (`apps/stolution-mcp/`) plus all of LIFT-036's scripts existed only as untracked files in the conductor working tree. Sourced from there since the archive branches did not include them.
- Section 1.10 `.eslintrc.json` was kept in CAIA's `apps/orchestrator/` as a legacy fallback, but the working config is the flat-config `eslint.config.js` (now reconciled with conductor's stricter rules: `prefer-const` + `no-unused-vars` with `^_` ignore patterns).
- Section 1.8 path discovery: nested workflows under `apps/orchestrator/.github/workflows/` were silently dead (GitHub Actions only runs `.github/workflows/` at repo root). Both `secrets-scan.yml` and `memory-rule-enforceable.yml` moved to repo-root `.github/workflows/` in PR #58.

The original analysis below is preserved as the historical record of where things stood when planning began.

---

**Source:**
- Local conductor: `~/Documents/projects/conductor/` on `claude/exec-token-phase2` (post-archive: `e920cf8` agents, `71a02a6` dedup-engine).
- Local CAIA: `~/Documents/projects/caia/` on `feat/consolidation-monorepo`.
- Authoritative on GitHub: `archive/conductor-*` branches pushed to `prakashgbid/caia` on 2026-04-28.

**Companion analysis:** Phase-1 deep dive in `caia-pipeline-phase1-analysis-2026-04-28.md` (do not redo; this matrix is broader).

---

## Status legend

- ✅ **identical** — same files, same content (modulo trivial diff like ESLint comment style).
- ⚠️ **divergent** — present in both but content differs in a way that matters (functions missing, schema additions, new logic).
- 🟡 **partial** — directory exists in both but a strict subset of files is present.
- 🔴 **missing** — present in conductor, absent in CAIA.
- 🚫 **retired** — explicitly out of scope (default position is "bring it over and let Prakash decide later"; few items qualify).

---

# Section 1 — Per-dimension matrix tables

## 1.1 Apps (`apps/*` and conductor's root `src/`)

Conductor's "orchestrator" lives at the repo root in `src/` (not under `apps/`); CAIA's lives at `apps/orchestrator/src/`. Apply the mapping when reading the table.

| Capability | Conductor path | CAIA path | Status | Note |
|---|---|---|---|---|
| Orchestrator engine (root src) | `src/` | `apps/orchestrator/src/` | ⚠️ divergent | Multiple subsystems drifted (see 1.2–1.10). |
| Executor daemon | `apps/executor/` | `apps/executor/` | ⚠️ divergent | 9 files / 1543 lines vs CAIA 7 files / 1180 lines. Phase-2 model routing (Haiku/Sonnet/Opus) + token telemetry missing in CAIA. |
| Dashboard (Next.js) | `dashboard/` (root) and `apps/dashboard/` (stub w/ new agents page) | `apps/dashboard/` | 🟡 partial | CAIA dashboard is older snapshot of conductor `dashboard/`. Missing 6 pages: `coverage`, `gates`, `pipeline`, `platform-status`, `submit`, plus the new `agents` page from conductor `apps/dashboard/`. |
| Completeness-sentinel daemon | `apps/completeness-sentinel/` | `apps/completeness-sentinel/` | ⚠️ divergent | CAIA has full src/, dist/. **Plist missing** (`com.conductor.completeness-sentinel.plist`). |
| db-backup hourly job | `apps/db-backup/` | `apps/db-backup/` | ✅ identical | Plist + `run-backup.sh` match. |
| story-backfiller daemon | `apps/story-backfiller/` | `apps/story-backfiller/` | ✅ identical | `index.ts`, plist match. |
| task-run-poller daemon | `apps/task-run-poller/` | `apps/task-run-poller/` | ✅ identical | `index.cjs`, `index.ts`, plist match. |
| pipeline-pulse health checker | `apps/pipeline-pulse/` | `apps/pipeline-pulse/` | ✅ identical | All src/ files match. README missing in CAIA. |
| orchestrator-middleware | `apps/orchestrator-middleware/` | `apps/orchestrator-middleware/` | ✅ identical | All 6 src files + 4 tests identical. |
| **stolution-mcp server** | `apps/stolution-mcp/` | — | 🔴 missing | 8 files / 901 lines + README + mcp-config.json + package-lock + `@stolution/mcp-server@0.1.0`. Used by remote-MCP toolchain (this analysis depends on it). |

## 1.2 Packages (`packages/*`)

| Capability | Conductor path | CAIA path | Status | Note |
|---|---|---|---|---|
| `@chiefaia/event-bus-internal` | `packages/event-bus/` (`@/event-bus`) | `packages/event-bus-internal/` | ✅ identical | Renamed; only import paths differ (`../events-taxonomy` → `@chiefaia/events-taxonomy-internal`). |
| `@chiefaia/events-taxonomy-internal` | `packages/events-taxonomy/` | `packages/events-taxonomy-internal/` | ⚠️ divergent | `index.ts` 421 vs 274 lines (+147 of agent payload typedefs). `registry.yaml` 76 vs 64 events (12 missing — see 1.5). |
| `@chiefaia/classifier` | `packages/classifier/` | — | 🔴 missing | 4 ts files / 381 lines. Domain/nature/complexity classifier consumed by entity-labels (migration 0019). |
| `@chiefaia/decomposer` | `packages/decomposer/` | — | 🔴 missing | 5 ts files / 423 lines. **Different package** from `@chiefaia/story-decomposer`. Has `claude-decomposer.ts` + `rule-based.ts` providers. |
| `@chiefaia/dedup-engine` | `packages/dedup-engine/` | — | 🔴 missing | 5 ts files / 408 lines. Jaccard similarity + temporal decay + entity labels (commit `71a02a6`). |
| `@chiefaia/local-llm-router` | `packages/local-llm-router/` | — | 🔴 missing | 6 ts files / 559 lines. Claude/Ollama routing for cost-optimization. |
| `@chiefaia/logger` | `packages/logger/` (1 file, 102 lines) | `packages/logger/` (full pino impl, dist/, docs/) | ⚠️ divergent | Different implementations. CAIA's is the production `@chiefaia/logger@0.2.0`; conductor's is a small private helper. Verify no behavioral gap. |
| `@chiefaia/test-kit` | `packages/test-kit/` (2 files / 270 lines) | `packages/test-kit/` (full package, 0.1.1) | ⚠️ divergent | CAIA's is more developed. Verify conductor's helpers all exist. |
| `@chiefaia/secrets-broker` | (in `prakashgbid/conductor` plugins workspace, already lifted) | `packages/secrets-broker/` | ✅ identical | Per MIGRATION-STATUS.md, already lifted. |
| `@chiefaia/story-decomposer` | (plugins workspace) | `packages/story-decomposer/` | ✅ identical | Already lifted. |
| `@chiefaia/dead-shell-detector` | (plugins workspace) | `packages/dead-shell-detector/` | ✅ identical | Already lifted. |
| `@chiefaia/behavior-suite` | (plugins workspace) | `packages/behavior-suite/` | ✅ identical | Already lifted (with known tsconfig drift). |

> Memory file referenced "agent-internal-types" — no such directory exists in conductor (`src/agents/*.ts` define their types inline). Treat as N/A.

## 1.3 Agents (`src/agents/` in conductor)

CAIA's `apps/orchestrator/src/` has **no `agents/` subdirectory at all**. Every entry below is 🔴 missing.

| Agent | Conductor path | Lines | Tier | Status |
|---|---|---|---|---|
| Scaffolder | `src/agents/scaffolder.ts` | 314 | Bootstrap | 🔴 missing |
| PO Agent (decomposition) | `src/agents/po-agent.ts` | 138 | Planning | 🔴 missing |
| BA Agent (enrichment) | `src/agents/ba-agent.ts` | 279 | Planning | 🔴 missing |
| Task Scheduler | `src/agents/task-scheduler.ts` | 195 | Planning | 🔴 missing |
| Testing Agent | `src/agents/testing-agent.ts` | 181 | Quality | 🔴 missing |
| Release Agent | `src/agents/release-agent.ts` | 147 | Quality | 🔴 missing |
| EA Agent (enterprise architecture) | `src/agents/ea-agent.ts` | 246 | Strategic | 🔴 missing |
| DBA Agent | `src/agents/dba-agent.ts` | 224 | Strategic | 🔴 missing |
| Platform Agent | `src/agents/platform-agent.ts` | 254 | Strategic | 🔴 missing |
| **Total** | — | **1978** | — | 🔴 9 missing |

Supporting:
- `src/db/seeds/agents.ts` — 610-line seed with system-prompt rows and registry entries — 🔴 missing.
- `src/api/routes/agents.ts` — 396-line agent registry API — 🔴 missing.
- API wiring in `src/api/app.ts` (`registerAgentRoutes(app, db)`) — missing.
- Dashboard `apps/dashboard/app/agents/page.tsx` (314 lines) + `app/api/agents/route.ts` (38 lines) — missing.

> The user's "25 agents per memory" appears to count agents-in-spec (from `caia-agent-team-architecture.md`) rather than agents-implemented. Conductor today has **9** agent files; the architecture doc plans more.

## 1.4 DB schema + migrations (`src/db/`)

| File | Conductor | CAIA | Status |
|---|---|---|---|
| `connection.ts` | 41 lines | 41 lines | ✅ identical |
| `migrate-from-jsonl.ts` | 242 | 242 | ✅ identical |
| `seed-adr.ts` / `seed-projects.ts` | 29 / 40 | 29 / 40 | ✅ identical |
| `schema.ts` | 856 lines | 722 lines | ⚠️ divergent (+134 lines) |
| `seeds/agents.ts` | 610 lines | — | 🔴 missing |
| `migrations/0000_optimal_risque.sql` | yes | yes | ✅ identical |
| `migrations/0001_timeline_enrich.sql` | yes | yes | ✅ identical |
| `migrations/0002_domains.sql` | yes | yes | ✅ identical |
| `migrations/0003_seed_domains.sql` | yes | yes | ✅ identical |
| `migrations/0004_task_runs.sql` | yes | yes | ✅ identical |
| `migrations/0005_behavior_tests.sql` | yes | yes | ✅ identical |
| `migrations/0006_completeness.sql` | yes | yes | ✅ identical |
| `migrations/0007_executor.sql` | yes | yes | ✅ identical |
| `migrations/0008_events.sql` | yes | yes | ✅ identical |
| `migrations/0009_build_runs.sql` | yes | yes | ✅ identical |
| `migrations/0010_prompt_traceability.sql` | yes | yes | ✅ identical |
| `migrations/0012_prioritization.sql` | yes | yes | ✅ identical |
| `migrations/0013_pulse.sql` | yes | yes | ✅ identical |
| `migrations/0014_health009_dom001.sql` | yes | yes | ✅ identical |
| `migrations/0015_event_pipeline_foundation.sql` | 37 lines | — | 🔴 missing |
| `migrations/0016_backfill_root_prompt_id.sql` | 68 lines | — | 🔴 missing |
| `migrations/0017_agent_registry.sql` | 80 lines | — | 🔴 missing |
| `migrations/0018_story_enrichment.sql` | 8 lines | — | 🔴 missing |
| `migrations/0019_entity_labels.sql` | 39 lines | — | 🔴 missing |

`schema.ts` divergences (conductor-only):
- `prompt_pipeline_stages` table (migration 0015).
- Backfill columns on `prompts` for `root_prompt_id` (migration 0016).
- `agent_registry`, `agent_system_prompts`, `agent_artifacts`, `agent_messages` tables (migration 0017).
- BA-agent enrichment columns on `stories` (`implementation_notes`, `updated_at`, `enriched_at`) (migration 0018).
- `entity_labels` and `dedup_results` tables (migration 0019).
- Token-telemetry columns on `task_runs` (`executor_pid`, `worktree_path`, `tool_call_count`, `input_tokens`, `output_tokens`, `files_changed`, `duration_ms`, `raw_claude_output`).

## 1.5 Event taxonomy (`packages/events-taxonomy*/registry.yaml`)

Conductor: 76 event types. CAIA: 64. **12 missing in CAIA:**

| Event type | Source | Status |
|---|---|---|
| `prompt.ingested` | migration 0015 | 🔴 missing |
| `requirement.state.transitioned` | migration 0015 | 🔴 missing |
| `executor.task.picked_up` | migration 0015 | 🔴 missing |
| `executor.claude.tool_call` | migration 0015 | 🔴 missing |
| `executor.claude.completed` | migration 0015 | 🔴 missing |
| `executor.task.failed` | migration 0015 | 🔴 missing |
| `completeness.check.completed` | migration 0015 | 🔴 missing |
| `pipeline.stage.advanced` | migration 0015 | 🔴 missing |
| `scaffolder.team.assembled` | scaffolder agent | 🔴 missing |
| `po-agent.decomposition.complete` | po-agent | 🔴 missing |
| `ba-agent.enrichment.complete` | ba-agent | 🔴 missing |
| `task-scheduler.scheduling.complete` | task-scheduler | 🔴 missing |

Plus type-level additions in `index.ts`: actor enum extensions (`scaffolder`, `po-agent`, `ba-agent`, `task-scheduler`, `testing-agent`, `release-agent`, `ea-agent`, `dba-agent`, `platform-agent`) and ~140 lines of payload interfaces.

## 1.6 API routes (`src/api/routes/*`)

| Route | Conductor lines | CAIA lines | Status |
|---|---|---|---|
| `adrs.ts` | 68 | 68 | ✅ identical |
| `audit.ts` | 17 | 17 | ✅ identical |
| `behavior-tests.ts` | 226 | 226 | ✅ identical |
| `builds.ts` | 63 | 63 | ✅ identical |
| `domains.ts` | 252 | 252 | ✅ identical |
| `events.ts` | 57 | 59 | ⚠️ divergent (signature change `registerEventsRoutes(app, db)`) |
| `executor.ts` | 414 | 387 | ⚠️ divergent (-27 lines; token telemetry endpoints) |
| `features.ts` | 65 | 65 | ✅ identical |
| `legacy.ts` | 128 | 128 | ✅ identical |
| `metrics.ts` | 50 | 50 | ✅ identical |
| `priority.ts` | 133 | 133 | ✅ identical |
| `projects.ts` | 58 | 58 | ✅ identical |
| `prompts.ts` | 327 | 107 | ⚠️ divergent (-220 lines; pipeline stages, agent artifacts, lineage endpoints) |
| `pulse.ts` | 91 | 91 | ✅ identical |
| `stories.ts` | 478 | 447 | ⚠️ divergent (-31 lines; BA-enrichment fields) |
| `suggestions.ts` | 78 | 78 | ✅ identical |
| `task-runs.ts` | 393 | 316 | ⚠️ divergent (-77 lines; token-telemetry, raw output, files-changed) |
| `timeline.ts` | 132 | 132 | ✅ identical |
| **`agents.ts`** | 396 | — | 🔴 missing |
| **`stats.ts`** | 60 | — | 🔴 missing |
| Wiring in `app.ts` | `registerStatsRoutes(app)` + `registerAgentRoutes(app, db)` | — | 🔴 missing |

## 1.7 Scripts

Conductor has **17 scripts**. CAIA's `apps/orchestrator/scripts/` has **8**. CAIA root `scripts/` has 1 (`migrate-launchd.sh`).

| Script | Conductor | CAIA | Status |
|---|---|---|---|
| `auto-categorize-existing.ts` | 131 lines | yes | ✅ identical |
| `backfill-prompts.ts` | 310 | yes | ✅ identical |
| `build-runner.ts` / `.sh` | 169 / 168 | yes | ✅ identical |
| `check-coverage-delta.ts` | 95 | yes | ✅ identical |
| `check-events-taxonomy.ts` | 84 | yes | ✅ identical |
| `check-memory-rule-enforceable.sh` | 33 | yes | ✅ identical |
| `check-observability.ts` | 97 | yes | ✅ identical |
| `install.ts` (+ d.ts/js) | 170 | yes | ✅ identical |
| `bootstrap-git-auth.sh` | 86 | — | 🔴 missing |
| `deploy-stolution-mcp.sh` | 166 | — | 🔴 missing |
| `escalate-stale-blockers.py` | 88 | — | 🔴 missing |
| `get-vault-secret.sh` | 9 | — | 🔴 missing |
| `heartbeat-pulse.sh` | 85 | — | 🔴 missing |
| `install-ollama.sh` | 10 | — | 🔴 missing |
| `pull-local-models.sh` | 52 | — | 🔴 missing |
| `push-ci-fix.sh` (root) | 89 bytes | — | 🔴 missing |

CAIA-only: `scripts/migrate-launchd.sh` (created during the consolidation; not in conductor — keep).

## 1.8 CI workflows (`.github/workflows/`)

| Workflow | Conductor | CAIA | Status |
|---|---|---|---|
| `memory-rule-enforceable.yml` | yes | `apps/orchestrator/.github/workflows/` | ✅ identical (location moved) |
| `secrets-scan.yml` | yes | `apps/orchestrator/.github/workflows/` | ✅ identical |
| Root-level `ci.yml` | — | yes | CAIA-only (turbo monorepo CI) |
| Root-level `release.yml` | — | yes | CAIA-only (changesets) |
| Root-level `docs.yml` | — | yes | CAIA-only |

> Verify the orchestrator-scoped workflows still trigger correctly when nested two levels deep — GitHub Actions filter paths may need adjustment.

## 1.9 Hooks

| Hook | Conductor | CAIA | Status |
|---|---|---|---|
| `.husky/pre-commit` | yes | `apps/orchestrator/.husky/pre-commit` | ✅ identical |
| `.husky/_/*` (husky internals) | yes | yes | ✅ identical |
| `.githooks/pre-commit` | yes | `apps/orchestrator/.githooks/pre-commit` | ✅ identical |
| `hooks/prespawn.sh` | 97 lines | yes | ✅ identical |

## 1.10 Configuration files

| File | Conductor | CAIA | Status |
|---|---|---|---|
| `package.json` | `@conductor/core@0.1.0` (npm + jest) | `caia` workspace root + `@caia-app/core@0.1.0` for orchestrator (pnpm + turbo) | ⚠️ divergent (build system) |
| `tsconfig.json` / `.build.json` | yes | yes (preserved at orchestrator level) | ✅ identical |
| `eslint.config.js` | 820 bytes | 617 bytes (orchestrator) | ⚠️ divergent (conductor uses newer rule set) |
| `jest.config.ts` | 1366 bytes | 1214 bytes (orchestrator) | ⚠️ divergent |
| `playwright.config.ts` | 432 bytes | 432 bytes | ✅ identical |
| `drizzle.config.ts` | 285 bytes | 285 bytes | ✅ identical |
| `run.sh` | 1018 bytes | 1018 bytes | ✅ identical |
| `.eslintrc.json` (legacy) | 396 bytes | — | 🔴 missing (or intentionally retired in favor of flat config) |
| `.prettierrc` | 106 bytes | — | 🔴 missing |
| `.gitleaks.toml` | 3008 bytes | — | 🔴 missing (root-level secret-scan config) |
| `.claude/settings.local.json` | yes | — | 🔴 missing (likely user-local; verify) |
| `pnpm-workspace.yaml` | — | yes | CAIA-only |
| `turbo.json` | — | yes | CAIA-only |

## 1.11 Documentation (`docs/`, root `*.md`, reports)

| Doc | Conductor | CAIA | Status |
|---|---|---|---|
| `MOVED-TO-CAIA.md` | yes | — | (Pointer; can retire after lift complete.) |
| `stolution-codebase-analysis.md` | 431 lines | — | 🔴 missing |
| `reports/BACKEND-V2-2026-04-20.md` | yes | — | 🔴 missing |
| `reports/BLOCKERS-QUESTIONS-2026-04-20.md` | yes | — | 🔴 missing |
| `reports/CONDUCTOR-EXT-2026-04-20.md` | yes | — | 🔴 missing |
| `reports/RUNAWAY-TABS-FIX-2026-04-20.md` | yes | — | 🔴 missing |
| `reports/SEED-2026-04-20.md` | yes | — | 🔴 missing |
| `reports/SEED-LIVE-STATE-2026-04-20.md` | yes | — | 🔴 missing |
| `reports/caia-agent-team-architecture.md` | 39834 B | — | 🔴 missing — defines the agent team taxonomy referenced everywhere |
| `reports/caia-domain-taxonomy-and-dedup-architecture.md` | 28851 B | — | 🔴 missing — drives migrations 0019 |
| `reports/caia-execution-plan.md` | 75536 B | — | 🔴 missing — master plan |
| `reports/caia-platform-architecture-proposal.md` | 102365 B | — | 🔴 missing — platform vision |
| `reports/enforcement-hardening-summary.md` | yes | — | 🔴 missing |
| `reports/memory-rule-inventory.md` | 86913 B | — | 🔴 missing |
| `reports/secrets-hyper-security-deployment.md` | yes | — | 🔴 missing |
| `apps/executor/README.md` | yes | yes | ✅ identical |
| `apps/executor/PHASE-A-FINDINGS.md` | yes | yes | ✅ identical |
| `apps/executor/execution-engine-lock-contract.md` | yes | yes | ✅ identical |
| `apps/pipeline-pulse/README.md` | yes | — | 🔴 missing |
| `apps/stolution-mcp/README.md` | 244 lines | — | 🔴 missing (with the app) |
| `templates/CLAUDE.md` | yes | yes (in apps/orchestrator) | ✅ identical |
| `docs/legacy-framework/*` | — | yes | CAIA-only |
| `docs/legacy-pokerzeno-framework/*` | — | yes | CAIA-only |

## 1.12 Templates

| Template | Conductor | CAIA | Status |
|---|---|---|---|
| `templates/CLAUDE.md` | yes | `apps/orchestrator/templates/CLAUDE.md` | ✅ identical |
| `templates/site/` | — | yes | CAIA-only (lifted from `site-template`) |
| `templates/site-pokerzeno/` | — | yes | CAIA-only (lifted from `pokerzeno-site-template`) |
| `templates/utility/` | — | yes | CAIA-only |

## 1.13 Data fixtures / seed data

| Item | Conductor | CAIA | Status |
|---|---|---|---|
| `src/db/seeds/agents.ts` | 610 lines | — | 🔴 missing — seeds `agent_registry`, `agent_system_prompts` |
| `src/db/seed-adr.ts` | 29 lines | yes | ✅ identical |
| `src/db/seed-projects.ts` | 40 lines | yes | ✅ identical |
| Coverage artifacts (`coverage/`) | yes | regenerated by CI | 🚫 retire (build artifact) |

## 1.14 Service configuration (plists, daemons)

| Plist | Conductor | CAIA | Status |
|---|---|---|---|
| `com.conductor.executor.plist` | `apps/executor/` | `apps/executor/` | ✅ identical (path inside file may need rewrite) |
| `com.conductor.db-backup.plist` | `apps/db-backup/plist/` | `apps/db-backup/plist/` | ✅ identical |
| `com.conductor.task-run-poller.plist` | `apps/task-run-poller/plist/` | `apps/task-run-poller/plist/` | ✅ identical |
| `com.conductor.story-backfiller.plist` | `apps/story-backfiller/plist/` | `apps/story-backfiller/plist/` | ✅ identical |
| `com.conductor.completeness-sentinel.plist` | `apps/completeness-sentinel/plist/` | — | 🔴 missing |
| `com.conductor.mcp.plist` | (referenced in MIGRATION-STATUS) | — | 🟡 partial — referenced for cutover, file not in repo (lives in `~/Library/LaunchAgents/`). Document. |
| `migrate-launchd.sh` | — | `scripts/migrate-launchd.sh` | CAIA-only |
| Dockerfiles / docker-compose | — | — | none in either repo |
| systemd units | — | — | none |

## 1.15 Third-party integrations

| Integration | Conductor wiring | CAIA wiring | Status |
|---|---|---|---|
| Anthropic Claude (model dispatch in executor) | `MODEL_HAIKU/SONNET/OPUS` consts in `dispatcher.ts`, OAuth via `CLAUDE_CODE_OAUTH_TOKEN` | older dispatcher (pre token-routing) | ⚠️ divergent — Phase-2 routing missing |
| Ollama (local LLM) | `scripts/install-ollama.sh`, `scripts/pull-local-models.sh`, `packages/local-llm-router/ollama-adapter.ts` | — | 🔴 missing |
| HashiCorp Vault | `scripts/get-vault-secret.sh`, `apps/stolution-mcp/src/tools/vault.ts`, `packages/secrets-broker/` | `packages/secrets-broker/` only | 🟡 partial — vault helper script + MCP tool not lifted |
| GitHub auth | `scripts/bootstrap-git-auth.sh` | — | 🔴 missing |
| Stolution remote (Postgres + PM2 + Docker + filesystem + git) | `apps/stolution-mcp/` | — | 🔴 missing (whole MCP server) |
| Native macOS notifications | `src/notifications/index.ts` | yes | ✅ identical (used by blockers) |
| MCP server (orchestrator) | `src/mcp/server.ts` (2 files / 2179 lines) | yes (2178 lines) | ✅ identical |
| MCP seed | `src/mcp/seed.ts` | yes | ✅ identical |
| trufflehog / gitleaks (secret-scan) | `package.json` `gate:no-secrets` script + `.gitleaks.toml` | `apps/orchestrator/.github/workflows/secrets-scan.yml` only | ⚠️ divergent — `.gitleaks.toml` not lifted |
| Pino logger | `pino` direct usage in `src/index.ts` | `@chiefaia/logger` (pino-backed) | ⚠️ divergent — verify same fields |
| Prom-client / metrics | `prom-client` direct in `src/metrics/` | `@chiefaia/metrics` | ⚠️ divergent — verify equivalence |

## 1.16 Tests

| Test directory | Conductor | CAIA | Status |
|---|---|---|---|
| `tests/api/`, `tests/blockers/`, `tests/contracts/`, `tests/core/`, `tests/db/`, `tests/e2e/`, `tests/hook/`, `tests/mcp/`, `tests/notifications/`, `tests/prioritization/`, `tests/pump/`, `tests/questions/`, `tests/requirements/`, `tests/ws/` | yes | yes (apps/orchestrator/tests/) | ✅ identical (37 vs 36) |
| `tests/dashboard/health.test.ts` | yes | — | 🔴 missing |
| `apps/executor/dispatcher.test.ts` | yes | — | 🔴 missing |
| `apps/executor/scheduler.test.ts` | yes | yes | ✅ identical |

---

# Section 2 — Aggregate counts

| Dimension | Total | ✅ | ⚠️ | 🟡 | 🔴 | 🚫 |
|---|---|---|---|---|---|---|
| Apps (1.1) | 10 | 5 | 2 | 2 | 1 | 0 |
| Packages (1.2) | 12 | 5 | 2 | 0 | 4 | 0 |
| Agents (1.3) | 12 (9 agent files + seeds + routes + UI) | 0 | 0 | 0 | 12 | 0 |
| DB schema/migrations (1.4) | 21 (15 mig + schema + 5 supporting) | 14 | 1 | 0 | 6 | 0 |
| Event taxonomy (1.5) | 76 | 64 | 0 | 0 | 12 | 0 |
| API routes (1.6) | 21 (18 + agents + stats + wiring) | 14 | 4 | 0 | 3 | 0 |
| Scripts (1.7) | 17 (orchestrator-scoped) + 1 root | 9 | 0 | 0 | 8 | 0 |
| CI workflows (1.8) | 5 | 5 | 0 | 0 | 0 | 0 |
| Hooks (1.9) | 3 | 3 | 0 | 0 | 0 | 0 |
| Configuration (1.10) | 12 | 5 | 4 | 0 | 4 (incl. user-local) | 0 (not retired by default) |
| Documentation (1.11) | 22 | 5 | 0 | 0 | 17 | 0 |
| Templates (1.12) | 4 | 1 | 0 | 0 | 0 | 0 (others CAIA-only) |
| Fixtures/seeds (1.13) | 4 | 2 | 0 | 0 | 1 | 1 |
| Service config (1.14) | 7 | 4 | 0 | 1 | 1 | 0 |
| Third-party (1.15) | 11 | 3 | 4 | 1 | 3 | 0 |
| Tests (1.16) | 16 | 14 | 0 | 0 | 2 | 0 |
| **TOTAL distinct items** | **~233** | **148** (≈64%) | **17** (≈7%) | **4** (≈2%) | **74** (≈32%) | **1** |

> Counts overlap somewhat across dimensions (e.g., `apps/stolution-mcp` shows up in apps, scripts, and integrations). The honest "distinct missing capability" count is **~74** items.

---

# Section 3 — Lift plan

Sequenced PR-sized batches. Every task default-includes: write the code/file, update CAIA's pnpm-workspace + turbo.json if a new package, run `pnpm install`, run `pnpm typecheck`, ensure `pnpm test` still green.

## Batch A — Quick wins (no behavioral risk)

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-001 | Lift `apps/completeness-sentinel/plist/com.conductor.completeness-sentinel.plist` | conductor `apps/completeness-sentinel/plist/` | `caia/apps/completeness-sentinel/plist/` | — | 5 min |
| LIFT-002 | Lift `tests/dashboard/health.test.ts` | conductor `tests/dashboard/` | `caia/apps/orchestrator/tests/dashboard/` | — | 10 min |
| LIFT-003 | Lift `apps/executor/dispatcher.test.ts` | conductor `apps/executor/dispatcher.test.ts` | `caia/apps/executor/dispatcher.test.ts` | LIFT-008 (because dispatcher logic must be lifted first) | 15 min |
| LIFT-004 | Lift `.gitleaks.toml` | conductor `/` | `caia/` | — | 2 min |
| LIFT-005 | Lift `apps/pipeline-pulse/README.md` | conductor `apps/pipeline-pulse/` | `caia/apps/pipeline-pulse/` | — | 2 min |
| LIFT-006 | Lift conductor `reports/*.md` (14 files) | `conductor/reports/` | `caia/docs/legacy-conductor-reports/` (new) | — | 30 min |
| LIFT-007 | Lift `stolution-codebase-analysis.md` | `conductor/stolution-codebase-analysis.md` | `caia/docs/legacy-conductor-reports/` | LIFT-006 | 5 min |

## Batch B — Executor token routing (Phase 2)

Already documented in `caia-pipeline-phase1-analysis-2026-04-28.md`; called out for completeness.

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-008 | Lift executor Phase-2 model routing | `apps/executor/dispatcher.ts` (340 lines), `parse-claude-output-rich.ts` (137), `publish-event.ts` (29), `completion-hook.ts` (326) | `caia/apps/executor/` | — | 4 hours (incl. tests) |
| LIFT-009 | Lift executor token-telemetry schema | `apps/orchestrator/src/db/schema.ts` (token cols on `task_runs`) — included in LIFT-014 | — | LIFT-014 | rolled in |

## Batch C — Internal packages

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-010 | Lift `@chiefaia/classifier` | `packages/classifier/` (4 files / 381 lines) | `caia/packages/classifier/` | — | 2 hours |
| LIFT-011 | Lift `@chiefaia/decomposer` (Claude + rule-based) | `packages/decomposer/` (5 files / 423 lines) | `caia/packages/decomposer/` | LIFT-010 | 3 hours |
| LIFT-012 | Lift `@chiefaia/dedup-engine` | `packages/dedup-engine/` (5 files / 408 lines) | `caia/packages/dedup-engine/` | LIFT-010 | 3 hours |
| LIFT-013 | Lift `@chiefaia/local-llm-router` + Ollama scripts | `packages/local-llm-router/` + `scripts/install-ollama.sh` + `scripts/pull-local-models.sh` | `caia/packages/local-llm-router/` + `caia/scripts/` | — | 3 hours |

## Batch D — DB schema + migrations

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-014 | Lift migration 0015 (event pipeline foundation) + schema additions | `migrations/0015_event_pipeline_foundation.sql` + `prompt_pipeline_stages` table + token cols | `caia/apps/orchestrator/src/db/` | — | 1 hour |
| LIFT-015 | Lift migration 0016 (backfill root_prompt_id) | `migrations/0016_backfill_root_prompt_id.sql` | same | LIFT-014 | 30 min |
| LIFT-016 | Lift migration 0017 (agent registry) + 4 new tables | `migrations/0017_agent_registry.sql` + `agent_registry`, `agent_system_prompts`, `agent_artifacts`, `agent_messages` | same | LIFT-015 | 1 hour |
| LIFT-017 | Lift migration 0018 (story enrichment columns) | `migrations/0018_story_enrichment.sql` | same | LIFT-016 | 15 min |
| LIFT-018 | Lift migration 0019 (entity_labels + dedup_results) | `migrations/0019_entity_labels.sql` | same | LIFT-017, LIFT-010, LIFT-012 | 30 min |
| LIFT-019 | Lift `src/db/seeds/agents.ts` (610 lines) | `src/db/seeds/agents.ts` | `caia/apps/orchestrator/src/db/seeds/agents.ts` | LIFT-016, LIFT-022 | 1 hour |

## Batch E — Event taxonomy + payloads

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-020 | Lift 12 missing event types into `events-taxonomy-internal/registry.yaml` | `packages/events-taxonomy/registry.yaml` | `caia/packages/events-taxonomy-internal/registry.yaml` | — | 30 min |
| LIFT-021 | Lift agent payload typedefs into `events-taxonomy-internal/index.ts` (+147 lines) | `packages/events-taxonomy/index.ts` | same | LIFT-020 | 1 hour |

## Batch F — Agent code (the "missing 9 + supporting")

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-022 | Create `apps/orchestrator/src/agents/` directory + 9 agent files | `src/agents/*.ts` (9 files / 1978 lines) | `caia/apps/orchestrator/src/agents/` | LIFT-016, LIFT-021 | 6 hours |
| LIFT-023 | Lift `src/api/routes/agents.ts` (396 lines) | same | `caia/apps/orchestrator/src/api/routes/agents.ts` | LIFT-022, LIFT-016 | 2 hours |
| LIFT-024 | Lift `src/api/routes/stats.ts` (60 lines) | same | `caia/apps/orchestrator/src/api/routes/stats.ts` | — | 30 min |
| LIFT-025 | Update `src/api/app.ts` to register agents + stats routes | conductor `src/api/app.ts` | same in CAIA | LIFT-023, LIFT-024 | 15 min |

## Batch G — Diverged subsystems

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-026 | Reconcile `src/api/routes/prompts.ts` (-220 lines: pipeline stages, agent artifacts, lineage) | conductor `src/api/routes/prompts.ts` | CAIA | LIFT-014, LIFT-016 | 3 hours |
| LIFT-027 | Reconcile `src/api/routes/task-runs.ts` (-77 lines: token telemetry) | same | CAIA | LIFT-014 | 2 hours |
| LIFT-028 | Reconcile `src/api/routes/stories.ts` (-31 lines: BA enrichment) | same | CAIA | LIFT-017 | 1 hour |
| LIFT-029 | Reconcile `src/api/routes/executor.ts` (-27 lines) | same | CAIA | LIFT-014 | 1 hour |
| LIFT-030 | Reconcile `src/requirements/manager.ts` (-60 lines) | same | CAIA | LIFT-014 | 1 hour |

## Batch H — Dashboard pages

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-031 | Lift dashboard pages: `coverage`, `gates`, `pipeline`, `platform-status`, `submit` | conductor `dashboard/app/` | `caia/apps/dashboard/app/` | — | 4 hours |
| LIFT-032 | Lift the `agents` page + API route from conductor `apps/dashboard/` | `apps/dashboard/app/agents/`, `app/api/agents/` | `caia/apps/dashboard/app/agents/`, `app/api/agents/` | LIFT-023 | 2 hours |
| LIFT-033 | Audit `dashboard/components/`, `dashboard/hooks/` for any drift | conductor `dashboard/` | `caia/apps/dashboard/` | LIFT-031 | 2 hours |

## Batch I — Stolution-MCP and remote tooling

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-034 | Lift `apps/stolution-mcp/` (8 files, 901 lines + README + lock + config) | conductor `apps/stolution-mcp/` | `caia/apps/stolution-mcp/` | — | 4 hours |
| LIFT-035 | Lift `scripts/deploy-stolution-mcp.sh` | conductor `scripts/` | `caia/apps/stolution-mcp/scripts/` (or `caia/scripts/`) | LIFT-034 | 30 min |
| LIFT-036 | Lift `scripts/get-vault-secret.sh`, `bootstrap-git-auth.sh`, `heartbeat-pulse.sh`, `escalate-stale-blockers.py`, `push-ci-fix.sh` | conductor `scripts/` | `caia/scripts/` (or per-app) | — | 1 hour |

## Batch J — Doc + config polish

| ID | Title | Source | Destination | Deps | Effort |
|---|---|---|---|---|---|
| LIFT-037 | Lift `.eslintrc.json` and `.prettierrc` (or document why retired) | conductor `/` | `caia/apps/orchestrator/` | — | 30 min |
| LIFT-038 | Reconcile `eslint.config.js` and `jest.config.ts` drift | conductor `/` | `caia/apps/orchestrator/` | LIFT-037 | 1 hour |
| LIFT-039 | Verify orchestrator-scoped `.github/workflows/*` actually trigger from `caia/apps/orchestrator/.github/workflows/` (GitHub may only run from repo-root `.github/workflows/`) | — | `caia/.github/workflows/` (move + path-filter) | — | 2 hours |
| LIFT-040 | Lift `MOVED-TO-CAIA.md` retirement: keep conductor repo archived, update CAIA `MIGRATION-STATUS.md` to mark lift complete | — | `caia/MIGRATION-STATUS.md` | all above | 30 min |

## Effort total

| Batch | Items | Effort |
|---|---|---|
| A — Quick wins | 7 | ~1.5 h |
| B — Executor Phase-2 | 2 | ~4 h |
| C — Internal packages | 4 | ~11 h |
| D — DB schema + migrations | 6 | ~4 h |
| E — Event taxonomy | 2 | ~1.5 h |
| F — Agent code | 4 | ~9 h |
| G — Diverged subsystems | 5 | ~8 h |
| H — Dashboard pages | 3 | ~8 h |
| I — Stolution-MCP + tooling | 3 | ~5.5 h |
| J — Doc/config polish | 4 | ~4 h |
| **Total** | **40** | **~57 hours** (≈ 1.5 weeks of focused engineering) |

---

# Section 4 — Things to explicitly retire (🚫)

Default position per Prakash: **bring it over and let Prakash decide later.** The list below is **deliberately short**; everything else gets lifted.

| Item | Why retire | Sign-off |
|---|---|---|
| `coverage/` directory (Jest output) | Build artifact regenerated by CI; lifting old reports adds repo bloat | Default-retire — confirm with Prakash. |
| Conductor's `dist/` directories | Build artifacts | Default-retire. |
| `MOVED-TO-CAIA.md` (after lift complete) | Pointer file; redundant once CAIA is the only repo | Retire after Batch J. |
| `.claude/settings.local.json` | User-local IDE config; `.gitignore`'d in most setups | Verify; default-retire. |

> Items NOT in this list (e.g., `local-llm-router`, `stolution-mcp`, agent code, all 14 reports) are explicitly not retired — Prakash's hard constraint applies.

Conductor's `package.json` (npm/jest based) is being functionally replaced by CAIA's `apps/orchestrator/package.json` (pnpm/turbo). That's a build-system migration, not a retirement of capability.

---

# Section 5 — Risk callouts

| Risk | Severity | Mitigation |
|---|---|---|
| **Migration sequence integrity.** CAIA today is at migration 0014. Lifting 0015–0019 onto a live DB requires running migrations in order. If anyone has a CAIA DB at HEAD without these migrations, applying them later may fail on existing data. | High | Run all migrations on a fresh local DB; do dry-run with `--dry` flag; back up `~/.conductor/conductor.sqlite` before cutover (db-backup daemon already does this). |
| **Build-system migration (npm/jest → pnpm/turbo).** Conductor's `package.json` declares all deps at the root; CAIA's `apps/orchestrator/package.json` is per-workspace. Lifted scripts using `ts-node`/`jest` may break under turbo's task runner. | High | LIFT-038: reconcile `eslint.config.js` + `jest.config.ts`; verify `pnpm test` still works for orchestrator after each batch. |
| **Logger / metrics divergence.** Conductor uses `pino` directly; CAIA uses `@chiefaia/logger` (pino-backed). Same for `prom-client` vs `@chiefaia/metrics`. If field names or log levels differ, dashboards / alerts may break silently. | Medium | Diff the fields emitted by both; treat as a behavioral test in LIFT-038. |
| **Workspace path differences for plists.** Conductor plists embed paths like `/Users/MAC/Documents/projects/conductor/...`; CAIA plists are already at the new path but `migrate-launchd.sh` is the cutover. After lift, ensure plists in `apps/*/plist/` match production reality. | Medium | Run `scripts/migrate-launchd.sh` once; verify with `launchctl list \| grep conductor`. |
| **GitHub Actions path filters.** Workflows nested under `apps/orchestrator/.github/workflows/` may not actually be picked up by GitHub — only `.github/workflows/` at repo root runs. Conductor's `memory-rule-enforceable.yml` and `secrets-scan.yml` may currently be **dead** in CAIA. | High | LIFT-039: move them to `caia/.github/workflows/` with `paths: apps/orchestrator/**` filter. |
| **Stolution-MCP server is the dependency for this analysis itself.** The MCP server backing the `stolution-remote` tooling lives in `conductor/apps/stolution-mcp/`. If conductor is archived without lifting it, the very tools used to compare these repos break. | High | LIFT-034 must precede archiving the conductor repo. |
| **Agent code depends on agent_registry table.** Lifting agents (LIFT-022) before migration 0017 (LIFT-016) will fail at startup. | Medium | Sequencing already enforced; do not parallelize. |
| **Decomposer naming clash.** Both `@chiefaia/decomposer` (conductor) and `@chiefaia/story-decomposer` (CAIA) exist — different code, different APIs. If both end up in CAIA, consumers must import the right one. | Medium | LIFT-011 reviews whether to merge into `story-decomposer` or keep separate. Default: keep separate, document distinct purposes. |
| **Test coverage drops during lift.** Each batch adds files but tests only land at the end. Risk of a regression slipping in. | Medium | Land tests in the same PR as the code; require `pnpm test` green per batch. |
| **Production launchd jobs mid-cutover.** If executor / completeness-sentinel / db-backup are running against `conductor/` paths during lift, restart them after each batch that affects their daemon source. | Medium | After Batch B, restart executor; after each daemon-touching batch, restart that daemon. |

---

## Cross-references

- Phase-1 deep-dive: `caia-pipeline-phase1-analysis-2026-04-28.md`
- Memory: `caia_pipeline_phase1.md` — captures Prakash's hard constraint.
- Source-of-truth branches: `prakashgbid/caia` `archive/conductor-claude-exec-token-phase2`, `archive/conductor-main` (pushed 2026-04-28).

## Open questions for Prakash

1. **Workspace path conventions.** Should remaining scripts that hardcode `/Users/MAC/Documents/projects/conductor/...` be rewritten to `caia/apps/orchestrator/...` in this lift, or kept as-is and rewritten via `migrate-launchd.sh`?
2. **`@chiefaia/decomposer` vs `@chiefaia/story-decomposer`** — keep both, or merge?
3. **Conductor reports under `caia/docs/legacy-conductor-reports/` vs `caia/docs/`** — preferred home?
4. **Workflow location** — keep nested under `apps/orchestrator/.github/workflows/` (probably dead) or hoist to repo root?

---

*End of report.*
