# Task Manager Agent — operator runbook

**Last updated:** 2026-04-28
**Track:** Phase 2 worker pool (TASKMGR-001 through TASKMGR-007)
**Architecture report:** `~/Documents/projects/reports/phase2-completion-architecture-2026-04-28.md`
**Audience:** anyone bringing up the orchestrator or debugging Phase 2 routing.

## What it is

The Task Manager Agent owns the runtime that picks validated +
test-designed tickets off the bucket-placer's ready-pool and dispatches
them to free Coding Agent workers. It also tracks worker liveness,
applies backpressure to the PO Agent when buckets fill, and emits the
per-bucket health metrics the dashboard renders.

Three composable pieces:

1. **`WorkerPoolRegistry`** (TASKMGR-002) — durable registry of every
   Coding/Fix-It worker process; in-process mirror of the `worker_pool`
   table from migration 0033. Stale-detector reaps workers whose
   heartbeat is older than 60 s.
2. **`ReadyPoolConsumer`** (TASKMGR-003) — bridges the BUCKET-009
   ready-pool recompute to the worker pool. On every
   `ticket.bucket_placed` / `task.completed`, snapshots stories,
   recomputes the ready set, and atomically assigns each ready story to a
   compatible idle worker. Atomicity comes from a SQLite transaction
   that re-checks worker.status + story.assignedWorkerId inside the tx.
3. **`BackpressureMonitor`** (TASKMGR-004) — per-bucket queue-depth
   watcher with hysteresis. Engages at depth ≥ ceiling, releases at
   depth ≤ ceiling - hysteresis. Defaults: ceiling = 25, hysteresis = 5.
4. **`HealthMetricsEmitter`** (TASKMGR-005) — periodic (default 60 s)
   per-bucket aggregator. Persists rows to `bucket_health_history`
   (migration 0034) and emits `task-scheduler.bucket.health` for live
   subscribers.

The `/api/workers/*` routes (TASKMGR-006) project the in-memory state
plus the persisted history for the dashboard.

## State model

Two tables own the Phase 2 runtime state:

- `worker_pool` (migration 0033) — one row per worker process. Fields:
  `id, kind ('coding'|'fix-it'), capabilities (JSON []), status
  ('idle'|'busy'|'crashed'|'released'), current_story_id,
  last_heartbeat_at, registered_at, released_at, metadata (JSON)`.
- `stories` (12 new columns from migration 0032): `assigned_worker_id,
  coding_session_id, worktree_path, feature_branch, pr_number, pr_url,
  pr_state, last_commit_sha, coding_attempts, fix_attempts,
  phase2_status, phase2_blocker_id`.

`phase2_status` taxonomy:

| value | meaning |
|---|---|
| `coding_in_progress` | Coding Agent has claimed; PR not yet open. |
| `coding_complete` | PR open; local unit/integration green. |
| `testing_in_progress` | Fix-It Test Agent running the testCases. |
| `testing_fixing` | mid-fix-loop (one or more retries in flight). |
| `tests_passing` | every testCase green; ready for PR merge. |
| `done` | PR merged; ticket closed. |
| `escalated` | fix-stuck or coding-stuck blocker filed. |

## Event taxonomy (additions from this track)

| Event | Severity | Payload (key fields) |
|---|---|---|
| `worker.registered` | info | workerId, kind, capabilities, registeredAt |
| `worker.heartbeat` | debug | workerId, status, currentStoryId, ts |
| `worker.released` | info | workerId, lastStoryId, releasedAt, reason |
| `worker.crashed` | error | workerId, lastStoryId, error, lastHeartbeatAt, ts |
| `task.assigned` | info | storyId, workerId, bucketId, assignedAt, correlationId |
| `task-scheduler.backpressure.engaged` | warning | bucketId, queueDepth, ceiling, ts |
| `task-scheduler.backpressure.released` | info | bucketId, queueDepth, ts |
| `task-scheduler.bucket.health` | debug | bucketId + the 5 metrics + ts |

`worker.crashed` is emitted by Task Manager (actor=task-scheduler), not
by the worker; the worker can't notify its own death.

## Lifecycle

### Worker startup (Coding Agent / Fix-It Agent)

```
worker process boots →
  registry.register({ kind, capabilities }) → emits worker.registered
  setInterval(15s, () => registry.heartbeat(workerId))
```

### Story assignment

