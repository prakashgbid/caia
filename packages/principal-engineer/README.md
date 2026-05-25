# @caia/principal-engineer

Stage 12 in CAIA's canonical pipeline. Takes EA-approved + Test-Author-prepared
tickets and distributes them across N parallel coding workers, deciding
parallel-vs-sequential bucketing from a typed dependency graph. Dispatches
Full-Stack-Engineer subagents up to the per-tenant concurrency cap. Drives the
state-machine transition `tests-reviewed -> scheduled` per ticket.

## Surface

```ts
import { schedule } from '@caia/principal-engineer';

const result = await schedule(
  {
    tickets: [
      { ticketId: 'T-001', dependsOn: [] },
      { ticketId: 'T-002', dependsOn: ['T-001'] },
      { ticketId: 'T-003', dependsOn: ['T-001'] },
    ],
    projectIdByTicket: { 'T-001': 'p1', 'T-002': 'p1', 'T-003': 'p1' },
    tenantTier: 'pro',
  },
  {
    stateMachine,            // @caia/state-machine StateMachine instance
    spawnFn: spawnClaude,    // injectable for tests
    fseSubagentPath: '.../caia-coding.md',
  },
);
// → { wavePlan, dispatched, transitions, failures }
```

## State-machine integration

Owns:
- `tests-reviewed -> scheduled` (per ticket; happy path)
- `tests-reviewed -> scheduling-failed` (cycle / dispatch exhausted)

Drives downstream (FSE owns):
- `scheduled -> coding-in-progress`

No new FSM states are added; every edge stays inside the canonical table in
`@caia/state-machine/transitions.ts`.

## Subscription-only

`@chiefaia/claude-spawner` is the only spawn path. It unconditionally scrubs
`ANTHROPIC_API_KEY` and the other auth-token env vars so the binary falls
through to the OAuth/keychain subscription session.

## Tenant tiers

| Tier       | Default concurrency cap |
| ---------- | ----------------------- |
| free       | 2                       |
| pro        | 5                       |
| enterprise | 10                      |

Override per-scheduler-call via `tenantOverrideCap`.

## Files

- `src/dependency-graph.ts` — pure graph layer (build, SCC, topo levels).
- `src/bucketer.ts` — wave + bucket assignment.
- `src/worker-pool.ts` — lifecycle around `StateMachine` worker primitives.
- `src/dispatcher.ts` — per-wave FSE fan-out.
- `src/api.ts` — `POST /api/principal-engineer/schedule` adapter.
- `src/types.ts` — public types.
- `src/index.ts` — re-exports + `schedule()`.

## Tests

`pnpm -F @caia/principal-engineer test` — ≥40 vitest cases including a
50-ticket integration scenario and a smoke test against the real FSE
subagent template.

## Plan

See `PLAN.md`. EA outcome recorded in `EA-REVIEW-OUTCOME.json`
(approved-with-modifications; operator-led live review required before True-Zero
admin-merge).
