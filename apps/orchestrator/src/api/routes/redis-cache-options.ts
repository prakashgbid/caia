import type { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/connection';
import { redisCacheOptions, projects } from '../../db/schema';

function now(): string {
  return new Date().toISOString();
}

export function registerRedisCacheOptionsRoutes(app: Hono, db: Db): void {

  // GET /redis/config — list all active redis_cache_options rows
  app.get('/redis/config', (c) => {
    const rows = db.select().from(redisCacheOptions)
      .where(and(
        eq(redisCacheOptions.status, 'active'),
      ))
      .orderBy(desc(redisCacheOptions.createdAt))
      .all();
    // Mask password fields before returning
    const safe = rows.map(r => ({ ...r, password: r.password ? '***' : null }));
    return c.json(safe);
  });

  // GET /redis/config/:id — single row
  app.get('/redis/config/:id', (c) => {
    const { id } = c.req.param();
    const row = db.select().from(redisCacheOptions)
      .where(eq(redisCacheOptions.id, id))
      .get();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ ...row, password: row.password ? '***' : null });
  });

  // POST /redis/config — create a new entry
  app.post('/redis/config', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const id = 'rco_' + nanoid(8);
    const ts = now();

    // Validate name
    if (!body['name'] || typeof body['name'] !== 'string') {
      return c.json({ error: 'name is required' }, 400);
    }

    // Optionally validate projectId exists
    if (body['project_id']) {
      const proj = db.select().from(projects)
        .where(eq(projects.id, body['project_id'] as string))
        .get();
      if (!proj) return c.json({ error: 'project not found' }, 400);
    }

    db.insert(redisCacheOptions).values({
      id,
      name: body['name'] as string,
      projectId: (body['project_id'] as string | undefined) ?? null,
      host: (body['host'] as string | undefined) ?? 'localhost',
      port: body['port'] ? Number(body['port']) : 6379,
      dbIndex: body['db_index'] ? Number(body['db_index']) : 0,
      password: (body['password'] as string | undefined) ?? null,
      keyPrefix: (body['key_prefix'] as string | undefined) ?? '',
      ttlSeconds: body['ttl_seconds'] ? Number(body['ttl_seconds']) : 3600,
      maxEntries: body['max_entries'] ? Number(body['max_entries']) : null,
      enabled: body['enabled'] !== undefined ? Boolean(body['enabled']) : true,
      status: 'active',
      scope: (body['scope'] as string | undefined) ?? 'global',
      createdAt: ts,
      updatedAt: ts,
    }).run();

    const row = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, id)).get()!;
    return c.json({ ...row, password: row.password ? '***' : null }, 201);
  });

  // PATCH /redis/config — upsert the global (scope=global) singleton config.
  // If a global row exists, update it; otherwise create one named "default".
  app.patch('/redis/config', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const ts = now();

    let row = db.select().from(redisCacheOptions)
      .where(and(eq(redisCacheOptions.scope, 'global'), eq(redisCacheOptions.status, 'active')))
      .orderBy(desc(redisCacheOptions.createdAt))
      .get();

    if (!row) {
      // Auto-create global default
      const id = 'rco_' + nanoid(8);
      db.insert(redisCacheOptions).values({
        id,
        name: 'default',
        projectId: null,
        host: 'localhost',
        port: 6379,
        dbIndex: 0,
        password: null,
        keyPrefix: '',
        ttlSeconds: 3600,
        maxEntries: null,
        enabled: true,
        status: 'active',
        scope: 'global',
        createdAt: ts,
        updatedAt: ts,
      }).run();
      row = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, id)).get()!;
    }

    const update: Record<string, unknown> = { updatedAt: ts };
    if (body['host'] !== undefined) update['host'] = String(body['host']);
    if (body['port'] !== undefined) update['port'] = Number(body['port']);
    if (body['db_index'] !== undefined) update['dbIndex'] = Number(body['db_index']);
    if (body['password'] !== undefined) update['password'] = body['password'] === '' ? null : String(body['password']);
    if (body['key_prefix'] !== undefined) update['keyPrefix'] = String(body['key_prefix']);
    if (body['ttl_seconds'] !== undefined) update['ttlSeconds'] = Number(body['ttl_seconds']);
    if (body['max_entries'] !== undefined) update['maxEntries'] = body['max_entries'] === null ? null : Number(body['max_entries']);
    if (body['enabled'] !== undefined) update['enabled'] = Boolean(body['enabled']);
    if (body['name'] !== undefined) update['name'] = String(body['name']);

    db.update(redisCacheOptions)
      .set(update as Parameters<ReturnType<typeof db.update>['set']>[0])
      .where(eq(redisCacheOptions.id, row.id))
      .run();

    const updated = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, row.id)).get()!;
    return c.json({ ...updated, password: updated.password ? '***' : null });
  });

  // PATCH /redis/config/:id — update a specific row
  app.patch('/redis/config/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>();

    const row = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, id)).get();
    if (!row) return c.json({ error: 'not found' }, 404);

    const update: Record<string, unknown> = { updatedAt: now() };
    if (body['host'] !== undefined) update['host'] = String(body['host']);
    if (body['port'] !== undefined) update['port'] = Number(body['port']);
    if (body['db_index'] !== undefined) update['dbIndex'] = Number(body['db_index']);
    if (body['password'] !== undefined) update['password'] = body['password'] === '' ? null : String(body['password']);
    if (body['key_prefix'] !== undefined) update['keyPrefix'] = String(body['key_prefix']);
    if (body['ttl_seconds'] !== undefined) update['ttlSeconds'] = Number(body['ttl_seconds']);
    if (body['max_entries'] !== undefined) update['maxEntries'] = body['max_entries'] === null ? null : Number(body['max_entries']);
    if (body['enabled'] !== undefined) update['enabled'] = Boolean(body['enabled']);
    if (body['name'] !== undefined) update['name'] = String(body['name']);

    db.update(redisCacheOptions)
      .set(update as Parameters<ReturnType<typeof db.update>['set']>[0])
      .where(eq(redisCacheOptions.id, id))
      .run();

    const updated = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, id)).get()!;
    return c.json({ ...updated, password: updated.password ? '***' : null });
  });

  // DELETE /redis/config/:id — soft-delete
  app.delete('/redis/config/:id', (c) => {
    const { id } = c.req.param();
    const row = db.select().from(redisCacheOptions).where(eq(redisCacheOptions.id, id)).get();
    if (!row) return c.json({ error: 'not found' }, 404);
    db.update(redisCacheOptions)
      .set({ status: 'deleted', updatedAt: now() })
      .where(eq(redisCacheOptions.id, id))
      .run();
    return c.json({ ok: true });
  });

  // GET /redis/ping — TCP connectivity check using the global config
  app.get('/redis/ping', async (c) => {
    const row = db.select().from(redisCacheOptions)
      .where(and(eq(redisCacheOptions.scope, 'global'), eq(redisCacheOptions.status, 'active'), eq(redisCacheOptions.enabled, true)))
      .orderBy(desc(redisCacheOptions.createdAt))
      .get();

    if (!row) return c.json({ ok: false, error: 'no global redis config found' });

    const { host, port } = row;
    const t0 = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const net = require('net') as typeof import('net');
        const sock = net.createConnection({ host, port, timeout: 3000 });
        sock.once('connect', () => { sock.destroy(); resolve(); });
        sock.once('error', reject);
        sock.once('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
      });
      return c.json({ ok: true, host, port, db: row.dbIndex, latencyMs: Date.now() - t0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: msg });
    }
  });

  // GET /redis/ping/:id — TCP connectivity check for a specific config
  app.get('/redis/ping/:id', async (c) => {
    const { id } = c.req.param();
    const row = db.select().from(redisCacheOptions)
      .where(eq(redisCacheOptions.id, id))
      .get();

    if (!row) return c.json({ ok: false, error: 'config not found' });
    if (row.status === 'deleted') return c.json({ ok: false, error: 'config has been deleted' });

    const { host, port } = row;
    const t0 = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const net = require('net') as typeof import('net');
        const sock = net.createConnection({ host, port, timeout: 3000 });
        sock.once('connect', () => { sock.destroy(); resolve(); });
        sock.once('error', reject);
        sock.once('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
      });
      return c.json({ ok: true, host, port, db: row.dbIndex, latencyMs: Date.now() - t0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: msg });
    }
  });
}
