/**
 * FREG-006 — PO Agent integration tests with feature registry.
 *
 * Drives runPOAgent against a temp DB pre-seeded with a feature
 * registry row, asserts the lifecycle override + linksTo persistence.
 *
 * Uses StubEmbeddingClient throughout so CI doesn't need Ollama.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import {
  bootstrapVectorTables,
  computeDedupKey,
  StubEmbeddingClient,
  upsertRegistryRow,
  type FeatureRegistryRow,
} from '@chiefaia/feature-registry';
import { runPOAgent } from '../../src/agents/po-agent';
import { setEmbedderForTesting, loadRegistryRowsByIds } from '../../src/agents/feature-registry-search-client';
import {
  getDb,
  getSqliteRaw,
  resetDb,
  runMigrations,
} from '../../src/db/connection';
import {
  featureRegistry,
  featureRegistrySearchLog,
  prompts,
  stories,
} from '../../src/db/schema';

const DIM = 768;

function tempDbUrl(): string {
  return path.join(os.tmpdir(), `freg-po-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

function nowIso() {
  return new Date().toISOString();
}

function seedPrompt(id = 'prm_freg_t1', body = 'add a leaderboard page that ranks players') {
  const db = getDb();
  db.insert(prompts).values({
    id,
    body,
    receivedAt: nowIso(),
    receivedVia: 'api',
    correlationId: `cor_${id}`,
    hash: `hash_${id}`,
    status: 'received',
  }).run();
  return id;
}

function seedRegistryRow(name = 'leaderboard page', description = 'ranks top players by chips won today'): FeatureRegistryRow {
  const sqlite = getSqliteRaw();
  const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
  const now = Date.now();
  const row: FeatureRegistryRow = {
    id: 'freg_seed_leader',
    project: 'pokerzeno',
    name,
    description,
    routePath: '/leaderboard',
    filePaths: ['app/leaderboard/page.tsx'],
    componentName: undefined,
    apiEndpoint: undefined,
    dbTables: ['users'],
    agentName: undefined,
    shippedAt: now,
    storyId: undefined,
    tags: ['gameplay'],
    embeddingModel: 'nomic-embed-text',
    embeddingDim: DIM,
    embeddingVersion: 'v1.5',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    dedupKey: computeDedupKey({
      project: 'pokerzeno',
      name,
      routePath: '/leaderboard',
    }),
  };
  // synchronous: stub.embed isn't actually async-bound — call immediately
  stub.embed(description).then(({ embedding }) => upsertRegistryRow(sqlite, row, embedding));
  return row;
}

describe('PO Agent — FREG-006 feature registry classification', () => {
  let url: string;
  let stub: StubEmbeddingClient;

  beforeEach(async () => {
    resetDb();
    url = tempDbUrl();
    runMigrations(url);
    bootstrapVectorTables(getSqliteRaw(), DIM);
    stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    setEmbedderForTesting(stub);
  });

  afterEach(() => {
    setEmbedderForTesting(null);
    try { fs.unlinkSync(url); } catch { /* */ }
    resetDb();
  });

  it('matched prompt → lifecycle="enhance" + linksTo populated + log row written', async () => {
    // Use a constant-vector embedder so the seed and every story get
    // identical embeddings (cosine sim 1.0). This isolates the
    // override path from decomposer output drift.
    const sqlite = getSqliteRaw();
    const constVec = new Float32Array(DIM);
    constVec[0] = 1; // unit vector along axis 0; cosine self-sim = 1
    const constEmbedder = {
      modelName: () => 'const-test',
      modelDim: () => DIM,
      embed: async () => ({ embedding: constVec, tokens: 10, latencyMs: 0 }),
      embedBatch: async (xs: string[]) => xs.map(() => ({ embedding: constVec, tokens: 10, latencyMs: 0 })),
    };
    setEmbedderForTesting(constEmbedder);

    const now = Date.now();
    const seedRow: FeatureRegistryRow = {
      id: 'freg_seed_leader',
      project: 'pokerzeno',
      name: 'leaderboard page',
      description: 'ranks top players by chips won today',
      routePath: '/leaderboard',
      filePaths: ['app/leaderboard/page.tsx'],
      componentName: undefined,
      apiEndpoint: undefined,
      dbTables: [],
      agentName: undefined,
      shippedAt: now,
      storyId: undefined,
      tags: ['gameplay'],
      embeddingModel: 'const-test',
      embeddingDim: DIM,
      embeddingVersion: 'v1.5',
      source: 'manual',
      createdAt: now,
      updatedAt: now,
      dedupKey: computeDedupKey({ project: 'pokerzeno', name: 'leaderboard page', routePath: '/leaderboard' }),
    };
    upsertRegistryRow(sqlite, seedRow, constVec);

    const promptId = seedPrompt('prm_match', 'add a leaderboard page to pokerzeno that ranks players');

    const result = await runPOAgent(
      {
        promptId,
        promptText: 'add a leaderboard page to pokerzeno that ranks players',
        projectId: null,
        correlationId: 'cor_match',
      },
      getDb(),
    );
    expect(result.storiesCreated).toBeGreaterThan(0);

    // At least one story should have lifecycle='enhance' + linksTo with the seed feature id.
    const allStories = getDb()
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();
    const enhanced = allStories.filter((s) => s.lifecycle === 'enhance');
    expect(enhanced.length).toBeGreaterThan(0);
    const top = enhanced[0]!;
    const linksTo = JSON.parse(top.linksToJson);
    expect(linksTo).toContain('freg_seed_leader');
    expect(top.featureClassification).toBe('enhance');
    expect(top.featureClassificationScore).toBeGreaterThan(0.99);

    // search_log received a row.
    const logs = sqlite
      .prepare("SELECT * FROM feature_registry_search_log WHERE caller = 'po-agent'")
      .all() as Array<{ classification: string; top_match_id: string | null; embedder_tokens: number }>;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.classification === 'enhance' && l.top_match_id === 'freg_seed_leader')).toBe(true);
  });

  it('novel prompt with empty registry → lifecycle="new" + empty linksTo', async () => {
    const promptId = seedPrompt('prm_novel', 'completely original feature nobody has built before');

    const result = await runPOAgent(
      {
        promptId,
        promptText: 'completely original feature nobody has built before',
        projectId: null,
        correlationId: 'cor_novel',
      },
      getDb(),
    );
    expect(result.storiesCreated).toBeGreaterThan(0);

    const allStories = getDb()
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();
    expect(allStories.length).toBeGreaterThan(0);
    const top = allStories[0]!;
    expect(JSON.parse(top.linksToJson)).toEqual([]);
    expect(top.featureClassification).toBe('new');
  });

  it('embedder unavailable → fallback to classifyLifecycle, skipped event emitted, story still inserted', async () => {
    // Replace the cached embedder with one that throws EmbedderUnavailableError.
    const { EmbedderUnavailableError } = await import('@chiefaia/feature-registry');
    setEmbedderForTesting({
      modelName: () => 'broken',
      modelDim: () => DIM,
      embed: async () => { throw new EmbedderUnavailableError('forced for test'); },
      embedBatch: async () => { throw new EmbedderUnavailableError('forced for test'); },
    });

    const promptId = seedPrompt('prm_offline', 'offline classification path test');

    const result = await runPOAgent(
      {
        promptId,
        promptText: 'offline classification path test',
        projectId: null,
        correlationId: 'cor_offline',
      },
      getDb(),
    );
    expect(result.storiesCreated).toBeGreaterThan(0);

    const allStories = getDb()
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();
    // Stories still got inserted; lifecycle is whatever classifyLifecycle returned.
    expect(allStories.length).toBeGreaterThan(0);
    expect(allStories[0]!.featureClassification).toBeNull();
    expect(JSON.parse(allStories[0]!.linksToJson)).toEqual([]);
  });
});