```
bucket-placer writes story.bucket_id + emits ticket.bucket_placed →
  ReadyPoolConsumer.onBucketPlaced() →
    pump():
      snapshots stories where status='pending' AND assigned_worker_id IS NULL
      recompute() returns { ready, deferred, inFlight }
      for each ready story:
        listIdle({ kind: 'coding', bucket: story.bucketId })
        atomicAssign — tx flips worker + story
        emit task.assigned
```

### Backpressure engage / release

```
BackpressureMonitor.checkBucket(bucketId) →
  depth = SELECT count(*) FROM stories WHERE bucket_id=? AND status='pending' AND assigned_worker_id IS NULL
  if depth >= ceiling AND not engaged: engaged.add; emit engaged event
  if depth <= ceiling-hysteresis AND engaged: engaged.delete; emit released event
```

PO Agent subscribes to engaged/released; when a bucket it would write
into is engaged, it defers new prompts to
`prompts.status='deferred_backpressure'` and resumes on release.

### Stale detection

```
setInterval(30s, () => registry.detectStale()):
  for each row where last_heartbeat_at < now - 60_000 AND status in ('idle','busy'):
    flip to 'crashed'; emit worker.crashed
    Task Manager requeues currentStoryId by clearing assigned_worker_id +
    nulling phase2_status (so ReadyPoolConsumer picks it up next pump).
```

Workers in `released` or already `crashed` are skipped — never resurrected.

## Bringing up the orchestrator

Phase 2 wiring is in `wirePhase2()` (TASKMGR-007 in the same PR set).
The orchestrator startup sequence:

1. Apply migrations (0000..0034).
2. Wire event bus (`wireEventBus(db)`).
3. Construct `WorkerPoolRegistry`, `ReadyPoolConsumer`, `BackpressureMonitor`,
   `HealthMetricsEmitter`.
4. Subscribe consumer + monitor to the bus glob `ticket.bucket_placed`,
   `task.completed`, `task.tested_and_done`.
5. Start the periodic timers — registry stale-detector (30 s),
   health-metrics emitter (60 s).

## Operating

- **List workers + counts:** `curl localhost:9800/api/workers/list`.
- **Per-bucket dashboard summary:** `curl localhost:9800/api/workers/summary`.
- **Per-bucket sparkline:** `curl localhost:9800/api/workers/health/<bucket_id>`.
- **Manually evict a stuck worker:** today this is a SQL update
  (`UPDATE worker_pool SET status='crashed' WHERE id='wkr_xyz'`); a
  `POST /api/workers/:id/evict` endpoint is on the dashboard polish
  follow-up.
- **Drain a bucket on engaged backpressure:** wait for either workers
  to free up OR for PO to stop adding to the bucket; the system
  self-resolves once depth drops past ceiling - hysteresis.

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Worker crashes mid-story | Stale-detector flips to crashed at 60 s | Story requeued (assigned_worker_id cleared); next pump reassigns |
| Two pumps race the same idle worker | Atomic-assign tx aborts second one | Story tagged readyButUnassigned; next pump cycle picks up |
| Bucket fills past ceiling | `task-scheduler.backpressure.engaged` event | PO defers new prompts until release |
| `bucket_health_history` grows unbounded | Tablespace alarm | Periodic prune `DELETE WHERE ts < now() - 24h` (cron, future) |
| Ollama down → emit fails on `worker.heartbeat` | Bus emit returns void | Heartbeat itself doesn't depend on Ollama; debug-severity event drops silently |

## Tests

- `tests/db/0032-0033-phase2-worker-pool.test.ts` — migration roundtrip (15 cases).
- `tests/agents/worker-pool-registry.test.ts` — registry contract (21 cases).
- `tests/agents/ready-pool-consumer.test.ts` — atomic assign + race (14 cases).
- `tests/agents/backpressure-monitor.test.ts` — engage/release + hysteresis (11 cases).
- `tests/agents/health-metrics-emitter.test.ts` — aggregation + persistence (10 cases).
- `tests/api/workers-routes.test.ts` — contract (6 cases).

Total: 77 jest cases.

## What's NOT here

- The Next.js `/workers` dashboard page is a separate UI PR (followup).
- Auto-eviction of crashed workers' assigned stories — the assigned-worker
  clear is in the next PR (TASKMGR-007 wiring).
- Per-worker observability metrics (Prometheus exporters) are a follow-up.
