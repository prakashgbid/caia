/**
 * Wave 1a NATS migration constants.
 *
 * The three event types that flip from `@chiefaia/event-bus-internal`
 * (in-process EventEmitter, SQLite outbox) to JetStream-backed
 * `@chiefaia/event-bus-nats` in this wave:
 *
 *   1. `tenant.provisioned`
 *        — first-time tenant signup fan-out. Low frequency, must not be
 *          lost. Explicit ack, max_deliver=3, DLQ on exhaustion.
 *   2. `worker.heartbeat`
 *        — per-second worker observability ping. High frequency,
 *          best-effort. `ackPolicy: 'none'` so the broker doesn't
 *          bookkeep acks per heartbeat (paid out at thousands/sec).
 *          `max_ack_pending: 1000` caps in-flight even though acks
 *          aren't strictly enforced — keeps a single misbehaving
 *          worker from monopolising the consumer.
 *   3. `pipeline.stage.advanced`
 *        — central cross-cutting pipeline state event. Subscribed to
 *          by the Projector, multiple dashboard views, escalation
 *          policy. Explicit ack, max_deliver=3, DLQ on exhaustion.
 *
 * `solution-lifecycle.state-changed` was the originally-named third
 * event but is not registered in `events-taxonomy-internal/registry.yaml`
 * on develop (the state-machine worktree that introduces it has not
 * landed yet). `pipeline.stage.advanced` was substituted because it
 * exists, is high-traffic, has a real subscriber (the Projector), and
 * exercises the migration hardest.
 */

import type { ConsumerOverride } from './types.js';

/** The three event types in Wave 1a. */
export const WAVE_1A_EVENT_TYPES = [
  'tenant.provisioned',
  'worker.heartbeat',
  'pipeline.stage.advanced',
] as const;

export type Wave1aEventType = (typeof WAVE_1A_EVENT_TYPES)[number];

/**
 * Per-event consumer overrides for Wave 1a. The map key is the exact
 * `typeGlob` string passed to `subscribe()` in the migrated callers.
 *
 * `worker.heartbeat` is the only deviation from defaults — it runs
 * fire-and-forget because heartbeats are observability, not workflow.
 */
export const WAVE_1A_CONSUMER_OVERRIDES: Record<string, ConsumerOverride> = {
  'worker.heartbeat': {
    ackPolicy: 'none',
    maxAckPending: 1000,
  },
  // tenant.provisioned + pipeline.stage.advanced use bus defaults
  // (explicit ack, maxDeliver from maxRetriesBeforeDlq, ackWait 30s).
};

/** The DLQ subject Wave 1a publishes poison messages to. */
export const WAVE_1A_DLQ_SUBJECT = 'chiefaia.events.dlq';

/** True if the given event type is in the Wave 1a migration set. */
export function isWave1aEvent(eventType: string): eventType is Wave1aEventType {
  return (WAVE_1A_EVENT_TYPES as readonly string[]).includes(eventType);
}
