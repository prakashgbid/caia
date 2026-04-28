/**
 * DASH-202 — guard the /platform-stats endpoint contract.
 *
 * The /platform-status dashboard page expects this endpoint to return a
 * PlatformStats object: {totalPrompts, activeTasks, blockedTasks,
 * completedToday, avgTaskDurationMs, queueDepth, lastUpdated}. This test
 * pins the route's existence and shape.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations, getSqliteRaw } from '../../src/db/connection';
import { registerStatsRoutes } from '../../src/api/routes/stats';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('DASH-202 GET /platform-stats', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-dash202-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    getDb(dbPath); // prime
    app = new Hono();
    registerStatsRoutes(app);
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  it('returns a PlatformStats envelope with all required fields on a fresh DB', async () => {
    const res = await app.request('/platform-stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      totalPrompts: expect.any(Number),
      activeTasks: expect.any(Number),
      blockedTasks: expect.any(Number),
      completedToday: expect.any(Number),
      avgTaskDurationMs: expect.any(Number),
      queueDepth: expect.any(Number),
      lastUpdated: expect.any(Number),
    }));
  });

  it('reports correct counts after seeding tasks in different states', async () => {
    const sqlite = getSqliteRaw();

    // Seed a prompt (real schema: received_at + received_via)
    sqlite.prepare(
      "INSERT INTO prompts (id, body, received_at, received_via, status, correlation_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('prm_test', 'test prompt', new Date().toISOString(), 'user', 'received', 'prm_test', 'h1');

    // Seed tasks: 1 running, 1 blocked, 1 queued, 1 done-today
    const now = new Date().toISOString();
    sqlite.prepare(
      "INSERT INTO tasks (id, title, status, cwd, created_at, attempt_count, paused, root_prompt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run('tsk_run', 'running', 'running', '/tmp', now, 0, 0, 'prm_test');
    sqlite.prepare(
      "INSERT INTO tasks (id, title, status, cwd, created_at, attempt_count, paused, root_prompt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run('tsk_blk', 'blocked', 'blocked', '/tmp', now, 0, 0, 'prm_test');
    sqlite.prepare(
      "INSERT INTO tasks (id, title, status, cwd, created_at, attempt_count, paused, root_prompt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run('tsk_q', 'queued', 'queued', '/tmp', now, 0, 0, 'prm_test');
    sqlite.prepare(
      "INSERT INTO tasks (id, title, status, cwd, created_at, attempt_count, paused, root_prompt_id, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run('tsk_done', 'done-today', 'done', '/tmp', now, 0, 0, 'prm_test', now);

    const res = await app.request('/platform-stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, number>;
    expect(body.totalPrompts).toBe(1);
    expect(body.activeTasks).toBe(1);
    expect(body.blockedTasks).toBe(1);
    expect(body.queueDepth).toBe(1);
    expect(body.completedToday).toBe(1);
  });
});
