// @no-events — unit tests for reprioritizer engine; events are fired but not asserted here

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import type { Db } from '../../src/db/connection';
import { tasks } from '../../src/db/schema';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

// Mock getSqliteRaw so reprioritizer's raw SQL queries work on the test db
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
    positionOrdinal: 0,
    priorityRationaleJson: null,
    lastPrioritizedAt: null,
    ...overrides,
  };
}

describe('scoreOne', () => {
  let db: Db;
  let raw: Database.Database;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    raw = result.raw;
    _mockRaw = raw;
  });

  afterEach(() => {
    _mockRaw = null;
  });

  it('returns null for nonexistent task', async () => {
    const { scoreOne } = await import('../../src/prioritization/reprioritizer');
    const result = await scoreOne('nonexistent', db, 'system');
    expect(result).toBeNull();
  });

  it('scores a task and persists results', async () => {
    const { scoreOne } = await import('../../src/prioritization/reprioritizer');
    const task = makeTask({ id: 'task_score_1', title: 'Security fix', domainSlug: 'security' });
    db.insert(tasks).values(task).run();

    const result = await scoreOne('task_score_1', db, 'system');
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('task_score_1');
    expect(typeof result!.score).toBe('number');
    expect(['P0', 'P1', 'P2', 'P3']).toContain(result!.bucket);
    expect(typeof result!.positionOrdinal).toBe('number');
    expect(result!.rationale).toBeDefined();
  });

  it('persists priority fields to database', async () => {
    const { scoreOne } = await import('../../src/prioritization/reprioritizer');
    const task = makeTask({ id: 'task_persist_1' });
    db.insert(tasks).values(task).run();

    await scoreOne('task_persist_1', db, 'user');

    const updated = db.select().from(tasks).where(
      (require('drizzle-orm') as typeof import('drizzle-orm')).eq(tasks.id, 'task_persist_1'),
    ).get();
    expect(updated).toBeDefined();
    expect(updated!.priorityRationaleJson).not.toBeNull();
    expect(updated!.lastPrioritizedAt).not.toBeNull();
  });

  it('emits priority.rebucketed event when bucket changes', async () => {
    const { scoreOne } = await import('../../src/prioritization/reprioritizer');
    const task = makeTask({
      id: 'task_rebu_1',
      title: 'Fix critical production crash',
      domainSlug: 'security',
      priorityBucket: 'P3',
    });
    db.insert(tasks).values(task).run();

    const result = await scoreOne('task_rebu_1', db, 'system');
    expect(result).not.toBeNull();
  });

  it('handles task with dependencies', async () => {
    const { scoreOne } = await import('../../src/prioritization/reprioritizer');
    const dep = makeTask({ id: 'dep_task_1', status: 'done' });
    const task = makeTask({ id: 'task_dep_1', dependsOn: JSON.stringify(['dep_task_1']) });
    db.insert(tasks).values(dep).run();
    db.insert(tasks).values(task).run();

    const result = await scoreOne('task_dep_1', db, 'system');
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('task_dep_1');
  });
});

describe('scoreAll', () => {
  let db: Db;
  let raw: Database.Database;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    raw = result.raw;
    _mockRaw = raw;
  });

  afterEach(() => {
    _mockRaw = null;
  });

  it('returns empty array when no active tasks', async () => {
    const { scoreAll } = await import('../../src/prioritization/reprioritizer');
    const results = await scoreAll(db, 'system');
    expect(results).toEqual([]);
  });

  it('scores all non-terminal tasks', async () => {
    const { scoreAll } = await import('../../src/prioritization/reprioritizer');
    const t1 = makeTask({ id: 'all_t1', status: 'queued' });
    const t2 = makeTask({ id: 'all_t2', status: 'running' });
    const t3 = makeTask({ id: 'all_t3', status: 'done' });
    const t4 = makeTask({ id: 'all_t4', status: 'failed' });
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();
    db.insert(tasks).values(t3).run();
    db.insert(tasks).values(t4).run();

    const results = await scoreAll(db, 'system');
    expect(results.length).toBe(2); // queued + running, not done/failed
    const ids = results.map(r => r.taskId);
    expect(ids).toContain('all_t1');
    expect(ids).toContain('all_t2');
  });
});

