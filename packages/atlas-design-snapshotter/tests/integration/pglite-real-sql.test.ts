/**
 * Integration test against an in-process real Postgres engine (PGlite).
 *
 * Exercises the actual migration SQL, real JSONB, real transactions,
 * the UNIQUE constraint, and ON CONFLICT DO UPDATE — everything the
 * fake-pg cannot prove. Runs without Docker so it stays in the default
 * `pnpm test:integration` lane.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DesignSnapshotter } from '../../src/snapshotter.js';
import { InMemoryBYOCAdapter } from '../../src/byoc-adapter.js';
import { PGlitePool } from '../helpers/pglite-pool.js';
import {
  baseDesign,
  copyChangedDesign,
  nodeAddedDesign,
  tokenChangedDesign,
} from '../helpers/fixtures.js';

describe('DesignSnapshotter — real Postgres (PGlite)', () => {
  let pool: PGlitePool;
  let snap: DesignSnapshotter;
  let byoc: InMemoryBYOCAdapter;

  beforeAll(async () => {
    pool = await PGlitePool.create();
    const ddl = readFileSync(
      resolve(__dirname, '../../migrations/0001_design_versions.sql'),
      'utf8',
    );
    await pool.exec(ddl);
    byoc = new InMemoryBYOCAdapter();
    snap = new DesignSnapshotter({ pool, byoc });
  }, 30_000);

  afterAll(async () => {
    if (pool) {
      await pool.close();
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
    const { uxUploadId, tenantId } = await newUpload();
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign(), { notes: 'hi' });
    expect(v1.versionNumber).toBe(1);
    expect(v1.tenantId).toBe(tenantId);

    const got = await snap.getSnapshot(v1.id);
    expect(got.id).toBe(v1.id);
    expect(got.notes).toBe('hi');
    // JSONB round-trip preserves nested structure.
    expect(got.renderedDesign.componentTrees['tree:home']!.node.domId).toBe('page-home');
  });

  it('UNIQUE (ux_upload_id, version_number) enforces monotonicity at the DB layer', async () => {
    const { uxUploadId } = await newUpload();
    await snap.captureSnapshot(uxUploadId, baseDesign());
    const v2 = await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    const v3 = await snap.captureSnapshot(uxUploadId, nodeAddedDesign());
    expect(v2.versionNumber).toBe(2);
    expect(v3.versionNumber).toBe(3);
    // Try to manually insert a duplicate version_number — must throw 23505.
    await expect(
      pool.query(
        `INSERT INTO design_versions
           (tenant_id, ux_upload_id, version_number, parent_version_id,
            rendered_design, rendered_design_hash, diff_from_parent, diff_summary)
         VALUES ($1, $2, $3, NULL, '{}'::jsonb, 'sha256:zz', NULL, NULL)`,
        [randomUUID(), uxUploadId, 2],
      ),
    ).rejects.toThrow();
  });

  it('design_assets dedup ON CONFLICT works under real Postgres', async () => {
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

  it('design_assets stores a brand-new row when content_hash changes', async () => {
    const { tenantId, uxUploadId } = await newUpload();
    const bytes = Buffer.from('new-image-bytes');
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const d = baseDesign();
    d.assets = [{ path: '/x.jpg', kind: 'image', contentHash: hash, byteSize: bytes.byteLength }];
    await snap.captureSnapshot(uxUploadId, d);
    const { rows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM design_assets WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0]!.c).toBe('1');
  });

  it('revert forward-creates v(N+1) with parent = prior latest', async () => {
    const { uxUploadId } = await newUpload();
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    const v2 = await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    const v3 = await snap.revertToVersion(uxUploadId, 1, { notes: 'undo' });
    expect(v3.versionNumber).toBe(3);
    expect(v3.parentVersionId).toBe(v2.id);
    expect(v3.renderedDesignHash).toBe(v1.renderedDesignHash);
    expect(v3.notes).toBe('undo');
  });

  it('diff_from_parent JSONB serializes/deserialises through Postgres', async () => {
    const { uxUploadId } = await newUpload();
    await snap.captureSnapshot(uxUploadId, baseDesign());
    const v2 = await snap.captureSnapshot(uxUploadId, tokenChangedDesign());
    // Fetch the raw row to prove the JSONB round-tripped intact.
    const { rows } = await pool.query<{ diff_from_parent: { tokens: { valueChanged: unknown[] } } }>(
      `SELECT diff_from_parent FROM design_versions WHERE id = $1`,
      [v2.id],
    );
    const dfp = rows[0]!.diff_from_parent;
    expect(dfp.tokens.valueChanged).toHaveLength(1);
  });

  it('deleteAllForTenant cascades through design_version_assets', async () => {
    const tenantA = (await newUpload()).tenantId;
    // re-create with controlled tenant
    const uA = (
      await pool.query<{ id: string }>(
        `INSERT INTO ux_uploads (tenant_id, source) VALUES ($1, $2) RETURNING id`,
        [tenantA, 'cd-zip'],
      )
    ).rows[0]!.id;
    const tenantB = randomUUID();
    const uB = (
      await pool.query<{ id: string }>(
        `INSERT INTO ux_uploads (tenant_id, source) VALUES ($1, $2) RETURNING id`,
        [tenantB, 'cd-zip'],
      )
    ).rows[0]!.id;

    await snap.captureSnapshot(uA, baseDesign());
    await snap.captureSnapshot(uA, copyChangedDesign());
    await snap.captureSnapshot(uB, baseDesign());

    const result = await snap.deleteAllForTenant(tenantA);
    expect(result.deletedVersionCount).toBeGreaterThanOrEqual(2);
    expect(result.deletedAssetCount).toBeGreaterThanOrEqual(1);

    const { rows: rA } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM design_versions WHERE tenant_id = $1`,
      [tenantA],
    );
    expect(rA[0]!.c).toBe('0');

    const { rows: rBV } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM design_versions WHERE tenant_id = $1`,
      [tenantB],
    );
    expect(Number(rBV[0]!.c)).toBeGreaterThan(0);

    const { rows: rVA } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM design_version_assets WHERE design_version_id IN
         (SELECT id FROM design_versions WHERE tenant_id = $1)`,
      [tenantA],
    );
    expect(rVA[0]!.c).toBe('0');
  });

  it('listVersions returns versions in ascending order from the DB', async () => {
    const { uxUploadId } = await newUpload();
    await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    await snap.captureSnapshot(uxUploadId, nodeAddedDesign());
    const list = await snap.listVersions(uxUploadId);
    expect(list.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
  });

  it('getDiff against non-parent path recomputes from JSONB payload', async () => {
    const { uxUploadId } = await newUpload();
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    const v3 = await snap.captureSnapshot(uxUploadId, nodeAddedDesign());
    const d = await snap.getDiff(v1.id, v3.id);
    expect(d.nodes.added).toContain('page-home>section-stats');
  });
});
