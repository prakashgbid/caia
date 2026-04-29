# Production hardening

> Status: **Wave 1 of HARDEN-NN shipped 2026-04-29.** Six PRs landed
> against `main`; one area (idempotency) is documented as
> deferred-with-reason; one area (security) is partially shipped with a
> follow-up backlog.

This document captures what the orchestrator pipeline does _today_ to
stay 200% reliably operational, plus what is intentionally deferred and
why. It is the single source of truth operators reach for when:

- a worker process crashes mid-coding (HARDEN-001)
- a single pipeline-run blows past the cost cap (HARDEN-002)
- the disk fills with orphan worktrees (HARDEN-003)
- an LLM call hangs or a provider has an outage (HARDEN-005)
- a journey page is slow / hard to read (HARDEN-006)
- a stray log line might be leaking secrets (HARDEN-007)

Each section follows the same shape: **Threat -> Mechanism -> Knobs ->
Runbook entry**.

## 1. Failure recovery

### Threat
A Coding Agent process can disappear mid-implementation (host kernel
OOMs, container restart, network partition cuts the heartbeat). Before
HARDEN-001 the assigned story stayed stuck in `coding_in_progress`
forever; no other worker would pick it up.

### Mechanism
1. `WorkerPoolRegistry.detectStale()` (TASKMGR-002) flips the worker to
   `crashed` and emits `worker.crashed` whenever its last heartbeat is
   older than `staleThresholdMs` (default 60 s).
