---
name: execution-engine
type: protocol
slug: execution-engine
---

# Execution Engine Contract

**slug:** `execution-engine`
**kind:** protocol
**version:** 1

## What it is

The autonomous 24/7 task execution engine that drains the `tasks` queue without human intervention.
Workers are `claude -p` headless processes. This contract governs scheduler behavior,
dispatch protocol, safety rails, and the CLI safety requirement.

## Dispatch Method

**Option 1 — `claude -p` (verified, chosen)**

```bash
claude \
  --print \
  --output-format json \
  --permission-mode bypassPermissions \
  --bare \
  --max-turns <max_turns> \
  --cwd <task.cwd> \
  "<prompt>"
```

Confirmed via `claude --help` on Claude Code 2.1.94. Output is JSON containing
`session_id`, `result`, `cost_usd`, `num_turns`. The worker writes a `[result] DONE:` or
`[result] FAILED:` line as the completion signal.

## Scheduler Rules (deterministic)

1. **Eligibility**: `tasks.status = 'queued'` AND `tasks.paused = false` AND all `depends_on` IDs in completed set.
2. **Capacity**: total running < `executor_config.max_concurrent` (default 3).
3. **Domain cap**: per `tasks.domain_slug`, running < `max_per_domain_concurrent` (default 1).
4. **Priority sort**: lower `priority` number first, then FIFO by `created_at`.
5. **Idempotent**: given the same input state, always produces the same output.

## Safety Rails (NON-NEGOTIABLE)

- **No auto-start**: executor daemon starts DISABLED (`executor_config.enabled = false`).
  User must explicitly run `conductor exec start` before any tasks are picked up.
- **Circuit breaker**: after `circuit_breaker_threshold` (default 3) consecutive failures,
  task is auto-paused and a human-review blocker is filed. Scheduler skips paused tasks.
- **Worktree isolation**: each dispatch creates a git worktree `exec-<task_id>-<ts>`.
  Success = auto-merge + cleanup. Failure = worktree left intact for review.
- **Crash recovery**: on daemon restart, all `executor_runs.status = 'running'` with dead PIDs
  are re-queued as `queued`.
- **Graceful shutdown**: SIGTERM kills no workers; they finish naturally. SIGINT exits.

## DB Tables

| Table | Purpose |
|-------|---------|
| `executor_runs` | One row per dispatched claude session |
| `executor_config` | Singleton config (enabled, concurrency, thresholds) |
| `task_attempts` | Audit trail of every attempt per task |
| `tasks.attempt_count` | Running count of attempts |
| `tasks.paused` | Circuit-breaker flag |

## CLI

```bash
conductor exec start           # Enable executor (sets enabled=true)
conductor exec stop            # Disable (tasks stay queued)
conductor exec status          # Show queue depth, running workers, config
conductor exec pause           # Same as stop
conductor exec resume          # Same as start
conductor exec drain           # Disable + kill in-flight workers
conductor exec daemon          # Start daemon process in foreground
conductor exec install-launchd # Install macOS launchd plist
conductor exec attempt --task <id> --reset-breaker   # Unpause a circuit-broken task
conductor exec attempt --task <id> --list            # Show attempt history
```

## API Endpoints

```
GET  /executor/status          — queue depth, running, config, recent runs
POST /executor/pause           — disable executor
POST /executor/resume          — enable executor
POST /executor/drain           — disable + kill in-flight
POST /executor/tasks/:id/run-now — manual nudge
POST /executor/tasks/:id/pause   — pause specific task
POST /executor/tasks/:id/unpause — unpause (+ optional reset_attempts)
GET  /executor/runs            — list executor_runs (filterable)
GET  /tasks/:id/attempts       — attempt history for a task
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `executor_status` | Queue + worker status |
| `executor_pause` | Pause the executor |
| `executor_resume` | Resume the executor |
| `task_run_now` | Nudge a specific task |

## Stability Locks Respected

This engine runs WITHIN the existing stability contracts:
- **behavior-gate**: completion-hook runs `gate:publish` before marking task done.
- **task-run-protocol**: every dispatched session creates a `task_runs` row via poller.
- **completeness-sentinel**: completion-hook triggers completeness check post-success.
- **lock-contracts**: engine writes to `lock_contracts` table via `conductor memory:sync`.
- **circuit-breaker**: 3 failures → auto-pause → human-review blocker filed.

## What the executor does NOT do

- Does NOT modify site code directly — workers do that.
- Does NOT bypass behavior gate — completion-hook enforces it.
- Does NOT auto-start — user must explicitly enable.
- Does NOT force-push or merge on failure — leaves worktree intact.
