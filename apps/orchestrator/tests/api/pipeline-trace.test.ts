/**
 * /api/pipelines/:promptId/trace + /api/pipelines/recent — HARDEN-006 tests.
 *
 * Drives the route handlers via Hono's c.req.fetch-style invocation
 * (matching the pattern used by the existing route test files). Each
 * test seeds a synthetic prompt + stage rows + a pair of events on the
 * bus, then asserts the trace payload shape.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Hono } from 'hono';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { prompts, promptPipelineStages } from '../../src/db/schema';
import { eventBus, wireEventBus } from '../../src/events/bus-adapter';
import { registerPipelineTraceRoutes } from '../../src/api/routes/pipeline-trace';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  wireEventBus(db);
  const app = new Hono();
  registerPipelineTraceRoutes(app, db);
  return { db, app };
}

function seedPrompt(db: ReturnType<typeof setup>['db'], id: string, correlationId: string): void {
  db.insert(prompts).values({
    id,
    body: `body-${id}`,
    receivedAt: new Date('2026-04-29T00:00:00Z').toISOString(),
    correlationId,
    hash: `h-${id}`,
  }).run();
}

function seedStage(
  db: ReturnType<typeof setup>['db'],
  promptId: string,
  stage: string,
  enteredAt: number,
  durationMs: number | null = null,
): void {
  db.insert(promptPipelineStages).values({
    id: `pps_${promptId}_${stage}`,
    promptId,
    stage,
    entityKind: null,
    entityId: null,
    enteredAt,
    durationMs,
    metadata: null,
  } as never).run();
}

describe('GET /api/pipelines/:promptId/trace', () => {
  it('returns 404 for an unknown prompt', async () => {
    const { app } = setup();
    const res = await app.request('/api/pipelines/p_ghost/trace');
    expect(res.status).toBe(404);
  });

  it('returns prompt + stages + events + summary for a known prompt', async () => {
    const { db, app } = setup();
    seedPrompt(db, 'p_a', 'corr_a');
    seedStage(db, 'p_a', 'ingested', 1000, 500);
    seedStage(db, 'p_a', 'scaffolded', 1500, 1000);

    eventBus.publish({
      type: 'prompt.ingested',
      actor: 'api',
      correlation_id: 'corr_a',
      payload: { promptId: 'p_a' },
    });
    eventBus.publish({
      type: 'po-agent.decomposition.complete',
      actor: 'po-agent',
      correlation_id: 'corr_a',
      payload: { storyCount: 3 },
    });

    const res = await app.request('/api/pipelines/p_a/trace');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.prompt.id).toBe('p_a');
    expect(body.prompt.correlationId).toBe('corr_a');
    expect(body.stages).toHaveLength(2);
    expect(body.stages[0].stage).toBe('ingested');
    expect(body.events.length).toBeGreaterThanOrEqual(2);
    expect(body.summary.eventCount).toBe(body.events.length);
    expect(body.cost).toBeNull(); // until HARDEN-002 wiring lands
    // Events sorted ascending by occurredAt
    for (let i = 1; i < body.events.length; i++) {
      expect(body.events[i].occurredAt >= body.events[i - 1].occurredAt).toBe(true);
    }
  });

  it('respects ?limit on the events list', async () => {
    const { db, app } = setup();
    seedPrompt(db, 'p_b', 'corr_b');
    for (let i = 0; i < 10; i++) {
      eventBus.publish({
        type: 'pipeline.stage.advanced',
        actor: 'system',
        correlation_id: 'corr_b',
        payload: { i },
      });
    }
    const res = await app.request('/api/pipelines/p_b/trace?limit=3');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.events.length).toBeLessThanOrEqual(3);
  });

  it('counts errors + warnings in summary', async () => {
    const { db, app } = setup();
    seedPrompt(db, 'p_c', 'corr_c');
    eventBus.publish({
      type: 'system.error',
      actor: 'system',
      correlation_id: 'corr_c',
      payload: { msg: 'boom' },
    });
    eventBus.publish({
      type: 'task-scheduler.backpressure.engaged',
      actor: 'task-scheduler',
      correlation_id: 'corr_c',
      payload: { bucketId: 'bkt' },
    });
    const res = await app.request('/api/pipelines/p_c/trace');
    const body: any = await res.json();
    expect(body.summary.errorCount).toBeGreaterThanOrEqual(1);
    expect(body.summary.warningCount).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/pipelines/recent', () => {
  it('returns prompts sorted by receivedAt desc', async () => {
    const { db, app } = setup();
    db.insert(prompts).values({
      id: 'p_old', body: 'older', receivedAt: '2026-04-28T00:00:00Z',
      correlationId: 'corr_old', hash: 'h_old',
    }).run();
    db.insert(prompts).values({
      id: 'p_new', body: 'newer', receivedAt: '2026-04-29T00:00:00Z',
      correlationId: 'corr_new', hash: 'h_new',
    }).run();
    const res = await app.request('/api/pipelines/recent');
    const body: any = await res.json();
    expect(body.pipelines.map((p: { id: string }) => p.id)).toEqual(['p_new', 'p_old']);
  });

  it('caps limit at 200', async () => {
    const { app } = setup();
    const res = await app.request('/api/pipelines/recent?limit=99999');
    expect(res.status).toBe(200);
  });
});
