# Conductor Executor

Autonomous 24/7 task execution engine. Drains the `tasks` queue by dispatching
`claude -p` headless processes, monitoring them, and handling completion/failure.

## Dispatch Method

**Option 1 — `claude -p`** (chosen)

Verified on Claude Code 2.1.94 via `claude --help`:
```bash
claude -p "<prompt>" --cwd <dir> --output-format json \
  --permission-mode bypassPermissions --bare --max-turns 40
```
Output: JSON with `session_id`, `result`, `cost_usd`, `num_turns`.

Options 2 (dispatch HTTP API) and 3 (Anthropic Messages API) were considered but
Option 1 is self-contained, requires no extra server, and is the same runtime
the user already has.

## Architecture

```
executor-daemon.ts         ← main loop (10s poll)
  ↓ calls
scheduler.ts               ← pure fn: queue state → [task_ids to start]
  ↓ for each task
dispatcher.ts              ← creates worktree + spawns claude -p
  ↓ spawned process
monitor.ts                 ← checks health every 30s
  ↓ on finish
completion-hook.ts         ← marks done/failed, runs gate, re-queues
  ↓ on 3rd failure
breaker.ts                 ← pauses task, files human-review blocker
```

## Safety Rails

- **DISABLED by default** — `executor_config.enabled = false` until you run `conductor exec start`
- **Circuit breaker** — 3 consecutive failures → auto-pause + blocker filed
- **Worktree isolation** — each task runs in `exec-<id>-<ts>` git worktree
- **Crash recovery** — on restart, dead PIDs are re-queued
- **Gate enforcement** — completion hook runs `gate:publish` before marking done

## CLI

```bash
conductor exec start           # Enable (sets enabled=true in DB)
conductor exec stop            # Disable
conductor exec status          # Show running/queued/paused counts
conductor exec daemon          # Start daemon process in foreground
conductor exec install-launchd # Install macOS launchd for 24/7
conductor exec drain           # Emergency stop — disable + kill workers
conductor exec attempt --task <id> --reset-breaker   # Un-trip circuit breaker
conductor exec attempt --task <id> --list            # View attempt history
```

## Dashboard

`/execution` — live view of workers, queue, recent runs, Pause/Resume/Drain controls.

## Lock Contract

Slug: `execution-engine` — see `execution-engine-lock-contract.md`.
Sync with: `conductor memory:sync`

## Files

| File | Purpose |
|------|---------|
| `scheduler.ts` | Pure scheduler function + unit tests |
| `dispatcher.ts` | Spawn `claude -p` workers + worktree management |
| `monitor.ts` | Process health polling |
| `completion-hook.ts` | Post-completion: gate, sentinel, re-queue |
| `breaker.ts` | Circuit breaker: pause + file blocker |
| `executor-daemon.ts` | Main daemon loop |
| `com.conductor.executor.plist` | macOS launchd template |
