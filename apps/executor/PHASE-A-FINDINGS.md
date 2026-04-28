# Phase A Findings: Executor Gap Analysis

## What Exists

### PumpEngine (`src/pump/index.ts`)
A tick-based scheduler that picks the next ready `requirement` from the requirements table,
checks file conflicts, and returns `{ prompt, cwd }`. It does NOT dispatch — it just returns
what should be dispatched. Nothing calls `tick()` autonomously.

### Tables that represent the queue
| Table | Queue role | Status lifecycle |
|-------|-----------|-----------------|
| `tasks` | Primary task queue (newer, used by story-decomposer) | `queued → running → completed/failed/cancelled` |
| `requirements` | Older requirement queue | `captured → specced → ready → executing → done` |
| `stories` | Decomposition tree nodes | `pending → verified/failed/partial` |
| `task_runs` | Session observation records | `pending → running → idle → completed/stalled/aborted/failed` |

**The executor targets `tasks` table** — tasks flow in from story_decompose as `status=queued`.

### `apps/task-run-poller`
Observes Claude's local session JSONL files (`~/Library/Application Support/Claude/...`)
and syncs them into `task_runs`. This is a **passive observer**, not an executor.
It doesn't create sessions, only watches existing ones.

### `start_code_task`
Referenced in `src/install.ts` as a hook matcher (`mcp__dispatch__start_code_task`).
This is a tool in the user's `dispatch` MCP server — it spawns Claude sessions interactively
from the orchestrator context. It requires the orchestrator to be actively prompting.

### Dependency tracking
- `tasks.depends_on` (JSON array of task IDs)
- `requirements.depends_on` (JSON array)
- `stories.depends_on_json` (JSON array of story IDs)
- `blockers` table — linked via `blocker.task_id`

### Domain tracking
- `entity_domains` many-to-many join table
- `tasks.scope` field
- `task_runs.domain_slugs` field

### `next_ready_task` concept
Exists as `requirement_pickup_next` MCP tool (claims next ready requirement).
No equivalent for `tasks` table. Executor must implement its own scheduler.

## The Gap

```
story_decompose → tasks(status=queued) → [GAP] → task_runs(session started) → poller observes → done
                                           ↑
                           Nothing picks up queued tasks and spawns Claude.
                           User must manually call start_code_task.
```

## Dispatch Method: Option 1 (claude -p)

`claude --help` confirms: `-p, --print` flag exists for headless/non-interactive mode.
Full command verified:

```bash
claude -p "<prompt>" \
  --cwd <dir> \
  --output-format json \
  --permission-mode bypassPermissions \
  --bare \
  --max-turns 40
```

`--bare` skips CLAUDE.md auto-discovery, LSP, attribution (faster cold start).
`--output-format json` returns `{ result, session_id, cost_usd, ... }` on stdout.
This is the dispatch mechanism.

## Build Plan

- Migration 0007: `executor_runs`, `executor_config`, `task_attempts`
- `apps/executor/`: scheduler, dispatcher, monitor, completion-hook, breaker, daemon
- API routes: `/api/executor/*`
- MCP tools: `executor_status`, `executor_pause`, `executor_resume`, `task_run_now`
- Dashboard: `/execution` route
- launchd plist
- CLI: `conductor exec start/stop/status/pause/resume/drain/attempt`
- Lock contract: `execution-engine`
