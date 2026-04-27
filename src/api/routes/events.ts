import type { Hono } from 'hono';
import { eventBus } from '../../events/bus-adapter';
import { isValidEventType, ALL_EVENT_TYPES, EVENT_SEVERITY } from '../../../packages/events-taxonomy/index';

export function registerEventsRoutes(app: Hono): void {
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

    const event = eventBus.publish({
      type: body.type,
      actor: (body.actor ?? 'api') as import('../../../packages/events-taxonomy/index').EventActor,
      payload: body.payload ?? {},
      correlation_id: body.correlation_id,
      entity_id: body.entity_id,
      entity_type: body.entity_type,
      project_slug: body.project_slug,
    });

    return c.json({ id: event.id, occurred_at: event.occurred_at });
  });
}
