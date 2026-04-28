/**
 * DASH-103 / DASH-104 / DASH-106 — guard the new event emissions added to
 * the orchestrator.
 *
 *   DASH-103: task.resumed when a paused task is unpaused
 *   DASH-104: pipeline.started on prompt creation,
 *             pipeline.completed when a prompt → answered,
 *             pipeline.failed when a prompt → failed,
 *             pipeline.decompose_started + pipeline.decompose_completed
 *               at the matching pipeline-stage transitions
 *   DASH-106: executor.heartbeat synthetic event with active_workers /
 *             queued_tasks / daemon_alive payload
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { Hono } from 'hono';
import * as schema from '../../src/db/schema';
import { tasks } from '../../src/db/schema';
import { registerExecutorRoutes } from '../../src/api/routes/executor';
import { wireEventBus } from '../../src/events/bus-adapter';
import { eventBus } from '@chiefaia/event-bus-internal';
import { createPrompt, updatePromptStatus } from '../../src/prompts/manager';
import { advancePipelineStage } from '../../src/agents/pipeline-stages';
import { emitExecutorHeartbeat } from '../../src/api/start';
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

describe('DASH-103 task.resumed', () => {
  let db: Db;
  let raw: Database.Database;
  let app: Hono;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    wireEventBus(db);
    app = new Hono();
    registerExecutorRoutes(app, db);
  });

  afterEach(() => {
    raw.close();
    _mockRaw = null;
  });

  it('POST /executor/tasks/:id/unpause emits task.resumed when the task was paused', async () => {
    const id = 'tsk_dash103_resumed';
    db.insert(tasks).values({
      id,
      title: 'paused task',
      status: 'queued',
      paused: true,
      pauseReason: 'Manual pause',
      cwd: '/',
      declaredFiles: '[]',
      dependsOn: '[]',
      attemptCount: 0,
      createdAt: new Date().toISOString(),
    } as typeof tasks.$inferInsert).run();

    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;
    const res = await app.request(`/executor/tasks/${id}/unpause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset_attempts: true }),
    });
    expect(res.status).toBe(200);

    const after = eventBus.replay({ correlationId: undefined, limit: 200 });
    const newOnes = after.slice(0, after.length - before);
    const ev = newOnes.find(e => e.type === 'task.resumed');
    expect(ev).toBeDefined();
    expect(ev!.entity_id).toBe(id);
    expect((ev!.payload as Record<string, unknown>)['reset_attempts']).toBe(true);
  });

  it('does NOT emit task.resumed if the task was already not paused', async () => {
    const id = 'tsk_dash103_noop';
    db.insert(tasks).values({
      id,
      title: 'already running',
      status: 'queued',
      paused: false,
      cwd: '/',
      declaredFiles: '[]',
      dependsOn: '[]',
      attemptCount: 0,
      createdAt: new Date().toISOString(),
    } as typeof tasks.$inferInsert).run();

    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;
    const res = await app.request(`/executor/tasks/${id}/unpause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);

    const after = eventBus.replay({ correlationId: undefined, limit: 200 });
    const newOnes = after.slice(0, after.length - before);
    expect(newOnes.map(e => e.type)).not.toContain('task.resumed');
  });
});

describe('DASH-104 pipeline lifecycle', () => {
  let db: Db;
  let raw: Database.Database;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    wireEventBus(db);
  });

  afterEach(() => {
    raw.close();
    _mockRaw = null;
  });

  it('createPrompt → updatePromptStatus(answered) emits pipeline.started + pipeline.completed', () => {
    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;
    const p = createPrompt(db, { body: 'hello world dash-104' });
    updatePromptStatus(db, p.id, 'answered');

    const events = eventBus.replay({ correlationId: undefined, limit: 200 });
    const newOnes = events.slice(0, events.length - before);
    const types = newOnes.map(e => e.type);
    expect(types).toContain('pipeline.started');
    expect(types).toContain('pipeline.completed');
  });

  it('updatePromptStatus(failed) emits pipeline.failed with severity error', () => {
    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;
    const p = createPrompt(db, { body: 'will fail dash-104' });
    updatePromptStatus(db, p.id, 'failed');

    const events = eventBus.replay({ correlationId: undefined, limit: 200 });
    const newOnes = events.slice(0, events.length - before);
    const failedEv = newOnes.find(e => e.type === 'pipeline.failed');
    expect(failedEv).toBeDefined();
    expect(failedEv!.severity).toBe('error');
  });

  it('advancePipelineStage emits pipeline.decompose_started/completed at the right transitions', () => {
    const p = createPrompt(db, { body: 'decompose dash-104' });
    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;

    advancePipelineStage({ promptId: p.id, stage: 'scaffolded', correlationId: p.correlationId }, db);
    advancePipelineStage({ promptId: p.id, stage: 'po_decomposed', correlationId: p.correlationId }, db);

    const events = eventBus.replay({ correlationId: undefined, limit: 200 });
    const newOnes = events.slice(0, events.length - before);
    const types = newOnes.map(e => e.type);
    expect(types).toContain('pipeline.decompose_started');
    expect(types).toContain('pipeline.decompose_completed');
  });
});

describe('DASH-106 executor.heartbeat', () => {
  let db: Db;
  let raw: Database.Database;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    wireEventBus(db);
  });

  afterEach(() => {
    raw.close();
    _mockRaw = null;
  });

  it('emitExecutorHeartbeat publishes executor.heartbeat with the expected payload shape', () => {
    db.insert(tasks).values({
      id: 'tsk_dash106_q',
      title: 'queued task',
      status: 'queued',
      paused: false,
      cwd: '/',
      declaredFiles: '[]',
      dependsOn: '[]',
      attemptCount: 0,
      createdAt: new Date().toISOString(),
    } as typeof tasks.$inferInsert).run();

    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;
    emitExecutorHeartbeat(db);

    const events = eventBus.replay({ correlationId: undefined, limit: 200 });
    const newOnes = events.slice(0, events.length - before);
    const hb = newOnes.find(e => e.type === 'executor.heartbeat');
    expect(hb).toBeDefined();

    const p = hb!.payload as Record<string, unknown>;
    expect(p['active_workers']).toBe(0);
    expect(p['queued_tasks']).toBe(1);
    expect(typeof p['daemon_alive']).toBe('boolean');
    expect('pid' in p).toBe(true);
    expect(hb!.severity).toBe('debug');
  });

  it('heartbeat tolerates DB errors and never throws', () => {
    // close the raw db underneath — heartbeat should swallow the error
    raw.close();
    expect(() => emitExecutorHeartbeat(db)).not.toThrow();
  });
});
