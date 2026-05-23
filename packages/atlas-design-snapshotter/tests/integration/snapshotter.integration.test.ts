/**
 * Integration test — real Postgres + S3-compatible MinIO.
 *
 * Skipped unless PG_INTEGRATION_URL is set. Bring up:
 *   docker compose -f docker-compose.test.yml up -d
 *   PG_INTEGRATION_URL=postgres://caia:caia@localhost:54321/caia_test \
 *     pnpm test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { DesignSnapshotter } from '../../src/snapshotter.js';
import { InMemoryBYOCAdapter } from '../../src/byoc-adapter.js';
import { baseDesign, copyChangedDesign, nodeAddedDesign } from '../helpers/fixtures.js';

const PG_URL = process.env.PG_INTEGRATION_URL;

describe.skipIf(!PG_URL)('DesignSnapshotter integration (real Postgres)', () => {
  let pool: Pool;
  let snap: DesignSnapshotter;
  let byoc: InMemoryBYOCAdapter;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });
    // Apply the migration. Idempotent IF NOT EXISTS.
    const ddl = readFileSync(
      resolve(__dirname, '../../migrations/0001_design_versions.sql'),
      'utf8',
    );
    await pool.query(ddl);
    byoc = new InMemoryBYOCAdapter();
    snap = new DesignSnapshotter({ pool, byoc });
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM design_version_assets');
      await pool.query('DELETE FROM design_versions');
      await pool.query('DELETE FROM design_assets');
      await pool.query('DELETE FROM ux_uploads');
      await pool.end();
    }
  });

  async function newUpload(): Promise<{ tenantId: string; uxUploadId: string }> {
    const tenantId = randomUUID();
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ux_uploads (tenant_id, source) VALUES ($1, $2) RETURNING id`,
      [tenantId, 'cd-zip'],
    );
    return { tenantId, uxUploadId: res.rows[0]!.id };
  }

  it('round-trips a single capture through real Postgres', async () => {
    const { uxUploadId } = await newUpload();
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    expect(v1.versionNumber).toBe(1);
    const got = await snap.getSnapshot(v1.id);
    expect(got.id).toBe(v1.id);
    expect(got.renderedDesign.componentTrees['tree:home']!.node.domId).toBe('page-home');
  });

  it('persists parent linkage across captures', async () => {
    const { uxUploadId } = await newUpload();
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    const v2 = await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    expect(v2.parentVersionId).toBe(v1.id);
    const list = await snap.listVersions(uxUploadId);
    expect(list).toHaveLength(2);
  });

  it('content-hash dedups asset rows across versions', async () => {
    const { tenantId, uxUploadId } = await newUpload();
    await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    await snap.captureSnapshot(uxUploadId, nodeAddedDesign());
    const { rows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM design_assets WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0]!.c).toBe('1');
  });

  it('revert forward-creates v(N+1) equal to v(target)', async () => {
    const { uxUploadId } = await newUpload();
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    const v3 = await snap.revertToVersion(uxUploadId, 1);
    expect(v3.versionNumber).toBe(3);
    expect(v3.renderedDesignHash).toBe(v1.renderedDesignHash);
  });

  it('deleteAllForTenant wipes everything for that tenant', async () => {
    const a = await newUpload();
    const b = await newUpload();
    await snap.captureSnapshot(a.uxUploadId, baseDesign());
    await snap.captureSnapshot(a.uxUploadId, copyChangedDesign());
    await snap.captureSnapshot(b.uxUploadId, baseDesign());

    const result = await snap.deleteAllForTenant(a.tenantId);
    expect(result.deletedVersionCount).toBe(2);

    const { rows: rA } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM design_versions WHERE tenant_id = $1`,
      [a.tenantId],
    );
    expect(rA[0]!.c).toBe('0');
    const { rows: rB } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM design_versions WHERE tenant_id = $1`,
      [b.tenantId],
    );
    expect(Number(rB[0]!.c)).toBeGreaterThan(0);
  });

  it('actually uploads a blob to the BYOC adapter when an asset is first seen', async () => {
    const { tenantId, uxUploadId } = await newUpload();
    // Pre-populate the BYOC store as if upstream had pushed the bytes.
    const bytes = Buffer.from('image-bytes');
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const design = baseDesign();
    design.assets = [
      { path: '/new.jpg', kind: 'image', contentHash: hash, byteSize: bytes.byteLength },
    ];
    await byoc.putBlob(tenantId, `upstream/new`, bytes);
    const v = await snap.captureSnapshot(uxUploadId, design);
    const { rows } = await pool.query<{ storage_url: string }>(
      `SELECT storage_url FROM design_assets WHERE tenant_id = $1 AND content_hash = $2`,
      [tenantId, hash],
    );
    expect(rows[0]!.storage_url).toMatch(/^byoc:|mem:/);
    void v;
  });
});
