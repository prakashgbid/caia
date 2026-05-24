# @caia/pipeline-conductor

The Pipeline Status Manager Agent for CAIA's 17-stage Build Pipeline.

Pipeline Conductor answers the question *"where is every project right now, what is stuck, and what is done?"* It is the dashboard's brain, the operator's pager, and the EA Agent's eyes.

Built as a **wrapper, not a rewrite**: layered over `@chiefaia/event-bus-internal`, `@caia/state-machine`, and a Postgres materialised view (`mv_pipeline_status`). Pipeline Conductor reads, never writes the source-of-truth tables. It emits a small derivative event set:

- `conductor.escalation.opened`
- `conductor.escalation.closed`
- `conductor.forecast.updated`
- `conductor.pipeline-bottleneck.detected`

Source-of-truth design: [`research/conductor_agent_spec_2026.md`](../../../research/conductor_agent_spec_2026.md).

## Capabilities

- Subscribes to **every** event on the bus and projects relevant ones into `mv_pipeline_status`.
- Watchdog scans for stuck stages every 30 s and opens escalations (idempotent via a unique partial index).
- Per-stage statistical (p50/p90) forecaster — no ML in V1. Tenant samples preferred; platform fallback at 10 samples; "we don't have enough data yet" below that.
- SSE channels per project / per tenant / platform, multiplexed off Postgres `LISTEN/NOTIFY`.
- Claude Code Subagent definition (`src/subagent.md`) for on-demand diagnostic queries.
- launchd plist (`launchd/com.caia.pipeline-conductor.plist`) for the projector daemon.

## Install

```sh
pnpm --filter @caia/pipeline-conductor install
pnpm --filter @caia/pipeline-conductor build
```

Run the six migrations against your Postgres (in order):

```sh
psql "$PG_DSN" -f migrations/001_mv_pipeline_status.sql
psql "$PG_DSN" -f migrations/002_conductor_escalations.sql
psql "$PG_DSN" -f migrations/003_conductor_stage_durations.sql
psql "$PG_DSN" -f migrations/004_conductor_projector_cursor.sql
psql "$PG_DSN" -f migrations/005_conductor_notify_triggers.sql
pnpm --filter @caia/pipeline-conductor register-events
```

`register-events` is idempotent — re-running reports `added=0 present=4`.

## Usage

```ts
import { Pool } from 'pg';
import { eventBus } from '@chiefaia/event-bus-internal';
import { StateMachine, PgStateStore } from '@caia/state-machine';
import { ConductorClient, Projector } from '@caia/pipeline-conductor';

const pool = new Pool({ connectionString: process.env.PG_DSN });
const sm = new StateMachine(new PgStateStore(pool));
await sm.init();

const projector = new Projector({ pool, bus: eventBus });
projector.start();

const client = new ConductorClient({ db: pool, bus: eventBus, stateMachine: sm });

const status = await client.getProjectStatus('<project-id>');
const stuck  = await client.listStuckProjects({ thresholdMinutes: 30 });
const health = await client.getPipelineHealth({ windowMinutes: 60 });
await client.escalate({
  projectId: '<project-id>',
  stage: 'coding-in-progress',
  reason: 'operator-initiated',
  notes: 'CI looks down — eyeball the GitHub Actions queue',
});
```

## Subscribe via SSE

The state-machine package exposes `handleProjectSse(sm, req, res, projectId)` (writes EventSource frames per project). Pipeline Conductor reuses that machinery — open a long-lived `GET /api/projects/:id/status-stream` on your HTTP layer and pipe events through `handleProjectSse`.

Channel-naming convention:

- `conductor:project:<projectId>` — per-project status changes
- `conductor:tenant:<tenantId>`   — tenant-wide events (escalations, forecasts)
- `conductor:platform`            — platform-wide rollup events

The `005_conductor_notify_triggers.sql` migration installs the trigger that fires on `conductor_escalations` INSERT/UPDATE-close.

## Run the projector daemon

```sh
cp launchd/com.caia.pipeline-conductor.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.caia.pipeline-conductor.plist
tail -f ~/Library/Logs/caia/conductor-projector.out.log
```

`KeepAlive=true` restarts on crash; the projector replays from the persisted cursor in `caia_meta.conductor_projector_cursor`.

Override the policy file via env:

```xml
<key>CONDUCTOR_POLICY_PATH</key>
<string>/path/to/your/escalation-policies.json</string>
```

## Escalation tuning

Defaults live in `src/escalation-policies.ts` (`DEFAULT_STAGE_THRESHOLDS`). Override per-tenant or globally with JSON:

```jsonc
{
  "coding-in-progress": { "dwell": 86400, "heartbeat": 1800 },
  "interview-complete": { "dwell": 7200, "heartbeat": 7200 }
}
```

Behaviour:

- Heartbeat watchdog only fires when an active agent run exists.
- Dwell watchdog only fires when the project is not paused.
- Paused projects suppress both watchdogs.
- Repeated-failure watchdog: `≥3 task.failed` in `1h` for same project opens escalation.
- Auto-close: on the next projector tick after the project transitions out.

## Subagent

`src/subagent.md` is a Claude Code subagent definition. Drop into `.claude/agents/`:

```
Task({ subagent_type: 'pipeline-conductor', prompt: 'where is project X?' })
```

Read-only by design. Sonnet by default.

## Integration with EA Architect Agent

Pipeline Conductor's bottleneck events feed governance recommendations to the EA Agent. When `conductor.pipeline-bottleneck.detected` fires with `recommended_action: 'escalate-to-architect'`, EA Agent's subscriber surfaces it as an operator-decision item in `agent-memory/INBOX.md` and may propose a plan modification through its `submitPlan` API.

This is the FIRST plan to go through the EA Agent (PR #556, merged 2026-05-24).

## Scripts

```sh
pnpm --filter @caia/pipeline-conductor build
pnpm --filter @caia/pipeline-conductor typecheck
pnpm --filter @caia/pipeline-conductor test
pnpm --filter @caia/pipeline-conductor register-events
```

## Honesty calibration

V1 has two known limitations:

1. Forecasting is **statistical**, not learned. Sum-of-p90s ≠ true p90 (Central Limit Theorem). Render as "could take up to".
2. Escalation thresholds are **hand-tuned**. The EA Agent should eventually own calibration; expect drift and tune via the JSON override file.

## License

MIT.
