# Plan: @chiefaia/event-bus-nats — NATS JetStream broker for inter-agent comms

**Plan type:** implementation
**Caller agent:** `@chiefaia/event-bus-nats` (this package)
**Submitted by:** Stolution
**Affected components:** `@chiefaia/event-bus-nats`, `@chiefaia/event-bus-internal`, `@chiefaia/events-taxonomy-internal`, `caia/infra/nats/`
**Spec:** `research/inter_agent_communication_protocol_2026.md` §4.7 (NATS JetStream as the recommended broker)
**Branch:** `feature/event-bus-nats-2026-05-25`

## Goal

Build the NATS JetStream backend for the ConductorEventBus. The
in-process `@chiefaia/event-bus-internal` is correct for V1 single-host
topology but the spec's §2.4 says cross-process scaling is now the
live concern. This package wraps `nats.js` and exposes the same
`publish(partial) → ConductorEvent`, `subscribe(typeGlob, handler) → unsubscribe`,
and `replay(opts) → ConductorEvent[]` surface, so consumers swap
backends behind a `BUS_BACKEND=jetstream` flag with no API change.

## Scope (V1 — this PR)

Per the operator's scope-cut clause:

1. **K3s manifests** at `caia/infra/nats/`: StatefulSet (3 replicas),
   PVC per replica (10 Gi), ConfigMap with TLS + NKey-aware
   `nats-server.conf`, headless + client Services, NetworkPolicy
   restricting traffic to the `chiefaia` namespace.
2. **Package skeleton** `@chiefaia/event-bus-nats` matching the
   `ConductorEventBus` shape from `@chiefaia/event-bus-internal`.
3. **At-least-once envelope** — every event carries
   `{id, correlation_id, causation_id, trace_id, idempotency_key, sender, recipients, payload, schema_version, occurred_at}`
   serialised as JSON in the NATS message body with the dispatch
   subject derived from `event.type`.
4. **One round-trip pub/sub path** — publish → JetStream stream
   `chiefaia-events` → durable consumer → ack.
5. **40+ vitest unit cases** covering envelope shape, subject
   derivation, subscribe semantics, ack/retry guards, reconnect
   stub, and interface conformance against `@chiefaia/event-bus-internal`.

## Scope (deferred — follow-up PRs)

- Full per-namespace stream config for all 57 events from
  `@chiefaia/events-taxonomy-internal/registry.yaml`. V1 ships a
  single catch-all stream `chiefaia-events` with subject filter
  `chiefaia.>`; per-namespace fanout is the v0.2 change.
- Saga semantics for multi-stage compensating actions
  (spec §6).
- Full DLQ routing via `$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.*`.
  The hook point is wired in `src/dlq.ts`; the routing handler ships
  in v0.2.
- Two-way request/reply via reply-to subjects (spec §3.6).
- Federated multi-cluster deployment (spec §12).

## State-machine integration

Not applicable — this package is a transport, not a workflow node.
It does not own any FSM transitions in `@caia/state-machine`. It
does emit events that drive other packages' FSMs (e.g.,
`@caia/state-machine`'s `SolutionLifecycleMachine.advance` is
ultimately driven by handlers that subscribe via this bus).

## API

```ts
import { NatsEventBus, type EventBus, type EventEnvelope } from '@chiefaia/event-bus-nats';

const bus = new NatsEventBus({
  servers: ['nats://nats.chiefaia.svc.cluster.local:4222'],
  auth: { nkeySeed: process.env.NATS_NKEY_SEED! },
  tls: { caFile: '/etc/nats/tls/ca.crt' },
  stream: 'chiefaia-events',
  subjectPrefix: 'chiefaia',
});

await bus.connect();

const unsub = bus.subscribe('story.completed', (ev) => { ... });

const published = await bus.publish({
  type: 'story.completed',
  actor: 'executor',
  payload: { story_id: 'st_1', project_slug: 'p', status: 'verified' },
});
```

The class is a drop-in for `ConductorEventBus` from
`@chiefaia/event-bus-internal`: identical method shapes, identical
`ConductorEvent` return type. Consumers that today import the
singleton `eventBus` can call `setBusBackend(natsBus)` to swap.

## Files

- `src/types.ts` — `EventBus` interface (extracted from
  `@chiefaia/event-bus-internal`), `EventEnvelope` (the wire shape
  used by NATS), `NatsEventBusConfig`.
