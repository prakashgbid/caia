import type { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/connection';
import { proactiveSuggestions } from '../../db/schema';
import { bus } from '../../ws/bus';
import { getEntityIdsForDomains } from './domains';

export function registerSuggestionRoutes(app: Hono, db: Db): void {
  app.get('/suggestions', (c) => {
    const { state, projectId, domain } = c.req.query() as Record<string, string>;
    let rows = db.select().from(proactiveSuggestions).orderBy(desc(proactiveSuggestions.createdAt)).all();
    if (state) rows = rows.filter(r => r.state === state);
    if (projectId) rows = rows.filter(r => r.projectId === projectId);
    if (domain) {
      const slugs = domain.split(',').map(s => s.trim()).filter(Boolean);
      if (slugs.length) {
        const ids = getEntityIdsForDomains(db, 'suggestion', slugs);
        rows = rows.filter(r => ids.has(r.id));
      }
    }
    return c.json(rows);
  });

  app.post('/suggestions', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const id = 'sug_' + nanoid(8);
    const row = {
      id,
      title: body['title'] as string,
      rationale: (body['rationale'] as string) ?? '',
      options: JSON.stringify(body['options'] ?? []),
      state: 'pending',
      projectId: body['projectId'] as string | undefined,
      scope: (body['scope'] as string) ?? 'global',
      createdAt: now,
    };
    db.insert(proactiveSuggestions).values(row).run();
    bus.push({ kind: 'suggestion.created', id, projectId: row.projectId, payload: row, ts: now });
    return c.json(row, 201);
  });

  app.get('/suggestions/:id', (c) => {
    const row = db.select().from(proactiveSuggestions).where(eq(proactiveSuggestions.id, c.req.param('id'))).all()[0];
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  app.post('/suggestions/:id/accept', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{ option?: string }>().catch(() => ({ option: '' }));
    const now = new Date().toISOString();
    db.update(proactiveSuggestions).set({
      state: 'accepted',
      acceptedOption: body.option ?? '',
      resolvedAt: now,
    }).where(eq(proactiveSuggestions.id, id)).run();
    const row = db.select().from(proactiveSuggestions).where(eq(proactiveSuggestions.id, id)).all()[0];
    if (row) bus.push({ kind: 'suggestion.accepted', id, projectId: row.projectId ?? undefined, payload: row, ts: now });
    return c.json(row ?? { error: 'Not found' });
  });

  app.post('/suggestions/:id/custom', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{ answer: string }>();
    const now = new Date().toISOString();
    db.update(proactiveSuggestions).set({
      state: 'custom',
      customAnswer: body.answer,
      resolvedAt: now,
    }).where(eq(proactiveSuggestions.id, id)).run();
    const row = db.select().from(proactiveSuggestions).where(eq(proactiveSuggestions.id, id)).all()[0];
    if (row) bus.push({ kind: 'suggestion.custom', id, projectId: row.projectId ?? undefined, payload: row, ts: now });
    return c.json(row ?? { error: 'Not found' });
  });
}
