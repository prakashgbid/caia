import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { userProfiles } from '../../db/schema';

const DEFAULT_USER_ID = 'default';

function ensureDefaultUser(db: Db): typeof userProfiles.$inferSelect {
  const existing = db.select().from(userProfiles).where(eq(userProfiles.id, DEFAULT_USER_ID)).all()[0];
  if (existing) return existing;
  const now = new Date().toISOString();
  const row = { id: DEFAULT_USER_ID, displayName: '', avatarUrl: null, createdAt: now, updatedAt: now };
  db.insert(userProfiles).values(row).run();
  return row;
}

export function registerUserRoutes(app: Hono, db: Db): void {
  app.get('/users/profile', (c) => {
    const profile = ensureDefaultUser(db);
    return c.json(profile);
  });

  app.patch('/users/profile', async (c) => {
    const body = await c.req.json<{ displayName?: string }>();
    ensureDefaultUser(db);
    const now = new Date().toISOString();
    db.update(userProfiles)
      .set({ displayName: body.displayName ?? '', updatedAt: now })
      .where(eq(userProfiles.id, DEFAULT_USER_ID))
      .run();
    const updated = db.select().from(userProfiles).where(eq(userProfiles.id, DEFAULT_USER_ID)).all()[0];
    return c.json(updated);
  });

  app.post('/users/avatar', async (c) => {
    const body = await c.req.json<{ dataUrl: string }>();
    if (!body.dataUrl || !body.dataUrl.startsWith('data:image/')) {
      return c.json({ error: 'Invalid image data' }, 400);
    }
    ensureDefaultUser(db);
    const now = new Date().toISOString();
    db.update(userProfiles)
      .set({ avatarUrl: body.dataUrl, updatedAt: now })
      .where(eq(userProfiles.id, DEFAULT_USER_ID))
      .run();
    const updated = db.select().from(userProfiles).where(eq(userProfiles.id, DEFAULT_USER_ID)).all()[0];
    return c.json(updated);
  });

  app.delete('/users/avatar', (c) => {
    const existing = db.select().from(userProfiles).where(eq(userProfiles.id, DEFAULT_USER_ID)).all()[0];
    if (!existing) return c.json({ error: 'Not found' }, 404);
    const now = new Date().toISOString();
    db.update(userProfiles)
      .set({ avatarUrl: null, updatedAt: now })
      .where(eq(userProfiles.id, DEFAULT_USER_ID))
      .run();
    const updated = db.select().from(userProfiles).where(eq(userProfiles.id, DEFAULT_USER_ID)).all()[0];
    return c.json(updated);
  });
}
