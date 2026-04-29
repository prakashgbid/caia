/**
 * FREG-007 — /api/feature-registry route surfaces.
 *
 * Drives the 5 routes against a minimal in-memory Hono app with seeded data.
 * Avoids importing createApp() so this test stays isolated from
 * unrelated route imports (llm, etc.) which have stale paths post-
 * consolidation per apps/orchestrator/package.json.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Hono } from 'hono';
import {
  bootstrapVectorTables,
  computeDedupKey,
  StubEmbeddingClient,
  upsertRegistryRow,
  type FeatureRegistryRow,
} from '@chiefaia/feature-registry';
import { registerFeatureRegistryRoutes } from '../../src/api/routes/feature-registry';
import { getDb, getSqliteRaw, resetDb, runMigrations } from '../../src/db/connection';
import { featureRegistrySearchLog } from '../../src/db/schema';
import { nanoid } from 'nanoid';

const DIM = 768;

function tempDbUrl(): string {
  return path.join(os.tmpdir(), `freg-routes-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

async function seedRegistry(n: number) {
  const sqlite = getSqliteRaw();
  const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const project = i % 2 === 0 ? 'pokerzeno' : 'caia';
    const row: FeatureRegistryRow = {
      id: `freg_seed_${i.toString().padStart(4, '0')}`,
      project: project as FeatureRegistryRow['project'],
      name: `seed feature ${i}`,
      description: `auto-seed feature ${i}`,
      routePath: `/seed-${i}`,
      filePaths: [],
      componentName: undefined,
      apiEndpoint: undefined,
      dbTables: [],
      agentName: undefined,
      shippedAt: now - i * 60_000,
      storyId: undefined,
      tags: [],
      embeddingModel: 'nomic-embed-text',
      embeddingDim: DIM,
      embeddingVersion: 'v1.5',
      source: i % 3 === 0 ? 'backfill_codebase' : 'story_completed',
      createdAt: now - i * 60_000,
      updatedAt: now - i * 60_000,
      dedupKey: computeDedupKey({ project, name: `seed feature ${i}`, routePath: `/seed-${i}` }),
    };
    upsertRegistryRow(sqlite, row, (await stub.embed(row.description)).embedding);
  }
}

function seedSearchLogs(n: number) {
  const db = getDb();
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    db.insert(featureRegistrySearchLog).values({
      id: `frgl_${nanoid(10)}`,
      query: `query ${i}`,
      project: i % 2 === 0 ? 'pokerzeno' : null,
      classification: i % 3 === 0 ? 'enhance' : i % 3 === 1 ? 'new' : 'ambiguous',
      topMatchId: i % 3 !== 1 ? `freg_seed_${(i % 5).toString().padStart(4, '0')}` : null,
      topScore: i % 3 !== 1 ? 0.85 + (i % 10) / 100 : null,
      thresholdUsed: 0.85,
      latencyMs: 100 + i * 5,
      embedderTokens: 30 + i,
      hitCount: i % 5,
      caller: 'po-agent',
      createdAt: now - i * 1000,
    }).run();
  }
}

function buildApp() {
  const app = new Hono();
  registerFeatureRegistryRoutes(app, getDb());
  return app;
}

describe('FREG-007 — /api/feature-registry routes', () => {
  let url: string;
  let app: Hono;

  beforeEach(async () => {
    resetDb();
    url = tempDbUrl();
    runMigrations(url);
    bootstrapVectorTables(getSqliteRaw(), DIM);
    await seedRegistry(8);
    seedSearchLogs(15);
    app = buildApp();
  });

  afterEach(() => {
    try { fs.unlinkSync(url); } catch { /* */ }
    resetDb();
  });

  it('GET /api/feature-registry/summary — counts by project + source + verdict', async () => {
    const res = await app.request('/api/feature-registry/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      registrySize: number;
      projectBreakdown: Array<{ project: string; c: number }>;
      sourceBreakdown: Array<{ source: string; c: number }>;
      classificationCounts24h: Array<{ classification: string; c: number }>;
      recentlyAddedCount: number;
    };
    expect(body.registrySize).toBe(8);
    const pz = body.projectBreakdown.find((p) => p.project === 'pokerzeno');
    expect(pz!.c).toBe(4);
    expect(body.classificationCounts24h.length).toBeGreaterThan(0);
  });

  it('GET /api/feature-registry/recent — paginated by limit', async () => {
    const res = await app.request('/api/feature-registry/recent?limit=3');
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: Array<{ id: string }> };
    expect(body.rows).toHaveLength(3);
  });

  it('GET /api/feature-registry/recent — filters by project', async () => {
    const res = await app.request('/api/feature-registry/recent?project=pokerzeno&limit=20');
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: Array<{ project: string }> };
    expect(body.rows.length).toBe(4);
    expect(body.rows.every((r) => r.project === 'pokerzeno')).toBe(true);
  });

  it('GET /api/feature-registry/search-log — most recent calls', async () => {
    const res = await app.request('/api/feature-registry/search-log?limit=10');
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: Array<{ classification: string; latency_ms: number }> };
    expect(body.rows).toHaveLength(10);
    expect(body.rows[0]!.classification).toBeDefined();
  });

  it('GET /api/feature-registry/latency — p50/p95/p99 over 24h', async () => {
    const res = await app.request('/api/feature-registry/latency?windowHours=24');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      sampleCount: number;
      p50Ms: number | null;
      p95Ms: number | null;
      p99Ms: number | null;
      meanMs: number | null;
    };
    expect(body.sampleCount).toBe(15);
    expect(body.p50Ms).not.toBeNull();
    expect(body.p95Ms).toBeGreaterThanOrEqual(body.p50Ms!);
    expect(body.p99Ms).toBeGreaterThanOrEqual(body.p95Ms!);
  });

  it('GET /api/feature-registry/latency — older logs excluded from window', async () => {
    // Insert a stale log older than the 24h window
    const db2 = getDb();
    db2.insert(featureRegistrySearchLog).values({
      id: 'frgl_stale',
      query: 'old query',
      project: null,
      classification: 'new',
      topMatchId: null,
      topScore: null,
      thresholdUsed: 0.85,
      latencyMs: 999_999,
      embedderTokens: 0,
      hitCount: 0,
      caller: 'po-agent',
      createdAt: Date.now() - 48 * 60 * 60 * 1000, // 48h ago
    }).run();

    const res = await app.request('/api/feature-registry/latency?windowHours=24');
    expect(res.status).toBe(200);
    const body = await res.json() as { sampleCount: number; p50Ms: number | null; maxMs: number | null };
    // 15 fresh + 0 stale (excluded)
    expect(body.sampleCount).toBe(15);
    // The stale 999_999 must not contaminate the max
    expect(body.maxMs).toBeLessThan(999_999);
  });

  it('GET /api/feature-registry/top-matches — grouped by feature_id', async () => {
    const res = await app.request('/api/feature-registry/top-matches?windowHours=24&limit=5');
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: Array<{ feature_id: string; match_count: number }> };
    expect(body.rows.length).toBeGreaterThan(0);
    for (let i = 1; i < body.rows.length; i++) {
      expect(body.rows[i]!.match_count).toBeLessThanOrEqual(body.rows[i - 1]!.match_count);
    }
  });
});
