import type { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { redisCacheOptions } from '../../db/schema';
import { nanoid } from 'nanoid';

function now(): string {
  return new Date().toISOString();
}

export function registerRedisRoutes(app: Hono, db: Db): void {

  // LIST active redis cache option configs
  app.get('/redis/cache-options', (c) => {
    const rows = db
      .select()
      .from(redisCacheOptions)
      .where(and(
        eq(redisCacheOptions.status, 'active'),
      ))
      .all();
    return c.json(rows);
  });

  // GET single config
  app.get('/redis/cache-options/:id', (c) => {
    const { id } = c.req.param();
    const row = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, id)).get();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  // CREATE
  app.post('/redis/cache-options', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const id = 'rco_' + nanoid(8);
    const ts = now();
    const row = {
      id,
      name: String(body['name'] ?? 'default'),
      projectId: body['project_id'] ? String(body['project_id']) : null,
      host: String(body['host'] ?? 'localhost'),
      port: Number(body['port'] ?? 6379),
      dbIndex: Number(body['db_index'] ?? 0),
      password: body['password'] ? String(body['password']) : null,
      keyPrefix: String(body['key_prefix'] ?? ''),
      ttlSeconds: Number(body['ttl_seconds'] ?? 3600),
      maxEntries: body['max_entries'] ? Number(body['max_entries']) : null,
      enabled: body['enabled'] !== false,
      status: 'active',
      scope: String(body['scope'] ?? 'global'),
      createdAt: ts,
      updatedAt: ts,
    };
    db.insert(redisCacheOptions).values(row as typeof redisCacheOptions.$inferInsert).run();
    return c.json(row, 201);
  });

  // UPDATE
  app.patch('/redis/cache-options/:id', async (c) => {
    const { id } = c.req.param();
    const existing = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, id)).get();
    if (!existing) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const update: Record<string, unknown> = { updatedAt: now() };
    if (body['name'] !== undefined) update['name'] = String(body['name']);
    if (body['host'] !== undefined) update['host'] = String(body['host']);
    if (body['port'] !== undefined) update['port'] = Number(body['port']);
    if (body['db_index'] !== undefined) update['dbIndex'] = Number(body['db_index']);
    if (body['password'] !== undefined) update['password'] = body['password'] ? String(body['password']) : null;
    if (body['key_prefix'] !== undefined) update['keyPrefix'] = String(body['key_prefix']);
    if (body['ttl_seconds'] !== undefined) update['ttlSeconds'] = Number(body['ttl_seconds']);
    if (body['max_entries'] !== undefined) update['maxEntries'] = body['max_entries'] ? Number(body['max_entries']) : null;
    if (body['enabled'] !== undefined) update['enabled'] = Boolean(body['enabled']);
    if (body['scope'] !== undefined) update['scope'] = String(body['scope']);

    db.update(redisCacheOptions)
      .set(update as Parameters<ReturnType<typeof db.update>['set']>[0])
      .where(eq(redisCacheOptions.id, id))
      .run();
    const updated = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, id)).get();
    return c.json(updated);
  });

  // SOFT DELETE
  app.delete('/redis/cache-options/:id', (c) => {
    const { id } = c.req.param();
    const existing = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, id)).get();
    if (!existing) return c.json({ error: 'not found' }, 404);
    db.update(redisCacheOptions)
      .set({ status: 'deleted', updatedAt: now() } as Parameters<ReturnType<typeof db.update>['set']>[0])
      .where(eq(redisCacheOptions.id, id))
      .run();
    return c.json({ ok: true });
  });
}
