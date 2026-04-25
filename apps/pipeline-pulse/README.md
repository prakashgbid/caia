# pipeline-pulse

Autonomous 3-layer health check for the Conductor pipeline. Runs on demand or on a schedule via `conductor pulse`.

## Algorithm

```
conductor pulse
     │
     ├─► Layer 1: Synthetic Canary      (end-to-end latency probe)
     │     Creates a [PULSE-CANARY] task, dispatches it, measures completion time.
     │     25s timeout. Passes when executor picks up + completes within SLA.
     │
     ├─► Layer 2: State Invariants      (checksums compared to previous run)
     │     • Event count non-decreasing
     │     • Running tasks have executor_run
     │     • Completed task count non-decreasing
     │
     └─► Layer 3: 15 Micro-probes       (run in parallel, 8s per check)
           Stage: infra      → api-reachable, db-writable, db-size, disk-space, memory-pressure
           Stage: executor   → executor-enabled, executor-heartbeat-fresh, no-stuck-running,
                               circuit-breaker-open, failed-tasks-rate
           Stage: pipeline   → queue-not-stalled, event-bus-writable, long-running-tasks,
                               scheduler-coherent, blocker-count
```

## Outcome Levels

| Outcome | Meaning |
|---------|---------|
| `PASSING` | All checks pass, canary completed |
| `DEGRADED` | Non-critical checks failing, pipeline operational |
| `CRITICAL` | Critical checks (`api-reachable`, `db-writable`) or canary failed |
| `AUTO-HEALED` | Checks failed, heals ran and fixed the issue |

## Decision Tree

Failing checks trigger heals automatically (unless `--no-heal`):

| Failing Check | Heal Action |
|---------------|-------------|
| `executor-heartbeat-fresh` | `restart-executor` (re-enables executor) |
| `executor-enabled` | `restart-executor` |
| `no-stuck-running` | `flush-stalled-runs` + `reset-stuck-tasks` |
| `queue-not-stalled` | `reset-stuck-tasks` |
| `circuit-breaker-open` | `reset-circuit-breaker` (unpause tripped tasks) |
| `disk-space` | `gc-worktrees` (remove orphaned git worktrees) |

Heals are **idempotent** — calling a heal when the system is already healthy is a no-op (does not count as AUTO-HEALED).

## Usage

```bash
# Standard run
conductor pulse

# JSON output (for scripting / heartbeat scheduled task)
conductor pulse --json

# Skip auto-heal phase
conductor pulse --no-heal

# Skip synthetic canary (faster, less coverage)
conductor pulse --no-canary
```

## Adding a New Check

1. Create `src/checks/your-check.ts`:

```typescript
import type { Check, CheckResult, PulseContext } from '../types';

// @no-events — check result reported via pulse.ts orchestrator
export const yourCheck: Check = {
  name: 'your-check',
  stage: 'pipeline', // 'infra' | 'executor' | 'pipeline'
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    // ... your check logic ...
    return { name: this.name, stage: this.stage, passed: true, message: 'ok', durationMs: Date.now() - t0 };
  },
};
```

2. Export from `src/checks/index.ts` and add to `ALL_CHECKS` array.

3. Add a test in `src/__tests__/pulse.test.ts`.

## Adding a New Heal

1. Create `src/heal/your-heal.ts`:

```typescript
import type { HealAction, HealResult, PulseContext } from '../types';
import { emitHealEvent } from '../emit';

// @no-events — emitHealEvent handles event emission
export const yourHeal: HealAction = {
  name: 'your-heal',
  triggeredByChecks: ['your-check'],  // checks that trigger this heal
  async run(ctx: PulseContext): Promise<HealResult> {
    const t0 = Date.now();
    // Check current state first for idempotency
    // ... heal logic ...
    const result: HealResult = { action: this.name, triggeredBy: 'your-check', success: true, idempotent: false, message: 'healed', durationMs: Date.now() - t0 };
    await emitHealEvent(ctx, this.name, 'your-check', true);
    return result;
  },
};
```

2. Export from `src/heal/index.ts` and add to `ALL_HEALS` array.

## Observability

Every pulse run:
- Emits `system.pipeline_pulse` event (queryable via `/events`)
- Emits `pulse.canary_dispatched` / `pulse.canary_completed`
- Emits `pulse.heal_applied` / `pulse.heal_failed` for each heal
- Persists to `pulse_runs` table (queryable via `/pulse/runs`)
- Visible in dashboard at `/health/pulse`

## Canary Bypass

When a task has `notes: '{"canary":true}'`, the executor dispatcher produces a minimal prompt (`echo "[result] DONE: canary ok"`) instead of the full task prompt. This skips story/epic expansion and keeps canary latency to 5–10s instead of minutes.

## Auto-purge

The heartbeat scheduled task calls `DELETE /pulse/canary/purge` after each run, which trims old PASSING run records beyond the last 288 entries (24h @ 5min cadence).
