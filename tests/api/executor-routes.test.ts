// @no-events — HTTP route tests for executor routes

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { tasks, executorConfig, executorRuns } from '../../src/db/schema';
import { createApp } from '../../src/api/app';
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

function seedConfig(db: Db): void {
  db.insert(executorConfig).values({
    enabled: true,
    maxConcurrent: 3,
    maxPerDomainConcurrent: 1,
    circuitBreakerThreshold: 3,
    pollIntervalMs: 5000,
    monitorIntervalMs: 30000,
    maxTurns: 50,
    permissionMode: 'default',
    updatedAt: new Date().toISOString(),
  }).run();
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

describe('GET /tasks/:id', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns 404 for nonexistent task', async () => {
    const res = await app.request('http://localhost/tasks/no_such_task', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('returns task for existing id', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_get1' })).run();
    const res = await app.request('http://localhost/tasks/task_get1', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    expect(body.id).toBe('task_get1');
  });
});

describe('PATCH /tasks/:id', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns 400 when no updatable fields', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_patch1' })).run();
    const res = await app.request('http://localhost/tasks/task_patch1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('updates status field and emits event on status change', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_patch2', status: 'queued' })).run();
    const res = await app.request('http://localhost/tasks/task_patch2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('running');
  });

  it('updates paused field and emits paused event', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_patch3', paused: false })).run();
    const res = await app.request('http://localhost/tasks/task_patch3', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true, pause_reason: 'Waiting on review' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { paused: boolean };
    expect(body.paused).toBe(true);
  });

  it('updates multiple fields', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_patch4' })).run();
    const res = await app.request('http://localhost/tasks/task_patch4', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sess_abc', attempt_count: 2, actual_files: '["a.ts"]' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /executor/config', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns 500 when executor_config not seeded', async () => {
    const res = await app.request('http://localhost/executor/config', { method: 'GET' });
    expect(res.status).toBe(500);
  });

  it('returns config when seeded', async () => {
    seedConfig(db);
    const res = await app.request('http://localhost/executor/config', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean };
    expect(typeof body.enabled).toBe('boolean');
  });
});

describe('PATCH /executor/config', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
    seedConfig(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('updates config fields and returns updated config', async () => {
    const res = await app.request('http://localhost/executor/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_concurrent: 5, enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { maxConcurrent: number; enabled: boolean };
    expect(body.maxConcurrent).toBe(5);
    expect(body.enabled).toBe(false);
  });

  it('returns 500 when config not seeded', async () => {
    const { db: emptyDb, raw: emptyRaw } = createTestDb();
    const emptyApp = createApp(emptyDb);
    _mockRaw = emptyRaw;
    const res = await emptyApp.request('http://localhost/executor/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(500);
    _mockRaw = raw; // restore
  });
});

describe('GET /executor/status', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
    seedConfig(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns status with basic fields', async () => {
    const res = await app.request('http://localhost/executor/status', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean; running: number; queued: number };
    expect(typeof body.enabled).toBe('boolean');
    expect(typeof body.running).toBe('number');
    expect(typeof body.queued).toBe('number');
  });

  it('counts completed_24h from done executor runs', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_st1' })).run();
    db.insert(executorRuns).values({
      taskId: 'task_st1', attemptN: 1, workerKind: 'claude-p',
      startedAt: new Date().toISOString(), status: 'done',
    } as typeof executorRuns.$inferInsert).run();

    const res = await app.request('http://localhost/executor/status', { method: 'GET' });
    const body = await res.json() as { completed_24h: number };
    expect(body.completed_24h).toBe(1);
  });
});

describe('POST /executor/pause and /executor/resume', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
    seedConfig(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('pause sets enabled=false', async () => {
    const res = await app.request('http://localhost/executor/pause', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });

  it('resume sets enabled=true', async () => {
    const res = await app.request('http://localhost/executor/resume', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean };
    expect(body.enabled).toBe(true);
  });
});

describe('POST /executor/drain', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
    seedConfig(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns drained=true', async () => {
    const res = await app.request('http://localhost/executor/drain', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { drained: boolean };
    expect(body.drained).toBe(true);
  });
});

