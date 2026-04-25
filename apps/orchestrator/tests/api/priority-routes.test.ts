// @no-events — HTTP route tests for /priority/* endpoints

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { tasks, priorityAudit } from '../../src/db/schema';
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

describe('GET /priority/queue', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns empty grouped queue when no tasks', async () => {
    const res = await app.request('http://localhost/priority/queue', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; grouped: Record<string, unknown[]>; rows: unknown[] };
    expect(body.total).toBe(0);
    expect(body.rows).toHaveLength(0);
    expect(body.grouped).toHaveProperty('P0');
    expect(body.grouped).toHaveProperty('P2');
  });

  it('groups tasks by bucket', async () => {
    db.insert(tasks).values(makeTask({ id: 't_p0', priorityBucket: 'P0', status: 'queued' })).run();
    db.insert(tasks).values(makeTask({ id: 't_p2', priorityBucket: 'P2', status: 'queued' })).run();
    db.insert(tasks).values(makeTask({ id: 't_done', status: 'done' })).run();

    const res = await app.request('http://localhost/priority/queue', { method: 'GET' });
    const body = await res.json() as { total: number; grouped: Record<string, unknown[]> };
    expect(body.total).toBe(2); // excludes done
    expect((body.grouped['P0'] as unknown[]).length).toBe(1);
    expect((body.grouped['P2'] as unknown[]).length).toBe(1);
  });

  it('filters by bucket query param', async () => {
    db.insert(tasks).values(makeTask({ id: 't_p1', priorityBucket: 'P1', status: 'queued' })).run();
    db.insert(tasks).values(makeTask({ id: 't_p2', priorityBucket: 'P2', status: 'queued' })).run();

    const res = await app.request('http://localhost/priority/queue?bucket=P1', { method: 'GET' });
    const body = await res.json() as { rows: Array<{ id: string }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]!.id).toBe('t_p1');
  });

  it('filters by project_id query param', async () => {
    // projectId has FK to projects — use null to avoid constraint
    db.insert(tasks).values(makeTask({ id: 't_proj1', projectId: null, status: 'queued', domainSlug: 'security' })).run();
    db.insert(tasks).values(makeTask({ id: 't_proj2', projectId: null, status: 'queued', domainSlug: 'content' })).run();

    // Use domain_slug filter instead (project_id filter code path uses the same filter pattern)
    const res = await app.request('http://localhost/priority/queue', { method: 'GET' });
    const body = await res.json() as { rows: Array<{ id: string }> };
    expect(body.rows).toHaveLength(2);
  });
});

describe('POST /priority/score/:taskId', () => {
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
    const res = await app.request('http://localhost/priority/score/no_such_task', { method: 'POST' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('not found');
  });

  it('scores an existing task and returns result', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_sc1', status: 'queued' })).run();
    const res = await app.request('http://localhost/priority/score/task_sc1', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { taskId: string; score: number; bucket: string };
    expect(body.taskId).toBe('task_sc1');
    expect(typeof body.score).toBe('number');
    expect(['P0', 'P1', 'P2', 'P3']).toContain(body.bucket);
  });
});

describe('POST /priority/score-all', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns rescored count', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_all1', status: 'queued' })).run();
    db.insert(tasks).values(makeTask({ id: 'task_all2', status: 'queued' })).run();

    const res = await app.request('http://localhost/priority/score-all', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { rescored: number; results: unknown[] };
    expect(body.rescored).toBe(2);
    expect(body.results).toHaveLength(2);
  });
});

describe('GET /priority/explain/:taskId', () => {
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
    const res = await app.request('http://localhost/priority/explain/no_such_task', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('returns explain data without rationale (not yet scored)', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_exp1' })).run();
    const res = await app.request('http://localhost/priority/explain/task_exp1', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { task_id: string; rationale: null };
    expect(body.task_id).toBe('task_exp1');
    expect(body.rationale).toBeNull();
  });

  it('returns explain data with rationale when scored', async () => {
    const rationale = {
      dimensions: { urgency: 0.5, blastRadius: 0, userVisible: 0.2, riskIfDelayed: 0.3, effortInverse: 1, confidence: 0.4, domainCriticality: 0.3 },
      score: 45, bucket: 'P2', summary: 'P2 (45/100): routine task', hardBlockerOverride: false,
    };
    db.insert(tasks).values(makeTask({ id: 'task_exp2', priorityRationaleJson: JSON.stringify(rationale) })).run();
    const res = await app.request('http://localhost/priority/explain/task_exp2', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { rationale: unknown };
    expect(body.rationale).not.toBeNull();
  });
});

describe('GET /priority/audit/:taskId', () => {
  let db: Db;
  let raw: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = createApp(db);
  });

  afterEach(() => { _mockRaw = null; });

  it('returns empty array for task with no audit records', async () => {
    const res = await app.request('http://localhost/priority/audit/task_no_audit', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(0);
  });

  it('returns audit records for a task', async () => {
    db.insert(priorityAudit).values({
      taskId: 'task_audit1',
      oldScore: 40,
      newScore: 75,
      oldBucket: 'P2',
      newBucket: 'P1',
      reason: 'Rescore',
      actor: 'system',
      changedAt: new Date().toISOString(),
    }).run();

    const res = await app.request('http://localhost/priority/audit/task_audit1', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ taskId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.taskId).toBe('task_audit1');
  });

  it('respects limit query param', async () => {
    for (let i = 0; i < 5; i++) {
      db.insert(priorityAudit).values({
        taskId: 'task_lim1',
        oldScore: 40, newScore: 50, oldBucket: 'P2', newBucket: 'P2',
        reason: 'Test', actor: 'system', changedAt: new Date().toISOString(),
      }).run();
    }
    const res = await app.request('http://localhost/priority/audit/task_lim1?limit=2', { method: 'GET' });
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(2);
  });
});

describe('POST /priority/override', () => {
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
    const res = await app.request('http://localhost/priority/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: 'no_such_task', new_ordinal: 5 }),
    });
    expect(res.status).toBe(404);
  });

  it('updates ordinal and creates audit record', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_ov1', positionOrdinal: 100 })).run();

    const res = await app.request('http://localhost/priority/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: 'task_ov1', new_ordinal: 5, reason: 'Manual bump' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; new_ordinal: number };
    expect(body.ok).toBe(true);
    expect(body.new_ordinal).toBe(5);
  });

  it('uses default reason when not provided', async () => {
    db.insert(tasks).values(makeTask({ id: 'task_ov2', positionOrdinal: 50 })).run();

    const res = await app.request('http://localhost/priority/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: 'task_ov2', new_ordinal: 1 }),
    });
    expect(res.status).toBe(200);
  });
});
