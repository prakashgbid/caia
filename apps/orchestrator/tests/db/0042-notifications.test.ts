/**
 * Migration 0042 smoke tests — notifications table.
 *
 * Verifies:
 *   - migration applies cleanly on top of all prior migrations (0000..0041)
 *   - NotificationStore.insert() persists all fields correctly
 *   - NotificationStore.list() returns rows ordered by createdAt desc with
 *     correct filtering (requirementId, taskId, unreadOnly)
 *   - NotificationStore.markRead() sets is_read + read_at on a single row
 *   - NotificationStore.markAllRead() bulk-marks unread rows; respects scope
 *   - NotificationStore.unreadCount() returns accurate count
 *   - metadata round-trips through JSON serialisation
 *   - NotificationQueue.attachDb() bridges in-memory queue to SQLite
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import {
  NotificationStore,
  getNotificationStore,
  resetNotificationStore,
} from '../../src/notifications/store';
import { NotificationQueue, resetNotificationQueue } from '../../src/notifications/index';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite };
}

describe('migration 0042 — notifications table', () => {
  it('applies cleanly on top of all prior migrations', () => {
    expect(() => createTestDb()).not.toThrow();
  });

  it('creates the notifications table with expected columns', () => {
    const { sqlite } = createTestDb();
    const cols = sqlite
      .prepare("PRAGMA table_info('notifications')")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('requirement_id');
    expect(names).toContain('task_id');
    expect(names).toContain('kind');
    expect(names).toContain('message');
    expect(names).toContain('channel');
    expect(names).toContain('is_read');
    expect(names).toContain('read_at');
    expect(names).toContain('metadata');
    expect(names).toContain('created_at');
  });

  it('creates all expected indexes', () => {
    const { sqlite } = createTestDb();
    const indexes = sqlite
      .prepare("PRAGMA index_list('notifications')")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('notifications_requirement_id_idx');
    expect(names).toContain('notifications_task_id_idx');
    expect(names).toContain('notifications_kind_idx');
    expect(names).toContain('notifications_is_read_idx');
    expect(names).toContain('notifications_created_at_idx');
  });
});

describe('NotificationStore', () => {
  let store: NotificationStore;

  beforeEach(() => {
    resetNotificationStore();
    const { db } = createTestDb();
    store = getNotificationStore(db);
  });

  afterEach(() => {
    resetNotificationStore();
  });

  describe('insert', () => {
    it('returns a stored notification with generated id', () => {
      const n = store.insert({ kind: 'started', message: 'Task started' });
      expect(n.id).toMatch(/^notif_/);
      expect(n.kind).toBe('started');
      expect(n.message).toBe('Task started');
      expect(n.isRead).toBe(false);
      expect(n.readAt).toBeNull();
      expect(n.channel).toBe('both');
    });

    it('persists requirementId and taskId', () => {
      const n = store.insert({
        kind: 'progress',
        message: 'Half done',
        requirementId: 'req_123',
        taskId: 'task_456',
      });
      expect(n.requirementId).toBe('req_123');
      expect(n.taskId).toBe('task_456');
    });

    it('persists custom channel', () => {
      const n = store.insert({ kind: 'completed', message: 'Done', channel: 'chat' });
      expect(n.channel).toBe('chat');
    });

    it('round-trips metadata through JSON', () => {
      const meta = { worktreePath: '/tmp/wt', prUrl: 'https://github.com/pr/1' };
      const n = store.insert({ kind: 'completed', message: 'Done', metadata: meta });
      expect(n.metadata).toEqual(meta);
    });

    it('stores null metadata when not provided', () => {
      const n = store.insert({ kind: 'started', message: 'Go' });
      expect(n.metadata).toBeNull();
    });

    it('sets createdAt to an ISO timestamp', () => {
      const n = store.insert({ kind: 'blocked', message: 'Stuck' });
      expect(() => new Date(n.createdAt)).not.toThrow();
      expect(new Date(n.createdAt).getFullYear()).toBeGreaterThanOrEqual(2024);
    });
  });

  describe('list', () => {
    it('returns all rows ordered by createdAt desc', () => {
      store.insert({ kind: 'started', message: 'first' });
      store.insert({ kind: 'progress', message: 'second' });
      store.insert({ kind: 'completed', message: 'third' });
      const rows = store.list();
      expect(rows.length).toBe(3);
      // most recent first
      expect(rows[0]!.message).toBe('third');
      expect(rows[2]!.message).toBe('first');
    });

    it('returns empty array when no rows exist', () => {
      expect(store.list()).toHaveLength(0);
    });

    it('filters by requirementId', () => {
      store.insert({ kind: 'started', message: 'A', requirementId: 'req_1' });
      store.insert({ kind: 'started', message: 'B', requirementId: 'req_2' });
      const rows = store.list({ requirementId: 'req_1' });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message).toBe('A');
    });

    it('filters by taskId', () => {
      store.insert({ kind: 'started', message: 'A', taskId: 'task_1' });
      store.insert({ kind: 'started', message: 'B', taskId: 'task_2' });
      const rows = store.list({ taskId: 'task_1' });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message).toBe('A');
    });

    it('filters unreadOnly', () => {
      const n1 = store.insert({ kind: 'started', message: 'unread' });
      const n2 = store.insert({ kind: 'progress', message: 'read' });
      store.markRead(n2.id);
      const rows = store.list({ unreadOnly: true });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(n1.id);
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        store.insert({ kind: 'started', message: `msg ${i}` });
      }
      const rows = store.list({ limit: 3 });
      expect(rows).toHaveLength(3);
    });
  });

  describe('markRead', () => {
    it('sets isRead to true and records readAt', () => {
      const n = store.insert({ kind: 'started', message: 'Go' });
      expect(n.isRead).toBe(false);

      store.markRead(n.id);

      const updated = store.list().find((r) => r.id === n.id)!;
      expect(updated.isRead).toBe(true);
      expect(updated.readAt).not.toBeNull();
      expect(new Date(updated.readAt!).getFullYear()).toBeGreaterThanOrEqual(2024);
    });

    it('does not affect other rows', () => {
      const n1 = store.insert({ kind: 'started', message: 'A' });
      const n2 = store.insert({ kind: 'started', message: 'B' });
      store.markRead(n1.id);
      const n2After = store.list().find((r) => r.id === n2.id)!;
      expect(n2After.isRead).toBe(false);
    });

    it('is idempotent', () => {
      const n = store.insert({ kind: 'started', message: 'Go' });
      store.markRead(n.id);
      expect(() => store.markRead(n.id)).not.toThrow();
      const row = store.list().find((r) => r.id === n.id)!;
      expect(row.isRead).toBe(true);
    });
  });

  describe('markAllRead', () => {
    it('marks all unread rows as read and returns change count', () => {
      store.insert({ kind: 'started', message: 'A' });
      store.insert({ kind: 'progress', message: 'B' });
      store.insert({ kind: 'completed', message: 'C' });
      const changed = store.markAllRead();
      expect(changed).toBe(3);
      expect(store.list({ unreadOnly: true })).toHaveLength(0);
    });

    it('returns 0 when nothing is unread', () => {
      const n = store.insert({ kind: 'started', message: 'A' });
      store.markRead(n.id);
      expect(store.markAllRead()).toBe(0);
    });

    it('scopes to requirementId when provided', () => {
      store.insert({ kind: 'started', message: 'A', requirementId: 'req_1' });
      store.insert({ kind: 'started', message: 'B', requirementId: 'req_2' });
      const changed = store.markAllRead({ requirementId: 'req_1' });
      expect(changed).toBe(1);
      const unread = store.list({ unreadOnly: true });
      expect(unread).toHaveLength(1);
      expect(unread[0]!.message).toBe('B');
    });

    it('scopes to taskId when provided', () => {
      store.insert({ kind: 'started', message: 'A', taskId: 'task_1' });
      store.insert({ kind: 'started', message: 'B', taskId: 'task_2' });
      store.markAllRead({ taskId: 'task_1' });
      const unread = store.list({ unreadOnly: true });
      expect(unread).toHaveLength(1);
      expect(unread[0]!.message).toBe('B');
    });
  });

  describe('unreadCount', () => {
    it('returns 0 when inbox is empty', () => {
      expect(store.unreadCount()).toBe(0);
    });

    it('counts all unread rows', () => {
      store.insert({ kind: 'started', message: 'A' });
      store.insert({ kind: 'progress', message: 'B' });
      expect(store.unreadCount()).toBe(2);
    });

    it('decrements after markRead', () => {
      const n = store.insert({ kind: 'started', message: 'A' });
      store.insert({ kind: 'progress', message: 'B' });
      store.markRead(n.id);
      expect(store.unreadCount()).toBe(1);
    });

    it('scopes to requirementId', () => {
      store.insert({ kind: 'started', message: 'A', requirementId: 'req_1' });
      store.insert({ kind: 'started', message: 'B', requirementId: 'req_2' });
      expect(store.unreadCount({ requirementId: 'req_1' })).toBe(1);
    });

    it('scopes to taskId', () => {
      store.insert({ kind: 'started', message: 'A', taskId: 'task_1' });
      store.insert({ kind: 'started', message: 'B', taskId: 'task_2' });
      expect(store.unreadCount({ taskId: 'task_2' })).toBe(1);
    });
  });

  describe('all notification kinds', () => {
    const kinds = ['started', 'progress', 'completed', 'blocked'] as const;
    for (const kind of kinds) {
      it(`stores and retrieves kind: ${kind}`, () => {
        const n = store.insert({ kind, message: `${kind} message` });
        expect(n.kind).toBe(kind);
        const found = store.list().find((r) => r.id === n.id)!;
        expect(found.kind).toBe(kind);
      });
    }
  });
});

describe('NotificationQueue.attachDb()', () => {
  beforeEach(() => {
    resetNotificationQueue();
    resetNotificationStore();
  });

  afterEach(() => {
    resetNotificationQueue();
    resetNotificationStore();
  });

  it('persists to SQLite when db is attached', () => {
    const { db } = createTestDb();
    const store = getNotificationStore(db);
    const queue = new NotificationQueue();
    queue.attachDb(db);

    queue.enqueue('req_1', 'started', 'Hello', 'chat');

    // In-memory queue holds the item
    expect(queue.pendingCount()).toBe(1);
    // SQLite store also has the item
    const rows = store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('started');
    expect(rows[0]!.message).toBe('Hello');
  });

  it('does not crash when db is not attached (best-effort mode)', () => {
    const queue = new NotificationQueue();
    expect(() => queue.enqueue('req_1', 'started', 'No db', 'chat')).not.toThrow();
    expect(queue.pendingCount()).toBe(1);
  });

  it('drain clears in-memory queue but leaves SQLite rows intact', () => {
    const { db } = createTestDb();
    const store = getNotificationStore(db);
    const queue = new NotificationQueue();
    queue.attachDb(db);

    queue.enqueue('req_1', 'completed', 'Done', 'chat');
    queue.drain();

    expect(queue.pendingCount()).toBe(0);
    expect(store.list()).toHaveLength(1);
  });
});