describe('FREG-006 — loadRegistryRowsByIds', () => {
  let url: string;

  beforeEach(async () => {
    resetDb();
    url = tempDbUrl();
    runMigrations(url);
    bootstrapVectorTables(getSqliteRaw(), DIM);
  });

  afterEach(() => {
    try { fs.unlinkSync(url); } catch { /* */ }
    resetDb();
  });

  it('returns empty array for empty input', () => {
    expect(loadRegistryRowsByIds([])).toEqual([]);
  });

  it('JSON-decodes file_paths_json + db_tables_json + tags_json', async () => {
    const sqlite = getSqliteRaw();
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const now = Date.now();
    const row: FeatureRegistryRow = {
      id: 'freg_decode',
      project: 'caia',
      name: 'thing',
      description: 'some desc',
      routePath: '/thing',
      filePaths: ['a.ts', 'b.ts'],
      componentName: undefined,
      apiEndpoint: undefined,
      dbTables: ['t1', 't2'],
      agentName: undefined,
      shippedAt: now,
      storyId: undefined,
      tags: ['x', 'y'],
      embeddingModel: 'nomic-embed-text',
      embeddingDim: DIM,
      embeddingVersion: 'v1.5',
      source: 'manual',
      createdAt: now,
      updatedAt: now,
      dedupKey: computeDedupKey({ project: 'caia', name: 'thing', routePath: '/thing' }),
    };
    const { embedding } = await stub.embed(row.description);
    upsertRegistryRow(sqlite, row, embedding);

    const loaded = loadRegistryRowsByIds(['freg_decode']);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.filePaths).toEqual(['a.ts', 'b.ts']);
    expect(loaded[0]!.dbTables).toEqual(['t1', 't2']);
    expect(loaded[0]!.tags).toEqual(['x', 'y']);
  });

  it('respects project filter', async () => {
    const sqlite = getSqliteRaw();
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const now = Date.now();
    for (const proj of ['caia', 'pokerzeno']) {
      const row: FeatureRegistryRow = {
        id: `freg_${proj}`,
        project: proj as FeatureRegistryRow['project'],
        name: 'thing',
        description: 'desc',
        routePath: '/thing',
        filePaths: [],
        componentName: undefined,
        apiEndpoint: undefined,
        dbTables: [],
        agentName: undefined,
        shippedAt: now,
        storyId: undefined,
        tags: [],
        embeddingModel: 'nomic-embed-text',
        embeddingDim: DIM,
        embeddingVersion: 'v1.5',
        source: 'manual',
        createdAt: now,
        updatedAt: now,
        dedupKey: computeDedupKey({ project: proj, name: 'thing', routePath: '/thing' }),
      };
      const { embedding } = await stub.embed(row.description);
      upsertRegistryRow(sqlite, row, embedding);
    }

    const all = loadRegistryRowsByIds(['freg_caia', 'freg_pokerzeno']);
    expect(all).toHaveLength(2);

    const filtered = loadRegistryRowsByIds(['freg_caia', 'freg_pokerzeno'], 'caia');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.project).toBe('caia');
  });
});
