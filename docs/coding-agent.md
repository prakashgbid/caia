# Coding Agent — operator runbook

**Last updated:** 2026-04-29
**Track:** Phase 2C worker pool (CODING-001 through CODING-009)
**Architecture report:** `~/Documents/projects/reports/phase2-completion-architecture-2026-04-28.md`
**Audience:** anyone running, debugging, or scaling the Coding Agent fleet.

## What it is

The Coding Agent is a long-running Node process that picks one
validated + test-designed ticket off the orchestrator's ready-pool,
implements it inside a per-story worktree, and opens a PR. After
`task.coding_complete` lands, the Fix-It Test Agent (Phase 2D) calls
back into the worker over a Unix-socket IPC channel to apply per-test
fixes without spending tokens on a fresh session.

It is the only Phase 2 worker that runs outside the orchestrator
process. Each instance is a peer of the Task Manager Agent (which lives
inside the orchestrator); communication is HTTP for lifecycle and Unix
socket for in-flight fixes.

Six building blocks ship one PR each (CODING-001 through CODING-006);
CODING-007 wires them to the orchestrator, CODING-008 is this runbook,
and CODING-009 is the real-git E2E harness.

| Block | PR | Lives in | Responsibility |
|---|---|---|---|
| `BundleReader` | #152 | `apps/worker-coding/src/bundle-reader.ts` | Fetch + zod-validate the ticket bundle from `GET /stories/:id/bundle`. |
| `WorktreeManager` | #153 | `worktree-manager.ts` | Claim a per-repo `git worktree add` against the integration branch. |
| `ImplementationEngine` | #154 | `implementation-engine.ts` | Drive the Claude Agent SDK turn-by-turn until `CODING_AGENT_DONE`. |
| `LocalTestRunner` | #155 | `local-test-runner.ts` | Discover + run unit/integration tests; bail on first failure. |
| `DiffCommitter` | #156 | `diff-committer.ts` | Conventional-commits format + `gh pr create` for the integration branch. |
| `DodSelfCheck` | #157 | `dod-self-check.ts` | 8-point Definition-of-Done gate before emitting `task.coding_complete`. |
| `IpcServer` + `Runtime` | #165 | `ipc-server.ts`, `runtime.ts`, `orchestrator-client.ts` | Wire the worker to the orchestrator (this PR). |

## Bringing up a worker

The worker is a single Node process. It registers with the orchestrator
on startup and runs until `SIGINT`, `SIGTERM`, or an inbound IPC
`shutdown`.

### Required env

```
ORCHESTRATOR_URL   http://localhost:7776 (or your prod orchestrator)
WORKER_KIND        coding (default)
HEARTBEAT_INTERVAL_MS  15000  (override only for tests)
POLL_INTERVAL_MS       5000   (override only for tests)
```

### Optional env

```
WORKER_CAPABILITIES   bucket_a,bucket_b   (comma-separated bucket ids the
                                          worker accepts; empty = any)
WORKER_SOCKET_DIR     /custom/sock/dir    (overrides ~/.caia/sockets)
```

### Running

```sh
cd apps/worker-coding
ORCHESTRATOR_URL=http://localhost:7776 \
  pnpm tsx src/main.ts
```

Or build + run the compiled CLI:

```sh
cd apps/worker-coding
pnpm build
ORCHESTRATOR_URL=http://localhost:7776 ./dist/src/main.js
```

The orchestrator must have wired Phase 2 (i.e. `wirePhase2()` in
`apps/orchestrator/src/api/start.ts`). Set
`CAIA_PHASE2_DISABLED=1` on the orchestrator to disable the entire
worker-pool subsystem (lifecycle endpoints will still work but won't
dispatch).

### Boot sequence

1. `readEnv()` loads + validates env vars.
2. `OrchestratorClient.register({ kind, capabilities, socketPath, metadata })`
   → returns `workerId`.
3. `IpcServer.start()` listens on `~/.caia/sockets/<workerId>.sock`.
4. Heartbeat loop ticks every `HEARTBEAT_INTERVAL_MS` (default 15s).
5. Assignment-poll loop ticks every `POLL_INTERVAL_MS` (default 5s) and
   calls the dispatch handler with the first new story it sees.
6. `SIGINT` / `SIGTERM` → release worker, close IPC, exit 0.

## Inspecting what a worker is doing

