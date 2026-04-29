import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  bootstrapVectorTables,
  buildArtifactFtsText,
  computeArtifactDedupKey,
  computeEdgeDedupKey,
  queryDense,
  querySparse,
  StubEmbeddingClient,
  upsertArtifactRow,
  upsertEdgeRow,
  readArtifactById,
  readArtifactsByIds,
  readEdgesFrom,
  readEdgesTo,
  recordExtractRun,
  type ArchArtifactRow,
  type ArchEdgeRow,
} from '../src';

const NOW = 1745812800000;
const DIM = 32;

function makeDb() {
  const sqlite = new Database(':memory:');
  // Mirror migration 0030 (we don't pull drizzle into this test).
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
    CREATE INDEX arch_artifacts_project_idx ON arch_artifacts (project);

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

    CREATE TABLE arch_extract_runs (
      id TEXT PRIMARY KEY NOT NULL,
      extractor TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      duration_ms INTEGER,
      commit_sha TEXT,
      artifacts_inserted INTEGER NOT NULL DEFAULT 0,
      artifacts_updated INTEGER NOT NULL DEFAULT 0,
      artifacts_unchanged INTEGER NOT NULL DEFAULT 0,
      edges_inserted INTEGER NOT NULL DEFAULT 0,
      edges_updated INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
  bootstrapVectorTables(sqlite, DIM);
  return sqlite;
}

function buildArtifact(over: Partial<ArchArtifactRow> = {}): ArchArtifactRow {
  const base = {
    id: 'arch_a',
    kind: 'component' as const,
    project: 'caia' as const,
    name: 'PromptList',
    description: 'Renders a paginated list of prompts in the dashboard.',
    keySignature: 'export function PromptList(props: { promptIds: string[] })',
    filePaths: ['apps/dashboard/components/prompt-list.tsx'],
    entryPath: 'apps/dashboard/components/prompt-list.tsx',
    techSubDomains: ['frontend' as const, 'design-system' as const],
    tags: ['dashboard'],
    metadataJson: '{}',
    source: 'ast_extract' as const,
    embeddingModel: 'stub-embed-text',
    embeddingDim: DIM,
    embeddingVersion: 'v1.5',
    createdAt: NOW,
    updatedAt: NOW,
    dedupKey: computeArtifactDedupKey({
      project: 'caia',
      kind: 'component',
      name: 'PromptList',
      entryPath: 'apps/dashboard/components/prompt-list.tsx',
    }),
    ...over,
  } as ArchArtifactRow;
  return base;
}

describe('bootstrapVectorTables', () => {
  it('creates vec0 + fts5 virtual tables idempotently', () => {
    const db = makeDb();
    bootstrapVectorTables(db, DIM); // second call should not throw

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='virtual'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('arch_artifacts_vec');
    expect(names).toContain('arch_artifacts_fts');
  });
});

describe('buildArtifactFtsText', () => {
  it('joins name + description + locator hints + tags', () => {
    const text = buildArtifactFtsText(
      buildArtifact({
        routeSignature: 'GET /leaderboard',
        owningService: '@caia-app/orchestrator',
      }),
    );
    expect(text).toContain('PromptList');
    expect(text).toContain('paginated list');
    expect(text).toContain('GET /leaderboard');
    expect(text).toContain('frontend');
    expect(text).toContain('design-system');
    expect(text).toContain('dashboard');
  });
});

describe('upsertArtifactRow + queryDense', () => {
  it('writes a row and finds it via cosine self-match', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const row = buildArtifact();
    const { embedding } = await stub.embed(row.description);

    upsertArtifactRow(db, row, embedding);

    const mainCount = db.prepare('SELECT COUNT(*) AS c FROM arch_artifacts').get() as { c: number };
    const vecCount = db.prepare('SELECT COUNT(*) AS c FROM arch_artifacts_vec').get() as { c: number };
    const ftsCount = db.prepare('SELECT COUNT(*) AS c FROM arch_artifacts_fts').get() as { c: number };
    expect(mainCount.c).toBe(1);
    expect(vecCount.c).toBe(1);
    expect(ftsCount.c).toBe(1);

    const hits = queryDense(db, embedding, { topK: 5 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.id).toBe('arch_a');
    expect(hits[0]!.score).toBeGreaterThan(0.99);
  });

  it('upsert is idempotent on dedup_key', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const row1 = buildArtifact({ description: 'first' });
    const row2 = buildArtifact({
      id: 'arch_b', // different id but SAME dedup_key
      description: 'second (rewritten)',
      tags: ['dashboard', 'enhanced'],
    });
    const { embedding: e1 } = await stub.embed(row1.description);
    const { embedding: e2 } = await stub.embed(row2.description);

    upsertArtifactRow(db, row1, e1);
    upsertArtifactRow(db, row2, e2);

    const rows = db.prepare('SELECT id, description, tags_json FROM arch_artifacts').all() as Array<{
      id: string;
      description: string;
      tags_json: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('arch_a');
    expect(rows[0]!.description).toContain('rewritten');
    expect(JSON.parse(rows[0]!.tags_json)).toContain('enhanced');
  });

  it('queryDense filters by kind', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const ui = buildArtifact({ id: 'arch_ui', kind: 'component', dedupKey: 'a'.repeat(64) });
    const api = buildArtifact({
      id: 'arch_api',
      kind: 'api',
      name: 'GET /leaderboard',
      routeSignature: 'GET /leaderboard',
      dedupKey: 'b'.repeat(64),
    });
    upsertArtifactRow(db, ui, (await stub.embed(ui.description)).embedding);
    upsertArtifactRow(db, api, (await stub.embed(api.description)).embedding);

    const onlyUi = queryDense(db, (await stub.embed(ui.description)).embedding, {
      topK: 5,
      kinds: ['component'],
    });
    expect(onlyUi.length).toBe(1);
    expect(onlyUi[0]!.id).toBe('arch_ui');
  });

  it('queryDense filters by tech_sub_domain (JSON LIKE on tech_sub_domains_json)', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const a = buildArtifact({
      id: 'arch_a',
      techSubDomains: ['frontend', 'design-system'],
      dedupKey: 'a'.repeat(64),
    });
    const b = buildArtifact({
      id: 'arch_b',
      kind: 'api',
      name: 'GET /x',
      techSubDomains: ['bff', 'observability'],
      dedupKey: 'b'.repeat(64),
    });
    upsertArtifactRow(db, a, (await stub.embed(a.description)).embedding);
    upsertArtifactRow(db, b, (await stub.embed(b.description)).embedding);

    const onlyFrontend = queryDense(db, (await stub.embed(a.description)).embedding, {
      topK: 5,
      techSubDomains: ['frontend'],
    });
    expect(onlyFrontend.map((h) => h.id)).toEqual(['arch_a']);

    const observabilityHits = queryDense(db, (await stub.embed(b.description)).embedding, {
      topK: 5,
      techSubDomains: ['observability'],
    });
    expect(observabilityHits.map((h) => h.id)).toEqual(['arch_b']);
  });
});

