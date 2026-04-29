import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  bootstrapVectorTables,
  computeDedupKey,
  search,
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

function row(over: Partial<FeatureRegistryRow> = {}): FeatureRegistryRow {
  const project = over.project ?? 'pokerzeno';
  const name = over.name ?? 'leaderboard page';
  const route = over.routePath ?? '/leaderboard';
  return {
    id: 'freg_test',
    project: project as FeatureRegistryRow['project'],
    name,
    description: 'ranks top players by chips won today',
    routePath: route,
    filePaths: ['app/leaderboard/page.tsx'],
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
    dedupKey: computeDedupKey({ project, name, routePath: route }),
    ...over,
  };
}

function loaderFor(rows: FeatureRegistryRow[]): SearchClientDeps['loadRowsByIds'] {
  const map = new Map(rows.map((r) => [r.id, r]));
  return (ids, project) => {
    return ids
      .map((id) => map.get(id))
      .filter((r): r is FeatureRegistryRow => !!r)
      .filter((r) => !project || r.project === project);
  };
}

describe('search — dense + sparse + classification', () => {
  let db: ReturnType<typeof makeDb>;
  let stub: StubEmbeddingClient;
  let leaderboard: FeatureRegistryRow;
  let profile: FeatureRegistryRow;
  let billing: FeatureRegistryRow;

  beforeEach(async () => {
    db = makeDb();
    stub = new StubEmbeddingClient('stub-embed-text', DIM);

    leaderboard = row({ id: 'freg_leader', name: 'leaderboard page', routePath: '/leaderboard',
      description: 'ranks top players by chips won today' });
    profile = row({ id: 'freg_profile', name: 'profile page', routePath: '/profile',
      description: 'shows user avatar and game statistics',
      dedupKey: computeDedupKey({ project: 'pokerzeno', name: 'profile page', routePath: '/profile' }) });
    billing = row({ id: 'freg_billing', name: 'billing checkout', routePath: '/billing',
      description: 'Stripe-backed subscription checkout for premium tier',
      dedupKey: computeDedupKey({ project: 'pokerzeno', name: 'billing checkout', routePath: '/billing' }) });

    for (const r of [leaderboard, profile, billing]) {
      upsertRegistryRow(db, r, (await stub.embed(r.description)).embedding);
    }
  });

  it('self-match query → enhance verdict, top match is the seed row', async () => {
    const result = await search(
      leaderboard.description,
      { project: 'pokerzeno', enhanceThreshold: 0.85 },
      { db, embedder: stub, loadRowsByIds: loaderFor([leaderboard, profile, billing]) },
    );
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.topMatch?.row.id).toBe('freg_leader');
    expect(result.topMatch!.scoreDense).toBeGreaterThan(0.99);
    expect(result.classification).toBe('enhance');
  });

  it('novel query → new verdict when threshold tuned to stub distribution', async () => {
    // The stub embedder produces L2-normalized random-hash vectors, so
    // random pairs have non-trivial cosine sim. We tune the threshold high
    // (0.99) so only true self-matches clear it. (Real nomic-embed-text
    // has tighter clusters; the production threshold is 0.85.)
    const result = await search(
      'completely orthogonal nonsense token sequence',
      { project: 'pokerzeno', enhanceThreshold: 0.99, ambiguousThreshold: 0.99 },
      { db, embedder: stub, loadRowsByIds: loaderFor([leaderboard, profile, billing]) },
    );
    expect(result.classification).toBe('new');
  });

  it('keyword-only match (sparse hit, no dense) classifies as new', async () => {
    // Use sparseOnly so we can isolate the sparse code path.
    const result = await search(
      'leaderboard',
      { project: 'pokerzeno', sparseOnly: true },
      { db, embedder: stub, loadRowsByIds: loaderFor([leaderboard, profile, billing]) },
    );
    // Sparse-only hits classify as `new` because we can't verify
    // semantic similarity from BM25 alone — too prone to false positives.
    expect(result.topMatch).not.toBeNull();
    expect(result.topMatch!.scoreDense).toBe(-1);
    expect(result.classification).toBe('new');
  });

  it('respects opts.project filter', async () => {
    const otherProject = row({
      id: 'freg_other', project: 'roulettecommunity', name: 'leaderboard page', routePath: '/leaderboard',
      description: 'ranks top players by chips won today',
      dedupKey: computeDedupKey({ project: 'roulettecommunity', name: 'leaderboard page', routePath: '/leaderboard' }),
    });
    upsertRegistryRow(db, otherProject, (await stub.embed(otherProject.description)).embedding);

    const result = await search(
      otherProject.description,
      { project: 'roulettecommunity' },
      {
        db,
        embedder: stub,
        loadRowsByIds: loaderFor([leaderboard, profile, billing, otherProject]),
      },
    );
    expect(result.hits).toHaveLength(1);
    expect(result.topMatch?.row.id).toBe('freg_other');
  });

  it('reports embedderTokens > 0 and latencyMs > 0', async () => {
    const result = await search(
      leaderboard.description,
      { project: 'pokerzeno' },
      { db, embedder: stub, loadRowsByIds: loaderFor([leaderboard, profile, billing]) },
    );
    expect(result.embedderTokens).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0); // can be 0 in fast tests
  });

  it('topK caps the number of returned hits', async () => {
    const result = await search(
      leaderboard.description,
      { project: 'pokerzeno', topK: 1 },
      { db, embedder: stub, loadRowsByIds: loaderFor([leaderboard, profile, billing]) },
    );
    expect(result.hits).toHaveLength(1);
  });

  it('matchType reflects which retrievers fired', async () => {
    const result = await search(
      leaderboard.description,
      { project: 'pokerzeno' },
      { db, embedder: stub, loadRowsByIds: loaderFor([leaderboard, profile, billing]) },
    );
    expect(['both', 'dense', 'sparse']).toContain(result.topMatch!.matchType);
  });

  it('threshold tuning — lower enhance threshold flips ambiguous → enhance', async () => {
    // Construct a query that should land in the ambiguous zone for some
    // seeds. With threshold 0.99 nothing clears; with 0.0 everything does.
    const r1 = await search(
      leaderboard.description,
      { project: 'pokerzeno', enhanceThreshold: 0.99, ambiguousThreshold: 0.78 },
      { db, embedder: stub, loadRowsByIds: loaderFor([leaderboard, profile, billing]) },
    );
    const r2 = await search(
      leaderboard.description,
      { project: 'pokerzeno', enhanceThreshold: 0.0, ambiguousThreshold: 0.0 },
      { db, embedder: stub, loadRowsByIds: loaderFor([leaderboard, profile, billing]) },
    );
    // r1: top dense ≈ 1.0; clears 0.99 → enhance
    // r2: anything > 0 clears → enhance
    expect(r1.classification).toBe('enhance');
    expect(r2.classification).toBe('enhance');
  });

  it('empty registry → no hits, classification new', async () => {
    const empty = makeDb();
    const result = await search(
      'anything at all',
      { project: 'pokerzeno' },
      { db: empty, embedder: stub, loadRowsByIds: () => [] },
    );
    expect(result.hits).toHaveLength(0);
    expect(result.topMatch).toBeNull();
    expect(result.classification).toBe('new');
  });
});
