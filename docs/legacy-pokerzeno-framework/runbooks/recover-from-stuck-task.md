# Runbook: Recover from a Stuck Task or Conductor Issue

**Use case**: A background task (content seeding, integrity check, deployment verification) has hung, the conductor is unresponsive, or a task is stuck in "in-progress" state indefinitely.

---

## What is the Conductor?

The PokerZeno conductor is a lightweight task orchestration process running on the remote development server. It manages long-running tasks like:
- Content seeding (`@pokerzeno/content-engine seed`)
- Cross-site batch operations (integrity check across all sites)
- Scheduled deployment verification smoke tests

It runs on port `7776` and exposes a REST API.

---

## Step 1: Check Conductor Health

```bash
curl http://localhost:7776/health
```

Expected healthy response:
```json
{
  "status": "ok",
  "uptime": 3842,
  "tasks": {
    "active": 1,
    "queued": 0,
    "completed_today": 5
  }
}
```

**If you get `Connection refused`**: The conductor process is not running. Skip to Step 5 to restart it.

**If you get a response but `status` is not `ok`**: Note the `status` value and continue to Step 2.

---

## Step 2: List Active Tasks and Their State

```bash
curl http://localhost:7776/tasks | jq '.'
```

Look for any task with `status: "in_progress"` and a `started_at` timestamp more than 15 minutes ago. A normal task should complete within 5-10 minutes.

```json
{
  "tasks": [
    {
      "id": "task_abc123",
      "type": "content_seed",
      "status": "in_progress",
      "site": "roulettecommunity",
      "started_at": "2026-04-20T10:15:00Z",
      "last_heartbeat": "2026-04-20T10:16:03Z"
    }
  ]
}
```

If `last_heartbeat` is more than 5 minutes old and `status` is still `in_progress`, the task is stuck.

---

## Step 3: Check for Blockers

```bash
curl http://localhost:7776/blockers | jq '.'
```

Blockers are dependency conditions that prevent task completion. Common blockers:
- Waiting for a Supabase migration to finish
- Waiting for a previous deploy to complete
- File lock held by another process

Example response:
```json
{
  "blockers": [
    {
      "id": "blocker_xyz789",
      "task_id": "task_abc123",
      "reason": "Waiting for Supabase project pokerzeno to be in ready state",
      "created_at": "2026-04-20T10:15:30Z"
    }
  ]
}
```

---

## Step 4: Resolve a Blocker Manually

If the blocking condition is resolved (e.g., Supabase project is now ready but the conductor doesn't know it):

```bash
curl -X POST http://localhost:7776/blockers/blocker_xyz789/resolve \
  -H "Content-Type: application/json" \
  -d '{"resolution": "Supabase project confirmed ready via dashboard"}'
```

Expected response:
```json
{
  "blocker_id": "blocker_xyz789",
  "status": "resolved",
  "task_id": "task_abc123",
  "message": "Blocker resolved. Task will resume."
}
```

Wait 30 seconds, then re-check task status:
```bash
curl http://localhost:7776/tasks/task_abc123 | jq '.status'
```

---

## Step 5: Force-Cancel a Stuck Task

If the task cannot be unblocked (e.g., underlying operation failed and won't recover):

```bash
curl -X POST http://localhost:7776/tasks/task_abc123/cancel \
  -H "Content-Type: application/json" \
  -d '{"reason": "Task hung for > 30 minutes with no heartbeat. Force-cancelling."}'
```

Expected response:
```json
{
  "task_id": "task_abc123",
  "status": "cancelled",
  "message": "Task cancelled. Resources released."
}
```

---

## Step 6: Check for Orphaned Processes

The conductor may have spawned a child process that continued running after the conductor lost track of it.

```bash
# Check for orphaned content-engine or integrity-check processes
ps aux | grep -E "content-engine|integrity-check|verify:all" | grep -v grep
```

If you see processes that should have finished, kill them:
```bash
kill [PID]
# If kill doesn't work:
kill -9 [PID]
```

---

## Step 7: Restart the Conductor

If conductor health is not `ok` or the process isn't running:

```bash
# Check if it's running
ps aux | grep "conductor" | grep -v grep

# Stop gracefully if running
curl -X POST http://localhost:7776/shutdown

# Wait 3 seconds, then start fresh
sleep 3
cd ~/projects/pokerzeno-site-template
nohup pnpm run conductor:start > /tmp/conductor.log 2>&1 &
echo $! > /tmp/conductor.pid
```

Verify it started:
```bash
sleep 2
curl http://localhost:7776/health
```

---

## Step 8: Verify the Work Was Actually Done

After recovering from a stuck task, verify the work actually completed. For content seeding:

```bash
# Check if seed files were created
ls -la roulettecommunity/src/data/

# Check if the content arrays have data
node -e "const t = require('./roulettecommunity/src/data/tips.ts'); console.log(t.tips.length, 'tips')"
```

For an integrity check that got stuck:
```bash
# Re-run it manually
cd roulettecommunity
pnpm run verify:integrity
```

If the original task didn't complete its work, re-enqueue it:
```bash
curl -X POST http://localhost:7776/tasks \
  -H "Content-Type: application/json" \
  -d '{"type": "content_seed", "site": "roulettecommunity", "count": 60}'
```

---

## Step 9: Check Conductor Logs

If the issue was unexpected, check the logs before closing:
```bash
tail -n 100 /tmp/conductor.log
```

Look for:
- `ERROR` or `FATAL` lines explaining the failure
- Stack traces pointing to specific files
- Timeout messages

Document unusual errors here or in `locks/learnings.md` if they're likely to recur.

---

## Quick Reference

| Action | Command |
|--------|---------|
| Check health | `curl http://localhost:7776/health` |
| List tasks | `curl http://localhost:7776/tasks \| jq '.'` |
| List blockers | `curl http://localhost:7776/blockers \| jq '.'` |
| Resolve blocker | `curl -X POST .../blockers/{id}/resolve` |
| Cancel task | `curl -X POST .../tasks/{id}/cancel` |
| View logs | `tail -f /tmp/conductor.log` |
| Restart conductor | Kill process, then `nohup pnpm run conductor:start &` |
