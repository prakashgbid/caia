/**
 * DASH-302 / DASH-303 — guard the features + suggestions seeders.
 *
 * The seed scripts run on every orchestrator boot and must:
 *   1. Insert all SEEDS rows into the empty table (first boot).
 *   2. Be idempotent — re-running on a populated table inserts 0 new
 *      rows and skips the seed count.
 *   3. Resolve project slugs → ids when present (so /features and
 *      /suggestions filtered by project still find seeded rows).
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { businessFeatures, proactiveSuggestions, projects } from '../../src/db/schema';
import { seedFeatures, FEATURE_SEEDS, FEATURE_SEED_MARKER } from '../../src/db/seed-features';
import { seedSuggestions, SUGGESTION_SEEDS, SUGGESTION_SEED_MARKER } from '../../src/db/seed-suggestions';
import { seedProjects } from '../../src/db/seed-projects';
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

describe('DASH-302 seedFeatures', () => {
  let db: Db;
  let raw: Database.Database;

  beforeEach(async () => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    await seedProjects(db);
  });

  afterEach(() => {
    raw.close();
    _mockRaw = null;
  });

  it('inserts all seed rows on a fresh db', async () => {
    const beforeRows = db.select().from(businessFeatures).all();
    expect(beforeRows).toHaveLength(0);

    const result = await seedFeatures(db);
    expect(result.inserted).toBe(FEATURE_SEEDS.length);
    expect(result.skipped).toBe(0);

    const after = db.select().from(businessFeatures).all();
    expect(after).toHaveLength(FEATURE_SEEDS.length);
    for (const row of after) {
      expect(row.description).toContain(FEATURE_SEED_MARKER);
    }
  });

  it('is idempotent — re-running inserts zero new rows', async () => {
    await seedFeatures(db);
    const second = await seedFeatures(db);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(FEATURE_SEEDS.length);

    const all = db.select().from(businessFeatures).all();
    expect(all).toHaveLength(FEATURE_SEEDS.length);
  });

  it('resolves project slugs to project ids', async () => {
    await seedFeatures(db);
    const pokerzenoProj = db.select().from(projects).where(eq(projects.slug, 'pokerzeno')).get();
    expect(pokerzenoProj).toBeDefined();
    const pokerzenoFeats = db.select().from(businessFeatures)
      .where(eq(businessFeatures.projectId, pokerzenoProj!.id))
      .all();
    expect(pokerzenoFeats.length).toBeGreaterThan(0);
  });
});

describe('DASH-303 seedSuggestions', () => {
  let db: Db;
  let raw: Database.Database;

  beforeEach(async () => {
    ({ db, raw } = createTestDb());
    _mockRaw = raw;
    await seedProjects(db);
  });

  afterEach(() => {
    raw.close();
    _mockRaw = null;
  });

  it('inserts all seed rows on a fresh db, all in pending state', async () => {
    const result = await seedSuggestions(db);
    expect(result.inserted).toBe(SUGGESTION_SEEDS.length);
    expect(result.skipped).toBe(0);
    const after = db.select().from(proactiveSuggestions).all();
    expect(after).toHaveLength(SUGGESTION_SEEDS.length);
    for (const row of after) {
      expect(row.state).toBe('pending');
      expect(row.rationale).toContain(SUGGESTION_SEED_MARKER);
      const opts = JSON.parse(row.options) as unknown[];
      expect(Array.isArray(opts)).toBe(true);
      expect(opts.length).toBeGreaterThan(1);
    }
  });

  it('is idempotent — re-running inserts zero new rows', async () => {
    await seedSuggestions(db);
    const second = await seedSuggestions(db);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(SUGGESTION_SEEDS.length);
  });

  it('does NOT touch user-created suggestions on re-run', async () => {
    await seedSuggestions(db);
    db.insert(proactiveSuggestions).values({
      id: 'sug_user1',
      title: 'User-created suggestion',
      rationale: 'Real rationale, no marker.',
      options: JSON.stringify(['yes', 'no']),
      state: 'pending',
      scope: 'global',
      createdAt: new Date().toISOString(),
    } as typeof proactiveSuggestions.$inferInsert).run();

    const before = db.select().from(proactiveSuggestions).all().length;
    const result = await seedSuggestions(db);
    expect(result.inserted).toBe(0);
    const after = db.select().from(proactiveSuggestions).all();
    expect(after).toHaveLength(before);
    const userRow = after.find(r => r.id === 'sug_user1');
    expect(userRow).toBeDefined();
    expect(userRow!.title).toBe('User-created suggestion');
  });
});
