import type { Hono } from 'hono';
import type { Db } from '../../db/connection';
import { projectionRegistry } from '../../projections';

export function registerProjectionsRoutes(app: Hono, db: Db): void {
  // Health status for all registered projections.
  // Returns name, live flag, and checkpoint (last processed event + counts).
  app.get('/projections', (c) => {
    const statuses = projectionRegistry.status(db);
    return c.json({ projections: statuses, total: statuses.length });
  });

  // Single projection detail.
  app.get('/projections/:name', (c) => {
    const { name } = c.req.param();
    const all = projectionRegistry.status(db);
    const found = all.find(s => s.name === name);
    if (!found) return c.json({ error: 'projection not found' }, 404);
    return c.json(found);
  });
}