### Lifecycle state

```sh
# What workers exist?
curl -s http://localhost:7776/api/workers/list | jq '.workers[] | {id, kind, status, currentStoryId}'

# Aggregate counts + per-bucket queue cards
curl -s http://localhost:7776/api/workers/summary | jq

# Per-bucket health history
curl -s http://localhost:7776/api/workers/health/bucket_main | jq '.series[-5:]'
```

### Live worker introspection

The Unix socket exposes a tiny RPC API:

```sh
node -e "
import('./apps/worker-coding/src/ipc-server.js').then(async ({ ipcCall }) => {
  const sock = process.env.HOME + '/.caia/sockets/wkr_xxx.sock';
  console.log(await ipcCall(sock, 'health'));
  console.log(await ipcCall(sock, 'flush_logs'));
});
"
```

Or hand-craft one over `nc -U`:

```sh
echo '{"id":"1","method":"health"}' | nc -U ~/.caia/sockets/wkr_xxx.sock
```

The four methods:

| Method | When to call it | Returns |
|---|---|---|
| `health` | Quick "are you alive + working" check. | `{ ok, status, workerId, currentStoryId, uptimeMs }` |
| `flush_logs` | Pull recent log lines for a forensic. | `{ lines: string[] }` |
| `apply_fix` | (Fix-It Agent only) Drive the engine's `applyFix` loop with one fix request. | `{ status, sha, turns, totalTokens }` |
| `shutdown` | Graceful exit. The runtime releases the worker + closes the socket. | `{ graceful: true }` |

### Logs

Worker logs go to stderr by default. Wrap with `pm2`, `systemd`, or your
log shipper of choice.

```sh
pnpm tsx src/main.ts 2>&1 | tee -a /var/log/caia/worker-coding.log
```

The orchestrator emits the rest of the picture:

- `worker.registered` — every fresh boot.
- `worker.heartbeat` (debug) — every 15s, filterable by `severity=debug`.
- `worker.released` — clean shutdown.
- `worker.crashed` — stale-detector reaped this worker (heartbeat older
  than 60s).
- `task.assigned` — orchestrator has handed off a story.

Query them via `GET /api/events?type=worker.crashed&limit=20`.

## Troubleshooting

### Worker registered but never picks up a story

1. Confirm the orchestrator wired Phase 2:
   ```
   $ curl -s http://localhost:7776/api/workers/summary | jq '.counts'
   ```
   If `idle` is non-zero but stories aren't dispatching, the
   `ReadyPoolConsumer` isn't subscribed. Check the orchestrator log for
   `Phase 2 task-manager wired` on boot. If absent, `CAIA_PHASE2_DISABLED`
   is set or `wirePhase2()` failed; see the next bullet.
2. Capabilities mismatch:
   ```
   $ curl -s http://localhost:7776/api/workers/list | jq '.workers[] | {id, capabilities}'
   ```
   If the worker's `capabilities` is non-empty, it only accepts stories
   whose `bucketId` is in that array. Empty = any bucket.
3. No ready stories. Bucket-placer hasn't placed anything ready. Check
   `GET /api/buckets` and look for stories with `status=pending` +
   `assigned_worker_id IS NULL`.

### Worker keeps getting reaped as crashed

The stale-detector flips a worker to `crashed` after 60s without a
heartbeat. Causes:

- The worker process is paused (debugger, swap thrashing).
- Network partition between the worker host and the orchestrator.
- Heartbeat HTTP call is timing out (default 10s) — bump
  `OrchestratorClient` timeout if your orchestrator is slow.

When a worker is reaped, its assigned story stays put until you either
restart the worker (it'll re-register cleanly) or manually clear
`stories.assigned_worker_id`. The Fix-It Test Agent's `RetestLoopController`
(FIX-009) will eventually escalate, but a quick manual unblock is:

```sql
UPDATE stories SET assigned_worker_id = NULL, phase2_status = NULL
  WHERE assigned_worker_id = 'wkr_dead';
```

### IPC socket appears stale on restart

The worker unlinks any existing file at the socket path on boot, so
this should self-heal. If you see `EADDRINUSE` regardless:

```sh
lsof -U | grep wkr_xxx.sock
# kill the holding process; remove the file
rm -f ~/.caia/sockets/wkr_xxx.sock
```

Then restart the worker.

### `apply_fix` always errors with `no story in progress`

This is the default shim from `main.ts` until per-story state is wired
(CODING-009). For now, only call `apply_fix` against a worker that
`task.assigned` has dispatched to.

### CI fails on a Coding Agent PR

The DoD self-check (CODING-006) catches most issues before the worker
opens a PR. If CI fails after PR open, the typical causes are:

- `package.json` version was bumped (the gate refuses these PRs by
  default; override only via the `version-bump` claim in the bundle).
- A test the LocalTestRunner didn't discover (e.g. an integration suite
  hidden behind a non-standard script). Add it to the runner's tier-3
  command list.
