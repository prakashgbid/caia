/**
 * DASH-107 — correlation_id propagation across the executor boundary.
 *
 * Before the fix the executor's `worker.spawned`, `task.completed`,
 * `task.failed`, `worker.completed`, and `worker.failed` events were emitted
 * without `correlation_id`, so `/prompts/:id/journey.totalEvents` undercounted
 * the events that actually belonged to a prompt's trace.
 *
 * This test simulates the executor's POST /events calls (the dispatcher and
 * completion-hook talk to the orchestrator over HTTP, so we're testing the
 * server-side acceptance of `correlation_id` plus the journey aggregation
 * end-to-end). It pins:
 *
 *   1. POST /events with `correlation_id` is accepted, persisted, and
 *      retrievable via /prompts/:id/events;
 *   2. /prompts/:id/journey.totalEvents reflects every event stamped with
 *      that prompt's correlation_id;
 *   3. events emitted WITHOUT correlation_id are NOT counted in the journey
 *      (this is the regression that the dispatcher/completion-hook fix
 *      eliminates).
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { createApp } from '../../src/api/app';
import { createPrompt } from '../../src/prompts/manager';
import { wireEventBus } from '../../src/events/bus-adapter';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

type Db = ReturnType<typeof drizzle<typeof schema>>;

function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  wireEventBus(db as Db);
  return db as Db;
}

async function req(
  app: ReturnType<typeof createApp>,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await app.request(`http://localhost${urlPath}`, init);
  let responseBody: unknown;
  try { responseBody = await response.json(); } catch { responseBody = null; }
  return { status: response.status, body: responseBody };
}

describe('DASH-107 correlation_id propagation', () => {
  it('counts every executor-style event stamped with a prompt`s correlation_id in the journey', async () => {
    const db = createTestDb();
    const app = createApp(db);

    // 1. Create a prompt and a task linked to it (mimicking what the prompt
    //    decomposer / orchestrator would do upstream of the executor).
    const prompt = createPrompt(db, { body: 'do thing X' });
    const taskId = 'tsk_dash107';
    db.insert(schema.tasks).values({
      id: taskId,
      title: 'do thing X',
      cwd: '/',
      createdAt: new Date().toISOString(),
      rootPromptId: prompt.id,
    }).run();

    // 2. Emit the five executor lifecycle events — exactly the shape the
    //    dispatcher and completion-hook now produce after DASH-107.
    const stamped = [
      { type: 'worker.spawned',   payload: { task_id: taskId, executor_run_id: 1, pid: 123, worktree_path: '/tmp/wt' } },
      { type: 'task.completed',   payload: { task_id: taskId, duration_ms: 1234 } },
      { type: 'worker.completed', payload: { task_id: taskId, executor_run_id: 1, exit_code: 0 } },
      { type: 'task.failed',      payload: { task_id: taskId, failure_reason: 'simulated', attempt_n: 2 } },
      { type: 'worker.failed',    payload: { task_id: taskId, executor_run_id: 1, exit_code: 1, failure_reason: 'simulated' } },
    ];
    for (const ev of stamped) {
      const res = await req(app, 'POST', '/events', {
        type: ev.type,
        actor: 'executor',
        correlation_id: prompt.correlationId,
        entity_type: 'task',
        entity_id: taskId,
        payload: ev.payload,
      });
      expect(res.status).toBe(200);
    }

    // 3. /prompts/:id/events must surface every stamped event.
    const eventsRes = await req(app, 'GET', `/prompts/${prompt.id}/events`);
    expect(eventsRes.status).toBe(200);
    const eventsBody = eventsRes.body as { events: Array<{ type: string }>; total: number; correlation_id: string };
    expect(eventsBody.correlation_id).toBe(prompt.correlationId);
    expect(eventsBody.total).toBeGreaterThanOrEqual(stamped.length);
    const typesSeen = eventsBody.events.map(e => e.type);
    for (const ev of stamped) {
      expect(typesSeen).toContain(ev.type);
    }

    // 4. /prompts/:id/journey.totalEvents must be > 0 and include the five
    //    executor events plus the prompt.received bootstrap.
    const journeyRes = await req(app, 'GET', `/prompts/${prompt.id}/journey`);
    expect(journeyRes.status).toBe(200);
    const journey = journeyRes.body as { totalEvents: number; promptId: string };
    expect(journey.promptId).toBe(prompt.id);
    expect(journey.totalEvents).toBeGreaterThan(0);
    expect(journey.totalEvents).toBeGreaterThanOrEqual(stamped.length);
  });

  it('does NOT count executor events emitted without correlation_id (the pre-fix regression)', async () => {
    const db = createTestDb();
    const app = createApp(db);

    const prompt = createPrompt(db, { body: 'untraced flow' });
    const baselineRes = await req(app, 'GET', `/prompts/${prompt.id}/journey`);
    const baseline = (baselineRes.body as { totalEvents: number }).totalEvents;

    // Pre-fix dispatcher/completion-hook payload: NO correlation_id.
    for (const type of ['worker.spawned', 'task.completed', 'worker.completed', 'task.failed', 'worker.failed']) {
      await req(app, 'POST', '/events', {
        type,
        actor: 'executor',
        // correlation_id intentionally omitted — this is the bug DASH-107 fixes
        entity_type: 'task',
        entity_id: 'tsk_untraced',
        payload: { task_id: 'tsk_untraced' },
      });
    }

    const journeyRes = await req(app, 'GET', `/prompts/${prompt.id}/journey`);
    const after = (journeyRes.body as { totalEvents: number }).totalEvents;

    // Pre-fix: events go nowhere visible from this prompt's perspective.
    expect(after).toBe(baseline);
  });
});
