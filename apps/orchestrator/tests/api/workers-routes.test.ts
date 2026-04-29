/**
 * /api/workers/* contract tests — TASKMGR-006.
 *
 * Hits each of the three endpoints against a freshly-migrated in-memory
 * SQLite seeded with workers + bucket health rows. Verifies the JSON
 * shape, sort order, the engaged-flag projection, and the per-bucket
 * 60-row history limit.
 *
 * 6 cases.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { Hono } from 'hono';
import * as schema from '../../src/db/schema';
import { workerPool, bucketHealthHistory } from '../../src/db/schema';
import { registerWorkerRoutes } from '../../src/api/routes/workers';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // Build a minimal Hono app with only the worker routes — avoids
  // pulling in apps/orchestrator/src/api/app.ts which has unrelated
  // module-resolution issues for routes outside this PR's scope.
  const app = new Hono();
  registerWorkerRoutes(app, db);
  return { db, app };
}

async function get(app: ReturnType<typeof setup>['app'], path: string) {
  const res = await app.request(path);
  expect(res.status).toBe(200);
  return res.json() as Promise<Record<string, unknown>>;
}

describe('GET /api/workers/summary', () => {
  it('returns zero counts + empty perBucket for a fresh DB', async () => {
    const { app } = setup();
    const body = await get(app, '/api/workers/summary');
    expect(body.counts).toEqual({ idle: 0, busy: 0, crashed: 0, released: 0 });
    expect(body.perBucket).toEqual([]);
    expect(typeof body.generatedAt).toBe('number');
  });

  it('aggregates counts across all worker statuses', async () => {
    const { db, app } = setup();
    const now = Date.now();
    const seed = (id: string, status: string, kind = 'coding') => ({
      id,
      kind,
      status,
      capabilitiesJson: '[]',
      lastHeartbeatAt: now,
      registeredAt: now,
      metadataJson: '{}',
    });
    db.insert(workerPool).values([
      seed('w1', 'idle'),
      seed('w2', 'idle'),
      seed('w3', 'busy'),
      seed('w4', 'crashed'),
      seed('w5', 'released'),
      seed('w6', 'idle', 'fix-it'),
    ]).run();
    const body = await get(app, '/api/workers/summary');
    expect(body.counts).toEqual({ idle: 3, busy: 1, crashed: 1, released: 1 });
  });

  it('perBucket reflects the most recent bucket_health_history row per bucket', async () => {
    const { db, app } = setup();
    const now = Date.now();
    const row = (id: string, bucketId: string, ts: number, depth: number, engaged = 0) => ({
      id,
      bucketId,
      ts,
      queueDepth: depth,
      throughputPerHour: 1,
      oldestReadyAgeS: null,
      workersAssigned: 0,
      engaged,
    });
    db.insert(bucketHealthHistory).values([
      row('h1', 'bkt_a', now - 2000, 5),
      row('h2', 'bkt_a', now - 1000, 7),       // newest a
      row('h3', 'bkt_b', now - 500, 12, 1),    // newest b, engaged
    ]).run();
    const body = await get(app, '/api/workers/summary');
    const perBucket = body.perBucket as Array<Record<string, unknown>>;
    expect(perBucket).toHaveLength(2);
    // sorted by queueDepth desc — bkt_b (12) before bkt_a (7)
    expect(perBucket[0]!.bucketId).toBe('bkt_b');
    expect(perBucket[0]!.queueDepth).toBe(12);
    expect(perBucket[0]!.engaged).toBe(true);
    expect(perBucket[1]!.bucketId).toBe('bkt_a');
    expect(perBucket[1]!.queueDepth).toBe(7);
  });
});

describe('GET /api/workers/list', () => {
  it('returns all workers sorted by registeredAt desc', async () => {
    const { db, app } = setup();
    const now = Date.now();
    db.insert(workerPool).values([
      {
        id: 'w_old',
        kind: 'coding',
        status: 'idle',
        capabilitiesJson: '[]',
        lastHeartbeatAt: now,
        registeredAt: now - 10_000,
        metadataJson: '{}',
      },
      {
        id: 'w_new',
        kind: 'coding',
        status: 'busy',
        currentStoryId: 'story-x',
        capabilitiesJson: JSON.stringify(['bkt_a']),
        lastHeartbeatAt: now,
        registeredAt: now - 1_000,
        metadataJson: JSON.stringify({ pid: 1234 }),
      },
    ]).run();
    const body = await get(app, '/api/workers/list');
    expect(body.total).toBe(2);
    const workers = body.workers as Array<Record<string, unknown>>;
    expect(workers[0]!.id).toBe('w_new');         // most recently registered first
    expect(workers[0]!.capabilities).toEqual(['bkt_a']);
    expect(workers[0]!.metadata).toEqual({ pid: 1234 });
    expect(typeof workers[0]!.uptimeMs).toBe('number');
    expect(workers[1]!.id).toBe('w_old');
    expect(workers[1]!.uptimeMs).toBeNull();      // idle workers have no uptime
  });
});

describe('GET /api/workers/health/:bucketId', () => {
  it('returns the last 60 rows for the bucket in chronological order', async () => {
    const { db, app } = setup();
    // Insert 80 rows for bkt_a; only the last 60 should appear.
    const rows = Array.from({ length: 80 }, (_, i) => ({
      id: `h${i}`,
      bucketId: 'bkt_a',
      ts: 1000 + i,
      queueDepth: i,
      throughputPerHour: 0,
      oldestReadyAgeS: null,
      workersAssigned: 0,
      engaged: 0,
    }));
    db.insert(bucketHealthHistory).values(rows).run();
    const body = await get(app, '/api/workers/health/bkt_a');
    expect(body.bucketId).toBe('bkt_a');
    const series = body.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(60);
    // oldest in returned set should be ts=1020 (i=20), newest ts=1079 (i=79)
    expect(series[0]!.ts).toBe(1020);
    expect(series[series.length - 1]!.ts).toBe(1079);
    // strictly ascending
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.ts).toBeGreaterThan(series[i - 1]!.ts as number);
    }
  });

  it('returns empty series for an unknown bucket', async () => {
    const { app } = setup();
    const body = await get(app, '/api/workers/health/nonexistent');
    expect(body).toEqual({ bucketId: 'nonexistent', series: [] });
  });
});
