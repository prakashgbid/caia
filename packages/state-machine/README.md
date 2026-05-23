# @caia/state-machine

A typed pipeline-status finite-state machine for CAIA projects.

* Strict enum of ~40 project states (happy, failed, control).
* Statically-enumerated valid transitions; invalid moves throw a typed `InvalidTransitionError`.
* Optimistic-locked atomic transitions with retry budget and payload-hash idempotency.
* Postgres-backed durable store **and** an in-memory store for tests.
* Distributed worker assignment (`tryAssignWork` / `recordWorkerHeartbeat` / `completeWork` / `expireInactiveWorkers`) backed by Postgres advisory upserts.
* LISTEN/NOTIFY → SSE realtime feed.
* `whatsNext(projectId)` — idempotent next-step helper used by the orchestrator.

This package is consumed by the CAIA orchestrator chain (`@chiefaia/chain-runner`,
`@chiefaia/capability-broker`). See the
[`state_machine_handoff_spec_2026.md`](../../../research/state_machine_handoff_spec_2026.md)
for the source-of-truth design.

## Usage

```ts
import { Pool } from 'pg';
import {
  StateMachine,
  PgStateStore,
  InMemoryStateStore,
  whatsNext,
} from '@caia/state-machine';

const pool = new Pool({ connectionString: process.env.PG_DSN });
const sm = new StateMachine(new PgStateStore(pool));
await sm.init(); // runs migration

const project = await sm.createProject({
  tenantId: 't1',
  slug: 'my-project',
  displayName: 'My Project',
});

await sm.transition(project.id, 'idea-captured', {
  reason: 'onboarding-complete',
  triggeredBy: { kind: 'system', id: 'orchestrator' },
});

const next = await whatsNext(sm, project.id);
// { hasWork: true, agent: { type: '@caia/idea-capture', ... } }

const unsub = await sm.subscribeToProject(project.id, (evt) => {
  console.log('state transition:', evt);
});
```

## Stores

Use `InMemoryStateStore` for unit tests. Use `PgStateStore` for everything else.

```ts
const sm = new StateMachine(new InMemoryStateStore());
```

## States

The canonical state enum lives in `src/states.ts` and the valid-transition table
in `src/transitions.ts`. Both are sourced from the spec.

## Scripts

```sh
pnpm --filter @caia/state-machine test       # vitest
pnpm --filter @caia/state-machine typecheck  # tsc --noEmit
pnpm --filter @caia/state-machine build      # tsc → dist/
```

## License

MIT.
