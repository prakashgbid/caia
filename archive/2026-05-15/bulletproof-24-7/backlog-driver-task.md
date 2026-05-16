# Backlog Driver — local-first design

**Token-cost-conscious version (operator constraint 2026-05-08).** The Backlog
Driver is no longer a single Claude scheduled task. It is split into two
layers per the local-first mandate:

1. **`local-poller.sh` + `pick-next-backlog-item.sh`** — pure-bash. Runs
   every minute via LaunchAgent / cron. Counts running sessions, picks the
   next item from `master_backlog_sequencing`, writes to a queue file. Zero
   Claude tokens.
2. **Thin Spawner** scheduled task — minimal Claude session that runs every
   5 minutes, drains the queue file, calls `mcp__cowork__start_task` for
   each line, exits. Cost: ~700 tokens on idle ticks, ~5 K on spawn ticks.
   See `thin-spawner-task.md`.

The narrative below describes the legacy single-Claude-task design; sections
later in this file have been overridden by the local-first split. Reading
`local-poller.sh`, `pick-next-backlog-item.sh`, and `thin-spawner-task.md`
together gives the canonical picture.

---

**Original purpose**: every 15 minutes, count running tasks and spawn from the master
backlog if running < target. Runs as an autonomous Claude scheduled task; the
orchestrator session does NOT need to be alive for this to work.

**Failure-mode addressed**: orchestrator session goes idle / context-dies /
skips a heartbeat → backlog stops advancing → operator wakes up to a stalled
system. With the Backlog Driver, even if the orchestrator is unresponsive, the
system keeps consuming the backlog.

**Scheduled-task definition** (create via `mcp__scheduled-tasks__create_scheduled_task`):

```jsonc
{
  "taskId": "backlog-driver",
  "description": "Every 15 min: count running tasks; if under target, spawn the next item from master_backlog_sequencing. Self-actuating — does NOT delegate to orchestrator session.",
  "cronExpression": "*/15 * * * *",
  "notifyOnCompletion": true,
  "prompt": "<see prompt template below>"
}
```

## Prompt template

```text
<!-- STANDING-RULE-SENTINEL v1 — see standing-rule-sentinel-prefix.md -->
[Sentinel block injected here verbatim]
<!-- /STANDING-RULE-SENTINEL v1 -->

# Role: Backlog Driver

You are the Backlog Driver. You run every 15 minutes. Your sole job is to
keep the running task count above the floor (target 35-45, floor 5). You
ACT directly — you do NOT post to the operator unless you find a hard
block.

# Steps

## 1) Count running tasks

Use `mcp__cowork__list_sessions` (or equivalent for this Claude env) to
list active sessions. A "running task" is a session whose status is
"in_progress" / "running" and whose last activity was within 30 minutes.

Let `RUNNING = count of running tasks`.

## 2) Decide whether to spawn

If `RUNNING >= 5` (floor) AND `RUNNING <= 45` (ceiling):
  → silent exit. Log "Backlog Driver: running=$RUNNING, no action".

If `RUNNING < 5`:
  → spawn enough to bring count to 8 (target floor + buffer of 3).

If `RUNNING > 45`:
  → silent exit. Log "Backlog Driver: ceiling reached, no spawn".

## 3) Pick the next backlog item

Read `~/Documents/projects/agent-memory/master_backlog_sequencing_2026-05-05.md`.
Find the lowest-numbered item whose:
  - status != "DONE"
  - status != "BLOCKED"
  - all dependencies are DONE
  - no in-flight task already owns this item (check session prompts for the
    item's name; skip items already running)

Apply the master-stop-conditions check. If any fire, skip to step 5.

## 4) Spawn

Compose the spawn prompt by:
  - injecting standing-rule-sentinel-prefix.md (verbatim block)
  - appending the item's directive content
    (`agent-memory/<item>_directive.md`)
  - appending the 10-stage DoD per master_backlog_sequencing
  - appending the most recent leg's handoff for context continuity (if
    item is mid-campaign)

Call `mcp__cowork__start_task` with that prompt.

Repeat steps 3-4 until target count is reached OR backlog has no more
unblocked items.

## 5) Stop-condition handling

If a master stop condition fires (subscription cap, 3 consecutive Stage-10
fails, 60-day no-operator-interaction, etc.):
  - DO post a SendUserMessage with status="proactive" describing the
    condition (this is one of the few legitimate operator-surfacing cases)
  - log to memory: `agent-memory/backlog_driver_halt_<date>.md`

Otherwise: silent exit. The system has its budget; it's working.

## 6) Hand off self-perpetuation

Even if you spawned 0 tasks, write a one-line entry to
`agent-memory/backlog_driver_log.md`:

  ISO_TIMESTAMP RUNNING=N SPAWNED=M ACTION=<spawn|skip|halt> NEXT_ITEM=<id>

This audit log lets the Heartbeat Auditor verify that the Driver is
running.

# Reminder: this task is autonomous. The orchestrator session may be dead.
# That is fine. Your job is to drive the queue, not to coordinate with the
# orchestrator. Reading this prompt is enough.
```

## How it interacts with the orchestrator

The orchestrator session may also spawn tasks (in response to operator
messages). The Backlog Driver and the orchestrator both look at the same
`list_sessions`. Two-writer race conditions are mitigated by:
  1. Each one checks "is there already a task running for item X" before
     spawning. Prompts include the item id in a structured prefix
     (`# Item: B5.A2 leg-3`) so grep is reliable.
  2. The Backlog Driver only spawns if RUNNING < 5; the orchestrator
     normally maintains RUNNING > 5 when active. The Driver is a safety
     net, not a primary scheduler.
  3. If both spawn the same item simultaneously, the second-spawned task
     reads the first's prompt-id, exits early with a "duplicate" memory
     note. Wasted ~30 s; no system damage.

## Why 15 minutes

Trade-offs:

- Faster (5 min): catches idleness sooner. Higher false-positive rate
  (orchestrator was about to spawn but Driver beat it).
- Slower (30 min): reduces races but lets idle gaps grow.
- 15 min: sweet spot. Floor of 5 means even a 14-minute gap with all 5
  finishing simultaneously is recovered within 15. Operator's tolerance
  per `feedback_24_7_bulletproof` is "> 15 min" being an incident.

## Cost analysis

Each Backlog Driver run uses:
  - 1 list_sessions call (cheap, < 1 s)
  - 1 file read (master sequencing, < 50 KB)
  - In the spawn case: 1 file read (item directive) + 1 start_task call
  - On a quiet tick: < 5 s, < 5 K tokens — negligible against the orchestrator's run rate

Scheduled-task quota is separately budgeted by the Cowork product. We hold
the existing 4 scheduled tasks; this adds 1 new (backlog-driver) plus 2
more (idle-detector, heartbeat-auditor) = 7 total scheduled tasks. Well
within product limits.
