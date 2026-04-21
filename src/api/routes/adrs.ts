import type { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/connection';
import { adrs } from '../../db/schema';
import { bus } from '../../ws/bus';
import { getEntityIdsForDomains } from './domains';

export function registerAdrRoutes(app: Hono, db: Db): void {
  app.get('/adrs', (c) => {
    const { status, projectId, domain } = c.req.query() as Record<string, string>;
    let rows = db.select().from(adrs).orderBy(desc(adrs.number)).all();
    if (status) rows = rows.filter(r => r.status === status);
    if (projectId) rows = rows.filter(r => r.projectId === projectId);
    if (domain) {
      const slugs = domain.split(',').map(s => s.trim()).filter(Boolean);
      if (slugs.length) {
        const ids = getEntityIdsForDomains(db, 'adr', slugs);
        rows = rows.filter(r => ids.has(r.id));
      }
    }
    return c.json(rows);
  });

  app.post('/adrs', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const id = 'adr_' + nanoid(8);
    const maxRow = db.select({ n: adrs.number }).from(adrs).orderBy(desc(adrs.number)).limit(1).all()[0];
    const number = (maxRow?.n ?? 0) + 1;
    const row = {
      id,
      number,
      title: body['title'] as string,
      status: (body['status'] as string) ?? 'proposed',
      context: (body['context'] as string) ?? '',
      decision: (body['decision'] as string) ?? '',
      consequences: (body['consequences'] as string) ?? '',
      alternatives: JSON.stringify(body['alternatives'] ?? []),
      supersedes: body['supersedes'] as string | undefined,
      projectId: body['projectId'] as string | undefined,
      scope: (body['scope'] as string) ?? 'global',
      createdAt: now,
      updatedAt: now,
    };
    db.insert(adrs).values(row).run();
    bus.push({ kind: 'adr.created', id, projectId: row.projectId, payload: row, ts: now });
    return c.json(row, 201);
  });

  app.get('/adrs/:id', (c) => {
    const row = db.select().from(adrs).where(eq(adrs.id, c.req.param('id'))).all()[0];
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  app.put('/adrs/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { ...body, updatedAt: now };
    db.update(adrs).set(updateData as Parameters<ReturnType<typeof db.update>['set']>[0]).where(eq(adrs.id, id)).run();
    const row = db.select().from(adrs).where(eq(adrs.id, id)).all()[0];
    if (row) bus.push({ kind: 'adr.updated', id, projectId: row.projectId ?? undefined, payload: row, ts: now });
    return c.json(row ?? { error: 'Not found' });
  });
}
