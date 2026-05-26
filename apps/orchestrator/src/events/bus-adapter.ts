/**
 * Wires the event bus to the conductor SQLite database (legacy outbox)
 * and layers a `HybridEventBus` from `@chiefaia/event-bus-nats` on top so
 * publishers transparently route per-event-type per the
 * `BUS_BACKEND_NATS_FOR_EVENT_TYPES` env var.
 *
 * Architecture:
 *   - The legacy `eventBus` singleton from `@chiefaia/event-bus-internal`
 *     remains the SQLite outbox + in-process EventEmitter. wireDb() is
 *     still called on it so the projector's SQLite-backed replay keeps
 *     working unchanged.
 *   - We construct ONE `HybridEventBus` that wraps the legacy singleton
 *     and re-export it AS `eventBus` for all orchestrator callers. They
 *     get the routing behavior for free without any source-level changes.
 *   - When the flag is empty (default), HybridEventBus skips constructing
 *     the NATS backend entirely → zero behavioral change vs. pre-Wave-1a.
 *
 * Wave 1a (2026-05-25): only `tenant.provisioned`, `worker.heartbeat`,
 * `pipeline.stage.advanced` should be in the env var. The 118 other
 * event types continue flowing through the in-process bus.
 */

import { eq, desc } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { events } from '../db/schema';
import {
  eventBus as legacyBus,
  type EventDb,
  type DbEventRow,
  type EventQueryOpts as InternalEventQueryOpts,
} from '@chiefaia/event-bus-internal';
import {
  HybridEventBus,
  WAVE_1A_CONSUMER_OVERRIDES,
} from '@chiefaia/event-bus-nats';

let hybridBus: HybridEventBus | null = null;
let connectPromise: Promise<void> | null = null;

/** Build the HybridEventBus singleton. Idempotent. */
export function getHybridBus(): HybridEventBus {
  if (hybridBus) return hybridBus;
  hybridBus = new HybridEventBus({
    legacyBus,
    natsConfig: {
      servers: (process.env.NATS_SERVERS ?? 'nats://nats.chiefaia.com:4222').split(','),
      stream: process.env.NATS_STREAM ?? 'chiefaia-events',
      subjectPrefix: process.env.NATS_SUBJECT_PREFIX ?? 'chiefaia',
      durableConsumer: process.env.NATS_DURABLE ?? 'chiefaia-orchestrator',
      consumerOverrides: WAVE_1A_CONSUMER_OVERRIDES,
      auth: process.env.NATS_NKEY_SEED ? { nkeySeed: process.env.NATS_NKEY_SEED } : undefined,
      tls: process.env.NATS_TLS_CA ? {
        caFile: process.env.NATS_TLS_CA,
        certFile: process.env.NATS_TLS_CERT,
        keyFile: process.env.NATS_TLS_KEY,
      } : undefined,
    },
  });
  return hybridBus;
}

/**
 * Connect the hybrid bus to NATS (no-op when the flag is empty). Called
 * from api/start.ts after `wireEventBus(db)`. Errors are surfaced — if
 * NATS is configured but unreachable, the orchestrator should fail to
 * start rather than silently dropping events.
 */
export async function connectHybridBus(): Promise<void> {
  if (!connectPromise) {
    connectPromise = getHybridBus().connect().catch((err) => {
      connectPromise = null;
      throw err;
    });
  }
  await connectPromise;
}

/** Tear down the NATS connection. Called from api/start.ts during shutdown. */
export async function closeHybridBus(): Promise<void> {
  if (hybridBus) await hybridBus.close();
  hybridBus = null;
  connectPromise = null;
}

// @no-events — infrastructure startup wiring, not a domain operation
export function wireEventBus(db: Db): void {
  const adapter: EventDb = {
    insertEvent(row: DbEventRow): void {
      db.insert(events).values({
        id: row.id,
        type: row.type,
        occurredAt: row.occurred_at,
        actor: row.actor,
        correlationId: row.correlation_id ?? undefined,
        causationId: row.causation_id ?? undefined,
        traceId: row.trace_id ?? undefined,
        spanId: row.span_id ?? undefined,
        entityType: row.entity_type ?? undefined,
        entityId: row.entity_id ?? undefined,
        projectSlug: row.project_slug ?? undefined,
        domainSlugsJson: row.domain_slugs_json,
        payloadJson: row.payload_json,
        metadataJson: row.metadata_json,
        severity: row.severity,
      }).run();
    },

    queryEvents(opts: InternalEventQueryOpts): DbEventRow[] {
      let q = db.select().from(events).orderBy(desc(events.occurredAt)).limit(opts.limit ?? 200);

      if (opts.correlationId) {
        q = q.where(eq(events.correlationId, opts.correlationId)) as typeof q;
      } else if (opts.entityId) {
        q = q.where(eq(events.entityId, opts.entityId)) as typeof q;
      } else if (opts.type) {
        q = q.where(eq(events.type, opts.type)) as typeof q;
      } else if (opts.projectSlug) {
        q = q.where(eq(events.projectSlug, opts.projectSlug)) as typeof q;
      }

      return q.all().map(r => ({
        id: r.id,
        type: r.type,
        occurred_at: r.occurredAt,
        actor: r.actor,
        correlation_id: r.correlationId ?? null,
        causation_id: r.causationId ?? null,
        trace_id: r.traceId ?? null,
        span_id: r.spanId ?? null,
        entity_type: r.entityType ?? null,
        entity_id: r.entityId ?? null,
        project_slug: r.projectSlug ?? null,
        domain_slugs_json: r.domainSlugsJson,
        payload_json: r.payloadJson,
        metadata_json: r.metadataJson,
        severity: r.severity,
      }));
    },
  };

  legacyBus.wireDb(adapter);
}

/**
 * Re-exported `eventBus` is now the HybridEventBus. Existing imports of
 * `import { eventBus } from '../events/bus-adapter'` automatically pick
 * up the routing behavior. The default-empty flag means: zero behavior
 * change until ops sets `BUS_BACKEND_NATS_FOR_EVENT_TYPES` in env.
 *
 * Callers that previously relied on the SYNC return value of publish()
 * (e.g. POST /events) must now `await` the result — see api/routes/events.ts.
 */
export const eventBus = getHybridBus();
