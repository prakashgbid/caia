import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { createApp } from '../../src/api/app';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as ReturnType<typeof drizzle<typeof schema>>;
}

async function req(
  app: ReturnType<typeof createApp>,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await app.request(`http://localhost${url}`, init);
  let responseBody: unknown;
  try { responseBody = await response.json(); } catch { responseBody = null; }
  return { status: response.status, body: responseBody };
}

describe('GET /oss-registry', () => {
  it('returns registry summary with totals and breakdowns', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/oss-registry');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b['totalPackages']).toBe('number');
    expect((b['totalPackages'] as number)).toBeGreaterThan(0);
    expect(typeof b['kindBreakdown']).toBe('object');
    expect(typeof b['statusBreakdown']).toBe('object');
    expect(typeof b['lastUpdated']).toBe('string');
  });
});

describe('GET /oss-registry/packages', () => {
  it('returns all packages without filters', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/oss-registry/packages');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBeGreaterThan(0);
  });

  it('filters by kind=package', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { body } = await req(app, 'GET', '/oss-registry/packages?kind=package');
    const pkgs = body as Array<{ kind: string }>;
    expect(pkgs.every((p) => p.kind === 'package')).toBe(true);
  });

  it('filters by kind=app', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { body } = await req(app, 'GET', '/oss-registry/packages?kind=app');
    const pkgs = body as Array<{ kind: string }>;
    expect(pkgs.length).toBeGreaterThan(0);
    expect(pkgs.every((p) => p.kind === 'app')).toBe(true);
  });

  it('filters by status=stable', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { body } = await req(app, 'GET', '/oss-registry/packages?status=stable');
    const pkgs = body as Array<{ status: string }>;
    expect(pkgs.length).toBeGreaterThan(0);
    expect(pkgs.every((p) => p.status === 'stable')).toBe(true);
  });

  it('returns empty array for unknown kind', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { body } = await req(app, 'GET', '/oss-registry/packages?kind=nonexistent');
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });
});

describe('GET /oss-registry/packages/:name', () => {
  it('returns a specific package by name', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/oss-registry/packages/%40caia%2Fconfig');
    expect(status).toBe(200);
    const pkg = body as { name: string; kind: string };
    expect(pkg['name']).toBe('@caia/config');
  });

  it('returns 404 for unknown package', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status } = await req(app, 'GET', '/oss-registry/packages/%40unknown%2Fpkg');
    expect(status).toBe(404);
  });
});