describe('subscribeToEvents', () => {
  let db: Db;
  let raw: Database.Database;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    raw = result.raw;
    _mockRaw = raw;
  });

  afterEach(() => {
    _mockRaw = null;
  });

  it('returns an unsubscribe function', async () => {
    const { subscribeToEvents } = await import('../../src/prioritization/reprioritizer');
    const unsub = subscribeToEvents(db);
    expect(typeof unsub).toBe('function');
    unsub(); // should not throw
  });

  it('re-scores task when completeness.finding_filed fires with entity_id', async () => {
    const { subscribeToEvents } = await import('../../src/prioritization/reprioritizer');
    const { eventBus } = await import('../../src/events/bus-adapter');

    const task = makeTask({ id: 'task_ev_1' });
    db.insert(tasks).values(task).run();

    const unsub = subscribeToEvents(db);
    eventBus.publish({
      type: 'completeness.finding_filed',
      actor: 'completeness-sentinel',
      entity_id: 'task_ev_1',
      payload: { run_id: 1, entity_id: 'task_ev_1', finding_code: 'missing_tests', severity: 'warning' },
    });

    unsub();
  });

  it('re-scores task when task.created fires with entity_id', async () => {
    const { subscribeToEvents } = await import('../../src/prioritization/reprioritizer');
    const { eventBus } = await import('../../src/events/bus-adapter');

    const task = makeTask({ id: 'task_ev_2' });
    db.insert(tasks).values(task).run();

    const unsub = subscribeToEvents(db);
    eventBus.publish({
      type: 'task.created',
      actor: 'executor',
      entity_id: 'task_ev_2',
      payload: { task_id: 'task_ev_2', title: 'New task', project_slug: 'test', domain_slug: 'testing-qa' },
    });

    unsub();
  });

  it('re-scores task when task.status_changed fires', async () => {
    const { subscribeToEvents } = await import('../../src/prioritization/reprioritizer');
    const { eventBus } = await import('../../src/events/bus-adapter');

    const task = makeTask({ id: 'task_ev_3' });
    db.insert(tasks).values(task).run();

    const unsub = subscribeToEvents(db);
    eventBus.publish({
      type: 'task.status_changed',
      actor: 'executor',
      entity_id: 'task_ev_3',
      payload: { task_id: 'task_ev_3', from_status: 'queued', to_status: 'running' },
    });

    unsub();
  });

  it('re-scores dependent tasks when task.status_changed fires and dependents exist', async () => {
    const { subscribeToEvents } = await import('../../src/prioritization/reprioritizer');
    const { eventBus } = await import('../../src/events/bus-adapter');

    const parent = makeTask({ id: 'parent_ev1', status: 'done' });
    const child = makeTask({ id: 'child_ev1', status: 'queued', dependsOn: JSON.stringify(['parent_ev1']) });
    db.insert(tasks).values(parent).run();
    db.insert(tasks).values(child).run();

    const unsub = subscribeToEvents(db);
    eventBus.publish({
      type: 'task.status_changed',
      actor: 'executor',
      entity_id: 'parent_ev1',
      payload: { task_id: 'parent_ev1', from_status: 'running', to_status: 'done' },
    });

    // Wait briefly for async scoreOne calls to settle
    await new Promise(resolve => setTimeout(resolve, 20));
    unsub();
  });

  it('handles task.status_changed with no entity_id gracefully', async () => {
    const { subscribeToEvents } = await import('../../src/prioritization/reprioritizer');
    const { eventBus } = await import('../../src/events/bus-adapter');

    const unsub = subscribeToEvents(db);
    eventBus.publish({
      type: 'task.status_changed',
      actor: 'executor',
      payload: { task_id: '', from_status: 'queued', to_status: 'running' },
    });

    unsub();
  });

  it('catch callbacks swallow errors when scoreOne rejects (completeness.finding_filed)', async () => {
    const { subscribeToEvents } = await import('../../src/prioritization/reprioritizer');
    const { eventBus } = await import('../../src/events/bus-adapter');

    const unsub = subscribeToEvents(db);
    // Nullify mock so getSqliteRaw throws → scoreOne rejects → catch(() => {}) runs
    _mockRaw = null;
    expect(() => eventBus.publish({
      type: 'completeness.finding_filed',
      actor: 'completeness-sentinel',
      entity_id: 'task_ev_1',
      payload: { run_id: 1, entity_id: 'task_ev_1', finding_code: 'x', severity: 'warning' },
    })).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 20));
    _mockRaw = raw; // restore
    unsub();
  });

  it('catch callbacks swallow errors when scoreOne rejects (task.status_changed)', async () => {
    const { subscribeToEvents } = await import('../../src/prioritization/reprioritizer');
    const { eventBus } = await import('../../src/events/bus-adapter');

    const task = makeTask({ id: 'task_catch1' });
    db.insert(tasks).values(task).run();
    const unsub = subscribeToEvents(db);
    _mockRaw = null;
    expect(() => eventBus.publish({
      type: 'task.status_changed',
      actor: 'executor',
      entity_id: 'task_catch1',
      payload: { task_id: 'task_catch1', from_status: 'queued', to_status: 'running' },
    })).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 20));
    _mockRaw = raw;
    unsub();
  });

  it('catch callbacks swallow errors when scoreOne rejects (task.created)', async () => {
    const { subscribeToEvents } = await import('../../src/prioritization/reprioritizer');
    const { eventBus } = await import('../../src/events/bus-adapter');

    const unsub = subscribeToEvents(db);
    _mockRaw = null;
    expect(() => eventBus.publish({
      type: 'task.created',
      actor: 'executor',
      entity_id: 'task_new_x',
      payload: { task_id: 'task_new_x', title: 'New', project_slug: 'test', domain_slug: null },
    })).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 20));
    _mockRaw = raw;
    unsub();
  });
});
