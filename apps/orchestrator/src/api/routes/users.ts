import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { users } from '../../db/schema';

const SINGLETON_ID = 'usr_local';

function ensureUser(db: Db) {
  const existing = db.select().from(users).where(eq(users.id, SINGLETON_ID)).all()[0];
  if (existing) return existing;
  const now = new Date().toISOString();
  const row = { id: SINGLETON_ID, displayName: '', avatarUrl: null, createdAt: now, updatedAt: now };
  db.insert(users).values(row).run();
  return row;
}

export function registerUsersRoutes(app: Hono, db: Db): void {
  app.get('/users/profile', (c) => {
    return c.json(ensureUser(db));
  });

  app.patch('/users/profile', async (c) => {
    const body = await c.req.json<{ displayName?: string }>();
    const user = ensureUser(db);
    const updated = { ...user, displayName: body.displayName ?? user.displayName, updatedAt: new Date().toISOString() };
    db.update(users).set({ displayName: updated.displayName, updatedAt: updated.updatedAt }).where(eq(users.id, SINGLETON_ID)).run();
    return c.json(updated);
  });

  app.post('/users/avatar', async (c) => {
    const body = await c.req.json<{ avatarUrl?: string }>();
    ensureUser(db);
    const updatedAt = new Date().toISOString();
    db.update(users).set({ avatarUrl: body.avatarUrl ?? null, updatedAt }).where(eq(users.id, SINGLETON_ID)).run();
    const row = db.select().from(users).where(eq(users.id, SINGLETON_ID)).all()[0];
    return c.json(row);
  });

  app.delete('/users/avatar', (c) => {
    ensureUser(db);
    const updatedAt = new Date().toISOString();
    db.update(users).set({ avatarUrl: null, updatedAt }).where(eq(users.id, SINGLETON_ID)).run();
    const row = db.select().from(users).where(eq(users.id, SINGLETON_ID)).all()[0];
    return c.json(row);
  });
}
