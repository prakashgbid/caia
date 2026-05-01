import type { Hono } from 'hono';
import type { Db } from '../../db/connection';
import { getNotificationStore } from '../../notifications/store';
import type { InsertNotificationInput, ListNotificationsFilter } from '../../notifications/store';

export function registerNotificationsRoutes(app: Hono, db: Db): void {
  const store = () => getNotificationStore(db);

  // GET /api/notifications — list with optional filters
  app.get('/notifications', (c) => {
    const { requirement_id, task_id, unread_only, limit } = c.req.query() as Record<string, string>;
    const filter: ListNotificationsFilter = {
      requirementId: requirement_id || undefined,
      taskId: task_id || undefined,
      unreadOnly: unread_only === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
    };
    const items = store().list(filter);
    return c.json({ notifications: items, total: items.length });
  });

  // GET /api/notifications/unread-count
  app.get('/notifications/unread-count', (c) => {
    const { requirement_id, task_id } = c.req.query() as Record<string, string>;
    const count = store().unreadCount({
      requirementId: requirement_id || undefined,
      taskId: task_id || undefined,
    });
    return c.json({ count });
  });

  // POST /api/notifications — insert a notification
  app.post('/notifications', async (c) => {
    const body = await c.req.json<InsertNotificationInput>();
    if (!body.kind || !body.message) {
      return c.json({ error: 'kind and message are required' }, 400);
    }
    const notification = store().insert(body);
    return c.json(notification, 201);
  });

  // POST /api/notifications/:id/read — mark one as read
  app.post('/notifications/:id/read', (c) => {
    const { id } = c.req.param();
    store().markRead(id);
    return c.json({ ok: true });
  });

  // POST /api/notifications/read-all — mark all matching as read
  app.post('/notifications/read-all', async (c) => {
    let filter: { requirementId?: string; taskId?: string } = {};
    try {
      const body = await c.req.json<{ requirement_id?: string; task_id?: string }>();
      filter = {
        requirementId: body.requirement_id || undefined,
        taskId: body.task_id || undefined,
      };
    } catch {
      // no body — mark all
    }
    const count = store().markAllRead(filter);
    return c.json({ ok: true, count });
  });

  // DELETE /api/notifications/read — delete all read notifications (optionally filtered)
  app.delete('/notifications/read', async (c) => {
    let filter: { requirementId?: string; taskId?: string } = {};
    try {
      const body = await c.req.json<{ requirement_id?: string; task_id?: string }>();
      filter = {
        requirementId: body.requirement_id || undefined,
        taskId: body.task_id || undefined,
      };
    } catch {
      // no body — delete all read
    }
    const count = store().deleteRead(filter);
    return c.json({ ok: true, count });
  });

  // DELETE /api/notifications/:id — delete a single notification
  app.delete('/notifications/:id', (c) => {
    const { id } = c.req.param();
    store().deleteById(id);
    return c.json({ ok: true });
  });
}