2. `WorkerCrashRecovery` (HARDEN-001 / PR #159) subscribes to
   `worker.crashed`. In a single SQLite transaction it clears
   `assignedWorkerId`, nulls `codingSessionId`, increments
   `codingAttempts`, and resets `phase2Status` so the ready-pool
   re-picks it up. The handler is **idempotent** — duplicate events
   are no-ops.
3. After `maxCodingAttempts` (default 3) the row is **escalated**
   instead of re-queued: `phase2Status='escalated'` and
   `phase2.escalated` fires. Operator must intervene.
4. The recovery handler optionally invokes `ReadyPoolConsumer.pump()`
   so a different idle worker picks the story up immediately rather
   than waiting for the next event-driven pump.

### Knobs
- `maxCodingAttempts` per recovery instance (default 3).
- `WorkerPoolRegistry.staleThresholdMs` (default 60 s).
- `ReadyPoolConsumer.maxAssignmentsPerPump` (default ∞).

### Runbook — worker crash storm
- Symptom: `phase2.escalated` events spike on the bus.
- Triage:
  1. `GET /api/workers/list` — confirm the crashed worker's host /
     last heartbeat.
  2. `SELECT * FROM stories WHERE phase2_status='escalated'` —
     get the affected stories.
  3. Decide: clear `phase2Status=null` to re-queue (operator
     trusts the input), or convert to a blocker and route to a
     human reviewer.

## 2. Idempotency

### Threat
An agent that re-runs on the same input must not duplicate work
(double-decompose into 2x stories, re-write a Test-Design pass on top
of an approved one, claim a worktree twice).

### Current state — verified through code audit
- **PO Agent**: stories are inserted with content-derived primary keys
  and the existing `seedFeatures` / `migrateFromJsonl` pattern uses
  slug-keyed UPSERTs. Re-running on the same prompt is idempotent.
- **BA Agent**: `agent_messages` rows are deduped on `(correlation_id,
  parent_message_id, from_agent)` via the awaitReplies pattern.
- **EA Agent**: `architectural_instructions_json` is the full set, so
  a second EA run overwrites cleanly rather than appending.
- **Test-Design Agent**: gated on `testDesignStatus`. Re-running checks
  the existing column and short-circuits when status='complete'.
- **Validator**: gated on `validationStatus`. The validator-loop
  (VAL-009) runs only when `validation_status` ∈ {pending, failed}.
- **Coding Agent**: `WorktreeManager.claim()` is documented idempotent
  — if a worktree already exists, it returns the existing record.
- **Bucket placer**: explicitly idempotent — re-running for the same
  prompt re-uses existing buckets.
- **ReadyPoolConsumer.atomicAssign**: re-checks worker.idle + story
  unassigned inside a transaction; a duplicate pump is safe.

### Status
**Deferred-with-reason.** Every agent already short-circuits on
re-runs. A no-op HARDEN-004 PR would just add tests. The verification
matrix above lives in code review; the next time an idempotency bug is
found in the wild, the test that catches it will be added at that site.

## 3. Resource cleanup

### Threat
Crashed workers leave orphan worktree directories under
`~/.caia/worktrees/<storyId>/`. Without a sweep, the disk fills.

### Mechanism
`WorktreeReaper` (HARDEN-003 / PR #166):
- Reaps directories whose story is missing, terminal (`status=completed`,
  `phase2Status` ∈ {done, escalated}), or unassigned past
  `orphanGraceMs` (default 10 min).
- `git worktree remove --force` first, then `fs.rmSync` fallback.
- Path-traversal defence: refuses to operate outside `baseDir`.
- Emits `worktree.reaped` events with the `reason`.

### Knobs (env)
- `CAIA_WORKTREE_REAPER_ENABLED=1` — opt-in (default off).
- `CAIA_WORKTREE_BASE_DIR` (default `~/.caia/worktrees`).
- `CAIA_WORKTREE_REPO_PATH` — required for `git worktree remove`.
- `CAIA_WORKTREE_REAPER_INTERVAL_MS` (default 5 min).

### Runbook — disk filling
- `du -sh ~/.caia/worktrees | sort -h`
- `CAIA_WORKTREE_REAPER_ENABLED=1` + restart orchestrator
- One-shot: `node -e "require('./apps/orchestrator/dist/agents/worktree-reaper').sweep()"`.

## 4. Cost tracking

### Threat
LLM bill blowouts go undetected until the next invoice. Operators
need to see _which pipeline-run_ is racking up dollars and _which
agent_ inside that run is responsible.

### Mechanism
`PipelineCostTracker` (HARDEN-002 / PR #162):
- Per-run row in `pipeline_run_costs` keyed by the prompt's
  `correlation_id`.
- Per-agent breakdown stored as JSON: `{ "po-agent": { calls, costUsd,
  baselineUsd } }`.
- `POST /llm/route` records the call when the body carries
  `correlationId` + `agent`.
- `GET /metrics/cost?correlationId=...` returns the run snapshot.
- `GET /metrics/cost` (no params) returns recent runs.
- Threshold trip emits `pipeline.cost.alert` exactly once per run when
  `total_cost_usd >= CAIA_PIPELINE_COST_ALERT_USD` (default $5).

### Knobs (env)
- `CAIA_PIPELINE_COST_ALERT_USD` (default 5).

### Runbook — cost-cap trip
- `pipeline.cost.alert` event fires on the bus.
- `GET /metrics/cost?correlationId=<id>` to inspect the per-agent
  breakdown.
- Decide: cancel the run (set prompt `status='cancelled'`), raise the
  cap for this run, or continue.

## 5. Observability

### Threat
The dashboard journey page used 4-5 round-trips to render a single
pipeline. Per-event timings, cost, and severity counts were scattered.

### Mechanism
`/api/pipelines/:promptId/trace` (HARDEN-006 / PR #171):
- Aggregates `prompt + stages + events + summary` in one response.
- Events sorted ascending by `occurred_at`.
- Limit defaults to 1000, clamped at 5000.
- Cost field reserved (currently `null`) — wired in once HARDEN-002 +
  HARDEN-006 both land on `main`.

`/api/pipelines/recent` — lightweight listing for the dashboard
landing page (capped at 200).

### Existing infrastructure (pre-HARDEN)
- `events` table — every event with `correlation_id` is queryable.
- `prompt_pipeline_stages` — explicit stage transition log.
- Prometheus metrics at `/prom-metrics`.
- WS gateway pushes `conductor:event` for live dashboards.

## 6. Concurrency safety

### Threat
Multiple Coding Agents picking the same story; multiple consumers
racing the same recompute; file-system races inside a worktree.

### Current state
- `ReadyPoolConsumer.atomicAssign` runs `BEGIN IMMEDIATE` via
  `db.transaction()`. It re-reads worker.idle + story unassigned
  inside the transaction; a lost race throws and surfaces as
  `readyButUnassigned`.
- `WorkerPoolRegistry.setBusy` / `setIdle` enforce state-machine
  transitions; `idle->busy` throws if the worker isn't idle.
- Each story gets its own worktree at
  `<baseDir>/<storyId>/`. No two workers share a directory.
- `WorkerCrashRecovery` rolls back inside a transaction with a
  same-worker check — a duplicate `worker.crashed` doesn't double-
  increment.
- Bus delivery is **synchronous**; subscribers are called in
  registration order.

### Status
**No new code shipped this wave.** The existing primitives provide
the guarantees enumerated above. A future PR could add chaos-driven
property-based tests, but the failure modes that exist today (worker
crash, slow LLM, disk fill) are covered by HARDEN-001 / 003 / 005.

## 7. Backpressure

### Mechanism
`BackpressureMonitor` (TASKMGR-004) — already shipped pre-HARDEN.
Watches per-bucket queue depth; emits
`task-scheduler.backpressure.engaged` when depth >= ceiling (default
25), `task-scheduler.backpressure.released` when it drains below
`ceiling - hysteresis` (default 5 below). PO Agent subscribes and
defers new prompts.

### Per-call resilience
`@chiefaia/local-llm-router` now wraps every dispatch in
`breaker.exec(withRetry(withTimeout(...)))` (HARDEN-005 / PR #169):
- Default 60 s timeout per call.
- 3 attempts (1 initial + 2 retries) with 250 / 500 ms exponential
  backoff. Only `TimeoutError` + network errors retry.
- Per-provider circuit breaker: opens after 5 consecutive failures;
  half-open after 30 s; one probe call decides next state. When
  open, the router falls back to the other provider.

### Runbook — provider outage
- `GET` exported `getBreakerStates()` (or watch logs for
  `[local-llm-router] retry attempt=...`).
- If `claude` is open and `local` is closed, all routes silently fall
  back to local — expected behaviour.
- If both are open: prompts will fail. Investigate: Ollama daemon up?
  Anthropic incidents page?

## 8. Security

### Mechanism (HARDEN-007 / PR #175)

**Log redaction.** `@chiefaia/logger` ships
`DEFAULT_REDACT_PATHS` (32 patterns: token / secret / password /
authorization / vault_token / github_pat / cookies / api keys /
set-cookie). Hosts opt in via
`createLogger({ includeDefaultRedactPaths: true })`. Orchestrator +
secrets-broker enabled by this PR.

**Shell spawn audit.** All 79 `child_process.*` call sites in
`apps/**` and `packages/**` use the safe argv-array form or
`bash -c <constant>`. No string-form `exec()`, no `shell:true` with
user data. See `docs/security-audit-shell-spawn.md`.

**PAT scope minimization.** Coding Agent's GitHub PAT is restricted
to:
- `contents: write`
- `pull_requests: write`
- `metadata: read` (implicit)

Explicitly NOT granted: `actions`, `workflows`, `administration`,
`secrets`, `packages`. PAT rotation runbook is a HARDEN-008 follow-up.

### Deferred-with-reason
- `local-test-runner.ts:92` runs `bash -c <command>` where `command` is
  read from `package.json.scripts`. Acceptable today (the worktree is
  ours; PR review gates malicious commits) but an argv-form rewrite is
  queued as `HARDEN-LOCAL-TEST-RUNNER-ARGV`.
- PAT auto-rotation script + runbook.

## Summary table

| # | Area | Mechanism | PR | Knob env |
|---|------|-----------|----|----------|
| 1 | Failure recovery | `WorkerCrashRecovery` subscriber | #159 | — |
| 2 | Cost tracking | `PipelineCostTracker` + `/metrics/cost` | #162 | `CAIA_PIPELINE_COST_ALERT_USD` |
| 3 | Resource cleanup | `WorktreeReaper` periodic sweep | #166 | `CAIA_WORKTREE_REAPER_ENABLED` |
| 4 | Idempotency | (audit only — no new code) | — | — |
| 5 | LLM resilience | timeout + retry + circuit breaker | #169 | `RouterOptions.timeoutMs` |
| 6 | Observability | `/api/pipelines/:id/trace` | #171 | — |
| 7 | Concurrency | (existing primitives — `atomicAssign`, transactions) | — | — |
| 8 | Security | logger defaults + spawn audit + PAT scopes | #175 | — |

## Hardening posture

Treat any failure mode that does NOT match a row above as new — file
a HARDEN-NN ticket, scope it to one PR, ship with a chaos-style test.
The hardening pattern (deterministic detection -> idempotent rollback
-> bounded retry -> escalation) is the canonical shape for new gaps.
