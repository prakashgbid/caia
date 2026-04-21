import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/connection';
import { projects } from '../../db/schema';
import { bus } from '../../ws/bus';

// @no-events — route registration wrapper, individual handlers emit events
export function registerProjectRoutes(app: Hono, db: Db): void {
  app.get('/projects', (c) => {
    const { status, kind } = c.req.query() as Record<string, string>;
    let rows = db.select().from(projects).all();
    if (status) rows = rows.filter(p => p.status === status);
    if (kind) rows = rows.filter(p => p.kind === kind);
    return c.json(rows);
  });

  app.post('/projects', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const id = 'proj_' + nanoid(8);
    const proj = {
      id,
      name: body['name'] as string,
      slug: body['slug'] as string,
      kind: body['kind'] as string,
      repoUrl: body['repoUrl'] as string | undefined,
      liveUrl: body['liveUrl'] as string | undefined,
      localPath: body['localPath'] as string | undefined,
      status: (body['status'] as string) ?? 'active',
      color: body['color'] as string | undefined,
      icon: body['icon'] as string | undefined,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(projects).values(proj).run();
    bus.push({ kind: 'project.created', id, payload: proj, ts: now });
    return c.json(proj, 201);
  });

  app.get('/projects/:id', (c) => {
    const { id } = c.req.param();
    const row = db.select().from(projects).where(eq(projects.id, id)).all()[0];
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  app.put('/projects/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { ...body, updatedAt: now };
    db.update(projects).set(updateData as Parameters<ReturnType<typeof db.update>['set']>[0]).where(eq(projects.id, id)).run();
    const row = db.select().from(projects).where(eq(projects.id, id)).all()[0];
    if (row) bus.push({ kind: 'project.updated', id, payload: row, ts: now });
    return c.json(row ?? { error: 'Not found' });
  });
}
