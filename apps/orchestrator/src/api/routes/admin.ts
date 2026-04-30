import type { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { listUsers, upsertUser, findUser } from '../../db/users';
import type { UserFields } from '../../db/users';

interface PromptAggRow {
  userId: string;
  totalPrompts: number;
  lastActiveAt: string;
  firstSeenAt: string;
  channels: string; // JSON array of distinct received_via values
}

export function registerAdminRoutes(app: Hono, db: Db): void {
  // GET /admin/users — merged view: users table + prompt activity aggregates
  app.get('/admin/users', (c) => {
    const promptAgg = db.all<PromptAggRow>(sql`
      SELECT
        COALESCE(user_id, 'anonymous')            AS userId,
        COUNT(*)                                   AS totalPrompts,
        MAX(received_at)                           AS lastActiveAt,
        MIN(received_at)                           AS firstSeenAt,
        json_group_array(DISTINCT received_via)    AS channels
      FROM prompts
      GROUP BY COALESCE(user_id, 'anonymous')
      ORDER BY lastActiveAt DESC
    `);

    const aggMap = new Map(promptAgg.map(r => [r.userId, r]));

    // Enrich with persisted user rows where available
    const persistedUsers = listUsers(db, { limit: 1000 });
    const persistedMap = new Map(persistedUsers.map(u => [u.id, u]));

    const users = promptAgg.map(r => {
      const persisted = persistedMap.get(r.userId);
      return {
        userId: r.userId,
        totalPrompts: Number(r.totalPrompts),
        lastActiveAt: r.lastActiveAt,
        firstSeenAt: r.firstSeenAt,
        channels: parseChannels(r.channels),
        status: isActiveUser(r.lastActiveAt) ? 'active' : 'idle',
        ...(persisted ? {
          displayName: persisted.displayName,
          handle: persisted.handle,
          email: persisted.email,
          avatarUrl: persisted.avatarUrl,
        } : {}),
      };
    });

    // Also include persisted users that have no prompts yet
    for (const u of persistedUsers) {
      if (!aggMap.has(u.id)) {
        users.push({
          userId: u.id,
          totalPrompts: 0,
          lastActiveAt: u.lastSeenAt,
          firstSeenAt: u.firstSeenAt,
          channels: [],
          status: isActiveUser(u.lastSeenAt) ? 'active' : 'idle',
          displayName: u.displayName,
          handle: u.handle,
          email: u.email,
          avatarUrl: u.avatarUrl,
        });
      }
    }

    return c.json({ users, total: users.length });
  });

  // POST /admin/users — create or upsert a user record
  app.post('/admin/users', async (c) => {
    let body: { userId?: unknown } & Record<string, unknown>;
    try {
      body = await c.req.json() as { userId?: unknown } & Record<string, unknown>;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { userId, ...rest } = body;
    if (!userId || typeof userId !== 'string') {
      return c.json({ error: 'userId (string) is required' }, 400);
    }
    const fields: UserFields = pickUserFields(rest);
    const user = upsertUser(db, userId, fields);
    return c.json({ user }, 201);
  });

  // PATCH /admin/users/:id — update fields on an existing user
  app.patch('/admin/users/:id', async (c) => {
    const id = c.req.param('id');
    if (!findUser(db, id)) {
      return c.json({ error: 'User not found' }, 404);
    }
    let body: Record<string, unknown>;
    try {
      body = await c.req.json() as Record<string, unknown>;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const fields: UserFields = pickUserFields(body);
    const user = upsertUser(db, id, fields);
    return c.json({ user });
  });
}

function pickUserFields(src: Record<string, unknown>): UserFields {
  const f: UserFields = {};
  if (typeof src['externalId'] === 'string') f.externalId = src['externalId'];
  if (typeof src['handle'] === 'string') f.handle = src['handle'];
  if (typeof src['displayName'] === 'string') f.displayName = src['displayName'];
  if (typeof src['email'] === 'string') f.email = src['email'];
  if (typeof src['avatarUrl'] === 'string') f.avatarUrl = src['avatarUrl'];
  return f;
}

function parseChannels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function isActiveUser(lastActiveAt: string): boolean {
  const diffMs = Date.now() - new Date(lastActiveAt).getTime();
  return diffMs < 24 * 60 * 60 * 1000;
}