- `src/envelope.ts` — `encodeEnvelope(event) → Uint8Array`,
  `decodeEnvelope(bytes) → ConductorEvent`, `subjectFor(eventType)`.
- `src/streams.ts` — stream + consumer config. V1 ships one stream
  (`chiefaia-events`); the per-namespace expansion is sketched but
  not wired (commented `// TODO: v0.2`).
- `src/index.ts` — `NatsEventBus` class. Wraps `nats.js`, implements
  the bus surface, handles reconnect with exponential backoff,
  backpressure via the publish queue, at-least-once via
  `AckPolicy.Explicit`.
- `src/dlq.ts` — placeholder for the DLQ advisory handler. Wired but
  not active in V1.
- `scripts/submit-plan.mjs` — submits this PLAN.md to
  `@caia/ea-architect.submitPlan` with `CAIA_EA_STUB=1` fallback.
- `tests/envelope.test.ts` — 8 cases on envelope encode/decode and
  subject derivation.
- `tests/publish.test.ts` — 8 cases on publish path (envelope
  population, severity resolution, ID generation, etc.).
- `tests/subscribe.test.ts` — 8 cases on subscribe + glob matching.
- `tests/ack-retry.test.ts` — 8 cases on ack semantics and retry
  budget.
- `tests/reconnect.test.ts` — 6 cases on reconnect + backoff.
- `tests/interface.test.ts` — 4 cases verifying conformance with
  the `EventBus` shape from `@chiefaia/event-bus-internal`.
- `tests/integration/round-trip.test.ts` — 1 integration case that
  spins a real nats-server (testcontainers pattern) and verifies a
  publish → subscribe round-trip.

## Reuse

- `@chiefaia/events-taxonomy-internal` — `ConductorEvent`, `EventType`,
  `EventActor`, `EventSeverity`, `EVENT_SEVERITY`. This package does
  NOT redefine the taxonomy.
- `@chiefaia/event-bus-internal` — the `EventBus` shape (publish /
  subscribe / replay). Extracted to an explicit `interface EventBus`
  in `src/types.ts` so future backends conform.
- `nats.js` (v2.28+) — first-party NATS Node SDK. JetStream API
  via `nc.jetstream()`.
- `picomatch` — same glob matcher the in-process bus uses, for
  subscribe-side filtering.

## Non-goals

- No `replay()` over the broker yet. V1 returns `[]` from `replay`
  and points consumers at the existing Postgres outbox via
  `@chiefaia/event-bus-internal`. JetStream-backed replay (seek by
  sequence) is v0.2.
- No managed-NATS / SaaS integration. Self-hosted on stolution K3s
  only. `$0` operator rule.
- No exactly-once delivery. At-least-once via `AckPolicy.Explicit`
  + idempotency_key in the envelope; consumers dedupe by key.
- No schema enforcement at the broker. Taxonomy enforcement stays
  in `@chiefaia/events-taxonomy-internal` at the type layer.

## Risk register check

- **P-no-vendor-lockin**: NATS is open-source (Apache 2.0). Self-hosted.
  No SaaS account. Wire protocol is documented and any conformant
  client works.
- **P-true-zero**: Admin-merge gate is ratified by the operator
  for the build phase; CI must still go green before merge.
- **P-idempotency**: Every envelope carries `idempotency_key`;
  consumers dedupe on that key. The wire format includes it as a
  first-class field.
- **$0 cost**: Self-hosted; runs on the existing K3s nodes; no new
  AWS/SaaS spend.
- **Auth posture**: NKeys generated offline, mounted as a Secret.
  TLS via cert-manager. NetworkPolicy restricts to chiefaia
  namespace.

## Operational verification (DoD)

1. `kubectl apply -n chiefaia -f caia/infra/nats/` succeeds.
2. `kubectl get statefulset nats -n chiefaia` shows `READY 3/3`.
3. `kubectl exec -n chiefaia nats-0 -- nats stream ls` lists the
   `chiefaia-events` stream.
4. Publish a test event through `@chiefaia/event-bus-nats` from
   one process; subscribe from a second; confirm round-trip
   delivery + ack.
5. CI green on the feature branch.
6. Merge to develop under True-Zero admin-merge.
