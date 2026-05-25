# @chiefaia/event-bus-nats

NATS JetStream backend for the ConductorEventBus. Implements the
publish/subscribe/replay surface from `@chiefaia/event-bus-internal`
but persists to a JetStream broker for cross-process, multi-host
inter-agent communication.

Spec: `research/inter_agent_communication_protocol_2026.md` §4.7.

## Status

V1 ships:

- Manifests for the broker (`caia/infra/nats/`)
- At-least-once envelope (NATS msg header + JSON body)
- One round-trip pub/sub path (publish → durable consumer → ack)
- 40+ vitest unit cases + 1 testcontainers-style integration test

V1 defers (follow-up):

- Full 57-event stream config (one stream-per-namespace shape is
  stubbed in `src/streams.ts`; the data covers a representative
  subset)
- Full saga semantics
- DLQ via `$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.*` (the hook
  point is wired; the routing handler ships in v0.2)

## Quickstart

```ts
import { NatsEventBus } from '@chiefaia/event-bus-nats';

const bus = new NatsEventBus({
  servers: ['nats://nats.chiefaia.svc.cluster.local:4222'],
  // auth + TLS injected by the operator
});

await bus.connect();

bus.subscribe('story.completed', (ev) => {
  console.log('got', ev.id, ev.type);
});

await bus.publish({
  type: 'story.completed',
  actor: 'executor',
  payload: { story_id: 'st_1', project_slug: 'p', status: 'verified' },
});
```

The class matches the shape of the in-process `ConductorEventBus`;
swap them behind the `BUS_BACKEND` env flag.

## Operational notes

- Subscription-only. No external SaaS managed-NATS account.
- Auth: NATS NKeys (operator-generated, mounted as Secret).
- Transport: TLS via cert-manager.
- Cost: $0 (runs on existing K3s cluster).

See `PLAN.md` for the architecture plan, `EA-REVIEW-OUTCOME.json`
for the EA Architect verdict, and `caia/infra/nats/` for the K3s
manifests.
