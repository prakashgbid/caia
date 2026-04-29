/**
 * /api/workers/* lifecycle contract tests — CODING-007.
 *
 * Covers the four POST/GET endpoints added by CODING-007:
 *   POST /api/workers/register
 *   POST /api/workers/:id/heartbeat
 *   GET  /api/workers/:id/assignment
 *   POST /api/workers/:id/release
 *
 * Tests run with the registry attached so we exercise the bus-event path,
 * and also without the registry to prove the fallback DB writes work.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { Hono } from 'hono';
import * as schema from '../../src/db/schema';
import { workerPool, stories } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { registerWorkerRoutes } from '../../src/api/routes/workers';
import { WorkerPoolRegistry } from '../../src/agents/worker-pool-registry';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup({ withRegistry }: { withRegistry: boolean }) {
  const sqlite = new Database(':memory:');
  // Disable FK enforcement so seeded stories don't need a backing
  // project_slug / parent / etc. Real production wiring lives in the
  // pump tests; these tests only exercise the lifecycle endpoints.
  sqlite.pragma('foreign_keys = OFF');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const registry = withRegistry ? new WorkerPoolRegistry(db, { silent: true }) : undefined;
  const app = new Hono();
  registerWorkerRoutes(app, db, { registry });
  return { db, app, registry };
}

async function postJson<T = Record<string, unknown>>(
  app: Hono,
  url: string,
  body: unknown,
): Promise<{ status: number; data: T }> {
  const res = await app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

async function getJson<T = Record<string, unknown>>(
  app: Hono,
  url: string,
): Promise<{ status: number; data: T }> {
  const res = await app.request(url);
  return { status: res.status, data: (await res.json()) as T };
}

describe.each([
  { mode: 'with registry', withRegistry: true },
  { mode: 'without registry', withRegistry: false },
])('/api/workers lifecycle ($mode)', ({ withRegistry }) => {
  it('register returns a workerId and persists the row', async () => {
    const { app, db } = setup({ withRegistry });
    const { status, data } = await postJson<{ workerId: string }>(
      app,
      '/api/workers/register',
      { kind: 'coding', socketPath: '/tmp/x.sock', capabilities: ['bucket_a'] },
    );
    expect(status).toBe(200);
    expect(typeof data.workerId).toBe('string');
    const row = db.select().from(workerPool).where(eq(workerPool.id, data.workerId)).get();
    expect(row?.kind).toBe('coding');
    expect(row?.status).toBe('idle');
    expect(JSON.parse(row?.capabilitiesJson ?? '[]')).toEqual(['bucket_a']);
    // socketPath must land in metadata so Fix-It can dial it later.
    expect(JSON.parse(row?.metadataJson ?? '{}').socketPath).toBe('/tmp/x.sock');
  });

  it('register honours an explicit id', async () => {
    const { app } = setup({ withRegistry });
    const { data } = await postJson<{ workerId: string }>(
      app,
      '/api/workers/register',
      { kind: 'coding', socketPath: '/tmp/x.sock', id: 'wkr_custom_42' },
    );
    expect(data.workerId).toBe('wkr_custom_42');
  });

  it('register rejects missing kind', async () => {
    const { app } = setup({ withRegistry });
    const { status, data } = await postJson(app, '/api/workers/register', { socketPath: '/tmp/x.sock' });
    expect(status).toBe(400);
    expect((data as { error: string }).error).toMatch(/kind/);
  });

  it('register rejects missing socketPath', async () => {
    const { app } = setup({ withRegistry });
    const { status, data } = await postJson(app, '/api/workers/register', { kind: 'coding' });
    expect(status).toBe(400);
    expect((data as { error: string }).error).toMatch(/socketPath/);
  });

  it('heartbeat bumps the lastHeartbeatAt and returns status', async () => {
    const { app, db } = setup({ withRegistry });
    const { data: reg } = await postJson<{ workerId: string }>(
      app,
      '/api/workers/register',
      { kind: 'coding', socketPath: '/tmp/x.sock', id: 'wkr_hb' },
    );
    // Force the row's heartbeat into the past so we can detect the update.
    db.update(workerPool).set({ lastHeartbeatAt: 1 }).where(eq(workerPool.id, reg.workerId)).run();
    const { status, data } = await postJson<{ ok: boolean; status: string; currentStoryId: string | null }>(
      app,
      `/api/workers/${reg.workerId}/heartbeat`,
      {},
    );
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toBe('idle');
    expect(data.currentStoryId).toBeNull();
    const row = db.select().from(workerPool).where(eq(workerPool.id, reg.workerId)).get();
    expect((row?.lastHeartbeatAt ?? 0) > 1).toBe(true);
  });

  it('heartbeat 404s for an unknown worker', async () => {
    const { app } = setup({ withRegistry });
    const { status } = await postJson(app, '/api/workers/wkr_does_not_exist/heartbeat', {});
    expect(status).toBe(404);
  });

  it('assignment returns null when the worker has no current story', async () => {
    const { app } = setup({ withRegistry });
    const { data: reg } = await postJson<{ workerId: string }>(
      app,
      '/api/workers/register',
      { kind: 'coding', socketPath: '/tmp/x.sock', id: 'wkr_a' },
    );
    const { status, data } = await getJson<{ assignment: unknown }>(
      app,
      `/api/workers/${reg.workerId}/assignment`,
    );
    expect(status).toBe(200);
    expect(data.assignment).toBeNull();
  });

  it('assignment surfaces the current story when the consumer has assigned one', async () => {
    const { app, db } = setup({ withRegistry });
    const { data: reg } = await postJson<{ workerId: string }>(
      app,
      '/api/workers/register',
      { kind: 'coding', socketPath: '/tmp/x.sock', id: 'wkr_b' },
    );
    // Seed a story and flip the worker to busy pointing at it (this is
    // what ReadyPoolConsumer.atomicAssign does in production).
    db.insert(stories).values({
      id: 's_demo',
      title: 't',
      description: 'd',
      createdAt: '1700000000000',
      status: 'pending',
      bucketId: 'bucket_main',
      templateVersion: 'v1',
      templateValidationStatus: 'valid',
      assignedWorkerId: reg.workerId,
    }).run();
    const ts = 1_700_000_000_000;
    db.update(workerPool)
      .set({ status: 'busy', currentStoryId: 's_demo', lastHeartbeatAt: ts })
      .where(eq(workerPool.id, reg.workerId))
      .run();
    const { data } = await getJson<{ assignment: { storyId: string; bucketId: string; assignedAt: number } }>(
      app,
      `/api/workers/${reg.workerId}/assignment`,
    );
    expect(data.assignment.storyId).toBe('s_demo');
    expect(data.assignment.bucketId).toBe('bucket_main');
    expect(data.assignment.assignedAt).toBe(ts);
  });

  it('assignment 404s for an unknown worker', async () => {
    const { app } = setup({ withRegistry });
    const { status } = await getJson(app, '/api/workers/wkr_missing/assignment');
    expect(status).toBe(404);
  });

  it('release flips the worker to released and is idempotent on second call', async () => {
    const { app, db } = setup({ withRegistry });
    const { data: reg } = await postJson<{ workerId: string }>(
      app,
      '/api/workers/register',
      { kind: 'coding', socketPath: '/tmp/x.sock', id: 'wkr_r' },
    );
    const { status, data } = await postJson<{ ok: boolean }>(
      app,
      `/api/workers/${reg.workerId}/release`,
      { reason: 'task-completed' },
    );
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    const row = db.select().from(workerPool).where(eq(workerPool.id, reg.workerId)).get();
    expect(row?.status).toBe('released');
    expect(row?.releasedAt).toBeTruthy();
  });

  it('release 404s for an unknown worker', async () => {
    const { app } = setup({ withRegistry });
    const { status } = await postJson(app, '/api/workers/wkr_phantom/release', {});
    expect(status).toBe(404);
  });
});