- An unclaimed file edit. The DoD `claims-files` check trips when the
  worktree diff touches a file not in `bundle.claims.files`. Fix
  upstream by widening the claim, or by trimming the worker's edits.

### How do I tail what the model is doing right now?

The implementation engine doesn't expose its turn-by-turn output over
IPC by design (token bloat). Instead, it sets
`stories.coding_session_id` once it starts; pair that with the SDK
session log on disk:

```sh
ls -lah ~/.config/claude-agent-sdk/sessions/ | grep $(curl -s http://localhost:7776/api/stories/STORY_ID/bundle | jq -r '.story.coding_session_id // empty')
```

## Scaling

### Number of workers

Workers are stateless beyond their assigned story; you can run as many
as your laptop or container fleet can host. Practical guidance:

- **Local dev:** 1-2 workers. Real CI on a single laptop will saturate
  before this matters.
- **Single-host prod:** 4-8 workers per machine. Each holds one Claude
  SDK session; SDK CPU is bursty so over-subscribe by 2x your core count.
- **Distributed prod:** 1 worker per container, scheduled by your
  cluster manager. The orchestrator's stale-detector handles eviction
  if a pod dies.

The Backpressure Monitor (TASKMGR-004) caps the per-bucket queue at 25
ready stories by default; once you hit that, the PO Agent is told to
defer new prompt creation for that bucket. So even if you scale workers,
the queue can only grow so far before pressure is applied upstream.

### Capability targeting

If you want a worker to only pick up stories from a specific bucket
(e.g. a worker on a beefy GPU box for ML stories), set
`WORKER_CAPABILITIES=bucket_ml`. The `ReadyPoolConsumer` will only
hand it stories whose `bucketId` matches.

### Heartbeat tuning

The defaults (15s heartbeat, 60s stale threshold) give a 4x margin so
slow heartbeats don't get a worker reaped. Tighten to 5s/15s if you
want faster failover; loosen to 30s/120s if your orchestrator is under
heavy load.

## Wire diagram

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  Orchestrator (HTTP)     │        │  Coding Agent worker     │
│  apps/orchestrator       │        │  apps/worker-coding      │
│                          │        │                          │
│  Task Manager:           │        │   IpcServer (Unix sock)  │
│   • WorkerPoolRegistry   │◄──────►│      │                   │
│   • ReadyPoolConsumer    │ HTTP   │      ▼                   │
│   • BackpressureMonitor  │        │   Runtime                │
│   • HealthMetricsEmitter │        │      │                   │
│                          │        │      ▼                   │
│  /api/workers/*          │        │   ImplementationEngine   │
│   register/heartbeat/    │        │   LocalTestRunner        │
│   release/assignment     │        │   DiffCommitter          │
│                          │        │   DodSelfCheck           │
└──────────────────────────┘        └──────────────────────────┘
            ▲                                    ▲
            │ events bus                         │ Unix socket
            │ (worker.* + task.*)                │ apply_fix calls
            │                                    │
   ┌────────┴───────────────┐         ┌──────────┴─────────┐
   │  Fix-It Test Agent     │ ──────► │  Same Coding Agent │
   │  (Phase 2D)            │         │  (apply_fix loop)  │
   └────────────────────────┘         └────────────────────┘
```

## Memory + roadmap

This runbook reflects CODING-001..009. The remaining open items live in
the Phase 2 master sequencing memory:

- **CODING-009** — real-git E2E harness (CI-driven proof that the worker
  can produce a green PR end-to-end).
- **FIX-001..013** — Fix-It Test Agent track (consumes the IPC server
  this runbook documents).

For the design rationale + interaction sequence diagrams, see the
architecture report referenced at the top of this file.
