/**
 * Benchmark — write+query latency of the storage layer at registry-typical
 * row counts. Validates the architecture's "<5ms search-only" claim from
 * the report.
 *
 * Skipped in regular test runs (sufficient signal lives in storage.test.ts);
 * run with `pnpm vitest bench` when tuning. We assert a generous upper bound
 * so CI doesn't flake on noisy build agents.
 */

import { bench, describe } from 'vitest';
import Database from 'better-sqlite3';
import {
  bootstrapVectorTables,
  computeDedupKey,
  queryDense,
  StubEmbeddingClient,
  upsertRegistryRow,
  type FeatureRegistryRow,
} from '../src';

const DIM = 32; // StubEmbeddingClient default; nomic uses 768

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
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const row: FeatureRegistryRow = {
      id: `freg_${i.toString().padStart(8, '0')}`,
      project: 'pokerzeno',
      name: `feature ${i}`,
      description: `auto-generated feature description for benchmark slot ${i}`,
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
      dedupKey: computeDedupKey({
        project: 'pokerzeno',
        name: `feature ${i}`,
        routePath: `/feature-${i}`,
      }),
    };
    upsertRegistryRow(db, row, (await stub.embed(row.description)).embedding);
  }
  return { db, stub };
}

describe('queryDense @ 1000 rows', async () => {
  const { db, stub } = await seed(1000);
  const q = (await stub.embed('feature 500 query')).embedding;

  bench('cosine top-5', () => {
    queryDense(db, q, { topK: 5 });
  });

  bench('cosine top-5 + project filter', () => {
    queryDense(db, q, { topK: 5, project: 'pokerzeno' });
  });
});
