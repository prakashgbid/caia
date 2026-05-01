import type { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/connection';
import { chores } from '../../db/schema';
import { bus } from '../../ws/bus';

type ChoreStatus = 'queued' | 'triaging' | 'executing' | 'done' | 'failed';

const VALID_TRANSITIONS: Record<ChoreStatus, ChoreStatus[]> = {
  queued: ['triaging', 'failed'],
  triaging: ['executing', 'failed'],
  executing: ['done', 'failed'],
  done: [],
  failed: [],
};

// @no-events — individual handlers emit bus events on every state change
export function registerChoresRoutes(app: Hono, db: Db): void {
  app.get('/chores', (c) => {
    const { status, projectId, storyId } = c.req.query() as Record<string, string>;
    let rows = db.select().from(chores).orderBy(desc(chores.createdAt)).all();
    if (status) rows = rows.filter((r) => r.status === status);
    if (projectId) rows = rows.filter((r) => r.projectId === projectId);
    if (storyId) rows = rows.filter((r) => r.storyId === storyId);
    return c.json(rows);
  });

  app.post('/chores', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const id = 'chor_' + nanoid(8);
    const row = {
      id,
      prompt: body['prompt'] as string,
      status: 'queued' as const,
      domain: (body['domain'] as string) ?? 'backend',
      sloMs: (body['sloMs'] as number) ?? 20000,
      storyId: (body['storyId'] as string | undefined) ?? null,
      projectId: (body['projectId'] as string | undefined) ?? null,
      scope: (body['scope'] as string) ?? 'global',
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    };
    db.insert(chores).values(row).run();
    bus.push({ kind: 'chore.created', id, projectId: row.projectId ?? undefined, payload: row, ts: now });
    return c.json(row, 201);
  });

  app.get('/chores/:id', (c) => {
    const row = db.select().from(chores).where(eq(chores.id, c.req.param('id'))).all()[0];
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  app.post('/chores/:id/triage', (c) => {
    const { id } = c.req.param();
    const existing = db.select().from(chores).where(eq(chores.id, id)).all()[0];
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (!VALID_TRANSITIONS[existing.status as ChoreStatus]?.includes('triaging')) {
      return c.json({ error: `Invalid transition: ${existing.status} → triaging` }, 409);
    }
    const now = new Date().toISOString();
    db.update(chores).set({ status: 'triaging' }).where(eq(chores.id, id)).run();
    const updated = db.select().from(chores).where(eq(chores.id, id)).all()[0];
    bus.push({ kind: 'chore.triaging', id, projectId: existing.projectId ?? undefined, payload: updated, ts: now });
    return c.json(updated);
  });

  app.post('/chores/:id/execute', (c) => {
    const { id } = c.req.param();
    const existing = db.select().from(chores).where(eq(chores.id, id)).all()[0];
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (!VALID_TRANSITIONS[existing.status as ChoreStatus]?.includes('executing')) {
      return c.json({ error: `Invalid transition: ${existing.status} → executing` }, 409);
    }
    const now = new Date().toISOString();
    db.update(chores).set({ status: 'executing', startedAt: now }).where(eq(chores.id, id)).run();
    const updated = db.select().from(chores).where(eq(chores.id, id)).all()[0];
    bus.push({ kind: 'chore.executing', id, projectId: existing.projectId ?? undefined, payload: updated, ts: now });
    return c.json(updated);
  });

  app.post('/chores/:id/complete', (c) => {
    const { id } = c.req.param();
    const existing = db.select().from(chores).where(eq(chores.id, id)).all()[0];
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (!VALID_TRANSITIONS[existing.status as ChoreStatus]?.includes('done')) {
      return c.json({ error: `Invalid transition: ${existing.status} → done` }, 409);
    }
    const now = new Date().toISOString();
    db.update(chores).set({ status: 'done', finishedAt: now }).where(eq(chores.id, id)).run();
    const updated = db.select().from(chores).where(eq(chores.id, id)).all()[0];
    bus.push({ kind: 'chore.done', id, projectId: existing.projectId ?? undefined, payload: updated, ts: now });
    return c.json(updated);
  });

  app.post('/chores/:id/fail', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{ reason?: string }>().catch(() => ({}));
    const existing = db.select().from(chores).where(eq(chores.id, id)).all()[0];
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (!VALID_TRANSITIONS[existing.status as ChoreStatus]?.includes('failed')) {
      return c.json({ error: `Invalid transition: ${existing.status} → failed` }, 409);
    }
    const now = new Date().toISOString();
    db.update(chores)
      .set({ status: 'failed', finishedAt: now, errorMessage: body.reason ?? 'Unknown error' })
      .where(eq(chores.id, id))
      .run();
    const updated = db.select().from(chores).where(eq(chores.id, id)).all()[0];
    bus.push({ kind: 'chore.failed', id, projectId: existing.projectId ?? undefined, payload: updated, ts: now });
    return c.json(updated);
  });
}
