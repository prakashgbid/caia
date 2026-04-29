# Phase 2 pipeline — operator runbook

> **Status:** Production-ready as of 2026-04-29 (Phase 2 ✅ COMPLETE).
> Acceptance gate: `apps/orchestrator/tests/phase2-e2e-acceptance.test.ts`
> + `apps/orchestrator/tests/phase2-diverse-prompts.test.ts` (10
> scenarios, 100% pass rate).

This document is the operator's runbook for the CAIA Phase 2 pipeline.
It covers what the pipeline does, how to start it, how to give it a
prompt, what to watch for on the dashboard, and how to troubleshoot
when something stalls.

If you're new to CAIA and want to skim the architecture first, read
`docs/agent-contracts.md` (the inter-agent contract registry pattern)
and `docs/architecture-registry.md` (the AKG that EA reads from)
before this file.

## What Phase 2 does

Phase 2 takes a single prompt and drives it end-to-end:

```
POST /prompts                 (HTTP entry point)
  → Scaffolder Agent          (classify + assemble agent team)
  → PO Agent                  (decompose into stories + FREG classify)
  → BA Agent                  (cross-agent collaboration → enrich ticket)
  → EA Agent                  (taxonomy + AKG → architecturalInstructions[])
  → Story Validator           (6-step composed-template rubric)
  → Test-Design Agent         (generate test_cases per story)
  → Task Scheduler            (place stories in sequential + parallel buckets)
  → Coding Agent worker       (implement → run local tests → open PR)
  → Fix-It Test Agent worker  (run every test_case → max 6 retries)
  → ticket marked done
```

Every transition fires a typed event on the bus, every event carries
the same `correlation_id` from the originating prompt (sub-correlations
of shape `${id}::${storyId}` are used by per-story collaborations), and
every stage transition is recorded in `prompt_pipeline_stages` so the
dashboard's `/prompts/[id]/journey` page can render the live timeline.

## Pipeline stages

The canonical sequence is defined in
`apps/orchestrator/src/agents/pipeline-stages.ts` as
`PIPELINE_STAGE_ORDER`:

| # | Stage              | Owner                | What happens |
|---|--------------------|----------------------|--------------|
| 0 | `received`         | API                  | Prompt accepted, dedup-checked, classified |
| 1 | `ingested`         | API                  | `pipeline.started` + `prompt.ingested` events |
| 2 | `scaffolded`       | Scaffolder           | Agent team assembled per request type; context broadcast |
| 3 | `po_decomposed`    | PO Agent             | Stories created with FREG lifecycle classification |
| 4 | `ba_enriched`      | BA Agent             | Cross-agent collab → ticket has acceptance criteria + per-domain agent sections |
| 5 | `ea_decomposed`    | EA Agent             | Taxonomy filled in (tech sub-domains, risk, effort, claims) + AKG-grounded `architecturalInstructions[]` |
| 6 | `validated`        | Story Validator      | Composed-template per-scope rubric (passed / escalated) |
| 7 | `test_designed`    | Test-Design Agent    | `testCases[]` generated per story per agent section |
| 8 | `bucket_placed`    | Task Scheduler       | Stories placed in `(project, tech_sub_domain)` sequential buckets or the per-prompt parallel bucket |
| 9 | `ready_for_pickup` | Task Scheduler       | Workers can pull assignments via `/api/workers/:id/assignment` |

Stages 7–9 unblock the worker side:

| Phase 2 worker step                      | Owner            | Output |
|------------------------------------------|------------------|--------|
| Pick up story → fetch bundle             | Coding Agent     | Bundle (story + ticket + bucket + claims) |
| Worktree setup                            | Coding Agent     | `WorktreeManager` creates an isolated worktree |
| Implement                                | Coding Agent     | `ImplementationEngine` drives Claude SDK to `DONE_MARKER` |
| Local test run + PR open                 | Coding Agent     | `task.coding_complete` event |
| Per-test-case fix loop (max 6 retries)   | Fix-It Test      | `task.tested_and_done` or `task.fix_loop_escalated` |
| Auto-merge or escalate                   | Task Manager     | PR merged or `fix-stuck` blocker filed |

## Starting the orchestrator

The orchestrator is the long-running process that hosts every agent +
the HTTP API + the worker registry.

### Local dev

```bash
cd apps/orchestrator
pnpm install
pnpm --filter @chiefaia/logger build         # required by orchestrator
pnpm --filter @chiefaia/local-llm-router build   # required by validator
pnpm --filter @chiefaia/feature-registry build   # required by PO agent (FREG)
pnpm dev                                      # tsc --watch
# in another terminal:
node dist/index.js
```