describe('querySparse', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const a = buildArtifact({ id: 'arch_a', dedupKey: 'a'.repeat(64) });
    const b = buildArtifact({
      id: 'arch_b',
      kind: 'api',
      name: 'GET /leaderboard',
      description: 'returns ranked players sorted by chips',
      routeSignature: 'GET /leaderboard',
      techSubDomains: ['bff'],
      tags: ['leaderboard'],
      dedupKey: 'b'.repeat(64),
    });
    upsertArtifactRow(db, a, (await stub.embed(a.description)).embedding);
    upsertArtifactRow(db, b, (await stub.embed(b.description)).embedding);
  });

  it('matches by keyword overlap', () => {
    const hits = querySparse(db, 'leaderboard', { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe('arch_b');
  });

  it('matches synonyms via prefix tokens (chips → chips*)', () => {
    const hits = querySparse(db, 'chips', { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe('arch_b');
  });

  it('returns empty for queries with no real tokens', () => {
    expect(querySparse(db, '!!! ??? ###', { topK: 5 })).toEqual([]);
  });

  it('respects opts.kinds', () => {
    const hits = querySparse(db, 'leaderboard', { topK: 5, kinds: ['component'] });
    expect(hits.length).toBe(0);
  });
});

describe('upsertEdgeRow', () => {
  it('writes an edge row + is idempotent on (from, to, relation)', () => {
    const db = makeDb();
    const e1: ArchEdgeRow = {
      id: 'edge_1',
      fromId: 'arch_x',
      toId: 'arch_y',
      relation: 'depends_on',
      weight: 1.0,
      metadataJson: JSON.stringify({ original: true }),
      source: 'ast_extract',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const e2: ArchEdgeRow = {
      ...e1,
      id: 'edge_2',
      weight: 0.5,
      metadataJson: JSON.stringify({ rewritten: true }),
      updatedAt: NOW + 100,
    };
    upsertEdgeRow(db, e1);
    upsertEdgeRow(db, e2);

    const rows = db.prepare('SELECT * FROM arch_edges').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.weight).toBe(0.5);
    expect(JSON.parse(rows[0]!.metadata_json as string).rewritten).toBe(true);
  });

  it('resolves placeholder package targets (pkg::<name>) to canonical artifact IDs', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    // Create the canonical package artifact first.
    const pkgRow = buildArtifact({
      id: 'arch_pkg_react',
      kind: 'package',
      name: 'react',
      packageName: 'react',
      description: 'React core library',
      techSubDomains: ['frontend'],
      tags: ['external'],
      dedupKey: computeArtifactDedupKey({
        project: 'caia',
        kind: 'package',
        name: 'react',
        packageName: 'react',
      }),
    });
    upsertArtifactRow(db, pkgRow, (await stub.embed(pkgRow.description)).embedding);

    // Now insert an edge with a placeholder target.
    const placeholderEdge: ArchEdgeRow = {
      id: 'edge_p',
      fromId: 'arch_a',
      toId: 'pkg::react',
      relation: 'depends_on',
      weight: 1.0,
      metadataJson: JSON.stringify({ targetPackageName: 'react' }),
      source: 'ast_extract',
      createdAt: NOW,
      updatedAt: NOW,
    };
    upsertEdgeRow(db, placeholderEdge);
    const stored = db.prepare('SELECT * FROM arch_edges').all() as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.to_id).toBe('arch_pkg_react');
  });

  it('skips placeholder edges whose target package is not yet known', () => {
    const db = makeDb();
    const e: ArchEdgeRow = {
      id: 'edge_x',
      fromId: 'arch_a',
      toId: 'pkg::nonexistent',
      relation: 'depends_on',
      weight: 1.0,
      metadataJson: '{}',
      source: 'ast_extract',
      createdAt: NOW,
      updatedAt: NOW,
    };
    upsertEdgeRow(db, e);
    expect(db.prepare('SELECT COUNT(*) AS c FROM arch_edges').get()).toMatchObject({ c: 0 });
  });
});

