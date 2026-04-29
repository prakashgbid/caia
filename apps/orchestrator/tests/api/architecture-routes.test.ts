/**
 * ARCH-007 — /api/architecture route surfaces.
 *
 * Drives the 5 routes against a minimal in-memory Hono app with seeded
 * AKG data. Mirrors the FREG-007 test shape (avoids createApp to stay
 * isolated from unrelated route imports).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Hono } from 'hono';
import {
  bootstrapVectorTables,
  computeArtifactDedupKey,
  StubEmbeddingClient,
  upsertArtifactRow,
  recordExtractRun,
  type ArchArtifactRow,
} from '@chiefaia/architecture-registry';
import { registerArchitectureRoutes } from '../../src/api/routes/architecture';
import { getDb, getSqliteRaw, resetDb, runMigrations } from '../../src/db/connection';
import { nanoid } from 'nanoid';

const DIM = 768;

function tempDbUrl(): string {
  return path.join(
    os.tmpdir(),
    `arch-routes-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
}

async function seedArtifacts(n: number): Promise<void> {
  const sqlite = getSqliteRaw();
  bootstrapVectorTables(sqlite, DIM);
  const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const kind = i % 4 === 0 ? 'component' : i % 4 === 1 ? 'api' : i % 4 === 2 ? 'schema' : 'package';
    const project = i % 2 === 0 ? 'caia' : 'pokerzeno';
    const techSubDomains: ArchArtifactRow['techSubDomains'] =
      kind === 'component'
        ? ['frontend']
        : kind === 'api'
          ? ['bff']
          : kind === 'schema'
            ? ['database']
            : ['backend'];
    const row: ArchArtifactRow = {
      id: `arch_seed_${i.toString().padStart(4, '0')}`,
      kind: kind as ArchArtifactRow['kind'],
      project: project as ArchArtifactRow['project'],
      name: `Seed${kind}${i}`,
      description: `auto-seed artifact ${i} of kind ${kind}`,
      filePaths: [`apps/seed/${i}.ts`],
      entryPath: `apps/seed/${i}.ts`,
      techSubDomains,
      tags: [],
      metadataJson: '{}',
      source: 'ast_extract',
      embeddingModel: 'nomic-embed-text',
      embeddingDim: DIM,
      embeddingVersion: 'v1.5',
      createdAt: now - i * 60_000,
      updatedAt: now - i * 60_000,
      dedupKey: computeArtifactDedupKey({
        project,
        kind: kind as ArchArtifactRow['kind'],
        name: `Seed${kind}${i}`,
        entryPath: `apps/seed/${i}.ts`,
      }),
    };
    upsertArtifactRow(sqlite, row, (await stub.embed(row.description)).embedding);
  }
}

function seedExtractRuns(n: number): void {
  const sqlite = getSqliteRaw();
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    recordExtractRun(sqlite, {
      id: `er_${nanoid(8)}`,
      extractor: i % 2 === 0 ? 'ts-morph' : 'drizzle',
      startedAt: now - i * 5_000,
      finishedAt: now - i * 5_000 + 1500,
      durationMs: 1500,
      commitSha: 'abc12345',
      artifactsInserted: i,
      artifactsUpdated: 0,
      artifactsUnchanged: 5,
      edgesInserted: i * 2,
      edgesUpdated: 0,
    });
  }
}

function makeAppWithRoutes(): Hono {
  const app = new Hono();
  registerArchitectureRoutes(app, getDb());
  return app;
}

describe('ARCH-007 — /api/architecture routes', () => {
  let url: string;
  let app: Hono;

  beforeEach(async () => {
    resetDb();
    url = tempDbUrl();
    runMigrations(url);
    await seedArtifacts(12);
    seedExtractRuns(5);
    app = makeAppWithRoutes();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(url)) fs.unlinkSync(url);
    } catch {
      // ignore
    }
    resetDb();
  });

  it('GET /api/architecture/summary returns counts + breakdowns', async () => {
    const res = await app.request('/api/architecture/summary');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalArtifacts: number;
      totalEdges: number;
      kindBreakdown: Array<{ kind: string; c: number }>;
      projectBreakdown: Array<{ project: string; c: number }>;
      sourceBreakdown: Array<{ source: string; c: number }>;
      recentExtractRunCount24h: number;
    };
    expect(body.totalArtifacts).toBe(12);
    expect(body.totalEdges).toBe(0);
    expect(body.recentExtractRunCount24h).toBe(5);
    const kinds = body.kindBreakdown.map((k) => k.kind).sort();
    expect(kinds).toEqual(['api', 'component', 'package', 'schema']);
  });

  it('GET /api/architecture/recent honors limit + kind filter', async () => {
    const res = await app.request('/api/architecture/recent?limit=3&kind=component');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ kind: string }> };
    expect(body.rows.length).toBeLessThanOrEqual(3);
    for (const r of body.rows) {
      expect(r.kind).toBe('component');
    }
  });

  it('GET /api/architecture/by-domain finds artifacts tagged with a tech_sub_domain', async () => {
    const res = await app.request('/api/architecture/by-domain?techSubDomain=frontend');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      techSubDomain: string;
      rows: Array<{ kind: string; tech_sub_domains_json: string }>;
    };
    expect(body.techSubDomain).toBe('frontend');
    expect(body.rows.length).toBeGreaterThan(0);
    for (const r of body.rows) {
      expect(r.tech_sub_domains_json).toContain('frontend');
    }
  });

  it('GET /api/architecture/by-domain rejects missing query param', async () => {
    const res = await app.request('/api/architecture/by-domain');
    expect(res.status).toBe(400);
  });

  it('GET /api/architecture/extract-runs returns recent runs', async () => {
    const res = await app.request('/api/architecture/extract-runs?limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ extractor: string }> };
    expect(body.rows.length).toBe(3);
    expect(['ts-morph', 'drizzle']).toContain(body.rows[0]!.extractor);
  });

  it('GET /api/architecture/edges rejects when neither fromId nor toId is provided', async () => {
    const res = await app.request('/api/architecture/edges');
    expect(res.status).toBe(400);
  });
});