The orchestrator listens on `http://localhost:3001` by default. The
in-process pipeline starts immediately — no separate worker registration
is required for the BA/EA/Validator/Test-Design/Task-Scheduler chain.

### Production

The orchestrator is deployed as a pm2 process named
`caia-orchestrator` on the stolution server. To restart:

```bash
pm2 restart caia-orchestrator
pm2 logs caia-orchestrator --lines 200
```

## Registering workers

Phase 2 worker pools (Coding Agent + Fix-It Test Agent) live in
separate processes and register over HTTP.

### Coding Agent worker

```bash
cd apps/worker-coding
pnpm install
pnpm build
node dist/src/main.js \
  --orchestrator http://localhost:3001 \
  --capabilities frontend,backend \
  --heartbeat-ms 15000 \
  --poll-ms 5000
```

On startup the worker:
1. POSTs to `/api/workers/register` with its IPC socket path.
2. Starts the IPC server so Fix-It can dial it for `apply_fix`.
3. Begins the heartbeat + assignment-poll loops.

### Fix-It Test Agent worker

```bash
cd apps/worker-fix-it
pnpm install
pnpm build
node dist/src/main.js \
  --orchestrator http://localhost:3001 \
  --browserless ws://localhost:3000   # for Playwright pool
```

The Fix-It worker subscribes to `task.coding_complete` and runs the
test cases against the Coding Agent's still-warm worktree.

## Giving the pipeline a prompt

The simplest path is the HTTP API:

```bash
curl -X POST http://localhost:3001/prompts \
  -H 'content-type: application/json' \
  -d '{
    "body": "add a user profile page with avatar upload",
    "received_via": "api"
  }'
```

The response includes:
- `prompt_id` — used as the path parameter for every read endpoint.
- `correlation_id` — flows through every event on the bus.
- `dedup_decision` — `unique` / `near-duplicate` / `duplicate`. The
  pipeline still runs on `near-duplicate` but the dashboard surfaces
  the warning.

The pipeline runs asynchronously. Watch progress via the dashboard or
poll the journey endpoint:

```bash
curl http://localhost:3001/prompts/<prompt_id>/journey
```

## Watching the dashboard

The dashboard runs on `http://localhost:3000` (Next.js). Phase 2 lives
on these routes:

| Route                              | What it shows |
|------------------------------------|---------------|
| `/prompts`                         | Every received prompt with status + dedup decision |
| `/prompts/[id]`                    | Single prompt + descendants |
| `/prompts/[id]/journey`            | Live pipeline timeline (every stage, BA collab inspector, ticket bundle viewer) |
| `/prompts/[id]/pipeline`           | Tree view (requirements → stories → tasks → task_runs) |
| `/architecture`                    | AKG entities EA produced architecturalInstructions[] from |
| `/contracts`                       | Agent contract registry — what each agent's SectionContract owns |
| `/buckets`                         | Sequential + parallel buckets, with backpressure indicators |
| `/workers`                         | Worker pool registry + bucket health metrics |
| `/blockers`                        | `validation-stuck` + `fix-stuck` escalations |

The dashboard subscribes to a WebSocket feed at `/ws/events` so every
stage transition lands in the UI within ~50 ms of being persisted.

## Troubleshooting

### A prompt is stuck in `scaffolded`

The PO Agent failed to decompose. Check:
- `pm2 logs caia-orchestrator --lines 200` for `[po-agent]` warnings.
- `/prompts/[id]/events?type=po-agent.decomposition.complete` — if
  empty, PO never finished.
- The classifier could be returning an empty domain set; rerun with
  a slightly more specific prompt.

### A prompt is stuck in `ba_enriched` (no `ea_decomposed`)

EA Agent typically blocks on the AKG instructor. Check:
- `/architecture` — is the AKG populated? If empty, run the seed
  script: `pnpm --filter @chiefaia/architecture-registry seed`.
- Per-story `ea-agent.akg.complete` events. EA's AKG instructor
  catches errors and falls back to classification-only — if you see
  `[ea-agent] AKG instructor failed`, the legacy taxonomy still
  populates but `architecturalInstructions[]` will be empty.

### A story is stuck in validation `in_progress`

Should never happen — the validator transitions to `passed` /
`escalated` even on judge failure. If you see `in_progress`:
- The validator process crashed mid-flight. Check
  `pm2 logs caia-orchestrator | grep story-validator`.
