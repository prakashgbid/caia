/**
 * NOTIF-001 — NotificationStore DB round-trip tests (12 cases).
 *
 *  1. insert returns stored notification with generated id.
 *  2. insert persists to SQLite (list returns the row).
 *  3. insert defaults channel to 'both'.
 *  4. insert serialises metadata as JSON.
 *  5. list returns notifications ordered newest-first.
 *  6. list filters by requirementId.
 *  7. list filters by taskId.
 *  8. list unreadOnly=true excludes read rows.
 *  9. list respects limit.
 * 10. markRead sets isRead=true and readAt timestamp.
 * 11. markAllRead returns changed count and filters by requirementId.
 * 12. unreadCount returns only unread rows.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { NotificationStore, resetNotificationStore } from '../../src/notifications/store';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

describe('NotificationStore', () => {
  let store: NotificationStore;

  beforeEach(() => {
    resetNotificationStore();
    store = new NotificationStore(createTestDb());
  });

  it('1. insert returns stored notification with generated id', () => {
    const n = store.insert({ kind: 'started', message: 'Task kicked off' });
    expect(n.id).toMatch(/^notif_/);
    expect(n.kind).toBe('started');
    expect(n.message).toBe('Task kicked off');
    expect(n.isRead).toBe(false);
    expect(n.readAt).toBeNull();
    expect(n.createdAt).toBeTruthy();
  });

  it('2. insert persists to SQLite (list returns the row)', () => {
    store.insert({ kind: 'completed', message: 'Done' });
    const rows = store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('completed');
  });

  it('3. insert defaults channel to both', () => {
    const n = store.insert({ kind: 'progress', message: 'Halfway' });
    expect(n.channel).toBe('both');
  });

  it('4. insert serialises metadata as JSON', () => {
    const meta = { worktree: '/tmp/wt', prUrl: 'https://github.com/pr/1' };
    const n = store.insert({ kind: 'completed', message: 'Done', metadata: meta });
    expect(n.metadata).toEqual(meta);
    const [row] = store.list();
    expect(row!.metadata).toEqual(meta);
  });

  it('5. list returns notifications ordered newest-first', () => {
    store.insert({ kind: 'started', message: 'first' });
    store.insert({ kind: 'progress', message: 'second' });
    store.insert({ kind: 'completed', message: 'third' });
    const rows = store.list();
    expect(rows[0]!.message).toBe('third');
    expect(rows[2]!.message).toBe('first');
  });

  it('6. list filters by requirementId', () => {
    store.insert({ requirementId: 'req_A', kind: 'started', message: 'A' });
    store.insert({ requirementId: 'req_B', kind: 'started', message: 'B' });
    const rows = store.list({ requirementId: 'req_A' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requirementId).toBe('req_A');
  });

  it('7. list filters by taskId', () => {
    store.insert({ taskId: 'task_1', kind: 'progress', message: 'T1' });
    store.insert({ taskId: 'task_2', kind: 'progress', message: 'T2' });
    const rows = store.list({ taskId: 'task_2' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBe('task_2');
  });

  it('8. list unreadOnly=true excludes read rows', () => {
    const n1 = store.insert({ kind: 'started', message: 'unread' });
    const n2 = store.insert({ kind: 'completed', message: 'will-be-read' });
    store.markRead(n2.id);
    const rows = store.list({ unreadOnly: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(n1.id);
  });

  it('9. list respects limit', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ kind: 'progress', message: `msg-${i}` });
    }
    const rows = store.list({ limit: 3 });
    expect(rows).toHaveLength(3);
  });

  it('10. markRead sets isRead=true and readAt timestamp', () => {
    const n = store.insert({ kind: 'started', message: 'Pending' });
    store.markRead(n.id);
    const [row] = store.list();
    expect(row!.isRead).toBe(true);
    expect(row!.readAt).toBeTruthy();
  });

  it('11. markAllRead returns changed count and filters by requirementId', () => {
    store.insert({ requirementId: 'req_X', kind: 'started', message: 'X1' });
    store.insert({ requirementId: 'req_X', kind: 'progress', message: 'X2' });
    store.insert({ requirementId: 'req_Y', kind: 'started', message: 'Y1' });
    const changed = store.markAllRead({ requirementId: 'req_X' });
    expect(changed).toBe(2);
    const unread = store.list({ unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0]!.requirementId).toBe('req_Y');
  });

  it('12. unreadCount returns only unread rows', () => {
    store.insert({ kind: 'started', message: 'A' });
    store.insert({ kind: 'progress', message: 'B' });
    const n = store.insert({ kind: 'completed', message: 'C' });
    store.markRead(n.id);
    expect(store.unreadCount()).toBe(2);
  });
});
