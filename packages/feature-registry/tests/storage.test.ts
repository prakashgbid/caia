import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  bootstrapVectorTables,
  buildFtsText,
  computeDedupKey,
  queryDense,
  querySparse,
  StubEmbeddingClient,
  upsertRegistryRow,
  type FeatureRegistryRow,
} from '../src';

const NOW = 1745812800000;
const DIM = 32; // matches StubEmbeddingClient default

function makeDb() {
  const sqlite = new Database(':memory:');
  // Mirror migration 0028 (we don't pull drizzle into this test).
  sqlite.exec(`
    CREATE TABLE feature_registry (
      id TEXT PRIMARY KEY NOT NULL,
      project TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      route_path TEXT,
      file_paths_json TEXT NOT NULL DEFAULT '[]',
      component_name TEXT,
      api_endpoint TEXT,
      db_tables_json TEXT NOT NULL DEFAULT '[]',
      agent_name TEXT,
      shipped_at INTEGER NOT NULL,
      story_id TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      embedding_model TEXT NOT NULL DEFAULT 'stub-embed-text',
      embedding_dim INTEGER NOT NULL DEFAULT ${DIM},
      embedding_version TEXT NOT NULL DEFAULT 'v1.5',
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      dedup_key TEXT NOT NULL UNIQUE
    );
    CREATE INDEX freg_project_idx ON feature_registry(project);
  `);
  bootstrapVectorTables(sqlite, DIM);
  return sqlite;
}

function buildRow(over: Partial<FeatureRegistryRow> = {}): FeatureRegistryRow {
  return {
    id: 'freg_a',
    project: 'pokerzeno',
    name: 'leaderboard page',
    description: 'ranks top players by chips won today',
    routePath: '/leaderboard',
    filePaths: ['app/leaderboard/page.tsx'],
    componentName: 'LeaderboardPage',
    apiEndpoint: undefined,
    dbTables: ['users'],
    agentName: undefined,
    shippedAt: NOW,
    storyId: 'story_a',
    tags: ['gameplay'],
    embeddingModel: 'stub-embed-text',
    embeddingDim: DIM,
    embeddingVersion: 'v1.5',
    source: 'story_completed',
    createdAt: NOW,
    updatedAt: NOW,
    dedupKey: computeDedupKey({
      project: 'pokerzeno',
      name: 'leaderboard page',
      routePath: '/leaderboard',
    }),
    ...over,
  };
}

describe('bootstrapVectorTables', () => {
  it('creates vec0 + fts5 virtual tables idempotently', () => {
    const db = makeDb();
    // Calling bootstrap twice should not throw.
    bootstrapVectorTables(db, DIM);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' OR type='virtual'",
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('feature_registry_vec');
    expect(names).toContain('feature_registry_fts');
  });
});

describe('buildFtsText', () => {
  it('joins name + description + locator + tags', () => {
    const text = buildFtsText({
      name: 'leaderboard page',
      description: 'ranks top players',
      routePath: '/leaderboard',
      componentName: 'LeaderboardPage',
      apiEndpoint: undefined,
      agentName: undefined,
      tags: ['gameplay', 'frontend'],
    });
    expect(text).toContain('leaderboard page');
    expect(text).toContain('ranks top players');
    expect(text).toContain('/leaderboard');
    expect(text).toContain('LeaderboardPage');
    expect(text).toContain('gameplay');
    expect(text).toContain('frontend');
  });

  it('skips empty fields', () => {
    const text = buildFtsText({
      name: 'tiny',
      description: 'thing',
      routePath: undefined,
      componentName: undefined,
      apiEndpoint: undefined,
      agentName: undefined,
      tags: [],
    });
    expect(text.trim()).toBe('tiny thing');
  });
});