- Manually advance: `UPDATE stories SET validation_status = 'failed'
  WHERE id = ?`. The next scheduler pass will re-pick it up.

### A story has `validation-stuck` blocker

The validator escalated after `VERDICT_THRESHOLDS.maxAttempts`
attempts. The pipeline still progresses (Test-Design + Bucket-Placer
run regardless). To surface the blocker:
- `/blockers?kind=validation-stuck` — shows the failed checks +
  fix suggestions.
- Operator may need to manually edit the BA enrichment or EA
  classification, then run `runValidatorLoop` against the prompt
  again via the orchestrator's CLI.

### A worker is registered but receiving no assignments

Check:
- `/workers` — is the worker `idle` or `crashed`?
- `/buckets` — is the worker's capability set in any open bucket?
  Workers without capabilities accept any bucket; check that
  `/api/workers/:id/heartbeat` is being called within the stale
  threshold (60s).
- Backpressure: if the bucket is engaged (>25 stories in flight),
  no new assignments fire. Wait for the in-flight count to drop
  below the hysteresis threshold (5).

### Fix-It loop is exhausting all 6 retries

A real bug or a flaky test. Check:
- `/stories/[id]` — the per-test-case attempt timeline.
- `task.fix_loop_escalated` event payload — lists every exhausted
  test case with the last error message.
- A `fix-stuck` blocker is filed; the operator decides whether to
  bypass (manual merge) or rework (close the PR + re-prompt).

### Costs spiking unexpectedly

The cost tracker emits `pipeline.cost_alert` when a per-prompt run
exceeds the configured budget. Check:
- `/prompts/[id]/cost` — per-stage breakdown.
- The Coding Agent's local LLM router stats — if the router is
  falling through to Claude on every turn (instead of qwen2.5-coder
  on the local Ollama), token cost will be 10–20× higher. Restart
  Ollama: `pm2 restart ollama`.

## Acceptance + regression tests (the contract)

The pipeline is gated by a comprehensive regression suite at
`apps/orchestrator/tests/e2e/`:

- **`pipeline/happy-path.test.ts`** (PHASE2E-001) — single fixture
  prompt drives the full pipeline; asserts every stage reached,
  correlation_id flows through, ImplementationEngine reaches
  `DONE_MARKER`, FixItOrchestrator returns `tested_and_done`.
- **`pipeline/diverse-prompts.test.ts`** (PHASE2E-002) — 10 varied
  real prompts; asserts 100% completion + per-prompt SLO budget.
- **`pipeline/validator-rejection-recovery.test.ts`** — judge fail
  on attempt 1 + pass on attempt 2 (recovery), and judge always-fail
  → escalation + `validation-stuck` blocker.
- **`pipeline/fix-it-loop-with-retries.test.ts`** — runner fails
  attempt 1 then passes → `tested_and_done` with
  `totalAttempts > testCases.length`.
- **`pipeline/fix-it-loop-escalation.test.ts`** — runner always-fails
  → `fix_loop_escalated` covering every test case + worktree NOT
  shut down (kept warm for triage).
- **`agents/<name>.regression.test.ts`** — one file per agent (PO,
  BA, EA, Validator, Test-Design, Task Manager, Coding Agent, Fix-It
  Test Agent). Each is a battery of structural-invariant cases on
  the agent's contract surface.

Run locally:

```bash
pnpm test:regression               # full suite (pipeline + agents)
pnpm test:regression:pipeline      # just full-pipeline scenarios
pnpm test:regression:agent         # just per-agent contract tests
```

CI runs the suite via `.github/workflows/pipeline-regression.yml` —
parallel pipeline + agents jobs, blocked-merge on failure. The tests
use deterministic stub judges (instead of the real local-llm-router)
so they don't depend on a running Ollama / Claude API.

> **Any change to agent behavior requires adding/updating a
> regression test case in the same PR.**

Read `docs/regression-testing.md` for the full contributor guide:
when to add a test, how to add one, how to interpret failures, and
the per-DoD-item gate.

If any test in the regression suite fails, **do not merge** — it's
the production gate.

## Further reading

- `docs/agent-contracts.md` — the contract registry pattern that
  scopes per-agent contributions.
- `docs/architecture-registry.md` — the AKG that EA reads from.
- `docs/feature-registry.md` — FREG, the feature lifecycle classifier
  PO uses.
- `docs/story-validation.md` — the 6-step validator rubric.
- `docs/task-manager.md` — bucket placement + worker pool.
- `docs/coding-agent.md` — Coding Agent worker internals.
- `docs/fix-it-test-agent.md` — Fix-It Test Agent loop.
