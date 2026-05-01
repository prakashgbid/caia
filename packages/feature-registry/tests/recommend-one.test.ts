import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  bootstrapVectorTables,
  computeDedupKey,
  recommendOne,
  StubEmbeddingClient,
  upsertRegistryRow,
  type FeatureRegistryRow,
  type SearchClientDeps,
} from '../src';

const NOW = 1745812800000;
const DIM = 32;

function makeDb() {
  const sqlite = new Database(':memory:');
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
  `);
  bootstrapVectorTables(sqlite, DIM);
  return sqlite;
}

function makeRow(over: Partial<FeatureRegistryRow> = {}): FeatureRegistryRow {
  const project = (over.project ?? 'pokerzeno') as FeatureRegistryRow['project'];
  const name = over.name ?? 'leaderboard page';
  const routePath = over.routePath ?? '/leaderboard';
  return {
    id: over.id ?? 'freg_test',
    project,
    name,
    description: over.description ?? 'ranks top players by chips won today',
    routePath,
    filePaths: over.filePaths ?? ['app/leaderboard/page.tsx'],
    componentName: undefined,
    apiEndpoint: undefined,
    dbTables: [],
    agentName: undefined,
    shippedAt: NOW,
    storyId: undefined,
    tags: ['frontend'],
    embeddingModel: 'stub-embed-text',
    embeddingDim: DIM,
    embeddingVersion: 'v1.5',
    source: 'story_completed',
    createdAt: NOW,
    updatedAt: NOW,
    dedupKey: computeDedupKey({ project, name, routePath }),
    ...over,
  };
}

function loaderFor(rows: FeatureRegistryRow[]): SearchClientDeps['loadRowsByIds'] {
  const map = new Map(rows.map((r) => [r.id, r]));
  return (ids, project) =>
    ids
      .map((id) => map.get(id))
      .filter((r): r is FeatureRegistryRow => !!r)
      .filter((r) => !project || r.project === project);
}

describe('recommendOne', () => {
  let db: ReturnType<typeof makeDb>;
  let stub: StubEmbeddingClient;
  let leaderboard: FeatureRegistryRow;
  let deps: SearchClientDeps;

  beforeEach(async () => {
    db = makeDb();
    stub = new StubEmbeddingClient('stub-embed-text', DIM);
    leaderboard = makeRow({ id: 'freg_leader' });
    upsertRegistryRow(db, leaderboard, (await stub.embed(leaderboard.description)).embedding);
    deps = { db, embedder: stub, loadRowsByIds: loaderFor([leaderboard]) };
  });

  it('self-match → action reuse when reuseThreshold is low', async () => {
    const rec = await recommendOne(
      leaderboard.description,
      { project: 'pokerzeno', reuseThreshold: 0.5, enhanceThreshold: 0.2 },
      deps,
    );
    expect(rec.action).toBe('reuse');
    expect(rec.confidence).toBeGreaterThan(0.5);
    expect(rec.topMatch?.row.id).toBe('freg_leader');
    expect(rec.reasoning).toContain('reuse');
  });

  it('score between thresholds → action enhance', async () => {
    const rec = await recommendOne(
      leaderboard.description,
      // Self-embed scores exactly 1.0 (capped by Math.min(1, …) in queryDense).
      // Set reuseThreshold above 1.0 so the hit always falls in the enhance band.
      { project: 'pokerzeno', reuseThreshold: 1.0001, enhanceThreshold: 0.0 },
      deps,
    );
    expect(rec.action).toBe('enhance');
    expect(rec.reasoning).toContain('enhance');
    expect(rec.topMatch).not.toBeNull();
  });

  it('empty registry → action new, topMatch null', async () => {
    const emptyDb = makeDb();
    const rec = await recommendOne(
      'completely unrelated query',
      {},
      { db: emptyDb, embedder: stub, loadRowsByIds: () => [] },
    );
    expect(rec.action).toBe('new');
    expect(rec.topMatch).toBeNull();
    expect(rec.confidence).toBe(0);
  });

  it('score below enhance threshold → action new', async () => {
    // reuseThreshold > enhanceThreshold > scoreDense → new
    const rec = await recommendOne(
      leaderboard.description,
      { reuseThreshold: 2.0, enhanceThreshold: 1.5 },
      deps,
    );
    expect(rec.action).toBe('new');
    expect(rec.reasoning).toContain('create');
  });

  it('returns latencyMs ≥ 0 and confidence in [0, 1]', async () => {
    const rec = await recommendOne(leaderboard.description, {}, deps);
    expect(rec.latencyMs).toBeGreaterThanOrEqual(0);
    expect(rec.confidence).toBeGreaterThanOrEqual(0);
    expect(rec.confidence).toBeLessThanOrEqual(1);
  });

  it('sparse-only hit (scoreDense = -1) → action new, topMatch is non-null, confidence 0', async () => {
    // sparseOnly skips dense retrieval — topMatch exists (BM25 keyword hit)
    // but scoreDense = -1. Should return 'new' and confidence 0.
    const rec = await recommendOne(
      'leaderboard',
      { project: 'pokerzeno', sparseOnly: true },
      deps,
    );
    expect(rec.action).toBe('new');
    expect(rec.confidence).toBe(0);
    expect(rec.topMatch).not.toBeNull();
    expect(rec.reasoning).toContain('no dense signal');
  });

  it('respects project filter — cross-project query returns correct project hit', async () => {
    const other = makeRow({
      id: 'freg_other',
      project: 'roulettecommunity',
      name: 'leaderboard page',
      routePath: '/leaderboard',
      dedupKey: computeDedupKey({
        project: 'roulettecommunity',
        name: 'leaderboard page',
        routePath: '/leaderboard',
      }),
    });
    upsertRegistryRow(db, other, (await stub.embed(other.description)).embedding);

    const rec = await recommendOne(
      leaderboard.description,
      { project: 'roulettecommunity', reuseThreshold: 0.5, enhanceThreshold: 0.2 },
      {
        db,
        embedder: stub,
        loadRowsByIds: loaderFor([leaderboard, other]),
      },
    );
    expect(rec.topMatch?.row.id).toBe('freg_other');
  });
});
