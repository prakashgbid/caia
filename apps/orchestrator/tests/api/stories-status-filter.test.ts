/**
 * DASH-001: regression test for `GET /stories?status=...` filter.
 *
 * Pre-fix bug: handler in routes/stories.ts read parent_id, project_slug,
 * kind, root from c.req.query() but NOT status — so status filtering was
 * silently a no-op. The audit ran into this empirically: querying
 * /stories?status=pending returned all 383 rows instead of the 277
 * actually-pending ones. See
 * Documents/projects/reports/outstanding-tasks-audit-2026-04-30.md.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories } from '../../src/db/schema';
import { createApp } from '../../src/api/app';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as ReturnType<typeof drizzle<typeof schema>>;
}

async function get(
  app: ReturnType<typeof createApp>,
  url: string,
): Promise<{ status: number; body: unknown }> {
  const response = await app.request(`http://localhost${url}`, { method: 'GET' });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* */ }
  return { status: response.status, body };
}

function makeStory(
  db: ReturnType<typeof createTestDb>,
  id: string,
  status: string,
  ordinal = 0,
  parentId: string | null = null,
): void {
  db.insert(stories).values({
    id,
    title: `story ${id}`,
    kind: parentId === null ? 'epic' : 'task',
    status,
    ordinal,
    parentId,
    createdAt: new Date().toISOString(),
  }).run();
}

describe('GET /stories — status filter (DASH-001 regression)', () => {
  it('returns only pending stories when status=pending', async () => {
    const db = createTestDb();
    makeStory(db, 'st_p1', 'pending', 0);
    makeStory(db, 'st_p2', 'pending', 1);
    makeStory(db, 'st_r1', 'resolved', 2);
    makeStory(db, 'st_c1', 'cancelled', 3);

    const app = createApp(db);
    const { status, body } = await get(app, '/stories?status=pending');
    expect(status).toBe(200);
    const rows = body as Array<{ id: string; status: string }>;
    expect(rows.map(r => r.id).sort()).toEqual(['st_p1', 'st_p2']);
    expect(rows.every(r => r.status === 'pending')).toBe(true);
  });

  it('returns only resolved stories when status=resolved', async () => {
    const db = createTestDb();
    makeStory(db, 'st_p1', 'pending', 0);
    makeStory(db, 'st_r1', 'resolved', 1);

    const app = createApp(db);
    const { status, body } = await get(app, '/stories?status=resolved');
    expect(status).toBe(200);
    const rows = body as Array<{ id: string; status: string }>;
    expect(rows.map(r => r.id)).toEqual(['st_r1']);
  });

  it('supports comma-separated multi-status filter', async () => {
    const db = createTestDb();
    makeStory(db, 'st_p1', 'pending', 0);
    makeStory(db, 'st_r1', 'resolved', 1);
    makeStory(db, 'st_c1', 'cancelled', 2);

    const app = createApp(db);
    const { status, body } = await get(app, '/stories?status=pending,resolved');
    expect(status).toBe(200);
    const rows = body as Array<{ id: string; status: string }>;
    expect(rows.map(r => r.id).sort()).toEqual(['st_p1', 'st_r1']);
  });

  it('returns all rows when status is omitted (no regression on default)', async () => {
    const db = createTestDb();
    makeStory(db, 'st_p1', 'pending', 0);
    makeStory(db, 'st_r1', 'resolved', 1);
    makeStory(db, 'st_c1', 'cancelled', 2);

    const app = createApp(db);
    const { status, body } = await get(app, '/stories');
    expect(status).toBe(200);
    const rows = body as unknown[];
    expect(rows.length).toBe(3);
  });

  it('combines status filter with parent_id filter', async () => {
    const db = createTestDb();
    makeStory(db, 'st_root', 'pending', 0);
    makeStory(db, 'st_child_pending', 'pending', 1, 'st_root');
    makeStory(db, 'st_child_resolved', 'resolved', 2, 'st_root');

    const app = createApp(db);
    const { status, body } = await get(
      app,
      '/stories?parent_id=st_root&status=resolved',
    );
    expect(status).toBe(200);
    const rows = body as Array<{ id: string }>;
    expect(rows.map(r => r.id)).toEqual(['st_child_resolved']);
  });

  it('returns empty array when status matches nothing', async () => {
    const db = createTestDb();
    makeStory(db, 'st_p1', 'pending', 0);

    const app = createApp(db);
    const { status, body } = await get(app, '/stories?status=does-not-exist');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});
