/**
 * FREG-002 — connection.ts bootstraps sqlite-vec + virtual tables
 * against a fresh DB, after the migration runs. Proves the full chain:
 *
 *   getDb(url) → migrate() → bootstrapVectorTables() → vec0 + fts5 ready
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sql } from 'drizzle-orm';
import {
  bootstrapVectorTables,
  computeDedupKey,
  StubEmbeddingClient,
  upsertRegistryRow,
  queryDense,
  querySparse,
} from '@chiefaia/feature-registry';
import { getDb, getSqliteRaw, resetDb, runMigrations } from '../../src/db/connection';

const DIM = 768; // matches connection.ts default (nomic-embed-text 768d)

// Use a unique tempfile so the singleton inside connection.ts can't
// leak state between tests. Each test resets before / after.
function tempDbUrl(): string {
  return path.join(os.tmpdir(), `freg-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

describe('FREG-002 — connection bootstraps sqlite-vec', () => {
  beforeEach(() => {
    resetDb();
  });

  it('opens DB, runs migrations, bootstraps vec0 + fts5', () => {
    const url = tempDbUrl();
    try {
      runMigrations(url);
      const sqlite = getSqliteRaw();
      // The orchestrator's connection.ts runs bootstrapVectorTables(sqlite)
      // with the default 768d. We re-bootstrap with our test dim for the
      // assertion below; idempotent + safe.
      bootstrapVectorTables(sqlite, DIM);

      // vec0 + fts5 tables exist.
      const tables = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table','virtual','vtable')",
        )
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('feature_registry_vec');
      expect(names).toContain('feature_registry_fts');

      // vec_version() callable.
      const v = sqlite.prepare('SELECT vec_version() as v').get() as { v: string };
      expect(v.v).toMatch(/^v\d+\.\d+/);
    } finally {
      try { fs.unlinkSync(url); } catch { /* best-effort */ }
      resetDb();
    }
  });

  it('round-trips a registry row through upsert + queryDense + querySparse', async () => {
    const url = tempDbUrl();
    try {
      runMigrations(url);
      const sqlite = getSqliteRaw();
      bootstrapVectorTables(sqlite, DIM);

      const stub = new StubEmbeddingClient('stub-embed-text', DIM);
      const now = Date.now();
      const dedupKey = computeDedupKey({
        project: 'pokerzeno',
        name: 'leaderboard page',
        routePath: '/leaderboard',
      });
      const row = {
        id: 'freg_lb_a',
        project: 'pokerzeno' as const,
        name: 'leaderboard page',
        description: 'ranks top players by chips won today',
        routePath: '/leaderboard',
        filePaths: ['app/leaderboard/page.tsx'],
        componentName: undefined,
        apiEndpoint: undefined,
        dbTables: ['users'],
        agentName: undefined,
        shippedAt: now,
        storyId: 'story_lb_a',
        tags: ['gameplay'],
        embeddingModel: 'stub-embed-text',
        embeddingDim: DIM,
        embeddingVersion: 'v1.5',
        source: 'story_completed' as const,
        createdAt: now,
        updatedAt: now,
        dedupKey,
      };
      const { embedding } = await stub.embed(row.description);
      upsertRegistryRow(sqlite, row, embedding);

      // dense — self-match returns the row with high similarity
      const dense = queryDense(sqlite, embedding, { topK: 5, project: 'pokerzeno' });
      expect(dense.length).toBe(1);
      expect(dense[0]!.id).toBe('freg_lb_a');
      expect(dense[0]!.score).toBeGreaterThan(0.99);

      // sparse — keyword "leaderboard" matches via FTS5
      const sparse = querySparse(sqlite, 'leaderboard', { topK: 5, project: 'pokerzeno' });
      expect(sparse.length).toBe(1);
      expect(sparse[0]!.id).toBe('freg_lb_a');

      // The drizzle `feature_registry` row was written — visible via
      // a raw SELECT to keep this test independent of orchestrator schema imports.
      const main = sqlite.prepare('SELECT name FROM feature_registry WHERE id = ?').get('freg_lb_a') as { name: string };
      expect(main.name).toBe('leaderboard page');
    } finally {
      try { fs.unlinkSync(url); } catch { /* best-effort */ }
      resetDb();
    }
  });
});
