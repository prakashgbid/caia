/**
 * Conductor event bus — pure, DB-agnostic core.
 *
 * publish(event):
 *   1. Inserts via injected EventDb (SQLite outbox) — call wireDb() at startup.
 *   2. Emits in-process so WS gateway and local subscribers receive it immediately.
 *
 * subscribe(typeGlob, handler):
 *   Subscribe in-process using picomatch globs, e.g. "task.*", "build.*", "*".
 *
 * DB wiring lives in src/events/bus-adapter.ts (has access to the schema).
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import picomatch from 'picomatch';
import type { ConductorEvent, EventType, EventActor, EventSeverity } from '@chiefaia/events-taxonomy-internal';
import { EVENT_SEVERITY } from '@chiefaia/events-taxonomy-internal';

export type { ConductorEvent, EventType, EventActor, EventSeverity };
export { EVENT_SEVERITY, ALL_EVENT_TYPES, isValidEventType } from '@chiefaia/events-taxonomy-internal';

// ─── ID generator ────────────────────────────────────────────────────────────

function makeEventId(): string {
  const ts = Date.now().toString(36).padStart(8, '0');
  const rand = randomUUID().replace(/-/g, '').slice(0, 16);
  return `ev_${ts}_${rand}`;
}

// ─── DB interface (injected at startup) ──────────────────────────────────────

export interface EventDb {
  insertEvent(row: DbEventRow): void;
  queryEvents(opts: EventQueryOpts): DbEventRow[];
}

export interface DbEventRow {
  id: string;
  type: string;
  occurred_at: string;
  actor: string;
  correlation_id: string | null;
  causation_id: string | null;
  trace_id: string | null;
  span_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  project_slug: string | null;
  domain_slugs_json: string;
  payload_json: string;
  metadata_json: string;
  severity: string;
}

export interface EventQueryOpts {
  type?: string;
  actor?: string;
  entityId?: string;
  projectSlug?: string;
  correlationId?: string;
  since?: string;
  limit?: number;
}

// ─── Bus ─────────────────────────────────────────────────────────────────────

export type EventHandler = (event: ConductorEvent) => void;

class ConductorEventBus extends EventEmitter {
  private _db: EventDb | null = null;
  private _subs: Array<{ glob: string; matcher: (s: string) => boolean; handler: EventHandler }> = [];

  wireDb(db: EventDb): void {
    this._db = db;
  }

  publish(
    partial: Omit<ConductorEvent, 'id' | 'occurred_at' | 'severity'> & { severity?: EventSeverity },
  ): ConductorEvent {
    const event: ConductorEvent = {
      id: makeEventId(),
      occurred_at: new Date().toISOString(),
      severity: partial.severity ?? EVENT_SEVERITY[partial.type] ?? 'info',
      ...partial,
    };

    if (this._db) {
      try {
        this._db.insertEvent({
          id: event.id,
          type: event.type,
          occurred_at: event.occurred_at,
          actor: event.actor,
          correlation_id: event.correlation_id ?? null,
          causation_id: event.causation_id ?? null,
          trace_id: event.trace_id ?? null,
          span_id: event.span_id ?? null,
          entity_type: event.entity_type ?? null,
          entity_id: event.entity_id ?? null,
          project_slug: event.project_slug ?? null,
          domain_slugs_json: JSON.stringify(event.domain_slugs ?? []),
          payload_json: JSON.stringify(event.payload),
          metadata_json: JSON.stringify(event.metadata ?? {}),
          severity: event.severity,
        });
      } catch (err) {
        console.error('[event-bus] DB insert failed', err);
      }
    }

    // WS gateway listens on 'conductor:event'
    this.emit('conductor:event', event);

    for (const sub of this._subs) {
      if (sub.matcher(event.type)) {
        try { sub.handler(event); } catch { /* never crash the bus */ }
      }
    }

    return event;
  }

  /** Subscribe in-process. Returns an unsubscribe function. */
  subscribe(typeGlob: string, handler: EventHandler): () => void {
    const entry = { glob: typeGlob, matcher: picomatch(typeGlob), handler };
    this._subs.push(entry);
    return () => { this._subs = this._subs.filter(s => s !== entry); };
  }

  /** Replay persisted events via DB. */
  replay(opts: EventQueryOpts): ConductorEvent[] {
    if (!this._db) return [];
    return this._db.queryEvents(opts).map(row => ({
      id: row.id,
      type: row.type as EventType,
      occurred_at: row.occurred_at,
      actor: row.actor as EventActor,
      correlation_id: row.correlation_id ?? undefined,
      causation_id: row.causation_id ?? undefined,
      trace_id: row.trace_id ?? undefined,
      span_id: row.span_id ?? undefined,
      entity_type: row.entity_type ?? undefined,
      entity_id: row.entity_id ?? undefined,
      project_slug: row.project_slug ?? undefined,
      domain_slugs: JSON.parse(row.domain_slugs_json) as string[],
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      severity: row.severity as EventSeverity,
    }));
  }
}

export const eventBus = new ConductorEventBus();
