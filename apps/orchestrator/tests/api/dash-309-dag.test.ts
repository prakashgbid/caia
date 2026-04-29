/**
 * DASH-309 — guard the GET /dag route.
 *
 * The dashboard's /dag page (in apps/dashboard/app/dag/page.tsx) renders
 * a mermaid graph from this endpoint. Contract pinned here:
 *   - returns { nodes: {id,title,status}[], edges: {from,to}[] }
 *   - edges built from tasks.depends_on JSON arrays
 *   - root=<id> filter does a bidirectional BFS
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { Hono } from 'hono';
import * as schema from '../../src/db/schema';
import { tasks } from '../../src/db/schema';
import { registerDagRoutes } from '../../src/api/routes/dag';
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

function makeTask(id: string, deps: string[] = []): typeof tasks.$inferInsert {
  return {
    id, title: `Task ${id}`, status: 'queued', cwd: '/',
    declaredFiles: '[]', dependsOn: JSON.stringify(deps),
    paused: false, attemptCount: 0,
    createdAt: new Date().toISOString(),
  } as typeof tasks.$inferInsert;
}

describe('DASH-309 GET /dag', () => {
  let db: Db;
  let raw: Database.Database;
  let app: Hono;

  beforeEach(() => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    app = new Hono();
    registerDagRoutes(app, db);
  });

  afterEach(() => {
    raw.close();
    _mockRaw = null;
  });

  it('returns empty arrays when there are no tasks', async () => {
    const res = await app.request('/dag');
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: unknown[]; edges: unknown[] };
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  it('builds nodes + edges from tasks.depends_on', async () => {
    db.insert(tasks).values(makeTask('a')).run();
    db.insert(tasks).values(makeTask('b', ['a'])).run();
    db.insert(tasks).values(makeTask('c', ['a', 'b'])).run();

    const res = await app.request('/dag');
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> };
    expect(body.nodes).toHaveLength(3);
    expect(body.edges).toHaveLength(3);
    expect(body.edges).toEqual(expect.arrayContaining([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'c' },
    ]));
  });

  it('?root=<id> restricts to the connected cone (BFS in both directions)', async () => {
    // Two disconnected components: a→b→c, and x→y
    db.insert(tasks).values(makeTask('a')).run();
    db.insert(tasks).values(makeTask('b', ['a'])).run();
    db.insert(tasks).values(makeTask('c', ['b'])).run();
    db.insert(tasks).values(makeTask('x')).run();
    db.insert(tasks).values(makeTask('y', ['x'])).run();

    const res = await app.request('/dag?root=b');
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ id: string }>; edges: unknown[] };
    const ids = body.nodes.map(n => n.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('skips edges that reference non-existent task ids gracefully', async () => {
    db.insert(tasks).values(makeTask('a', ['ghost'])).run();
    const res = await app.request('/dag');
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> };
    // The ghost edge is still emitted (DAG view shows hanging edges) but
    // there's only one real node.
    expect(body.nodes.map(n => n.id)).toEqual(['a']);
    expect(body.edges).toEqual([{ from: 'ghost', to: 'a' }]);
  });
});
