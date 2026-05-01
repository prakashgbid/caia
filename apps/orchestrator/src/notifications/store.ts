import { eq, desc, and } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

import type { Db } from '../db/connection';
import { notifications } from '../db/schema';
import type { NotificationChannel, NotificationKind } from '../requirements/types';

export interface StoredNotification {
  id: string;
  requirementId: string | null;
  taskId: string | null;
  kind: NotificationKind;
  message: string;
  channel: NotificationChannel;
  isRead: boolean;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface InsertNotificationInput {
  requirementId?: string;
  taskId?: string;
  kind: NotificationKind;
  message: string;
  channel?: NotificationChannel;
  metadata?: Record<string, unknown>;
}

export interface ListNotificationsFilter {
  requirementId?: string;
  taskId?: string;
  unreadOnly?: boolean;
  limit?: number;
}

function toStored(row: typeof notifications.$inferSelect): StoredNotification {
  return {
    id: row.id,
    requirementId: row.requirementId ?? null,
    taskId: row.taskId ?? null,
    kind: row.kind as NotificationKind,
    message: row.message,
    channel: row.channel as NotificationChannel,
    isRead: Boolean(row.isRead),
    readAt: row.readAt ?? null,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    createdAt: row.createdAt,
  };
}

export class NotificationStore {
  constructor(private readonly db: Db) {}

  insert(input: InsertNotificationInput): StoredNotification {
    const id = 'notif_' + nanoid(8);
    const now = new Date().toISOString();
    const row = {
      id,
      requirementId: input.requirementId ?? null,
      taskId: input.taskId ?? null,
      kind: input.kind,
      message: input.message,
      channel: input.channel ?? 'both',
      isRead: false,
      readAt: null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
    };
    this.db.insert(notifications).values(row).run();
    return toStored(row as typeof notifications.$inferSelect);
  }

  list(filter: ListNotificationsFilter = {}): StoredNotification[] {
    const limit = filter.limit ?? 100;
    const conditions = [];

    if (filter.requirementId) {
      conditions.push(eq(notifications.requirementId, filter.requirementId));
    }
    if (filter.taskId) {
      conditions.push(eq(notifications.taskId, filter.taskId));
    }
    if (filter.unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }

    const rows = this.db
      .select()
      .from(notifications)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .all();

    return rows.map(toStored);
  }

  markRead(id: string): void {
    this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date().toISOString() })
      .where(eq(notifications.id, id))
      .run();
  }

  markAllRead(filter: { requirementId?: string; taskId?: string } = {}): number {
    const conditions = [eq(notifications.isRead, false)];

    if (filter.requirementId) {
      conditions.push(eq(notifications.requirementId, filter.requirementId));
    }
    if (filter.taskId) {
      conditions.push(eq(notifications.taskId, filter.taskId));
    }

    const result = this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date().toISOString() })
      .where(and(...conditions))
      .run();

    return result.changes;
  }

  unreadCount(filter: { requirementId?: string; taskId?: string } = {}): number {
    const rows = this.list({ ...filter, unreadOnly: true, limit: 10000 });
    return rows.length;
  }

  deleteById(id: string): void {
    this.db.delete(notifications).where(eq(notifications.id, id)).run();
  }

  deleteRead(filter: { requirementId?: string; taskId?: string } = {}): number {
    const conditions = [eq(notifications.isRead, true)];
    if (filter.requirementId) {
      conditions.push(eq(notifications.requirementId, filter.requirementId));
    }
    if (filter.taskId) {
      conditions.push(eq(notifications.taskId, filter.taskId));
    }
    const result = this.db.delete(notifications).where(and(...conditions)).run();
    return result.changes;
  }
}

let _store: NotificationStore | null = null;

export function getNotificationStore(db: Db): NotificationStore {
  if (!_store) {
    _store = new NotificationStore(db);
  }
  return _store;
}

export function resetNotificationStore(): void {
  _store = null;
}
