import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/connection';
import { businessFeatures } from '../../db/schema';
import { bus } from '../../ws/bus';
import { getEntityIdsForDomains } from './domains';

export function registerFeatureRoutes(app: Hono, db: Db): void {
  app.get('/features', (c) => {
    const { phase, status, projectId, domain } = c.req.query() as Record<string, string>;
    let rows = db.select().from(businessFeatures).all();
    if (phase) rows = rows.filter(r => r.phase === phase);
    if (status) rows = rows.filter(r => r.status === status);
    if (projectId) rows = rows.filter(r => r.projectId === projectId);
    if (domain) {
      const slugs = domain.split(',').map(s => s.trim()).filter(Boolean);
      if (slugs.length) {
        const ids = getEntityIdsForDomains(db, 'feature', slugs);
        rows = rows.filter(r => ids.has(r.id));
      }
    }
    return c.json(rows);
  });

  app.post('/features', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const id = 'feat_' + nanoid(8);
    const row = {
      id,
      title: body['title'] as string,
      description: (body['description'] as string) ?? '',
      phase: (body['phase'] as string) ?? '1',
      status: (body['status'] as string) ?? 'planned',
      linkedRequirements: JSON.stringify(body['linkedRequirements'] ?? []),
      targetDate: body['targetDate'] as string | undefined,
      projectId: body['projectId'] as string | undefined,
      scope: (body['scope'] as string) ?? 'global',
      createdAt: now,
      updatedAt: now,
    };
    db.insert(businessFeatures).values(row).run();
    bus.push({ kind: 'feature.created', id, projectId: row.projectId, payload: row, ts: now });
    return c.json(row, 201);
  });

  app.get('/features/:id', (c) => {
    const row = db.select().from(businessFeatures).where(eq(businessFeatures.id, c.req.param('id'))).all()[0];
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  app.put('/features/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { ...body, updatedAt: now };
    db.update(businessFeatures).set(updateData as Parameters<ReturnType<typeof db.update>['set']>[0]).where(eq(businessFeatures.id, id)).run();
    const row = db.select().from(businessFeatures).where(eq(businessFeatures.id, id)).all()[0];
    if (row) bus.push({ kind: 'feature.updated', id, projectId: row.projectId ?? undefined, payload: row, ts: now });
    return c.json(row ?? { error: 'Not found' });
  });
}
