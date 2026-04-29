import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  archSearch,
  bootstrapVectorTables,
  computeArtifactDedupKey,
  findBackendArtifacts,
  findDBArtifacts,
  findUIArtifacts,
  findAcrossDomains,
  StubEmbeddingClient,
  upsertArtifactRow,
  type ArchArtifactRow,
  type EmbeddingClient,
} from '../src';

const NOW = 1745812800000;
const DIM = 32;

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE arch_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      project TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      key_signature TEXT,
      file_paths_json TEXT NOT NULL DEFAULT '[]',
      entry_path TEXT,
      route_signature TEXT,
      table_name TEXT,
      owning_service TEXT,
      package_name TEXT,
      design_system_tier TEXT,
      tech_sub_domains_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL,
      content_hash TEXT,
      extracted_at_commit TEXT,
      embedding_model TEXT NOT NULL DEFAULT 'stub-embed-text',
      embedding_dim INTEGER NOT NULL DEFAULT ${DIM},
      embedding_version TEXT NOT NULL DEFAULT 'v1.5',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      dedup_key TEXT NOT NULL UNIQUE
    );
    CREATE INDEX arch_artifacts_kind_idx ON arch_artifacts (kind);

    CREATE TABLE arch_edges (
      id TEXT PRIMARY KEY NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (from_id, to_id, relation)
    );
  `);
  bootstrapVectorTables(sqlite, DIM);
  return sqlite;
}

function buildArtifact(over: Partial<ArchArtifactRow>): ArchArtifactRow {
  const base: ArchArtifactRow = {
    id: 'arch_default',
    kind: 'component',
    project: 'caia',
    name: 'Default',
    description: 'default',
    filePaths: [],
    techSubDomains: [],
    tags: [],
    metadataJson: '{}',
    source: 'ast_extract',
    embeddingModel: 'stub-embed-text',
    embeddingDim: DIM,
    embeddingVersion: 'v1.5',
    createdAt: NOW,
    updatedAt: NOW,
    dedupKey: 'a'.repeat(64),
    ...over,
  } as ArchArtifactRow;
  return base;
}

async function seed(
  db: Database.Database,
  embedder: EmbeddingClient,
  rows: ArchArtifactRow[],
): Promise<void> {
  for (const row of rows) {
    const { embedding } = await embedder.embed(row.description);
    upsertArtifactRow(db, row, embedding);
  }
}

describe('archSearch — basic hybrid retrieval', () => {
  let db: Database.Database;
  let embedder: EmbeddingClient;

  beforeEach(async () => {
    db = makeDb();
    embedder = new StubEmbeddingClient('stub-embed-text', DIM);
    await seed(db, embedder, [
      buildArtifact({
        id: 'arch_ui_leaderboard',
        kind: 'component',
        name: 'LeaderboardPage',
        description: 'React page that renders the top 100 players ranked by chips',
        techSubDomains: ['frontend', 'design-system'],
        dedupKey: computeArtifactDedupKey({
          project: 'caia',
          kind: 'component',
          name: 'LeaderboardPage',
          entryPath: 'apps/dashboard/components/leaderboard.tsx',
        }),
      }),
      buildArtifact({
        id: 'arch_api_leaderboard',
        kind: 'api',
        name: 'GET /leaderboard',
        description: 'Hono endpoint that returns top players sorted by chips',
        routeSignature: 'GET /leaderboard',
        techSubDomains: ['bff'],
        dedupKey: computeArtifactDedupKey({
          project: 'caia',
          kind: 'api',
          name: 'GET /leaderboard',
          routeSignature: 'GET /leaderboard',
        }),
      }),
      buildArtifact({
        id: 'arch_schema_users',
        kind: 'schema',
        name: 'users',
        description: 'User account rows including chips_total + last_login',
        tableName: 'users',
        techSubDomains: ['database'],
        dedupKey: computeArtifactDedupKey({
          project: 'caia',
          kind: 'schema',
          name: 'users',
          tableName: 'users',
        }),
      }),
      buildArtifact({
        id: 'arch_pkg_zod',
        kind: 'package',
        name: 'zod',
        description: 'TypeScript-first schema validation library',
        packageName: 'zod',
        techSubDomains: ['agent-runtime'],
        dedupKey: computeArtifactDedupKey({
          project: 'caia',
          kind: 'package',
          name: 'zod',
          packageName: 'zod',
        }),
      }),
    ]);
  });

  it('returns ranked hits for a self-match query', async () => {
    const r = await archSearch(
      'top players ranked by chips',
      { topK: 4, minScore: 0 },
      { db, embedder },
    );
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.topMatch).toBeTruthy();
    expect(r.embedderTokens).toBeGreaterThan(0);
  });

  it('respects topK', async () => {
    const r = await archSearch('chips', { topK: 1, minScore: 0 }, { db, embedder });
    expect(r.hits.length).toBeLessThanOrEqual(1);
  });

  it('falls back to sparse-only when embedder throws', async () => {
    const broken: EmbeddingClient = {
      modelName: () => 'broken',
      modelDim: () => DIM,
      embed: async () => {
        throw new Error('upstream down');
      },
      embedBatch: async () => {
        throw new Error('upstream down');
      },
    };
    const r = await archSearch('chips', { topK: 5, minScore: 0 }, { db, embedder: broken });
    // Sparse path still finds something.
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.embedderTokens).toBe(0);
    for (const h of r.hits) {
      expect(h.scoreDense).toBe(-1);
      expect(h.matchType).toBe('sparse');
    }
  });

  it('reports thresholdUsed and latencyMs', async () => {
    const r = await archSearch('zod', { topK: 5, minScore: 0.3 }, { db, embedder });
    expect(r.thresholdUsed).toBe(0.3);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('per-domain helpers — kind filtering', () => {
  let db: Database.Database;
  let embedder: EmbeddingClient;

  beforeEach(async () => {
    db = makeDb();
    embedder = new StubEmbeddingClient('stub-embed-text', DIM);
    await seed(db, embedder, [
      buildArtifact({
        id: 'arch_ui',
        kind: 'component',
        name: 'LeaderboardPage',
        description: 'leaderboard page UI',
        techSubDomains: ['frontend'],
        dedupKey: 'a'.repeat(64),
      }),
      buildArtifact({
        id: 'arch_api',
        kind: 'api',
        name: 'GET /leaderboard',
        description: 'leaderboard backend endpoint',
        routeSignature: 'GET /leaderboard',
        techSubDomains: ['bff'],
        dedupKey: 'b'.repeat(64),
      }),
      buildArtifact({
        id: 'arch_schema',
        kind: 'schema',
        name: 'users',
        description: 'leaderboard user records',
        tableName: 'users',
        techSubDomains: ['database'],
        dedupKey: 'c'.repeat(64),
      }),
      buildArtifact({
        id: 'arch_mig',
        kind: 'migration',
        name: '0030_arch.sql',
        description: 'leaderboard migration that adds chips column',
        techSubDomains: ['database', 'data-migration'],
        dedupKey: 'd'.repeat(64),
      }),
      buildArtifact({
        id: 'arch_svc',
        kind: 'service',
        name: '@caia-app/orchestrator',
        description: 'orchestrator service that owns leaderboard route',
        techSubDomains: ['bff', 'agent-runtime'],
        dedupKey: 'e'.repeat(64),
      }),
    ]);
  });

  it('findUIArtifacts returns only UI kinds', async () => {
    const r = await findUIArtifacts('leaderboard', { topK: 5, minScore: 0 }, { db, embedder });
    expect(r.hits.length).toBeGreaterThan(0);
    for (const h of r.hits) {
      expect(['component', 'theme', 'plugin']).toContain(h.row.kind);
    }
  });

  it('findBackendArtifacts returns api/service', async () => {
    const r = await findBackendArtifacts('leaderboard', { topK: 5, minScore: 0 }, { db, embedder });
    expect(r.hits.length).toBeGreaterThan(0);
    for (const h of r.hits) {
      expect(['api', 'service']).toContain(h.row.kind);
    }
  });

  it('findDBArtifacts returns schema/migration', async () => {
    const r = await findDBArtifacts('leaderboard', { topK: 5, minScore: 0 }, { db, embedder });
    expect(r.hits.length).toBeGreaterThan(0);
    for (const h of r.hits) {
      expect(['schema', 'migration']).toContain(h.row.kind);
    }
  });

  it('findAcrossDomains returns mixed kinds', async () => {
    const r = await findAcrossDomains('leaderboard', { topK: 10, minScore: 0 }, { db, embedder });
    const kinds = new Set(r.hits.map((h) => h.row.kind));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('caller can override kinds even via per-domain helper', async () => {
    const r = await findUIArtifacts(
      'leaderboard',
      { topK: 5, minScore: 0, kinds: ['api'] },
      { db, embedder },
    );
    for (const h of r.hits) {
      expect(h.row.kind).toBe('api');
    }
  });
});

describe('archSearch — RRF fusion + minScore', () => {
  let db: Database.Database;
  let embedder: EmbeddingClient;

  beforeEach(async () => {
    db = makeDb();
    embedder = new StubEmbeddingClient('stub-embed-text', DIM);
    await seed(db, embedder, [
      buildArtifact({
        id: 'arch_match_both',
        kind: 'component',
        name: 'LeaderboardPage',
        description: 'leaderboard page UI',
        techSubDomains: ['frontend'],
        dedupKey: 'a'.repeat(64),
      }),
      buildArtifact({
        id: 'arch_unrelated',
        kind: 'component',
        name: 'Avatar',
        description: 'user avatar primitive',
        techSubDomains: ['frontend'],
        dedupKey: 'b'.repeat(64),
      }),
    ]);
  });

  it('match_type is "both" when dense + sparse both fire', async () => {
    const r = await archSearch(
      'leaderboard page UI',
      { topK: 5, minScore: 0 },
      { db, embedder },
    );
    const top = r.hits.find((h) => h.row.id === 'arch_match_both');
    expect(top).toBeDefined();
    expect(top!.matchType).toBe('both');
    expect(top!.scoreDense).toBeGreaterThan(0);
    expect(top!.scoreSparse).toBeGreaterThan(0);
  });

  it('minScore filters out weak dense hits before fusion', async () => {
    const r = await archSearch(
      'leaderboard',
      { topK: 5, minScore: 0.99 },
      { db, embedder },
    );
    // With minScore=0.99 the dense hits get dropped; only sparse hits make it.
    for (const h of r.hits) {
      expect(['sparse', 'both']).toContain(h.matchType);
    }
  });
});
