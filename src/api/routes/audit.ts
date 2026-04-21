import type { Hono } from 'hono';
import { desc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { auditLog } from '../../db/schema';

export function registerAuditRoutes(app: Hono, db: Db): void {
  app.get('/audit', (c) => {
    const { entityKind, entityId, projectId, limit: lim } = c.req.query() as Record<string, string>;
    const limitN = Math.min(parseInt(lim ?? '100', 10), 500);
    let rows = db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limitN).all();
    if (entityKind) rows = rows.filter(r => r.entityKind === entityKind);
    if (entityId) rows = rows.filter(r => r.entityId === entityId);
    if (projectId) rows = rows.filter(r => r.projectId === projectId);
    return c.json(rows);
  });
}
