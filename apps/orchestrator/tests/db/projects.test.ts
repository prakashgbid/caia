import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { projects } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { seedProjects, INITIAL_PROJECTS } from '../../src/db/seed-projects';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

describe('seedProjects', () => {
  it('seeds all initial projects', async () => {
    const db = createTestDb();
    await seedProjects(db);

    const rows = db.select().from(projects).all();
    expect(rows.length).toBe(INITIAL_PROJECTS.length);
  });

  it('is idempotent - no duplicates on second run', async () => {
    const db = createTestDb();
    await seedProjects(db);
    await seedProjects(db); // Second run

    const rows = db.select().from(projects).all();
    expect(rows.length).toBe(INITIAL_PROJECTS.length);
  });

  it('seeds pokerzeno project correctly', async () => {
    const db = createTestDb();
    await seedProjects(db);

    const row = db.select().from(projects).where(eq(projects.slug, 'pokerzeno')).all()[0];
    expect(row).toBeDefined();
    expect(row!.name).toBe('PokerZeno');
    expect(row!.kind).toBe('site');
    expect(row!.status).toBe('active');
  });

  it('seeds conductor as internal project', async () => {
    const db = createTestDb();
    await seedProjects(db);

    const row = db.select().from(projects).where(eq(projects.slug, 'conductor')).all()[0];
    expect(row).toBeDefined();
    expect(row!.kind).toBe('internal');
  });

  it('all seeded projects have required fields', async () => {
    const db = createTestDb();
    await seedProjects(db);

    const rows = db.select().from(projects).all();
    for (const row of rows) {
      expect(row.id).toMatch(/^proj_/);
      expect(row.name).toBeTruthy();
      expect(row.slug).toBeTruthy();
      expect(row.kind).toBeTruthy();
      expect(row.status).toBe('active');
      expect(row.createdAt).toBeTruthy();
      expect(row.updatedAt).toBeTruthy();
    }
  });
});

describe('Project CRUD', () => {
  it('creates and retrieves a project', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.insert(projects).values({
      id: 'proj_custom',
      name: 'My Project',
      slug: 'my-project',
      kind: 'site',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).run();

    const row = db.select().from(projects).where(eq(projects.id, 'proj_custom')).all()[0];
    expect(row).toBeDefined();
    expect(row!.name).toBe('My Project');
  });

  it('updates project status', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.insert(projects).values({
      id: 'proj_upd',
      name: 'Upd',
      slug: 'upd',
      kind: 'plugin',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).run();

    db.update(projects).set({ status: 'archived', updatedAt: new Date().toISOString() })
      .where(eq(projects.id, 'proj_upd')).run();

    const row = db.select().from(projects).where(eq(projects.id, 'proj_upd')).all()[0];
    expect(row!.status).toBe('archived');
  });

  it('filters projects by kind', async () => {
    const db = createTestDb();
    await seedProjects(db);

    const plugins = db.select().from(projects).all().filter(p => p.kind === 'plugin');
    const sites = db.select().from(projects).all().filter(p => p.kind === 'site');

    expect(plugins.length).toBeGreaterThan(0);
    expect(sites.length).toBeGreaterThan(0);
  });
});
