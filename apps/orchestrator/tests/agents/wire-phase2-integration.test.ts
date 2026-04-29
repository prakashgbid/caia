/**
 * wirePhase2 integration test — CODING-007.
 *
 * End-to-end against the real bus + registry + consumer stack:
 *   1. wirePhase2 stands up the subsystem.
 *   2. Register a coding worker via the registry.
 *   3. Seed a ready-for-pickup story.
 *   4. Publish `ticket.bucket_placed` — the consumer should pump and
 *      atomically assign the story to the worker.
 *   5. Verify the worker.currentStoryId now points at the story.
 *
 * This is the proof that the full Task Manager → Coding Agent dispatch
 * loop wires correctly end-to-end without external IPC.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { workerPool, stories } from '../../src/db/schema';
import { wirePhase2 } from '../../src/agents/wire-phase2';
import { eventBus, wireEventBus } from '../../src/events/bus-adapter';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  wireEventBus(db);
  return { db, sqlite };
}

describe('wirePhase2 integration', () => {
  it('dispatches a ready story to a registered coding worker via bus event', async () => {
    const { db } = setup();
    const ctx = wirePhase2(db, { silent: true, skipTimers: true });
    try {
      // 1. Register a coding worker (idle, accepts any bucket).
      const worker = ctx.registry.register({
        kind: 'coding',
        capabilities: [],
        metadata: { socketPath: '/tmp/wkr.sock' },
        id: 'wkr_e2e',
      });
      expect(worker.status).toBe('idle');

      // 2. Seed a ready-for-pickup story.
      db.insert(stories).values({
        id: 'story_e2e',
        title: 'demo',
        description: '',
        createdAt: String(Date.now()),
        status: 'pending',
        bucketId: 'bucket_main',
        templateVersion: 'v1',
        templateValidationStatus: 'valid',
      }).run();

      // 3. Publish the bus event that triggers consumer.pump().
      eventBus.publish({
        type: 'ticket.bucket_placed' as never,
        actor: 'task-scheduler',
        payload: { storyId: 'story_e2e', bucketId: 'bucket_main' },
      });
      // Allow the fire-and-forget pump to settle.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // 4. Verify atomic assignment landed.
      const w = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_e2e')).get();
      const s = db.select().from(stories).where(eq(stories.id, 'story_e2e')).get();
      expect(w?.status).toBe('busy');
      expect(w?.currentStoryId).toBe('story_e2e');
      expect(s?.assignedWorkerId).toBe('wkr_e2e');
    } finally {
      ctx.stopAll();
    }
  });

  it('does not double-assign the same story to multiple workers', async () => {
    const { db } = setup();
    const ctx = wirePhase2(db, { silent: true, skipTimers: true });
    try {
      ctx.registry.register({ kind: 'coding', id: 'wkr_a', metadata: { socketPath: '/a.sock' } });
      ctx.registry.register({ kind: 'coding', id: 'wkr_b', metadata: { socketPath: '/b.sock' } });
      db.insert(stories).values({
        id: 'story_solo',
        title: 'solo',
        description: '',
        createdAt: String(Date.now()),
        status: 'pending',
        bucketId: 'bucket_main',
        templateVersion: 'v1',
        templateValidationStatus: 'valid',
      }).run();
      eventBus.publish({
        type: 'ticket.bucket_placed' as never,
        actor: 'task-scheduler',
        payload: { storyId: 'story_solo', bucketId: 'bucket_main' },
      });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      // Trigger another pump — must be a no-op (no more ready stories).
      eventBus.publish({
        type: 'task.completed' as never,
        actor: 'task-scheduler',
        payload: { storyId: 'story_solo' },
      });
      await new Promise((r) => setImmediate(r));
      const a = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_a')).get();
      const b = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_b')).get();
      const busy = [a, b].filter((w) => w?.currentStoryId === 'story_solo');
      expect(busy).toHaveLength(1);
    } finally {
      ctx.stopAll();
    }
  });
});
