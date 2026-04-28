/**
 * Wires the event bus singleton to the conductor SQLite database.
 * Called once during API server startup, after migrations have run.
 */

import { eq, desc } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { events } from '../db/schema';
import { eventBus, type EventDb, type DbEventRow, type EventQueryOpts } from '@chiefaia/event-bus-internal';

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

    queryEvents(opts: EventQueryOpts): DbEventRow[] {
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

  eventBus.wireDb(adapter);
}

export { eventBus } from '@chiefaia/event-bus-internal';
