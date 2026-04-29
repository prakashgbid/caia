/**
 * Migration 0025 integration test — a story with declared
 * `inputDependencies` must surface them on the bundle endpoint
 * (`GET /stories/:id/bundle`) so executors and the dashboard can read
 * them without re-querying.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations } from '../../src/db/connection';
import { wireEventBus } from '../../src/events/bus-adapter';
import { registerStoriesRoutes } from '../../src/api/routes/stories';
import { stories } from '../../src/db/schema';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('migration 0025 — inputDependencies on /stories/:id/bundle', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-input-deps-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    wireEventBus(db);
    app = new Hono();
    registerStoriesRoutes(app, db);
  });

  afterEach(() => {
    try { fs.unlinkSync(dbPath); } catch { /* best-effort */ }
  });

  it('legacy story with no input deps returns []', async () => {
    const db = getDb();
    const id = 'st_legacy_1';
    db.insert(stories).values({
      id,
      title: 'Legacy story',
      kind: 'story',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }).run();

    const res = await app.request(`/stories/${id}/bundle`);
    expect(res.status).toBe(200);
    const body = await res.json() as { inputDependencies: unknown[] };
    expect(body.inputDependencies).toEqual([]);
  });

  it('story with one declared input dependency surfaces it on the bundle', async () => {
    const db = getDb();
    const id = 'st_with_deps_1';
    const dep = {
      kind: 'capability',
      name: 'login flow',
      description: 'must already authenticate the user',
      required: true,
      declaredBy: 'po',
      declaredAt: 1730000000000,
    };
    db.insert(stories).values({
      id,
      title: 'Profile page',
      kind: 'story',
      status: 'pending',
      inputDependenciesJson: JSON.stringify([dep]),
      createdAt: new Date().toISOString(),
    }).run();

    const res = await app.request(`/stories/${id}/bundle`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      inputDependencies: Array<Record<string, unknown>>;
    };
    expect(body.inputDependencies).toHaveLength(1);
    expect(body.inputDependencies[0]).toEqual(dep);
  });

  it('returns multiple input deps in declared order', async () => {
    const db = getDb();
    const id = 'st_multi_deps';
    const deps = [
      { kind: 'capability', name: 'login flow', description: '', required: true, declaredBy: 'po', declaredAt: 1 },
      { kind: 'schema', name: 'users table', description: '', required: true, declaredBy: 'ea', declaredAt: 2, satisfiedBy: 'st_users_table' },
      { kind: 'env', name: 'STRIPE_API_KEY', description: '', required: false, declaredBy: 'po', declaredAt: 3 },
    ];
    db.insert(stories).values({
      id,
      title: 'Checkout',
      kind: 'story',
      status: 'pending',
      inputDependenciesJson: JSON.stringify(deps),
      createdAt: new Date().toISOString(),
    }).run();

    const res = await app.request(`/stories/${id}/bundle`);
    const body = await res.json() as {
      inputDependencies: Array<{ name: string; satisfiedBy?: string; required: boolean }>;
    };
    expect(body.inputDependencies).toHaveLength(3);
    expect(body.inputDependencies.map(d => d.name)).toEqual([
      'login flow', 'users table', 'STRIPE_API_KEY',
    ]);
    expect(body.inputDependencies[1]!.satisfiedBy).toBe('st_users_table');
    expect(body.inputDependencies[2]!.required).toBe(false);
  });

  it('drops non-object entries from input_dependencies_json (defensive parsing)', async () => {
    const db = getDb();
    const id = 'st_garbage';
    db.insert(stories).values({
      id,
      title: 'Hand-edited',
      kind: 'story',
      status: 'pending',
      inputDependenciesJson: JSON.stringify([
        'this should be dropped',
        42,
        { kind: 'capability', name: 'real one', description: '', required: true, declaredBy: 'po', declaredAt: 1 },
      ]),
      createdAt: new Date().toISOString(),
    }).run();

    const res = await app.request(`/stories/${id}/bundle`);
    const body = await res.json() as { inputDependencies: Array<{ name: string }> };
    expect(body.inputDependencies).toHaveLength(1);
    expect(body.inputDependencies[0]!.name).toBe('real one');
  });

  it('input deps are independent of taxonomy.blockedBy (different fields)', async () => {
    const db = getDb();
    const id = 'st_indep_1';
    db.insert(stories).values({
      id,
      title: 'Profile',
      kind: 'story',
      status: 'pending',
      inputDependenciesJson: JSON.stringify([
        { kind: 'capability', name: 'login flow', description: '', required: true, declaredBy: 'po', declaredAt: 1 },
      ]),
      blockedByJson: JSON.stringify(['st_other_1']),
      createdAt: new Date().toISOString(),
    }).run();

    const res = await app.request(`/stories/${id}/bundle`);
    const body = await res.json() as {
      inputDependencies: Array<{ kind: string; name: string }>;
      dependencies: { upstream: string[]; downstream: string[] };
    };
    expect(body.inputDependencies).toHaveLength(1);
    expect(body.inputDependencies[0]!.name).toBe('login flow');
    expect(body.dependencies.upstream).toEqual([]);
  });
});
