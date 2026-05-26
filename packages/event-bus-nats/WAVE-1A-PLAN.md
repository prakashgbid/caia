# Plan: Wave 1a — Migrate first 3 events from in-process bus to NATS JetStream

**Plan type:** implementation
**Caller agent:** Stolution (operator-supplied scope)
**Submitted by:** autonomous-build (2026-05-25)
**Branch:** `feature/nats-event-migration-wave1a-2026-05-25` (cut from `origin/develop`)
**Spec:** research/inter_agent_communication_protocol_2026.md §4.7 (the Wave 1a slice of the 121-event taxonomy migration)
**ADRs touched:** none new; aligns with ADR-065 (reuse-first) and the True-Zero admin-merge exception (PR #587)

## Goal

Wave 1a takes the first 3 highest-traffic CAIA events off the in-process
`@chiefaia/event-bus-internal` EventEmitter and routes them through the
JetStream-backed `@chiefaia/event-bus-nats` package (shipped in PR #590).
The cutover is gated by an env var so the change is a no-op for
operators who haven't flipped the flag yet — the V1 NATS skeleton has
been live since PR #590 but no events actually flowed through it.

This unlocks cross-process / multi-host fanout for those three events
without touching the other 118; the next waves migrate by namespace.

## Scope (Wave 1a — this PR)

### Three events flipped
1. **`tenant.provisioned`** — first-time signup fan-out from
   `apps/dashboard/lib/tenants/provision.ts`. Low frequency, must not
   be lost. Explicit ack, max_deliver=3, DLQ on exhaustion.
2. **`worker.heartbeat`** — per-second observability ping from
   `apps/orchestrator/src/agents/worker-pool-registry.ts`. High volume.
   `ackPolicy: 'none'`, `max_ack_pending: 1000` — heartbeats are
   observability, not workflow, so dropping one is fine and paying
   broker bookkeeping per heartbeat is not.
3. **`pipeline.stage.advanced`** — central cross-cutting pipeline
   state event with publishers in `pipeline-stages.ts`,
   `api/routes/{executor,stories,task-runs,prompts}.ts`,
   `requirements/manager.ts`. Subscribed to by the Projector. Explicit
   ack, max_deliver=3, DLQ on exhaustion.

The originally-named third event `solution-lifecycle.state-changed`
was not on develop (the state-machine worktree that introduces it is
unmerged); `pipeline.stage.advanced` was substituted with operator
sign-off because it exists, is high-traffic, and exercises the
migration harder than the originally-named slot.

### Code additions (all in `@chiefaia/event-bus-nats`, the canonical reuse target)

- `src/router.ts` — `HybridEventBus` that wraps the legacy in-process
  bus + `NatsEventBus`, routes per event-type via the
  `BUS_BACKEND_NATS_FOR_EVENT_TYPES` env var (CSV). Default empty =
  zero behavioural change. Includes Node-EventEmitter passthrough
  (`on/off/emit`) so the WS gateway keeps working unchanged.
- `src/wave1a.ts` — Wave 1a constants (`WAVE_1A_EVENT_TYPES`,
  `WAVE_1A_CONSUMER_OVERRIDES`, `WAVE_1A_DLQ_SUBJECT`).
- `src/dlq.ts` (rewritten) — `publishToDlq()` helper that wraps the
  envelope with a `dlq` provenance block (original subject, delivery
  count, last error, failed_at) and republishes to
  `chiefaia.events.dlq`. `nakBackoffMs()` helper for
  exponential-backoff nak with jitter.
- `src/index.ts` (extended) — `NatsEventBus.startConsumer` now tracks
  `msg.info.redeliveryCount`, naks with exponential backoff inside
  the retry budget, and republishes + ack's once
  `maxRetriesBeforeDlq` is exceeded. New `consumerOverrides` config
  threads per-typeGlob ack policy / max_ack_pending into the
  consumer.add call. New `dlqSubject` config defaults to
  `chiefaia.events.dlq`.
- `src/types.ts` (extended) — `ConsumerOverride`, optional
  `consumerOverrides`/`dlqSubject`/`maxRetriesBeforeDlq` on
  `NatsEventBusConfig`, optional `dlq` provenance block on
  `EventEnvelope`.

### App wiring

- `apps/orchestrator/src/events/bus-adapter.ts` — re-exports
  `HybridEventBus` AS `eventBus`. The 105 existing call sites that
  import `eventBus` from this module automatically pick up routing
  with zero source changes. The legacy SQLite outbox still works
  because `wireEventBus(db)` is still called on the legacy singleton.
  `connectHybridBus()` + `closeHybridBus()` are wired into
  `api/start.ts`.
- `apps/orchestrator/src/api/routes/events.ts` — `await`s the publish
  return value (the only sync-return caller in the codebase).
- `apps/dashboard/lib/tenants/wire.ts` — replaces the V1 skeleton
  publisher (which constructed a `NatsEventBus` but never called
  `connect()`, so every publish silently threw) with a lazily-
  connecting `HybridEventBus`. Connection errors are now surfaced.

### Tests

54 new vitest cases across:
- `tests/router.test.ts` (27) — `parseFlagCsv`, construction, publish
  routing, dual fan-in subscribe, replay, setSender, dual unsub.
- `tests/per-event-config.test.ts` (9) — `worker.heartbeat`
  override wire-through, bus-default fallback, independent overrides.
- `tests/dlq-publish.test.ts` (10) — `nakBackoffMs`, `publishToDlq`,
  default DLQ handler.
- `tests/consume-retry-dlq.test.ts` (8) — explicit-ack retry budget,
  DLQ republish on exhaustion, `ackPolicy='none'` drop-on-failure.
- `tests/integration/wave1a-events.integration.test.ts` (4) —
  full round-trips against a real NATS broker. Gated by
  `it.skipIf(!process.env.NATS_INTEGRATION_URL)` per the operator
  brief — CI runs the live tests separately.

All 135 unit tests pass locally (`pnpm -F @chiefaia/event-bus-nats test`).
Typecheck clean for `@chiefaia/event-bus-nats`, `@caia-app/core`
(orchestrator), and the dashboard app.

## Out of scope (intentional)

- Other 118 event types — stay on the in-process bus. They flow
  through `HybridEventBus` unchanged (sync path, no NATS round-trip).
- JetStream-side replay — still returns `[]`; replay defers to the
  legacy SQLite outbox.
- DLQ consumer / triage automation — only the publish side is wired.
  An operator can `nats sub 'chiefaia.events.dlq'` to inspect.
- Per-namespace stream fanout — V1's single catch-all
  `chiefaia-events` stream is sufficient for Wave 1a's three events.
  v0.2 splits the 15 namespaces from `events-taxonomy-internal`
  registry.yaml.

## Reuse-first verification

`@chiefaia/event-bus-nats` is the canonical reuse target per the
operator brief. No parallel NATS client is introduced. The
`HybridEventBus` lives INSIDE that package so the routing logic is
co-located with the backend it routes to.

Reuse-search results (machine-readable form in
WAVE-1A-EA-OUTCOME.json):

- **@chiefaia/event-bus-nats** (selected) — V1 NATS skeleton +
  envelope + streams config. Wave 1a extends in place.
- **@chiefaia/event-bus-internal** (selected) — legacy in-process bus.
  Wrapped, not replaced. Retains SQLite outbox + WS EventEmitter.
- **@chiefaia/events-taxonomy-internal** (selected) — taxonomy
  registry consulted at publish time via `isValidEventType`.
- **@chiefaia/tracing** (selected) — `withNatsPublishSpan` +
  `withNatsConsumeSpan` already wired in PR #608. Wave 1a inherits
  the OTel spine on every NATS-routed event for free.
- **nats** (npm, existing dep) — JetStream client. No new client.

## Rollout

Default-empty `BUS_BACKEND_NATS_FOR_EVENT_TYPES` ships the code with
zero behavioural change. Operator flips the flag in env (k3s ConfigMap
or pm2 env) per service to migrate the events one at a time, observing
the DLQ subject and Tempo traces.

Suggested rollout order:
1. `tenant.provisioned` (low frequency, easy rollback)
2. `pipeline.stage.advanced` (proves the central event works)
3. `worker.heartbeat` (firehose, hardest test of broker load)

## Definition of done

- [x] Branch cut from `origin/develop`
- [x] Three events migrated via feature-flag router
- [x] DLQ subject `chiefaia.events.dlq` wired
- [x] Feature flag `BUS_BACKEND_NATS_FOR_EVENT_TYPES` plumbed
- [x] Per-event consumer overrides applied (`worker.heartbeat`
      ackPolicy=none, maxAckPending=1000)
- [x] `apps/dashboard/lib/tenants/wire.ts` swallowed-publish bug fixed
      (connect on first publish, errors surfaced)
- [x] ≥30 vitest cases added (54 added)
- [x] Integration tests gated by `NATS_INTEGRATION_URL`
- [x] Typecheck green for package + orchestrator + dashboard
- [x] Unit tests green (135 passed)
- [ ] CI green + admin-merge with `[True-Zero admin-merge]` subject
      (pending push)
