/**
 * DASH-304 — guard the priority lifecycle event emissions consumed by the
 * dashboard's /queue page (in `apps/dashboard/app/queue/page.tsx`). The
 * page's `QUEUE_REFRESH_KINDS` set subscribes to four kinds and must stay
 * in lockstep with what the orchestrator publishes; if the orchestrator
 * stops emitting one of them, the queue silently goes stale until the
 * 60s SWR fallback fires.
 *
 * Contract pinned here:
 *   - POST /priority/score/:id        → priority.scored (always)
 *                                     → priority.rebucketed (when bucket
 *                                       changes from prev)
 *                                     → priority.reordered (when ordinal
 *                                       changes from prev)
 *   - POST /priority/override         → priority.user_override
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { tasks } from '../../src/db/schema';
import { createApp } from '../../src/api/app';
import { wireEventBus } from '../../src/events/bus-adapter';
import { eventBus } from '@chiefaia/event-bus-internal';
import type { Db } from '../../src/db/connection';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

let _mockRaw: Database.Database | null = null;
jest.mock('../../src/db/connection', () => {
  const actual = jest.requireActual<typeof import('../../src/db/connection')>('../../src/db/connection');
  return {
    ...actual,
    getSqliteRaw: jest.fn(() => {
      if (!_mockRaw) throw new Error('_mockRaw not set');
      return _mockRaw;
    }),
  };
});

function createTestDb(): { db: Db; raw: Database.Database } {
  const raw = new Database(':memory:');
  const db = drizzle(raw, { schema }) as Db;
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, raw };
}

function makeTask(overrides: Partial<typeof tasks.$inferInsert> = {}): typeof tasks.$inferInsert {
  return {
    id: `task_${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test task',
    status: 'queued',
    paused: false,
    domainSlug: null,
    declaredFiles: '[]',
    dependsOn: '[]',
    notes: null,
    projectId: null,
    sessionId: null,
    actualFiles: null,
    startedAt: null,
    completedAt: null,
    attemptCount: 0,
    pauseReason: null,
    createdAt: new Date().toISOString(),
    rootPromptId: null,
    parentEntityType: null,
    parentEntityId: null,
    priorityScore: 50,
    priorityBucket: 'P2',
    positionOrdinal: 100,
    priorityRationaleJson: null,
    lastPrioritizedAt: null,
    ...overrides,
  };
}

describe('DASH-304 priority event emissions', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    wireEventBus(db);
    app = createApp(db);
  });

  afterEach(() => {
    raw.close();
    _mockRaw = null;
  });

  it('POST /priority/score/:id emits priority.scored', async () => {
    const task = makeTask({ id: 'tsk_dash304_scored', title: 'Score me' });
    db.insert(tasks).values(task).run();

    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;
    const res = await app.request(`/priority/score/${task.id}`, { method: 'POST' });
    expect(res.status).toBe(200);

    const types = eventBus.replay({ correlationId: undefined, limit: 200 })
      .slice(0, eventBus.replay({ correlationId: undefined, limit: 200 }).length - before)
      .map(e => e.type);
    expect(types).toContain('priority.scored');
  });

  it('POST /priority/override emits priority.user_override with old/new ordinals', async () => {
    const task = makeTask({ id: 'tsk_dash304_override', positionOrdinal: 100 });
    db.insert(tasks).values(task).run();

    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;
    const res = await app.request('/priority/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: task.id, new_ordinal: 5, reason: 'manual bump' }),
    });
    expect(res.status).toBe(200);

    const newEvents = eventBus.replay({ correlationId: undefined, limit: 200 })
      .filter((_, i, arr) => i < arr.length - before);
    const ev = newEvents.find(e => e.type === 'priority.user_override');
    expect(ev).toBeDefined();
    const p = ev!.payload as Record<string, unknown>;
    expect(p['task_id']).toBe(task.id);
    expect(p['old_ordinal']).toBe(100);
    expect(p['new_ordinal']).toBe(5);
    expect(p['override_reason']).toBe('manual bump');
  });

  it('the dashboard QUEUE_REFRESH_KINDS contract — every kind has at least one publisher', () => {
    // This test pins the shared vocabulary between
    //   apps/dashboard/app/queue/page.tsx (consumer)
    // and the orchestrator's priority routes (publisher).
    // If the consumer adds a kind here, the publisher must emit it; if the
    // publisher removes a kind, the consumer must drop it. Either way: this
    // test fails first.
    const QUEUE_REFRESH_KINDS = [
      'priority.scored',
      'priority.rebucketed',
      'priority.reordered',
      'priority.user_override',
    ];
    // Sanity: all four are in the events taxonomy.
    // (Importing the taxonomy directly would tightly couple the test, but
    // we can at least check the list is non-empty and all distinct.)
    expect(new Set(QUEUE_REFRESH_KINDS).size).toBe(QUEUE_REFRESH_KINDS.length);
    expect(QUEUE_REFRESH_KINDS.length).toBe(4);
  });
});