describe('upsertRegistryRow + queryDense', () => {
  it('writes a row and finds it via cosine self-match', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const row = buildRow();
    const { embedding } = await stub.embed(row.description);

    upsertRegistryRow(db, row, embedding);

    // After insert: feature_registry, vec, fts all hold one row.
    const mainCount = db.prepare('SELECT COUNT(*) AS c FROM feature_registry').get() as { c: number };
    const vecCount = db.prepare('SELECT COUNT(*) AS c FROM feature_registry_vec').get() as { c: number };
    const ftsCount = db.prepare('SELECT COUNT(*) AS c FROM feature_registry_fts').get() as { c: number };
    expect(mainCount.c).toBe(1);
    expect(vecCount.c).toBe(1);
    expect(ftsCount.c).toBe(1);

    // Self-match → cosine sim should be 1 (identical vector).
    const hits = queryDense(db, embedding, { topK: 5 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.id).toBe('freg_a');
    expect(hits[0]!.score).toBeGreaterThan(0.99);
  });

  it('upsert is idempotent on dedup_key (same row twice does not duplicate)', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const row1 = buildRow({ description: 'first description' });
    const row2 = buildRow({
      id: 'freg_b', // different id but SAME dedup_key (same project/name/route)
      description: 'second description (rewritten)',
      tags: ['gameplay', 'enhanced'],
    });
    const { embedding: e1 } = await stub.embed(row1.description);
    const { embedding: e2 } = await stub.embed(row2.description);

    upsertRegistryRow(db, row1, e1);
    upsertRegistryRow(db, row2, e2);

    const rows = db.prepare('SELECT id, description, tags_json FROM feature_registry').all() as Array<{
      id: string;
      description: string;
      tags_json: string;
    }>;
    expect(rows).toHaveLength(1);
    // Stored id is the original (immutable PK); description + tags are updated.
    expect(rows[0]!.id).toBe('freg_a');
    expect(rows[0]!.description).toContain('rewritten');
    expect(JSON.parse(rows[0]!.tags_json)).toContain('enhanced');

    // Vec table also has only one row with the canonical id.
    const vecRows = db.prepare('SELECT id FROM feature_registry_vec').all() as Array<{ id: string }>;
    expect(vecRows).toHaveLength(1);
    expect(vecRows[0]!.id).toBe('freg_a');
  });

  it('different dedup_key → two rows; queryDense returns both ranked', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);

    const a = buildRow({ id: 'freg_a' });
    const b = buildRow({
      id: 'freg_b',
      name: 'profile page',
      routePath: '/profile',
      description: 'shows the user avatar and game stats',
      dedupKey: computeDedupKey({
        project: 'pokerzeno',
        name: 'profile page',
        routePath: '/profile',
      }),
    });

    upsertRegistryRow(db, a, (await stub.embed(a.description)).embedding);
    upsertRegistryRow(db, b, (await stub.embed(b.description)).embedding);

    const hits = queryDense(db, (await stub.embed(a.description)).embedding, { topK: 5 });
    expect(hits.length).toBe(2);
    // a should rank above b for an a-flavored query.
    expect(hits[0]!.id).toBe('freg_a');
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('queryDense filters by project when opts.project is set', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const a = buildRow({ id: 'freg_a', project: 'pokerzeno' });
    const b = buildRow({
      id: 'freg_b',
      project: 'roulettecommunity',
      dedupKey: computeDedupKey({
        project: 'roulettecommunity',
        name: 'leaderboard page',
        routePath: '/leaderboard',
      }),
    });
    upsertRegistryRow(db, a, (await stub.embed(a.description)).embedding);
    upsertRegistryRow(db, b, (await stub.embed(b.description)).embedding);

    const hits = queryDense(db, (await stub.embed(a.description)).embedding, {
      topK: 5,
      project: 'pokerzeno',
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.id).toBe('freg_a');
  });
});

describe('querySparse', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(async () => {
    db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const a = buildRow({ id: 'freg_a' });
    const b = buildRow({
      id: 'freg_b',
      name: 'profile page',
      routePath: '/profile',
      description: 'shows the user avatar and game stats',
      tags: ['profile', 'frontend'],
      dedupKey: computeDedupKey({
        project: 'pokerzeno',
        name: 'profile page',
        routePath: '/profile',
      }),
    });
    upsertRegistryRow(db, a, (await stub.embed(a.description)).embedding);
    upsertRegistryRow(db, b, (await stub.embed(b.description)).embedding);
  });

  it('matches by keyword overlap (BM25)', () => {
    const hits = querySparse(db, 'leaderboard', { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe('freg_a');
    expect(hits[0]!.score).toBeGreaterThan(0);
  });

  it('matches synonyms via prefix tokens (avatar → avatar*)', () => {
    const hits = querySparse(db, 'avatar', { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe('freg_b');
  });

  it('returns empty results for queries with no real tokens', () => {
    const hits = querySparse(db, '!!! ??? ###', { topK: 5 });
    expect(hits).toEqual([]);
  });

  it('respects opts.project at query time', () => {
    const hits = querySparse(db, 'leaderboard', { topK: 5, project: 'roulettecommunity' });
    expect(hits.length).toBe(0);
  });
});
