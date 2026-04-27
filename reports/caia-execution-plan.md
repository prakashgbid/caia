# CAIA Platform: Dependency-Aware Fastest-Path Execution Plan

**Generated:** 2026-04-27  
**Horizon:** 24 weeks (12 × 2-week sprints) — ends 2026-10-11  
**Based on:** `caia-platform-architecture-proposal.md` + codebase audit + PR #43 blocker analysis

---

## ⚡ DO THIS RIGHT NOW (TODAY, 2026-04-27)

**Fix PR #43 CI failures.** Every single item in this plan is blocked until CI is green. Zero other work has leverage until the monorepo is in a deployable, clean state. Open the failing checks, fix typecheck/lint/test errors, push, and watch CI go green. Do not start any new feature work until the PR is merged.

**Also today (manual, < 5 minutes):** Disable 4 Cowork connectors in Cowork Settings UI — Kapture, Chrome Control, Notes, osascript. This is a one-time cleanup that removes background noise.

---

## Table of Contents

1. [Dependency Graph Analysis](#part-1-dependency-graph-analysis)
2. [Critical Path](#part-2-critical-path)
3. [Parallel Track Identification](#part-3-parallel-track-identification)
4. [Sprint-by-Sprint Execution Plan](#part-4-sprint-by-sprint-execution-plan)
5. [Test-Fix-Commit Protocol](#part-5-test-fix-commit-protocol)
6. [Risk Register](#part-6-risk-register)
7. [Success Metrics](#part-7-success-metrics)
8. [ASCII Gantt Chart](#appendix-ascii-gantt-chart)

---

## Part 1: Dependency Graph Analysis

### 1.1 All Discrete Work Items

#### Infrastructure & Foundation

| ID | Work Item | Status | Effort | Blocking Items |
|----|-----------|--------|--------|----------------|
| F-01 | Fix PR #43 CI (typecheck / lint / test / build) | 🚨 BLOCKER | S | Everything |
| F-02 | Disable 4 Cowork connectors (manual UI step) | 🚨 BLOCKER | XS | Cowork stability |
| F-03 | Verify monorepo structure post-merge (all imports, builds, paths) | Foundation | S | Depends on F-01 |
| F-04 | Add `initiative` to `stories.kind` enum (migration 0017) | Foundation | XS | Depends on F-01 |
| F-05 | Add `enriched_spec_json` + `parallel_batch` columns (migration 0017b) | Foundation | XS | Depends on F-01 |
| F-06 | Add `pull_requests` table (migration 0018) | Foundation | XS | Depends on F-01 |
| F-07 | Add `deployments` table (migration 0019) | Foundation | XS | Depends on F-01 |
| F-08 | Add `acceptance_reviews` table (migration 0020) | Foundation | XS | Depends on F-01 |
| F-09 | Add `releases` table (migration 0021) | Foundation | XS | Depends on F-01 |
| F-10 | Add `routing_decision` + `local_model` cols to `executor_runs` (migration 0022) | Foundation | XS | Depends on F-01 |
| F-11 | Extend events-taxonomy: 14 new event types (clarification, dag, pr, deploy, acceptance, release, prompt.completed) | Foundation | S | Depends on F-01 |
| F-12 | Executor streaming: POST outputLines to `/task-runs/{id}/output` as they arrive | Foundation | S | Depends on F-01 |
| F-13 | Add `GET /task-runs/{id}/stream` SSE endpoint in Hono | Foundation | S | Depends on F-12 |
| F-14 | Add `GET /events/stream` SSE endpoint for event feed | Foundation | S | Depends on F-01 |
| F-15 | Test coverage gate ≥ 80% on event-bus, events-taxonomy, prioritization, orchestrator-middleware | Foundation | M | Depends on F-01 |
| F-16 | Add `github_token` + `cloudflare_token` fields to `projects` table; encrypt at rest | Foundation | S | Depends on F-01 |
| F-17 | Add `build_commands` JSON config to `projects` table | Foundation | XS | Depends on F-01 |
| F-18 | Turso/libSQL support: `DATABASE_URL` env var, libSQL client adapter | Foundation | S | Can defer to Sprint 8 |

#### Core Pipeline Utilities

| ID | Work Item | Status | Effort | Key Dependencies |
|----|-----------|--------|--------|-----------------|
| P-01 | `@caia/clarifier` — AI question generator + clarity scorer | Missing | M | F-01, F-11 |
| P-02 | `@caia/decomposer` — 2-phase AI decomposer (Initiative→Epic→Module + Stories) | Missing | L | F-01, F-04, F-11 |
| P-03 | `@caia/enricher` — Per-story AI spec generator (file paths, function sigs, test cases) | Missing | M | P-02 |
| P-04 | `@caia/dag-analyzer` — Kahn's algorithm DAG + file-overlap detection + parallel batches | Missing | M | P-02, F-05 |
| P-05 | Story→Task Bridge — creates Tasks from Stories post-DAG with full dependency linkage | Missing | S | P-04 |
| P-06 | `@caia/scheduler` completion — bridge from Stories to executor queue | Partial | S | P-05 |
| P-07 | `@caia/worktree-manager` extraction — extract from executor/dispatcher.ts to standalone package | Partial | S | F-01 |
| P-08 | `@caia/pr-manager` — GitHub PR creation, AI review, diff summary, status tracking | Missing | M | F-06, F-16, P-07 |
| P-09 | `@caia/test-runner` — Auto-run Vitest/Playwright on task.completed; update behavior registry | Partial | M | P-08 |
| P-10 | `@caia/build-verifier` — Auto-run build pipeline; AI error diagnosis on failure | Partial | M | P-09 |
| P-11 | `@caia/deployment-manager` — Cloudflare Pages staging deploy, health verify | Missing | M | F-07, F-16, P-10 |
| P-12 | `@caia/acceptance-gate` — Staging notify + human decision API + event emit | Missing | M | F-08, P-11 |
| P-13 | `@caia/release-manager` — Merge PR, production deploy, tag release | Missing | S | F-09, P-12 |
| P-14 | `@caia/observability-closeout` — Final metrics, cost summary, prompt.completed event | Partial | S | P-13 |
| P-15 | `@caia/local-llm-router` — Ollama routing policy, cost-budget gating, domain exclusions | Partial | L | F-10, P-02, P-03 |
| P-16 | Ollama tool execution loop — bash/file I/O via local LLM API (replaces claude --print) | Missing | L | P-15 |
| P-17 | BullMQ mode for executor queue (behind `EXECUTOR_QUEUE=bullmq` flag) | Missing | M | F-01 |
| P-18 | NATS inter-process event transport (EventTransport abstraction) | Missing | M | F-01 |

#### Dashboard Views

| ID | Work Item | Status | Effort | Key Dependencies |
|----|-----------|--------|--------|-----------------|
| D-01 | Prompt Submission view — rich text, project selector, priority hint, cost estimate | Skeleton | S | F-01 |
| D-02 | Prompt Waterfall view — accordion Initiative→Epic→Module→Story→Task→Subtask + real-time | Skeleton | M | P-02, F-12, F-13 |
| D-03 | Task Detail view — spec, execution history, file changes, raw output, re-run controls | Skeleton | S | F-01 |
| D-04 | Live Execution view — real-time output stream, subtask list, tool calls, kill button | Skeleton | M | F-12, F-13 |
| D-05 | Test Results view — pass/fail history, flake detection, run trigger, failure excerpts | Skeleton | S | P-09 |
| D-06 | Build Status view — step-by-step output, retry controls, AI error diagnosis display | Skeleton | S | P-10 |
| D-07 | Deployment Status view — staging/prod URLs, status, rollback button | Missing | S | P-11 |
| D-08 | Human Acceptance Review view — staging preview, criteria checklist, approve/reject | Missing | M | P-12 |
| D-09 | Notifications panel — bell icon, in-app + webhook on staging ready | Missing | S | P-11 |
| D-10 | Settings page — GitHub token, Cloudflare token, executor config, build commands | Skeleton | S | F-16, F-17 |
| D-11 | Observability dashboard completion — cost breakdown by model, throughput, 30-day trend | Partial | S | P-14, P-15 |
| D-12 | Prompt History / full-text search | Missing | S | F-01 |
| D-13 | Mobile-responsive layout for waterfall + acceptance views | Missing | S | D-02, D-08 |
| D-14 | Keyboard shortcuts — submit, navigate, approve/reject | Missing | XS | D-01, D-08 |

#### Domain Taxonomy & Dedup (from domain taxonomy architecture doc)

| ID | Work Item | Status | Effort | Key Dependencies |
|----|-----------|--------|--------|-----------------|
| T-01 | Domain taxonomy baseline — canonical domain list, slug definitions, ownership rules | Missing | S | F-01 |
| T-02 | Domain classifier utility — assigns stories to domains using AI + rule-based fallback | Missing | M | T-01, P-02 |
| T-03 | Dedup engine — story-level semantic deduplication before scheduling | Missing | M | P-02, T-02 |
| T-04 | Dedup dashboard view — surfacing near-duplicate stories for human review | Missing | S | T-03 |
| T-05 | Domain heatmap integration in dashboard (file heat map already exists) | Partial | S | T-02 |
| T-06 | Lock contracts system — design standards, brand rules enforcement in decomposer | Missing | M | P-02, T-01 |

#### Agent Team (from agent team architecture doc)

| ID | Work Item | Status | Effort | Key Dependencies |
|----|-----------|--------|--------|-----------------|
| A-01 | Agent Registry — central registry of agent capabilities, tools, prompts, versions | Missing | M | F-01 |
| A-02 | Agent Scaffolder — CLI + template generator for new agents following standard conventions | Missing | M | A-01 |
| A-03 | Tier 0 — Coordinator Agent (routes prompts to right tier, manages handoffs) | Missing | M | A-01, P-02 |
| A-04 | Tier 1 — Product Owner Agent (refines requirements, generates acceptance criteria) | Missing | M | A-01, A-03 |
| A-05 | Tier 1 — Business Analyst Agent (domain modeling, data flow analysis, edge cases) | Missing | M | A-01, A-03 |
| A-06 | Tier 1 — Architect Agent (technical design, ADR drafting, stack decisions) | Missing | L | A-01, A-03 |
| A-07 | Tier 2 — Developer Agent (story execution, tool orchestration, self-checking) | Partial | M | A-01, P-02 |
| A-08 | Tier 2 — Test Engineer Agent (writes and runs test suites, interprets failures) | Missing | M | A-01, P-09 |
| A-09 | Tier 2 — Code Reviewer Agent (PR review, acceptance criteria coverage, risk flags) | Missing | M | A-01, P-08 |
| A-10 | Tier 3 — QA Agent (E2E test authoring, regression triage) | Missing | M | A-01, A-08 |
| A-11 | Tier 3 — Security Agent (OWASP checks, secret scanning, auth review) | Missing | M | A-01 |
| A-12 | Tier 3 — Performance Agent (load test design, bottleneck identification) | Missing | L | A-01 |
| A-13 | Tier 4 — Deploy Agent (orchestrates deployment-manager, verifies health) | Missing | M | A-01, P-11 |
| A-14 | Tier 4 — Monitor Agent (watches pulse runs, escalates anomalies) | Missing | M | A-01 |
| A-15 | Tier 5 — Meta/Coach Agent (improves agent prompts based on outcomes, token analysis) | Missing | L | A-01, all others |
| A-16 | Agent-to-agent communication protocol (event-bus mediated, no direct calls) | Missing | M | A-01, F-11 |
| A-17 | Agent evaluation harness — 3 example inputs per agent, output schema validation | Missing | M | A-01 |

#### Open-Source Extraction

| ID | Work Item | Status | Effort | Key Dependencies |
|----|-----------|--------|--------|-----------------|
| O-01 | Extract `@caia/event-bus` as standalone (parameterize ConductorEvent type) | Done (published) | S | Stable in prod first |
| O-02 | Extract `@caia/task-dag` (clean up for standalone; zero CAIA deps) | Missing | S | P-04 stable |
| O-03 | Extract `@caia/claude-executor` (injectable hooks, no CAIA API calls) | Partial | M | P-07, all exec stable |
| O-04 | Extract `@caia/pipeline-pulse` (injectable check implementations) | Partial | S | Stable in prod |
| O-05 | Extract `@caia/completeness-sentinel` (clean config interface) | Done (published) | S | Already external |
| O-06 | Extract `@caia/requirement-decomposer` (generalize schema) | Missing | L | P-02 stable in prod |

---

### 1.2 Classification: Critical Path / Parallel / Blocked

| Classification | Items |
|---|---|
| **Critical Path** | F-01 → F-03→F-04→F-05→F-11 → P-02 → P-03 → P-04 → P-05 → P-06 → P-09 → P-10 → P-08 → P-11 → P-12 → P-13 → P-14 |
| **Parallel Eligible (start after F-01)** | F-06 through F-17, P-01, P-07, P-17, P-18, D-01, T-01, A-01 |
| **Parallel Eligible (start after P-02)** | P-03 + P-04 simultaneously, T-02, T-06, A-03 |
| **Blocked (on Critical Path items)** | P-08 (needs F-06, F-16), P-11 (needs P-10), P-12 (needs P-11), A-04→A-15 (need A-01) |
| **Deferred (Phase 6+)** | P-15, P-16, O-01 through O-06 |

---

## Part 2: Critical Path

The critical path is the single longest sequential chain that determines the earliest possible completion date for a fully automated prompt-to-deploy pipeline.

```
Fix PR #43 CI
    ↓
Monorepo verification + Foundation migrations (F-03 → F-04, F-05, F-11)
    ↓
@caia/decomposer (Phase 1 Sonnet call + Phase 2 parallel story generation) [LONGEST SINGLE ITEM]
    ↓
@caia/enricher (parallel Haiku/Sonnet calls per Story)
    ↓
@caia/dag-analyzer (topological sort + file overlap detection)
    ↓
Story→Task Bridge + @caia/scheduler completion
    ↓
@caia/test-runner (post-execution test automation)
    ↓
@caia/build-verifier (post-test build verification)
    ↓
@caia/pr-manager (GitHub PR creation + AI review)
    ↓
@caia/deployment-manager (Cloudflare Pages staging deploy)
    ↓
@caia/acceptance-gate (human decision API + dashboard view)
    ↓
@caia/release-manager (merge + production deploy)
    ↓
@caia/observability-closeout (metrics + prompt.completed)
    ↓
FIRST FULLY AUTOMATED PROMPT → DEPLOYED FEATURE
```

**Estimated critical path duration: 18–20 weeks** (assuming F-01 fixed in week 1).

**The decomposer (P-02) is the single most critical item on the path.** It unlocks everything downstream and has the highest implementation risk. All efforts to parallelise work elsewhere are secondary to shipping P-02.

---

## Part 3: Parallel Track Identification

### Track A — Core Pipeline (Critical Path)
The main artery. All other tracks feed into or support this one.

Items: F-01 → F-03..F-11 → P-02 → P-03 → P-04 → P-05 → P-06 → P-09 → P-10 → P-08 → P-11 → P-12 → P-13 → P-14

### Track B — Domain Taxonomy + Classifier + Dedup
Can start in Sprint 2 (after F-01 merged). Produces the domain taxonomy that feeds into P-02's project context. A 9-week effort running in parallel with the core pipeline.

Items: T-01 → T-02 → T-03 → T-04 → T-05 → T-06

### Track C — Dashboard Enhancements
Runs continuously. Each dashboard view unblocks as its data source becomes available. Can start immediately after F-01.

Items: D-01 → D-03 → D-10 → D-12 → D-02 (needs P-02) → D-04 (needs F-12) → D-05 (needs P-09) → D-06 (needs P-10) → D-07 (needs P-11) → D-08 (needs P-12) → D-09 → D-11 → D-13 → D-14

### Track D — Agent Team Infrastructure
Starts after F-01 and begins once the orchestration model (P-02) is working. Adds the multi-agent layer on top of the pipeline.

Items: A-01 → A-02 → A-16 → A-03 → A-04 → A-05 → A-06 → A-07 → A-08 → A-09 → A-10 → A-11 → A-12 → A-13 → A-14 → A-15 → A-17

### Track E — Testing Infrastructure, Local LLM, Open Source
Runs in the final 8 weeks. Requires a working end-to-end pipeline as its foundation.

Items: P-17 → P-18 → P-15 → P-16 → O-01..O-06

---

## Part 4: Sprint-by-Sprint Execution Plan

### Sprint 1 — 2026-04-27 to 2026-05-10
**Theme: UNBLOCK EVERYTHING — Fix CI, harden foundation**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **F-01: Fix PR #43 CI** | A | S | None | F-02 | Human + Claude Code | All CI checks (Build, Test, Lint, Typecheck) green. PR merged to main. | All pre-existing tests pass | git push → CI green → merge |
| **F-02: Disable 4 Cowork connectors** | Ops | XS | None | F-01 | Human (manual UI) | Kapture, Chrome Control, Notes, osascript disabled in Cowork Settings. | N/A | N/A (UI action) |
| **F-03: Monorepo post-merge verification** | A | S | F-01 | F-04..F-11 | Claude Code | `pnpm build` exits 0 from root. All packages resolve. No phantom imports. | `pnpm typecheck && pnpm test` from root pass | git commit "chore: post-merge monorepo cleanup" |
| **F-04: Migration 0017 — `initiative` kind** | A | XS | F-01 | F-05..F-11 | Claude Code | Drizzle push succeeds. `stories.kind` accepts 'initiative'. Backfill runs on empty set (no existing initiatives). | Drizzle schema test | git commit "feat(db): add initiative kind to stories" |
| **F-05: Migration 0017b — `enriched_spec_json`, `parallel_batch`** | A | XS | F-01 | F-04 | Claude Code | Columns added to `stories`. Old rows default to null. Drizzle push clean. | Schema integrity test | git commit "feat(db): story enrichment columns" |
| **F-11: Extend events-taxonomy (14 new types)** | A | S | F-01 | F-04 | Claude Code | All 14 new types in `registry.yaml` + TypeScript type definitions. Existing event consumers compile without changes. | `pnpm typecheck` on events-taxonomy passes | git commit "feat(events): add pipeline stage event types" + `pnpm publish` `@caia/events-taxonomy` v bump |
| **F-06..F-10: Migrations 0018-0022** | A | S | F-01 | F-04, F-11 | Claude Code | All 5 migrations run cleanly. Drizzle push succeeds. Schemas match appendix A specs. | Drizzle schema test for each | git commit "feat(db): pr/deployment/acceptance/release/llm tables" |
| **D-01: Prompt Submission view** | C | S | F-01 | D-03 | Claude Code | `/prompts/new` renders, validates input, POSTs to API, redirects to prompt detail. Handles error state. Character count live. | Component render test + API integration test | git commit "feat(dashboard): prompt submission view" |
| **D-03: Task Detail view** | C | S | F-01 | D-01 | Claude Code | `/tasks/[id]` renders all fields. Re-run button works. Edit notes inline editor saves. | Render test + mock data fixture | git commit "feat(dashboard): task detail view completion" |

**Sprint 1 Success Gate:** PR #43 merged, CI green, root `pnpm build` clean, all 6 migrations applied, events-taxonomy published.

---

### Sprint 2 — 2026-05-11 to 2026-05-24
**Theme: FOUNDATIONS COMPLETE — Executor streaming, settings, domain taxonomy begins**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **F-12: Executor streaming — POST outputLines** | A | S | F-01 | F-13, F-14 | Claude Code | Executor POSTs each output line to `/task-runs/{id}/output` as it arrives (not at completion). API stores in `task_run_output_lines` table. | Integration test: run a real short task, verify lines arrive before completion event | git commit "feat(executor): stream output lines to API" |
| **F-13: SSE endpoint `GET /task-runs/{id}/stream`** | A | S | F-12 | F-14 | Claude Code | Endpoint streams `outputLines` as `data:` SSE events. Client EventSource reconnects on drop. | SSE integration test | git commit "feat(api): task-run SSE stream endpoint" |
| **F-14: SSE endpoint `GET /events/stream`** | A | S | F-01 | F-12 | Claude Code | Endpoint streams all bus events filtered by optional `type` query param. | SSE integration test | git commit "feat(api): event stream SSE endpoint" |
| **F-15: Test coverage gate ≥ 80%** | A | M | F-01 | F-12..F-14 | Claude Code | Vitest coverage report shows ≥ 80% on event-bus, events-taxonomy, prioritization packages. Enforced via `gate:coverage` script in CI. | Coverage report artifact in CI | git commit "test: enforce 80% coverage gate on core packages" |
| **F-16: GitHub + Cloudflare token fields in projects** | A | S | F-01 | F-17 | Claude Code | `projects` table has `github_token_encrypted`, `cloudflare_api_token_encrypted` columns. Settings API encrypts/decrypts with `ENCRYPTION_KEY` env var. | Encryption round-trip test | git commit "feat(db): project credential storage" |
| **F-17: `build_commands` config in projects** | A | XS | F-01 | F-16 | Claude Code | `projects.build_commands` JSON column. Default: `[{name:"typecheck",cmd:"pnpm typecheck"},{name:"test",cmd:"pnpm test"},{name:"build",cmd:"pnpm build"}]` | Schema test | git commit "feat(db): per-project build commands" |
| **P-07: Extract `@caia/worktree-manager`** | A | S | F-01 | F-12..F-17 | Claude Code | `packages/worktree-manager/` package. `createWorktree`, `cleanupWorktree`, `listWorktrees` extracted from `apps/executor/dispatcher.ts`. Executor imports from package. | Unit tests for create/cleanup lifecycle | git commit + `pnpm publish` `@caia/worktree-manager` |
| **T-01: Domain taxonomy baseline** | B | S | F-01 | F-12..P-07 | Human + Claude Code | `domains` table populated with canonical domain list + slugs + ownership rules. CLAUDE.md in orchestrator updated with domain taxonomy reference. | Domain slug uniqueness test | git commit "feat(domains): canonical taxonomy v1" |
| **D-10: Settings page** | C | S | F-16, F-17 | D-01 | Claude Code | `/settings` page renders project config form. GitHub token field saves/loads (masked). Build commands editable JSON. Cloudflare token field. | Form submit test | git commit "feat(dashboard): settings page" |
| **A-01: Agent Registry** | D | M | F-01 | T-01 | Claude Code | `packages/agent-registry/` package. Schema: `agents` table with id, name, tier, system_prompt, tools[], version, created_at. CRUD API at `/agents`. Type-safe `AgentManifest` interface. | Unit tests for registry CRUD | git commit + `pnpm publish` `@caia/agent-registry` |

**Sprint 2 Success Gate:** Executor streams output in real-time. F-15 coverage gate enforced in CI. Agent registry published.

---

### Sprint 3 — 2026-05-25 to 2026-06-07
**Theme: THE DECOMPOSER — the most important two weeks in the roadmap**

The decomposer is the single hardest and most valuable item. Deserves a full sprint. Do not split focus.

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **P-02: `@caia/decomposer` Phase 1** | A | L | F-04, F-05, F-11 | T-02 starts | Claude Code | Phase 1: given a prompt + project context, Sonnet call returns structured JSON with Initiative + Epics + Modules. JSON conforms to `DecompositionTree` schema (JSON Schema validation). All nodes written to `stories` table with `rootPromptId`. `story.created` emitted per node. | Eval suite: 5 representative prompts decomposed. Assert: ≥ 1 Initiative, ≥ 2 Epics, ≥ 3 Modules per complex prompt. Schema validation 100%. | git commit "feat(decomposer): phase 1 initiative+epic+module" |
| **P-02: `@caia/decomposer` Phase 2** | A | L | P-02 Phase 1 | T-02 | Claude Code | Phase 2: parallel Sonnet/Haiku calls — one per Module — produce Stories. Each Story has: title, description, expectedBehavior, acceptanceCriteria[], verificationPlan[], estimatedFiles[], dependsOn[], domainSlug. Leaf stories written to `stories` table. `pipeline.decompose_completed` emitted. | Eval suite expanded to 10 prompts. Assert: Stories have all required fields (100%), estimatedFiles non-empty (90%), domainSlug resolves to a valid domain (80%). Decomposition completes in < 60 seconds. | git commit "feat(decomposer): phase 2 parallel story generation" + `pnpm publish` `@caia/decomposer` |
| **T-02: Domain classifier** | B | M | T-01, P-02 | P-02 | Claude Code | Given a Story title + description + estimatedFiles[], classifier assigns `domainSlug`. Two modes: AI (Haiku) + rule-based fallback (file path prefix matching). 85%+ accuracy on 20 manually-labeled test stories. | 20-story labeled test set. Classifier accuracy ≥ 85%. | git commit "feat(classifier): domain assignment utility" |
| **A-02: Agent Scaffolder** | D | M | A-01 | P-02 | Claude Code | `packages/agent-scaffolder/` CLI: `pnpm agent:new --name=<name> --tier=<0-5>` generates: system prompt template, manifest file, eval fixture dir, package.json stub. Registers agent in registry on create. | Scaffolder creates valid manifest. Agent passes typecheck. | git commit + `pnpm publish` `@caia/agent-scaffolder` |

**Sprint 3 Success Gate:** A prompt submitted to the API results in a full Initiative→Epic→Module→Story tree in the `stories` table. Eval suite green on 10 prompts.

---

### Sprint 4 — 2026-06-08 to 2026-06-21
**Theme: ENRICHMENT + DAG — turn stories into actionable specs**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **P-03: `@caia/enricher`** | A | M | P-02 | P-04, P-01 | Claude Code | Subscribes to `pipeline.decompose_completed`. For each leaf Story: calls Claude (Haiku for trivial/simple, Sonnet for moderate/complex based on `estimatedComplexity`). Output stored in `stories.enriched_spec_json`. Fields: implementationNotes, fileChanges[], testCases[], dependenciesRequired[], recommendedModel. All stories enriched before emitting `story.enrichment_completed`. | Enrichment produces non-empty `fileChanges` for 95% of stories. `recommendedModel` set for 100% of stories. | git commit + `pnpm publish` `@caia/enricher` |
| **P-04: `@caia/dag-analyzer`** | A | M | P-02, F-05 | P-03, P-01 | Claude Code | Implements Kahn's algorithm on `stories.dependsOn[]`. Detects file-overlap implicit dependencies (two stories touching the same file → story with create/schema change goes first). Validates: no cycles (halts with `pipeline.dag_error` if found). Writes `stories.parallel_batch` (integer, 0-indexed topological level). Emits `pipeline.dag_computed`. | Cycle detection test (inject known cycle, assert error). Parallel batch assignment test (known DAG, assert batches). File overlap test. | git commit + `pnpm publish` `@caia/dag-analyzer` |
| **P-05 + P-06: Story→Task Bridge + Scheduler completion** | A | S | P-04 | P-03 | Claude Code | After `pipeline.dag_computed`: for each leaf Story, creates a `tasks` row with: `title`, `notes` (enriched spec JSON), `declaredFiles`, `dependsOn`, `priorityBucket`, `positionOrdinal`, `rootPromptId`, `domainSlug`. Links to parent story via `storyId` FK. Emits `task.created` + `task.queued` per task. Executor picks up queued tasks on next poll. | Integration test: decompose sample prompt → verify task count matches story count, all priority buckets set, all dependsOn chains valid. | git commit "feat(pipeline): story-task bridge + scheduler wiring" |
| **P-01: `@caia/clarifier`** | A | M | F-11 | P-03, P-04 | Claude Code | Subscribes to `prompt.ingested`. Computes `clarityScore` (0–1) via Haiku. If `score < 0.85`: generates up to 5 targeted questions (priority: critical/normal/optional). Writes to `questions` table. Emits `prompt.clarification_started`. On all critical questions answered (or `canSkip: true`): emits `prompt.clarification_completed` which triggers decomposer. | Clarity score test: unambiguous prompt → score > 0.85 (skips). Ambiguous prompt → score < 0.85, generates questions. | git commit + `pnpm publish` `@caia/clarifier` |
| **T-03: Dedup engine** | B | M | P-02, T-02 | P-03 | Claude Code | Before scheduling, scan new stories against existing completed stories for semantic duplicates (cosine similarity on embeddings via Haiku). Flag near-duplicates (similarity > 0.85) with `duplicate_of` reference. Emit `story.duplicate_flagged`. | Dedup test: submit same requirement twice, second run flags stories as duplicates. | git commit "feat(dedup): semantic story deduplication" |
| **D-02: Prompt Waterfall view — Phase 1** | C | M | P-02 | P-03 | Claude Code | `/prompts/[id]` renders: header card, pipeline stage progress bar, accordion tree (Initiative→Epic→Module→Story). Static data (no real-time yet). Uses `/prompts/:id/pipeline` API. | Render test with fixture data covering all hierarchy levels. Empty state handled. Error state handled. | git commit "feat(dashboard): prompt waterfall accordion tree" |
| **A-03: Coordinator Agent** | D | M | A-01, A-02 | P-03 | Claude Code | Tier 0 agent: receives a prompt classification signal, routes to the right tier-1 agent (PO/BA/Architect) based on prompt type. System prompt written + evaluated against 3 representative inputs. Registered in agent-registry. | 3 eval fixtures pass. Agent returns valid `AgentHandoff` schema. | git commit "feat(agents): coordinator agent tier-0" |

**Sprint 4 Success Gate:** Full pipeline from `prompt.ingested` → clarification → decomposition → enrichment → DAG → tasks queued. Executor can pick up and run these tasks. End-to-end: submit a prompt, get running tasks.

---

### Sprint 5 — 2026-06-22 to 2026-07-05
**Theme: EXECUTION LOOP CLOSED — first prompt runs tasks end-to-end**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **Integration test: full prompt→tasks pipeline** | A | S | P-01..P-06 | P-09 starts | Human + Claude Code | Submit a real test prompt. Verify: clarification check runs, decomposition produces valid tree, enrichment completes, DAG computed with batches, tasks created and queued, executor picks up and starts first batch. All events emitted in correct order. | End-to-end integration test in `apps/orchestrator/test/e2e/` | git commit "test(e2e): prompt to task execution pipeline" |
| **P-09: `@caia/test-runner`** | A | M | P-08 scaffolding (partial — doesn't need full PR yet) | P-10 | Claude Code | Daemon subscribes to `task.completed`. Runs `vitest run --reporter=json --related <changedFiles>`. Parses JSON output. Updates `behavior_test_runs`. Creates blocker entries for failures. Flake detection: re-run failing tests ≤ 2 times; classify as `flake` if inconsistent. Emits `pipeline.tests_completed` (all pass) or `pipeline.tests_failed`. | Test runner runs on sample project with known test suite. Passes/fails/skips counted correctly. Flake classifier correctly identifies non-deterministic test (mock timer). | git commit + `pnpm publish` `@caia/test-runner` |
| **P-10: `@caia/build-verifier`** | A | M | P-09 | P-08 | Claude Code | Subscribes to `pipeline.tests_completed`. Runs configured build commands from `projects.build_commands` in sequence. Captures stdout/stderr per step. Persists to `build_runs`/`build_steps`. On failure: calls Claude Sonnet to diagnose error signature, creates a fix task via `POST /tasks`. Emits `build.completed` (pass) or `build.failed`. | Build verifier runs against a project with a known passing build. Also: inject a type error, verify Sonnet diagnoses it and creates a fix task. | git commit + `pnpm publish` `@caia/build-verifier` |
| **D-04: Live Execution view** | C | M | F-12, F-13 | P-09, P-10 | Claude Code | `/tasks/[id]/live` renders: terminal-style output stream (auto-scroll), subtask checklist, current tool call, files touched, turn counter, kill button. Connects to SSE stream endpoint. | SSE connection test. Kill button sends SIGTERM and updates status. | git commit "feat(dashboard): live execution view" |
| **D-05: Test Results view** | C | S | P-09 | D-06 | Claude Code | `/tests` renders behavior test registry: pass/fail history, flake badge, run trigger button, failure excerpts. Filter by project/scope/status. | Render test with fixture data. Run trigger fires correct API call. | git commit "feat(dashboard): test results view" |
| **T-04: Dedup dashboard view** | B | S | T-03 | T-05 | Claude Code | Dashboard panel showing near-duplicate story pairs with similarity score. Human can dismiss (keep both) or merge (mark one as `superseded`). | Render test. Dismiss + merge actions update DB correctly. | git commit "feat(dashboard): dedup review panel" |
| **A-04: Product Owner Agent** | D | M | A-01, A-03 | A-05 | Claude Code | Tier 1 agent: refines vague requirements, generates detailed acceptance criteria, identifies scope boundaries. Integrates with clarifier output. 3 eval fixtures pass. | 3 eval fixtures | git commit "feat(agents): product owner agent tier-1" |
| **A-05: Business Analyst Agent** | D | M | A-01, A-03 | A-04 | Claude Code | Tier 1 agent: domain modeling, data flow analysis, edge case identification, constraint documentation. 3 eval fixtures pass. | 3 eval fixtures | git commit "feat(agents): business analyst agent tier-1" |

**Sprint 5 Success Gate:** A real prompt flows all the way to task execution AND test runner runs automatically after. Tests are reported in the dashboard.

---

### Sprint 6 — 2026-07-06 to 2026-07-19
**Theme: QUALITY GATES — build verification, hardening, streaming complete**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **Build verification integration + hardening** | A | S | P-10 | P-08 | Claude Code | Build verifier integrated into pipeline. Pulse check added for build verifier health. Auto-fix task creation for type errors tested with real failures. | Pulse check passes. Auto-fix task created for injected error. | git commit "feat(pulse): build verifier health check" |
| **D-06: Build Status view** | C | S | P-10 | D-07 | Claude Code | `/builds` renders step-by-step output, retry controls, AI error diagnosis display, duration per step. | Render test. Retry button fires API. | git commit "feat(dashboard): build status view" |
| **D-02 Part 2: Waterfall real-time updates** | C | M | F-13, F-14 | D-04 | Claude Code | Prompt waterfall connects to SSE `/events/stream` filtered by `correlationId`. Active executing nodes show pulsing indicator. Live subtask list updates. | SSE integration test: events arrive, nodes update without page reload. | git commit "feat(dashboard): waterfall real-time via SSE" |
| **T-05: Domain heatmap integration** | B | S | T-02 | T-06 | Claude Code | File heatmap in observability dashboard now shows domain overlay — which domains are changing most frequently per sprint. | Render test with fixture data. | git commit "feat(dashboard): domain heatmap overlay" |
| **T-06: Lock contracts system** | B | M | P-02, T-01 | T-05 | Claude Code | `lock_contracts` table: id, domain, rule, severity (block/warn), created_by. API: `GET/POST /lock-contracts`. Decomposer reads active contracts as project context. Contract violations flagged in decomposition output. | Lock contract violation detected in decomposer test prompt. API CRUD tests. | git commit "feat(lock-contracts): design rules enforcement" |
| **A-06: Architect Agent** | D | L | A-01, A-03 | A-08 | Claude Code | Tier 1 agent: produces ADR drafts, stack decisions, component boundary analysis, dependency tree for new features. 3 eval fixtures. | 3 eval fixtures | git commit "feat(agents): architect agent tier-1" |
| **A-16: Agent-to-agent communication protocol** | D | M | A-01, F-11 | A-06 | Claude Code | Agents communicate via event bus only (no direct function calls). Protocol: `agent.handoff_requested`, `agent.handoff_completed`, `agent.blocked`. Each handoff carries: from_agent, to_agent, context_payload, correlation_id. | Round-trip handoff test: Coordinator → PO Agent → BA Agent. Events appear in timeline. | git commit "feat(agents): event-bus mediated handoff protocol" |

**Sprint 6 Success Gate:** Build failures create auto-fix tasks. Waterfall view updates in real-time. Lock contracts block invalid decompositions.

---

### Sprint 7 — 2026-07-20 to 2026-08-02
**Theme: GITHUB INTEGRATION — PR creation closes the execution loop**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **P-08: `@caia/pr-manager`** | A | M | F-06, F-16, P-07 | P-11 scaffolding | Claude Code | Subscribes to `build.completed`. Pushes worktree branch: `git push origin HEAD:refs/heads/task-{taskId}`. Creates GitHub PR via `@octokit/rest` with auto-generated description (story title + acceptance criteria + changed files + execution summary). Runs AI review (Sonnet reads diff → structured review JSON → posted as PR comments). Tracks PR in `pull_requests` table. Emits `pr.created`. Exponential backoff on GitHub API rate limit. | PR creation: mock `@octokit/rest`, verify PR body format. AI review: mock Sonnet, verify comments posted. Rate limit retry test. | git commit + `pnpm publish` `@caia/pr-manager` |
| **GitHub integration configuration** | A | S | F-16, P-08 | P-08 | Human + Claude Code | `GITHUB_TOKEN` env var wired. Repository URL in projects table for test project. Settings page shows GitHub connection status (✓ Connected / ✗ Not configured). | OAuth token validation API test | git commit "feat(settings): github integration status" |
| **A-07 hardening: Developer Agent** | D | M | A-01, P-02 | P-08 | Claude Code | Existing executor upgraded with agent-registry-registered Developer Agent manifest. System prompt: includes project context, lock contracts, acceptance criteria, enriched spec. Self-checking: after execution, verifies acceptance criteria coverage. 3 eval fixtures. | 3 eval fixtures passing. Self-check catches a deliberately incomplete implementation. | git commit "feat(agents): developer agent v2 with self-check" |
| **A-08: Test Engineer Agent** | D | M | A-01, P-09 | A-09 | Claude Code | Tier 2 agent: writes test suites for new features based on acceptance criteria. Interprets test failures and proposes fixes. 3 eval fixtures. | 3 eval fixtures | git commit "feat(agents): test engineer agent tier-2" |
| **A-09: Code Reviewer Agent** | D | M | A-01, P-08 | A-08 | Claude Code | Tier 2 agent: reviews PRs against acceptance criteria, flags risks, generates structured review JSON. Powers `@caia/pr-manager`'s AI review step. 3 eval fixtures. | 3 eval fixtures | git commit "feat(agents): code reviewer agent tier-2" |
| **D-12: Prompt History / full-text search** | C | S | F-01 | D-07 | Claude Code | Search bar on `/prompts` does FTS on `prompts.body` + story titles. Results highlight matching text. Cursor-based pagination. | Search returns correct results for keyword. Empty query returns recent prompts. | git commit "feat(dashboard): full-text prompt search" |

**Sprint 7 Success Gate:** A completed task automatically creates a GitHub PR with AI review comments. PR visible in dashboard linked to the prompt.

---

### Sprint 8 — 2026-08-03 to 2026-08-16
**Theme: STAGING DEPLOYMENT — close the automated pipeline through staging**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **P-11: `@caia/deployment-manager`** | A | M | F-07, F-16, P-10 | P-12 | Claude Code | Subscribes to `pr.created`. Runs `wrangler pages deploy <artifact-path> --project-name=<name> --branch=staging`. Polls for deployment status. On live: verifies staging URL returns HTTP 200. Captures `stagingUrl`. Records in `deployments` table. Emits `deployment.completed`. Uses `DeploymentProvider` interface (supports Cloudflare Pages now, extensible to GCP/Railway). | Deployment mock: mock `wrangler` CLI, verify command construction. Health check: mock HTTP, verify 200 and non-200 cases. | git commit + `pnpm publish` `@caia/deployment-manager` |
| **Cloudflare Pages configuration** | A | S | F-16, P-11 | P-11 | Human + Claude Code | Cloudflare API token added to test project. Wrangler installed in executor environment. Staging project created in Cloudflare dashboard (one-time manual step per target project). | Wrangler auth test | git commit "feat(deploy): cloudflare pages wrangler integration" |
| **F-18: Turso/libSQL support** | A | S | F-01 | P-11 | Claude Code | `DATABASE_URL` env var. If starts with `libsql://`: use `@libsql/client`. Else: use `better-sqlite3`. Drizzle config switches adapter. Zero schema changes. | Turso connection test (use Turso free tier). Existing tests still pass on SQLite. | git commit "feat(db): turso/libsql support" |
| **D-07: Deployment Status view** | C | S | P-11 | D-08 | Claude Code | `/deployments` renders table: prompt, project, environment, URL, status badge, deployed-at, PR link. Rollback button (sends revert + redeploy). "Open staging URL" link. | Render test. Rollback fires correct API. | git commit "feat(dashboard): deployment status view" |
| **D-09: Notifications panel** | C | S | P-11 | D-08 | Claude Code | Bell icon top-right with unread count. Notifications created on: staging ready, task failure, build failure. Optional webhook config (Slack URL). | Notification created on `deployment.completed`. Webhook payload test. | git commit "feat(dashboard): notifications panel + webhook" |
| **A-10: QA Agent** | D | M | A-01, A-08 | A-11 | Claude Code | Tier 3 agent: E2E test authoring using Playwright, regression triage. 3 eval fixtures. | 3 eval fixtures | git commit "feat(agents): qa agent tier-3" |
| **A-11: Security Agent** | D | M | A-01 | A-10 | Claude Code | Tier 3 agent: OWASP checks, secret scanning (no secrets committed), auth/authz review. Runs on every PR diff. 3 eval fixtures. | 3 eval fixtures. Secret detection catches injected dummy secret. | git commit "feat(agents): security agent tier-3" |

**Sprint 8 Success Gate:** A completed build is automatically deployed to Cloudflare Pages staging. Staging URL appears in the dashboard with a notification.

---

### Sprint 9 — 2026-08-17 to 2026-08-30
**Theme: HUMAN GATE + RELEASE — first fully automated prompt→production cycle**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **P-12: `@caia/acceptance-gate`** | A | M | F-08, P-11 | P-13 | Claude Code | Subscribes to `deployment.completed`. Calls Claude Sonnet to generate acceptance report (what changed, criteria provably met, criteria needing manual check). Creates notification. Waits for human decision via `POST /prompts/:id/accept` or `/reject`. On accept: emits `human.acceptance_granted`. On reject: emits `human.acceptance_rejected` → re-queues failed acceptance criteria as new stories. On `approved_with_changes`: emits grant + creates follow-up stories. | Acceptance report generation test. Accept/reject API test. Re-queue-on-reject: verify new stories created with correct parent linkage. | git commit + `pnpm publish` `@caia/acceptance-gate` |
| **P-13: `@caia/release-manager`** | A | S | F-09, P-12 | P-14 | Claude Code | Subscribes to `human.acceptance_granted`. Merges PR via GitHub API (`octokit.pulls.merge`). Triggers production Cloudflare Pages deploy. Verifies production health (HTTP 200 on production URL). Tags release: `v<semver>-prompt-<promptId>`. Records in `releases` table. Emits `release.completed`. | Merge mock: verify merge commit captured. Release tag format test. Production health check test. | git commit + `pnpm publish` `@caia/release-manager` |
| **P-14: `@caia/observability-closeout`** | A | S | P-13 | P-12 | Claude Code | Subscribes to `release.completed`. Computes: totalDurationMs, totalCostUsd (sum of `executor_runs.cost_usd`), totalTokens, filesChanged, storiesDelivered, stagesCompleted. Writes to `prompt_pipeline_stages` (all stages closed). Emits `prompt.completed`. | Closeout computes correct totals against fixture data. `prompt.completed` event emitted. | git commit + `pnpm publish` `@caia/observability-closeout` |
| **D-08: Human Acceptance Review view** | C | M | P-12 | P-13 | Claude Code | `/prompts/[id]/review` renders: staging URL with iframe preview (configurable), PR diff summary, acceptance criteria checklist (provably met / manual check / failed), AI acceptance report, test results summary, build status, cost incurred. Approve / Reject with feedback / Approve with changes buttons. | Render test. Approve fires `POST /prompts/:id/accept`. Reject opens feedback textarea and fires `/reject`. | git commit "feat(dashboard): human acceptance review view" |
| **🎯 MILESTONE: First fully automated prompt→production run** | A | — | P-12, P-13, P-14, D-08 | — | Human | Submit a real (non-trivial) prompt. Observe: clarification → decomposition → enrichment → dag → tasks → execution → test → build → PR → staging → human approval → production. Total time < 2 hours. Zero manual steps except the approve button. | End-to-end integration test (CI-safe mock for deploy/PR steps) | Document the run in a MILESTONE-2026-08.md report |
| **A-13: Deploy Agent** | D | M | A-01, P-11 | A-14 | Claude Code | Tier 4 agent: orchestrates deployment-manager, verifies deployment health, escalates on timeout. 3 eval fixtures. | 3 eval fixtures | git commit "feat(agents): deploy agent tier-4" |
| **A-14: Monitor Agent** | D | M | A-01 | A-13 | Claude Code | Tier 4 agent: watches pulse runs, escalates anomalies to notifications, proposes auto-heal actions. 3 eval fixtures. | 3 eval fixtures | git commit "feat(agents): monitor agent tier-4" |

**Sprint 9 Success Gate: 🏆 MVP. A human submits a prompt and a feature is live in production with zero manual intervention except the approve button. This is the platform's north star.**

---

### Sprint 10 — 2026-08-31 to 2026-09-13
**Theme: DASHBOARD COMPLETION + POLISH**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **D-11: Observability dashboard — cost by model** | C | S | P-14 | D-13 | Claude Code | Cost breakdown chart: Haiku/Sonnet/Opus/Local per day. 30-day cost trend line. Monthly projection (linear extrapolation). | Render test with fixture cost data. | git commit "feat(dashboard): cost breakdown by model" |
| **D-13: Mobile-responsive layout** | C | S | D-02, D-08 | D-14 | Claude Code | Waterfall view + acceptance view render correctly on 375px viewport. No horizontal scroll. Accordion tree collapses to compact mode on mobile. | Playwright mobile viewport test. | git commit "feat(dashboard): mobile responsive layout" |
| **D-14: Keyboard shortcuts** | C | XS | D-01, D-08 | D-13 | Claude Code | `Cmd+Enter` submits prompt. `J/K` navigates stories in waterfall. `A` approves, `R` rejects (on review view). Shortcuts shown in tooltips. | Keyboard interaction test. | git commit "feat(dashboard): keyboard shortcuts" |
| **P-17: BullMQ mode** | E | M | F-01 | P-18 | Claude Code | `EXECUTOR_QUEUE=bullmq` enables BullMQ worker. Upstash Redis connection via `REDIS_URL`. Jobs have priority, TTL, retry backoff. Polling mode retained as default. | BullMQ mode integration test: enqueue + process + complete job. | git commit "feat(executor): bullmq queue mode" |
| **P-18: NATS inter-process event transport** | E | M | F-01 | P-17 | Claude Code | `EventTransport` abstraction added to `@caia/event-bus`. `NatsEventTransport` implementation: publishes to NATS JetStream, subscribes via NATS consumer. In-process `EventEmitter` retained as default. | NATS transport round-trip test. Existing in-process tests still pass. | git commit + version bump `@caia/event-bus` |
| **A-17: Agent evaluation harness** | D | M | A-01, all agents | A-15 | Claude Code | `packages/agent-eval/` package: runs each registered agent against its 3 eval fixtures, validates output conforms to schema, reports pass/fail. CI step: `pnpm agent:eval` runs harness. | All 15 agents pass their 3 eval fixtures. | git commit + `pnpm publish` `@caia/agent-eval` |
| **A-12: Performance Agent** | D | L | A-01 | A-15 | Claude Code | Tier 3 agent: load test design, bottleneck identification, query performance analysis. 3 eval fixtures. | 3 eval fixtures | git commit "feat(agents): performance agent tier-3" |

---

### Sprint 11 — 2026-09-14 to 2026-09-27
**Theme: LOCAL LLM + AGENT TEAM COMPLETION**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **P-15: `@caia/local-llm-router`** | E | L | F-10, P-02, P-03 | P-16 | Claude Code | Routing policy: budget-based, complexity-based, domain-exclusion-based. Config via Settings page. Routes to Ollama `http://localhost:11434/v1`. Records `routing_decision` + `local_model` in `executor_runs`. Falls back to Claude if local is unavailable. | Routing policy tests: budget-exceeded → local, security domain → Claude always, complexity < 0.4 → local. | git commit + `pnpm publish` `@caia/local-llm-router` |
| **P-16: Ollama tool execution loop** | E | L | P-15 | A-15 | Claude Code | When `routing_decision = 'local'`: invokes Ollama OpenAI-compatible API. Implements tool execution loop: send prompt → parse tool calls → execute tools (bash, file read/write) → send results → loop until `[result]` marker. Tested on `qwen2.5-coder:7b`. | Tool loop test: verify bash execution works, file write works, result marker terminates loop. Quality check: qwen2.5 solves a sample boilerplate task. | git commit "feat(executor): ollama tool execution loop" |
| **A-15: Meta/Coach Agent** | D | L | A-01, A-17 | P-16 | Claude Code | Tier 5 agent: analyzes eval scores + token usage + task success rates. Proposes system prompt improvements for underperforming agents. Runs weekly as a scheduled task. 3 eval fixtures. | Coach agent produces improvement suggestions for a deliberately degraded agent prompt. | git commit "feat(agents): meta coach agent tier-5" |
| **A-16 hardening: Communication protocol v2** | D | S | A-16 v1 | A-15 | Claude Code | Add `agent.error` + `agent.retry_requested` events. Coordinator handles retry routing. Circuit breaker: if agent fails 3× on same input, escalate to human. | Retry loop test. Circuit breaker fires after 3 failures. | git commit "feat(agents): handoff protocol v2 with circuit breaker" |
| **Cost dashboard + 40% reduction target** | E | S | P-14, P-15 | P-16 | Human + Claude Code | Settings page shows current month cost, projected month cost, savings from local LLM routing (actual vs if-all-Claude). Alert threshold configurable. | Savings calculation test. | git commit "feat(dashboard): llm cost savings tracker" |

---

### Sprint 12 — 2026-09-28 to 2026-10-11
**Theme: OPEN SOURCE EXTRACTION + FINAL POLISH**

| Work Item | Track | Effort | Dependencies | Parallel With | Owner | Definition of Done | Tests Required | Commit/Publish |
|-----------|-------|--------|-------------|---------------|-------|-------------------|----------------|----------------|
| **O-02: Extract `@caia/task-dag`** | E | S | P-04 stable | O-03 | Claude Code | `packages/task-dag/` — zero CAIA dependencies. Generic TypeScript DAG: `build`, `validate`, `topologicalSort`, `criticalPath`. Public API via JSDoc. README with standalone example. | All DAG tests pass with no CAIA imports. | `pnpm publish` `@caia/task-dag` standalone |
| **O-03: Extract `@caia/claude-executor`** | E | M | P-07, full exec stable | O-04 | Claude Code | Injectable hooks: `onTaskComplete`, `promptBuilder`, `onOutputLine`. No CAIA API calls in core. README + standalone example (50-line demo). | Standalone example runs with no monorepo dependencies. | `pnpm publish` `@caia/claude-executor` standalone |
| **O-04: Extract `@caia/pipeline-pulse`** | E | S | Stable in prod | O-06 | Claude Code | Injectable check implementations. Standalone: `createPulse({ checks: [...], canary: () => ... })`. | Standalone example runs. | `pnpm publish` `@caia/pipeline-pulse` standalone |
| **O-06: `@caia/requirement-decomposer` extraction begins** | E | L | P-02 stable in prod | O-02..O-04 | Claude Code | Parameterize hierarchy schema (Initiative/Epic/Module/Story ← generic level names). Separate CAIA-specific context from core decomposer logic. README drafted. | Core decomposer tests pass with generic schema. Apache 2.0 LICENSE. | git commit "feat(oss): requirement-decomposer extraction" (publish in Sprint 13 if needed) |
| **Platform documentation** | E | M | All above | O-06 | Claude Code | `docs/` directory: Getting Started, Architecture Overview, Utility Catalogue, API Reference, Agent Team Reference, Plugin Development Guide. | Docs build via `pnpm docs:build`. All links resolve. | git commit "docs: platform documentation v1" |
| **Final end-to-end performance audit** | E | S | All above | O-06 | Human + Claude Code | Run 3 prompts end-to-end. Measure: wall-clock from submit to production. Target: < 2 hours. Cost per prompt: measure actual vs target. Token usage by phase. | Benchmark results saved to `reports/performance-baseline.md` | git commit "docs: performance baseline report" |

---

## Part 5: Test-Fix-Commit Protocol

Every implementation task in this plan follows this exact protocol — no exceptions.

### Standard Protocol (every task)

```
1. IMPLEMENT
   Write the code. Follow ADRs strictly:
   - Living Library: if reusable logic appears, extract to package FIRST
   - Code Purity: apps contain ONLY custom business logic
   - Event-First: every state change emits an event
   - Agent-First: AI logic lives in agents, not route handlers

2. TYPECHECK
   pnpm typecheck
   → Fix ALL errors before proceeding. Zero tolerance.
   → If error is in a dependency, fix the dependency, bump its version, update imports.

3. TEST
   pnpm test (run relevant test file(s) first, then full suite)
   → Fix ALL failures. Do not skip or comment out failing tests.
   → If a test is wrong (testing the wrong thing), fix the test AND verify the fix is sound.

4. COMMIT
   git add -A
   git commit -m "<scope>(<package>): <imperative description>"
   Examples:
     feat(decomposer): add phase 2 parallel story generation
     fix(executor): handle SIGTERM during active worktree
     chore(db): migration 0018 pull_requests table

5. PUSH
   git push origin <branch>

6. IF NEW PACKAGE:
   a. Update package.json version (semver)
   b. pnpm changeset (describe the change)
   c. pnpm publish --access public
   d. Verify package appears on npm: npm info @caia/<name>

7. IF PR:
   a. Open PR against main
   b. Wait for ALL CI checks to pass (Build ✓, Test ✓, Lint ✓, Typecheck ✓)
   c. Do not merge with failing checks. Fix first.
   d. If CI fails on something unrelated to your change: fix it anyway (T-F-C applies to CI too)

8. UPDATE DOCS
   If observable behavior changed:
   - Update CLAUDE.md if Claude Code agents need to know about it
   - Update relevant API documentation
   - Update any architecture docs that reference the changed component
```

### Definition of Done: By Category

**New utility package (`@caia/*`):**
- `pnpm typecheck` passes with zero errors
- Unit test coverage ≥ 80% on the package
- Published to npm (`npm info @caia/<name>` returns correct version)
- README.md with: purpose, installation, basic usage example, event contracts
- Registered in `CLAUDE.md` package catalogue

**New agent:**
- System prompt committed in `packages/agent-registry/agents/<name>/system-prompt.md`
- 3 eval fixtures in `packages/agent-registry/agents/<name>/evals/` (input.json + expected-output.json)
- `pnpm agent:eval --agent=<name>` passes all 3 fixtures
- Output schema validated (JSON Schema or Zod)
- Agent registered in agent-registry table with correct tier

**New dashboard page/route:**
- Renders without errors in both empty state and populated state
- Handles API error state (shows error message, not blank/crashed)
- Added to sidebar navigation
- Keyboard navigation works (Tab through interactive elements)
- Render test passing in `dashboard/__tests__/`

**New API endpoint:**
- Returns correct JSON shape for success case
- Returns correct HTTP status codes for error cases (400, 404, 500)
- TypeScript request/response types defined and exported
- Added to API documentation
- Integration test covering success + at least one error case

**Database migration:**
- Migration file committed in `src/db/migrations/`
- `pnpm drizzle-kit push` runs cleanly on empty DB
- Backfill script run if existing rows need updating
- `pnpm drizzle-kit generate` produces no unexpected changes after push
- Migration is reversible (down migration documented in comments)

---

## Part 6: Risk Register

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R-01 | **PR #43 CI fix takes > 3 days** — monorepo structure issues are deeper than expected | Medium | Critical | Time-box to 2 days. If stuck: revert to last green commit, cherry-pick known-good changes incrementally. Do not let this drag beyond day 3. |
| R-02 | **@caia/decomposer output quality insufficient** — structured JSON output has hallucinations, missing fields, or incoherent story trees | High | Critical | Mitigate with: (1) JSON Schema enforcement via Anthropic structured output API, (2) Zod validation post-response with re-try on failure (max 2 retries), (3) eval suite of 10 prompts scored before Sprint 3 exits, (4) human "looks right?" gate before first real execution run. Accept that Sprint 3 may extend by 3 days if quality is insufficient. |
| R-03 | **Agent-to-agent communication latency/reliability** — multi-agent handoffs introduce cascading delays or dropped events | Medium | High | All agent communication is event-bus-mediated (not real-time RPC). Events are persisted — no message loss. Circuit breaker pattern (3 failures → escalate to human) prevents infinite retry loops. Start with synchronous chains before enabling parallel handoffs. |
| R-04 | **Token costs exceed budget before platform is self-sustaining** | Medium | High | (1) Local LLM routing for low-complexity tasks (Sprint 11) targets 40-60% cost reduction, (2) Per-prompt cost tracking from Sprint 9 milestone gives budget visibility, (3) Hard monthly limit in `@caia/local-llm-router` policy forces fallback to local above threshold, (4) Decomposer caching: identical prompt hashes (10s window) skip re-decomposition. |
| R-05 | **Local LLM quality insufficient for delegated tasks** | High | Medium | (1) Quality feedback loop: record `resultOk` per local task; auto-escalate to Claude if local success rate < 70% on a task type, (2) Never route security/architecture/complex-refactor tasks to local (domain exclusion list), (3) Roll out local LLM to boilerplate-only tasks first (migration files, barrel exports), (4) Monitor completeness sentinel findings on local vs Claude tasks. |
| R-06 | **GitHub API rate limits block high-throughput PR creation** | Low | Medium | Implement exponential backoff in `@caia/pr-manager`. Use GitHub App authentication (higher rate limit: 5,000/hour vs 60/hour for PAT). Batch PR operations where possible. |
| R-07 | **Cloudflare Pages wrangler deploy fails silently** | Low | Medium | Add timeout (5 min) + retry (2×) in deployment-manager. Verify deployment via health check, not just wrangler exit code. Pulse check includes a synthetic staging deployment. |
| R-08 | **Monorepo CI becomes slow as packages accumulate** | Medium | Medium | (1) Turborepo remote cache enabled from Sprint 2, (2) Affected-only builds in CI (`turbo run build --filter=...[HEAD^1]`), (3) Max CI time threshold: if any job exceeds 10 min, investigate and fix before next sprint. |
| R-09 | **Story→Task bridge creates incorrect dependency chains** — circular or missing deps cause tasks to never be scheduled | Medium | High | (1) Cycle detection in `@caia/dag-analyzer` with explicit `pipeline.dag_error` halt, (2) Integration test verifies dependency chains on 3 known prompt shapes before Sprint 4 exits, (3) Dashboard DAG view (`DagView` component) shows the computed graph for human verification before first execution. |
| R-10 | **Database SQLite write contention under multiple concurrent agents** | Medium | Low (single user) / High (multi-user) | (1) Single-user mode: SQLite WAL mode, acceptable, (2) Multi-user: migrate to Turso (Sprint 8, F-18), (3) BullMQ queue (Sprint 10, P-17) moves task dispatching off SQLite hot path. |
| R-11 | **Decomposer LLM cost spike** — a single complex prompt spawns 50+ stories × enrichment calls | Medium | Medium | Hard cap: `maxStoryCount: 50` in decomposer config (configurable). If exceeded: decompose to Module level only, require human confirmation before Phase 2. Cost estimate shown in Prompt Submission view before submit. |
| R-12 | **The two missing architecture reports** — `caia-domain-taxonomy-and-dedup-architecture.md` and `caia-agent-team-architecture.md` were not found in the reports directory | High | Medium | This plan incorporates the available information from the one existing report + the prompt context. Before Sprint 4 begins: write the missing two reports (or confirm the information in this plan is correct) to ensure Track B (domain taxonomy, 9-week plan) and Track D (25 agents, 6 tiers) are accurately spec'd. |

---

## Part 7: Success Metrics

### Phase 1 Complete (end of Sprint 2) when:
- PR #43 merged, CI green on main
- `pnpm build` passes from monorepo root with zero errors
- All 6 migrations (0017–0022) applied cleanly
- `@caia/events-taxonomy` published with 14 new event types
- Executor streams output in real-time (SSE endpoint live)
- Test coverage ≥ 80% on event-bus, events-taxonomy, prioritization packages
- `@caia/agent-registry` published and accepting agent manifests

### Phase 2 Complete (end of Sprint 4) when:
- A prompt submitted to `POST /prompts` triggers the full clarification → decomposition → enrichment → DAG → task-queue pipeline automatically
- Decomposer eval suite: 10 prompts, all produce valid trees (no crashes, all stories have required fields)
- DAG analyzer detects cycles in injected test case
- Task queue is populated and executor picks up tasks
- Prompt Waterfall dashboard shows full accordion tree

### Phase 3 Complete (end of Sprint 6) when:
- Task execution automatically triggers test runner
- Test failures create blocker entries visible in dashboard
- Build verification runs automatically after tests pass
- Build failures spawn auto-fix tasks via Claude Sonnet
- Live Execution view streams output in real-time
- Lock contracts block invalid decompositions

### Phase 4 Complete (end of Sprint 8) when:
- A completed, verified build automatically creates a GitHub PR with AI review comments
- The PR automatically triggers a Cloudflare Pages staging deployment
- Staging URL appears in the dashboard with a notification
- Deployment Status view operational

### Platform MVP Complete (end of Sprint 9) when:
- **Human submits prompt → working feature deployed to staging in < 2 hours with zero manual intervention** (except the approve button and one-time project setup)
- 5 required human gates function correctly: (1) clarification questions, (2) decomposition confirmation for large trees, (3) DAG review, (4) human acceptance review, (5) approve/reject
- `prompt.completed` event emitted with accurate cost/duration/files metrics
- End-to-end run successfully documented with real prompt

### Phase 5 Complete (end of Sprint 10) when:
- All 14 dashboard views implemented and passing render tests
- Mobile layout works on 375px viewport
- Cost breakdown dashboard shows Haiku/Sonnet/Opus split
- Notification panel delivers in-app alerts on staging ready

### Phase 6 Complete (end of Sprint 11) when:
- `@caia/local-llm-router` routes boilerplate tasks to Ollama `qwen2.5-coder:7b`
- Local task success rate ≥ 70% on boilerplate task type
- Cost dashboard shows ≥ 30% cost reduction from local routing (measured over 20 prompts)
- All 15+ agents registered, evaluated, and passing eval harness

### Phase 7 / Open Source Ready (end of Sprint 12) when:
- `@caia/task-dag`, `@caia/claude-executor`, `@caia/pipeline-pulse` published as standalone packages
- Each has a README with standalone example that runs without CAIA monorepo
- `@caia/requirement-decomposer` extraction in progress
- Platform documentation complete (`docs/`)
- Performance baseline: average prompt-to-production time measured and documented

---

## Appendix: ASCII Gantt Chart

```
CAIA Platform Build — 24-Week Overview
Week:  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23 24
       |  |  |  |  |  |  |  |  |  |   |  |  |  |  |  |  |  |  |  |  |  |  |  |
Sprint:   S1          S2          S3          S4          S5          S6
       |-----|  |-----|  |-----|  |-----|  |-----|  |-----|
       Apr27-May10  May11-May24  ...         ...          Sep28-Oct11

TRACK A — CRITICAL PATH
PR #43 Fix        [==]
Foundation        [====]
Decomposer             [=====]
Enricher+DAG                [=====]
Bridge+Sched                     [=]
Test+Build Runner                    [======]
PR Manager                                 [===]
Deploy Manager                                 [====]
Accept+Release                                     [====]
Observability                                          [=]
🏆 MVP                                                  ^

TRACK B — DOMAIN TAXONOMY (9 weeks)
Taxonomy Baseline    [=]
Domain Classifier        [====]
Dedup Engine                  [====]
Lock Contracts                    [====]
Dedup Dashboard                        [==]
                   Wk2                          Wk11

TRACK C — DASHBOARD (continuous)
Prompt Submit+Task [==]
Settings+Search        [==]
Waterfall P1                [===]
Live Execution                   [==]
Tests+Builds                          [==]
Deploy+Notifs                              [==]
Acceptance View                                [==]
Polish+Mobile                                      [====]

TRACK D — AGENT TEAM (starts Wk2)
Registry+Scaffolder  [===]
Coordinator               [=]
PO+BA+Architect               [=====]
Dev+Test+Review Agents              [======]
QA+Security+Perf                          [======]
Deploy+Monitor                                 [===]
Meta Coach                                          [===]
Eval Harness                                     [===]

TRACK E — INFRA + LOCAL LLM + OSS (starts Wk18)
BullMQ+NATS                                       [===]
Local LLM Router                                       [===]
Ollama Tool Loop                                           [===]
OSS Extraction                                                 [====]
Docs+Polish                                                        [=]

LEGEND: [=] = 1 sprint of work  ^ = milestone
```

```
Detailed Sprint Map:
┌────────────────────────────────────────────────────────────────────────────┐
│ SPRINT 1  Apr27-May10  FIX CI / FOUNDATIONS                                │
│  ▶ F-01 PR #43 FIX (🚨 BLOCKER)   ▶ F-02 Disable connectors               │
│  ▶ F-03 Monorepo verify            ▶ F-04..F-10 Migrations 0017-0022       │
│  ▶ F-11 Events taxonomy ext        ▶ D-01 Prompt Submit  ▶ D-03 Task Detail│
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 2  May11-May24  FOUNDATIONS COMPLETE                                │
│  ▶ F-12 Executor streaming         ▶ F-13 SSE task stream                  │
│  ▶ F-14 SSE event stream           ▶ F-15 Coverage gate 80%               │
│  ▶ F-16/17 Project credentials     ▶ P-07 Worktree manager extract         │
│  ▶ T-01 Domain taxonomy            ▶ D-10 Settings page  ▶ A-01 Registry   │
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 3  May25-Jun07  🔑 THE DECOMPOSER                                   │
│  ▶ P-02 @caia/decomposer Phase 1+2 (FULL SPRINT FOCUS)                     │
│  ▶ T-02 Domain classifier          ▶ A-02 Agent scaffolder                  │
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 4  Jun08-Jun21  ENRICHMENT + DAG + PIPELINE WIRED                  │
│  ▶ P-03 @caia/enricher             ▶ P-04 @caia/dag-analyzer               │
│  ▶ P-05/P-06 Story-Task bridge     ▶ P-01 @caia/clarifier                  │
│  ▶ T-03 Dedup engine               ▶ D-02 Waterfall P1   ▶ A-03 Coordinator│
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 5  Jun22-Jul05  EXECUTION LOOP CLOSED                               │
│  ▶ E2E integration test            ▶ P-09 @caia/test-runner                │
│  ▶ P-10 @caia/build-verifier       ▶ D-04 Live Execution                   │
│  ▶ D-05 Test Results               ▶ T-04 Dedup dashboard                  │
│  ▶ A-04 PO Agent                   ▶ A-05 BA Agent                         │
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 6  Jul06-Jul19  QUALITY GATES + HARDENING                           │
│  ▶ Build verifier integration      ▶ D-06 Build Status                     │
│  ▶ D-02 Waterfall real-time        ▶ T-05 Domain heatmap                   │
│  ▶ T-06 Lock contracts             ▶ A-06 Architect Agent                  │
│  ▶ A-16 Handoff protocol           │                                        │
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 7  Jul20-Aug02  GITHUB INTEGRATION                                  │
│  ▶ P-08 @caia/pr-manager           ▶ GitHub config                          │
│  ▶ A-07 Developer Agent v2         ▶ A-08 Test Engineer Agent               │
│  ▶ A-09 Code Reviewer Agent        ▶ D-12 Prompt search                    │
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 8  Aug03-Aug16  STAGING DEPLOYMENT                                  │
│  ▶ P-11 @caia/deployment-manager   ▶ Cloudflare config                     │
│  ▶ F-18 Turso/libSQL               ▶ D-07 Deployment view                  │
│  ▶ D-09 Notifications              ▶ A-10 QA Agent  ▶ A-11 Security Agent  │
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 9  Aug17-Aug30  🏆 MVP — HUMAN GATE + PRODUCTION RELEASE            │
│  ▶ P-12 @caia/acceptance-gate      ▶ P-13 @caia/release-manager            │
│  ▶ P-14 @caia/observability-closeout ▶ D-08 Acceptance Review              │
│  ▶ 🎯 FIRST AUTOMATED PROMPT→PRODUCTION RUN                                │
│  ▶ A-13 Deploy Agent               ▶ A-14 Monitor Agent                    │
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 10  Aug31-Sep13  DASHBOARD + INFRA                                  │
│  ▶ D-11 Cost dashboard             ▶ D-13 Mobile layout                    │
│  ▶ D-14 Keyboard shortcuts         ▶ P-17 BullMQ mode                      │
│  ▶ P-18 NATS transport             ▶ A-17 Eval harness  ▶ A-12 Perf Agent  │
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 11  Sep14-Sep27  LOCAL LLM + AGENT COMPLETION                       │
│  ▶ P-15 @caia/local-llm-router     ▶ P-16 Ollama tool loop                 │
│  ▶ A-15 Meta Coach Agent           ▶ A-16 Handoff protocol v2              │
│  ▶ Cost savings dashboard          │                                        │
├────────────────────────────────────────────────────────────────────────────┤
│ SPRINT 12  Sep28-Oct11  OPEN SOURCE + DOCS + POLISH                        │
│  ▶ O-02 @caia/task-dag             ▶ O-03 @caia/claude-executor             │
│  ▶ O-04 @caia/pipeline-pulse       ▶ O-06 decomposer extraction begins     │
│  ▶ Platform docs                   ▶ Performance baseline audit             │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference: What's Next (Priority Order)

Given today is 2026-04-27, here is the exact priority order for the next 5 working days:

1. **TODAY:** Open PR #43. Read the failing CI check logs. Fix typecheck/lint/test errors. Push. Watch CI. If green: merge.
2. **TODAY (5 min):** Disable Kapture, Chrome Control, Notes, osascript in Cowork Settings.
3. **After PR #43 merges:** Run `pnpm build` from monorepo root. Fix any residual import errors.
4. **Day 2-3:** Apply migrations F-04 through F-10. Extend events-taxonomy (F-11). Publish `@caia/events-taxonomy`.
5. **Day 3-5:** Begin F-12 (executor streaming) and D-01 (prompt submission view) in parallel.

**The decomposer (P-02) is the single most impactful item on the entire roadmap.** Every sprint before it is clearing the runway. Everything after it builds the landing gear.

---

*This plan was generated 2026-04-27. Dates are fixed to today's date and should be updated if Sprint 1 start is delayed. The critical path assumes PR #43 is fixed within Sprint 1 (by May 10 at latest). A delay beyond May 10 shifts every subsequent sprint date by the same amount.*
