/**
 * DASH-107 — guard the executor's correlation_id propagation.
 *
 * Before DASH-107, four lifecycle events emitted by the executor
 * (`task.completed`, `task.failed`, `worker.completed`, `worker.failed`)
 * plus `worker.spawned` from the dispatcher crossed the executor boundary
 * without `correlation_id`. As a result, `/prompts/:id/journey` undercounted
 * events and `/prompts/:id/events?correlation_id=...` returned an
 * incomplete trace.
 *
 * The fix: every executor publishEvent call now passes a `correlationId`
 * (the originating prompt id, threaded via `task.rootPromptId`) plus
 * `entity_type='task'` and `entity_id=<taskId>` so the orchestrator can
 * persist the join.
 *
 * This test pins the contract end-to-end: a POST /events with
 * `correlation_id` + `entity_type` + `entity_id` is persisted such that
 * `/events?correlation_id=...` returns the row, and the public events
 * endpoint exposes the correlation_id field.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations } from '../../src/db/connection';
import { registerEventsRoutes } from '../../src/api/routes/events';
import { wireEventBus } from '../../src/events/bus-adapter';
import { eventBus } from '@chiefaia/event-bus-internal';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('DASH-107 correlation_id propagation through /events', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-dash107-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    wireEventBus(db);
    app = new Hono();
    registerEventsRoutes(app, db);
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  it('persists correlation_id from executor lifecycle events and returns them via /events', async () => {
    // Simulate the 5 executor-emitted events that DASH-107 fixed
    const promptId = 'prm_dash107_test';
    const taskId = 'tsk_dash107_test';
    const types = [
      'worker.spawned',
      'task.completed',
      'task.failed',
      'worker.completed',
      'worker.failed',
    ];

    for (const type of types) {
      const res = await app.request('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          actor: 'executor',
          payload: { task_id: taskId },
          correlation_id: promptId,
          entity_type: 'task',
          entity_id: taskId,
        }),
      });
      expect(res.status).toBe(200);
    }

    // Filter by correlation_id — should return all 5
    const filtered = await app.request(`/events?correlation_id=${promptId}`);
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json() as { events: Array<{ type: string; correlation_id: string | null }>; total: number };
    expect(filteredBody.events.length).toBe(5);
    expect(filteredBody.total).toBe(5);
    for (const e of filteredBody.events) {
      expect(e.correlation_id).toBe(promptId);
      expect(types).toContain(e.type);
    }
  });

  it('events emitted WITHOUT correlation_id are not surfaced when filtering by correlation_id', async () => {
    const promptId = 'prm_no_match';
    // Pre-fix regression: emit events with no correlation_id
    for (const type of ['task.completed', 'worker.completed']) {
      await app.request('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          actor: 'executor',
          payload: { task_id: 'tsk_orphan' },
        }),
      });
    }
    const res = await app.request(`/events?correlation_id=${promptId}`);
    const body = await res.json() as { events: unknown[]; total: number };
    expect(body.events.length).toBe(0);
    expect(body.total).toBe(0);
  });
});
