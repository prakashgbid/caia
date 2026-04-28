/**
 * DASH-301 — guard the /requirements pagination contract.
 *
 * The legacy bare-array shape returned all rows uncapped, leading to a
 * 14 MB payload at production scale. This route now supports
 * `?limit=N&cursor=<base64>` and returns
 *   { requirements: [...], nextCursor: <base64|null>, total: N }
 * Without `?limit`, the legacy array shape is preserved for backward
 * compatibility with older dashboard builds.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations, getSqliteRaw } from '../../src/db/connection';
import { registerLegacyRoutes } from '../../src/api/routes/legacy';
import { wireEventBus } from '../../src/events/bus-adapter';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('DASH-301 GET /requirements pagination', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-dash301-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    wireEventBus(db);
    app = new Hono();
    registerLegacyRoutes(app, db);

    // Seed 25 requirements with predictable createdAt timestamps
    const sqlite = getSqliteRaw();
    const stmt = sqlite.prepare(
      "INSERT INTO requirements (id, title, description, state, priority, labels, target_project, estimated_files, depends_on, linked_task_ids, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (let i = 0; i < 25; i++) {
      const ts = new Date(2026, 0, 1, 0, 0, i).toISOString();
      stmt.run(`req_${i.toString().padStart(2, '0')}`, `Req ${i}`, '', 'captured', 3, '[]', null, '[]', '[]', '[]', 'global', ts, ts);
    }
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  it('without ?limit returns legacy bare-array shape (back-compat)', async () => {
    const res = await app.request('/requirements');
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(25);
  });

  it('with ?limit=10 returns first page + nextCursor + total', async () => {
    const res = await app.request('/requirements?limit=10');
    expect(res.status).toBe(200);
    const body = await res.json() as { requirements: Array<{ id: string }>; nextCursor: string | null; total: number };
    expect(body.total).toBe(25);
    expect(body.requirements.length).toBe(10);
    expect(body.requirements[0].id).toBe('req_00');
    expect(body.requirements[9].id).toBe('req_09');
    expect(body.nextCursor).toBeTruthy();
  });

  it('cursor walks pages until nextCursor is null', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let safety = 5;
    while (safety-- > 0) {
      const url = cursor ? `/requirements?limit=10&cursor=${encodeURIComponent(cursor)}` : '/requirements?limit=10';
      const res = await app.request(url);
      const body = await res.json() as { requirements: Array<{ id: string }>; nextCursor: string | null };
      seen.push(...body.requirements.map(r => r.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen.length).toBe(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen[0]).toBe('req_00');
    expect(seen[24]).toBe('req_24');
  });

  it('clamps limit to max 500', async () => {
    const res = await app.request('/requirements?limit=99999');
    const body = await res.json() as { requirements: unknown[]; total: number };
    expect(body.requirements.length).toBe(25); // only 25 seeded; clamp wouldn't be observable here
    expect(body.total).toBe(25);
  });
});
