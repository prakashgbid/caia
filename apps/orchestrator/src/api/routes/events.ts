import type { Hono } from 'hono';
import type { Db } from '../../db/connection';
import { eventBus } from '../../events/bus-adapter';
import { isValidEventType } from '@chiefaia/events-taxonomy-internal';

export function registerEventsRoutes(app: Hono, _db: Db): void {
  // Recent events with optional filters
  app.get('/events', (c) => {
    const { type, actor, entity_id, project_slug, correlation_id, limit } = c.req.query() as Record<string, string>;

    const events = eventBus.replay({
      type: type || undefined,
      actor: actor || undefined,
      entityId: entity_id || undefined,
      projectSlug: project_slug || undefined,
      correlationId: correlation_id || undefined,
      limit: limit ? parseInt(limit, 10) : 200,
    });

    return c.json({ events, total: events.length });
  });

  // List all valid event types
  app.get('/events/types', (c) => {
    const { ALL_EVENT_TYPES, EVENT_SEVERITY } = require('@chiefaia/events-taxonomy-internal') as typeof import('@chiefaia/events-taxonomy-internal');
    return c.json({
      types: ALL_EVENT_TYPES.map(t => ({ type: t, severity: EVENT_SEVERITY[t] })),
    });
  });

  // Publish an event (for external callers — executor daemon, CI etc.)
  app.post('/events', async (c) => {
    const body = await c.req.json() as {
      type: string;
      actor?: string;
      payload?: Record<string, unknown>;
      correlation_id?: string;
      entity_id?: string;
      entity_type?: string;
      project_slug?: string;
    };

    if (!body.type || !isValidEventType(body.type)) {
      return c.json({ error: 'invalid event type' }, 400);
    }

    // HybridEventBus.publish returns Promise<ConductorEvent> | ConductorEvent
    // depending on whether body.type routes to NATS or legacy. `await` handles
    // both: awaiting a non-Promise is a no-op in JS.
    const event = await eventBus.publish({
      type: body.type,
      actor: (body.actor ?? 'api') as import('@chiefaia/events-taxonomy-internal').EventActor,
      payload: body.payload ?? {},
      correlation_id: body.correlation_id,
      entity_id: body.entity_id,
      entity_type: body.entity_type,
      project_slug: body.project_slug,
    });

    return c.json({ id: event.id, occurred_at: event.occurred_at });
  });
}
