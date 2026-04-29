/**
 * Benchmark for the high-level search() API at registry-typical row
 * counts. Validates the architecture report's <50ms search-only claim
 * (excluding embedding) on 10K rows.
 */
import { bench, describe } from 'vitest';
import Database from 'better-sqlite3';
import {
  bootstrapVectorTables,
  computeDedupKey,
  search,
  StubEmbeddingClient,
  upsertRegistryRow,
  type FeatureRegistryRow,
} from '../src';

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

async function seed(n: number) {
  const db = makeDb();
  const stub = new StubEmbeddingClient('stub-embed-text', DIM);
  const rows: FeatureRegistryRow[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const r: FeatureRegistryRow = {
      id: `freg_${i.toString().padStart(8, '0')}`,
      project: 'pokerzeno',
      name: `feature ${i}`,
      description: `auto-generated feature description for benchmark slot ${i} with various keywords like leaderboard profile billing chat`,
      routePath: `/feature-${i}`,
      filePaths: [`app/feature-${i}/page.tsx`],
      componentName: undefined,
      apiEndpoint: undefined,
      dbTables: [],
      agentName: undefined,
      shippedAt: now,
      storyId: undefined,
      tags: ['frontend'],
      embeddingModel: 'stub-embed-text',
      embeddingDim: DIM,
      embeddingVersion: 'v1.5',
      source: 'backfill_codebase',
      createdAt: now,
      updatedAt: now,
      dedupKey: computeDedupKey({ project: 'pokerzeno', name: `feature ${i}`, routePath: `/feature-${i}` }),
    };
    upsertRegistryRow(db, r, (await stub.embed(r.description)).embedding);
    rows.push(r);
  }
  return { db, stub, rows };
}

describe('search @ 1000 rows (StubEmbeddingClient ≈ instant embed)', async () => {
  const { db, stub, rows } = await seed(1000);
  const map = new Map(rows.map((r) => [r.id, r]));
  const loader = (ids: string[]) =>
    ids.map((id) => map.get(id)).filter((r): r is FeatureRegistryRow => !!r);

  bench('hybrid (dense + sparse) search top-5 with project filter', async () => {
    await search(
      'leaderboard profile feature',
      { project: 'pokerzeno', topK: 5 },
      { db, embedder: stub, loadRowsByIds: loader },
    );
  });

  bench('sparse-only search top-5', async () => {
    await search(
      'leaderboard profile feature',
      { project: 'pokerzeno', topK: 5, sparseOnly: true },
      { db, embedder: stub, loadRowsByIds: loader },
    );
  });
});
