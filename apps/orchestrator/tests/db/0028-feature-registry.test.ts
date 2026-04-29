/**
 * Migration 0028 smoke tests — feature_registry + feature_registry_search_log.
 *
 * Verifies the migration applies cleanly to a fresh in-memory DB and the
 * new schema is functional via drizzle (insert/select/UNIQUE on dedup_key/
 * indexes used by the dashboard surfaces in FREG-007).
 *
 * vec0 + FTS5 virtual tables are exercised by FREG-002's separate
 * integration tests (they require the sqlite-vec extension to be loaded
 * into the connection, which is not part of this migration).
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, sql } from 'drizzle-orm';
import * as path from 'path';
import { computeDedupKey } from '@chiefaia/feature-registry';
import * as schema from '../../src/db/schema';
import { featureRegistry, featureRegistrySearchLog } from '../../src/db/schema';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  const dedupKey = computeDedupKey({
    project: 'pokerzeno',
    name: 'leaderboard page',
    routePath: '/leaderboard',
  });
  return {
    id: 'freg_test000001',
    project: 'pokerzeno',
    name: 'leaderboard page',
    description: 'ranks top players by chips won today',
    routePath: '/leaderboard',
    filePathsJson: JSON.stringify(['app/leaderboard/page.tsx']),
    componentName: 'LeaderboardPage',
    apiEndpoint: null,
    dbTablesJson: JSON.stringify(['users']),
    agentName: null,
    shippedAt: now,
    storyId: 'story-leader-aaaa',
    tagsJson: JSON.stringify(['gameplay', 'frontend']),
    embeddingModel: 'nomic-embed-text',
    embeddingDim: 768,
    embeddingVersion: 'v1.5',
    source: 'story_completed',
    createdAt: now,
    updatedAt: now,
    dedupKey,
    ...overrides,
  } as const;
}

describe('migration 0028: feature_registry', () => {
  it('creates the feature_registry table and inserts a row', () => {
    const db = createTestDb();
    db.insert(featureRegistry).values(row()).run();
    const rows = db.select().from(featureRegistry).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.project).toBe('pokerzeno');
    expect(rows[0]!.name).toBe('leaderboard page');
    expect(rows[0]!.embeddingModel).toBe('nomic-embed-text');
    expect(rows[0]!.embeddingDim).toBe(768);
  });

  it('enforces UNIQUE on dedup_key (idempotent upsert key)', () => {
    const db = createTestDb();
    db.insert(featureRegistry).values(row({ id: 'freg_a' })).run();
    expect(() =>
      // Same dedup_key, different id — must throw.
      db.insert(featureRegistry).values(row({ id: 'freg_b' })).run(),
    ).toThrow(/UNIQUE/);
  });

  it('allows two rows when dedup_key differs', () => {
    const db = createTestDb();
    db.insert(featureRegistry).values(row({ id: 'freg_a' })).run();
    db.insert(featureRegistry)
      .values(
        row({
          id: 'freg_b',
          name: 'profile page',
          routePath: '/profile',
          dedupKey: computeDedupKey({
            project: 'pokerzeno',
            name: 'profile page',
            routePath: '/profile',
          }),
        }),
      )
      .run();
    const rows = db.select().from(featureRegistry).all();
    expect(rows).toHaveLength(2);
  });

  it('indexes project, story_id, source for dashboard queries', () => {
    const db = createTestDb();
    // Use a raw query to introspect SQLite's index list.
    const indexes = db.all(sql`
      SELECT name FROM sqlite_master
      WHERE type='index' AND tbl_name='feature_registry'
    `) as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('freg_project_idx');
    expect(names).toContain('freg_story_idx');
    expect(names).toContain('freg_source_idx');
    expect(names).toContain('freg_shipped_idx');
  });
});

describe('migration 0028: feature_registry_search_log', () => {
  it('creates the search log table and inserts a record', () => {
    const db = createTestDb();
    db.insert(featureRegistrySearchLog)
      .values({
        id: 'frgl_a',
        query: 'add a leaderboard',
        project: 'pokerzeno',
        classification: 'enhance',
        topMatchId: 'freg_x',
        topScore: 0.91,
        thresholdUsed: 0.85,
        latencyMs: 187,
        embedderTokens: 42,
        hitCount: 3,
        caller: 'po-agent',
        createdAt: Date.now(),
      })
      .run();
    const rows = db.select().from(featureRegistrySearchLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('enhance');
    expect(rows[0]!.embedderTokens).toBe(42);
  });

  it('logs new-classification rows with no top match', () => {
    const db = createTestDb();
    db.insert(featureRegistrySearchLog)
      .values({
        id: 'frgl_b',
        query: 'something nobody has built',
        project: 'caia',
        classification: 'new',
        topMatchId: null,
        topScore: null,
        thresholdUsed: 0.85,
        latencyMs: 195,
        embedderTokens: 30,
        hitCount: 0,
        caller: 'po-agent',
        createdAt: Date.now(),
      })
      .run();
    const rows = db
      .select()
      .from(featureRegistrySearchLog)
      .where(eq(featureRegistrySearchLog.classification, 'new'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.topMatchId).toBeNull();
  });
});