describe('reads', () => {
  it('readArtifactById returns the row exactly', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const row = buildArtifact();
    upsertArtifactRow(db, row, (await stub.embed(row.description)).embedding);
    const back = readArtifactById(db, 'arch_a');
    expect(back).toBeDefined();
    expect(back?.name).toBe(row.name);
    expect(back?.techSubDomains).toEqual(['frontend', 'design-system']);
  });

  it('readArtifactsByIds returns multiple rows', async () => {
    const db = makeDb();
    const stub = new StubEmbeddingClient('stub-embed-text', DIM);
    const a = buildArtifact({ id: 'arch_a', dedupKey: 'a'.repeat(64) });
    const b = buildArtifact({ id: 'arch_b', dedupKey: 'b'.repeat(64) });
    upsertArtifactRow(db, a, (await stub.embed(a.description)).embedding);
    upsertArtifactRow(db, b, (await stub.embed(b.description)).embedding);
    const rows = readArtifactsByIds(db, ['arch_a', 'arch_b', 'arch_missing']);
    expect(rows.length).toBe(2);
  });

  it('readEdgesFrom + readEdgesTo filter by relation', () => {
    const db = makeDb();
    const dep: ArchEdgeRow = {
      id: 'edge_dep',
      fromId: 'arch_x',
      toId: 'arch_y',
      relation: 'depends_on',
      weight: 1,
      metadataJson: '{}',
      source: 'ast_extract',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const exp: ArchEdgeRow = {
      ...dep,
      id: 'edge_exp',
      relation: 'exposes',
    };
    upsertEdgeRow(db, dep);
    upsertEdgeRow(db, exp);
    expect(readEdgesFrom(db, 'arch_x', 'depends_on')).toHaveLength(1);
    expect(readEdgesFrom(db, 'arch_x', 'exposes')).toHaveLength(1);
    expect(readEdgesFrom(db, 'arch_x')).toHaveLength(2);
    expect(readEdgesTo(db, 'arch_y', 'depends_on')).toHaveLength(1);
  });
});

describe('recordExtractRun', () => {
  it('persists a run row with counts', () => {
    const db = makeDb();
    recordExtractRun(db, {
      id: 'er_1',
      extractor: 'ts-morph',
      startedAt: NOW,
      finishedAt: NOW + 1000,
      durationMs: 1000,
      commitSha: 'abc1234',
      artifactsInserted: 5,
      artifactsUpdated: 2,
      artifactsUnchanged: 10,
      edgesInserted: 7,
      edgesUpdated: 0,
    });
    const rows = db.prepare('SELECT * FROM arch_extract_runs').all() as Array<{
      id: string;
      extractor: string;
      duration_ms: number;
      artifacts_inserted: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.extractor).toBe('ts-morph');
    expect(rows[0]!.duration_ms).toBe(1000);
    expect(rows[0]!.artifacts_inserted).toBe(5);
  });
});

// Suppress dedupKey unused-import lint since not all branches use it.
void computeEdgeDedupKey;
