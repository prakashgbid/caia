import { eq, desc } from 'drizzle-orm';
import type { Db } from './connection';
import { users } from './schema';

export interface UserFields {
  externalId?: string;
  handle?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface UserRow {
  id: string;
  externalId: string | null;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  metadataJson: string;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Upsert a user record.  Creates the row on first call; on subsequent calls
 * updates `lastSeenAt`, `updatedAt`, and any non-null fields supplied.
 * Returns the persisted row.
 */
export function upsertUser(db: Db, userId: string, fields: UserFields = {}): UserRow {
  const now = new Date().toISOString();
  const metadataJson = JSON.stringify(fields.metadata ?? {});

  const existing = db.select().from(users).where(eq(users.id, userId)).get();

  if (!existing) {
    const row = {
      id: userId,
      externalId: fields.externalId ?? null,
      handle: fields.handle ?? null,
      displayName: fields.displayName ?? null,
      email: fields.email ?? null,
      avatarUrl: fields.avatarUrl ?? null,
      metadataJson,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(users).values(row).run();
    return row as UserRow;
  }

  const updates: Partial<typeof users.$inferInsert> = {
    lastSeenAt: now,
    updatedAt: now,
  };
  if (fields.externalId != null) updates.externalId = fields.externalId;
  if (fields.handle != null) updates.handle = fields.handle;
  if (fields.displayName != null) updates.displayName = fields.displayName;
  if (fields.email != null) updates.email = fields.email;
  if (fields.avatarUrl != null) updates.avatarUrl = fields.avatarUrl;
  if (fields.metadata != null) updates.metadataJson = metadataJson;

  db.update(users).set(updates).where(eq(users.id, userId)).run();

  return { ...existing, ...updates } as UserRow;
}

/** Find a user by id.  Returns undefined if not found. */
export function findUser(db: Db, userId: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.id, userId)).get() as UserRow | undefined;
}

/** List all users ordered by last active, with optional limit/offset. */
export function listUsers(db: Db, opts: { limit?: number; offset?: number } = {}): UserRow[] {
  const { limit = 100, offset = 0 } = opts;
  return db.select().from(users)
    .orderBy(desc(users.lastSeenAt))
    .limit(limit)
    .offset(offset)
    .all() as UserRow[];
}