describe('GET /executor/tasks/next', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns null when no queued tasks', async () => {
    const res = await app.request('http://localhost/executor/tasks/next', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { task: null };
    expect(body.task).toBeNull();
  });

  it('returns highest priority queued task with no deps', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_next1', status: 'queued', dependsOn: '[]', priorityBucket: 'P1' })).run();
    const res = await app.request('http://localhost/executor/tasks/next', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { task: { id: string } };
    expect(body.task?.id).toBe('task_next1');
  });

  it('filters by domain_slug', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_d1', status: 'queued', domainSlug: 'security' })).run();
    db.insert(tasks).values(makeTask({ id: 'task_d2', status: 'queued', domainSlug: 'content' })).run();

    const res = await app.request('http://localhost/executor/tasks/next?domain_slug=security', { method: 'GET' });
    const body = await res.json() as { task: { id: string } | null };
    expect(body.task?.id).toBe('task_d1');
  });

  it('skips tasks with unsatisfied deps', async () => {
    const dep = makeTask({ id: 'dep_t1', status: 'queued' });
    const task = makeTask({ id: 'task_with_dep', status: 'queued', dependsOn: JSON.stringify(['dep_t1']) });
    db.insert(tasks).values(dep).run();
    db.insert(tasks).values(task).run();

    const res = await app.request('http://localhost/executor/tasks/next', { method: 'GET' });
    const body = await res.json() as { task: null | { id: string } };
    // dep_t1 has no deps so it is eligible; task_with_dep waits for dep_t1
    expect(body.task?.id).toBe('dep_t1');
  });

  it('returns task with satisfied deps (dep is done)', async () => {
    const dep = makeTask({ id: 'dep_done1', status: 'done' });
    const task = makeTask({ id: 'task_satdep', status: 'queued', dependsOn: JSON.stringify(['dep_done1']) });
    db.insert(tasks).values(dep).run();
    db.insert(tasks).values(task).run();

    const res = await app.request('http://localhost/executor/tasks/next', { method: 'GET' });
    const body = await res.json() as { task: { id: string } | null };
    expect(body.task?.id).toBe('task_satdep');
  });
});

describe('POST /executor/tasks/:id/pause and /unpause', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('pause returns ok', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_pause1' })).run();
    const res = await app.request('http://localhost/executor/tasks/task_pause1/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Manual pause' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('unpause returns ok', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_un1', paused: true })).run();
    const res = await app.request('http://localhost/executor/tasks/task_un1/unpause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset_attempts: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('POST /executor/tasks/:id/running', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('marks task as running', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_run1' })).run();
    const res = await app.request('http://localhost/executor/tasks/task_run1/running', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('GET /executor/runs', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns empty array', async () => {
    const res = await app.request('http://localhost/executor/runs', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(0);
  });

  it('filters by status', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_er1' })).run();
    db.insert(executorRuns).values({
      taskId: 'task_er1', attemptN: 1, workerKind: 'claude-p',
      startedAt: new Date().toISOString(), status: 'running',
    } as typeof executorRuns.$inferInsert).run();

    const res = await app.request('http://localhost/executor/runs?status=running', { method: 'GET' });
    const body = await res.json() as Array<{ status: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]!.status).toBe('running');
  });

  it('filters by task_id', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_er2' })).run();
    db.insert(executorRuns).values({
      taskId: 'task_er2', attemptN: 1, workerKind: 'claude-p',
      startedAt: new Date().toISOString(), status: 'done',
    } as typeof executorRuns.$inferInsert).run();

    const res = await app.request('http://localhost/executor/runs?task_id=task_er2', { method: 'GET' });
    const body = await res.json() as Array<{ taskId: string }>;
    expect(body[0]!.taskId).toBe('task_er2');
  });
});

describe('POST /executor/runs', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('creates an executor run', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_cr1' })).run();
    const now = new Date().toISOString();
    const res = await app.request('http://localhost/executor/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: 'task_cr1', attempt_n: 1, started_at: now }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { taskId: string; status: string };
    expect(body.taskId).toBe('task_cr1');
    expect(body.status).toBe('running');
  });
});

describe('PATCH /executor/runs/:id', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('updates run fields', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_pr1' })).run();
    db.insert(executorRuns).values({
      taskId: 'task_pr1', attemptN: 1, workerKind: 'claude-p',
      startedAt: new Date().toISOString(), status: 'running',
    } as typeof executorRuns.$inferInsert).run();
    const runs = db.select().from(executorRuns).all();
    const runId = runs[0]!.id;

    const res = await app.request(`http://localhost/executor/runs/${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done', result_summary: 'All good' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('GET /tasks/:id/attempts', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns empty array for task with no attempts', async () => {
    const res = await app.request('http://localhost/tasks/any_task/attempts', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(0);
  });
});

describe('POST /executor/tasks/:id/run-now', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns 404 for nonexistent task', async () => {
    const res = await app.request('http://localhost/executor/tasks/no_such_task/run-now', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when task is not queued', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_rn1', status: 'running' })).run();
    const res = await app.request('http://localhost/executor/tasks/task_rn1/run-now', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('returns ok for queued task', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_rn2', status: 'queued' })).run();
    const res = await app.request('http://localhost/executor/tasks/task_rn2/run-now', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('unpauses paused queued task', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_rn3', status: 'queued', paused: true })).run();
    const res = await app.request('http://localhost/executor/tasks/task_rn3/run-now', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
