import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DesignSnapshotter } from '../../src/snapshotter.js';
import { InMemoryBYOCAdapter } from '../../src/byoc-adapter.js';
import { SnapshotterError } from '../../src/errors.js';
import { FakePool } from '../helpers/fake-pg.js';
import {
  assetHashChangedDesign,
  baseDesign,
  copyChangedDesign,
  nodeAddedDesign,
  nodeMovedDesign,
  tokenChangedDesign,
} from '../helpers/fixtures.js';

function setup() {
  const pool = new FakePool();
  const byoc = new InMemoryBYOCAdapter();
  const snap = new DesignSnapshotter({ pool, byoc });
  return { pool, byoc, snap };
}

describe('captureSnapshot', () => {
  it('creates v1 when no prior version exists', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });

    const v = await snap.captureSnapshot(uxUploadId, baseDesign());
    expect(v.versionNumber).toBe(1);
    expect(v.parentVersionId).toBeNull();
    expect(v.tenantId).toBe(tenantId);
    expect(v.diffSummary!.totalChanges).toBe(0);
  });

  it('links v2 to v1 as parent', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });

    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    const v2 = await snap.captureSnapshot(uxUploadId, copyChangedDesign());

    expect(v2.versionNumber).toBe(2);
    expect(v2.parentVersionId).toBe(v1.id);
  });

  it('writes the diff_from_parent into v2', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });

    await snap.captureSnapshot(uxUploadId, baseDesign());
    const v2 = await snap.captureSnapshot(uxUploadId, copyChangedDesign());

    expect(v2.diffFromParent!.copy.textChanged).toHaveLength(1);
    expect(v2.diffSummary!.copyChanged).toBeGreaterThanOrEqual(1);
    expect(v2.diffSummary!.totalChanges).toBeGreaterThan(0);
  });

  it('dedups identical asset bytes by content_hash', async () => {
    const { pool, snap, byoc } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    void byoc;

    // Capture two versions with the same asset → only one design_assets
    // row should exist (UNIQUE on (tenant_id, content_hash)).
    await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());

    const matching = pool.tables.design_assets.filter(
      (r) => r.content_hash.startsWith('sha256:aaaa'),
    );
    expect(matching).toHaveLength(1);
  });

  it('creates a new design_assets row when the asset hash changes', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, assetHashChangedDesign());
    expect(pool.tables.design_assets).toHaveLength(2);
  });

  it('throws ux_upload_not_found for an unknown uxUploadId', async () => {
    const { snap } = setup();
    await expect(snap.captureSnapshot(randomUUID(), baseDesign())).rejects.toMatchObject({
      code: 'ux_upload_not_found',
    });
  });

  it('throws invalid_renderable_design for null payload', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await expect(
      snap.captureSnapshot(uxUploadId, null as unknown as ReturnType<typeof baseDesign>),
    ).rejects.toMatchObject({ code: 'invalid_renderable_design' });
  });

  it('skipIfUnchanged returns the parent when payload hash is identical', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    const v1again = await snap.captureSnapshot(uxUploadId, baseDesign(), {
      skipIfUnchanged: true,
    });
    expect(v1again.id).toBe(v1.id);
    expect(pool.tables.design_versions).toHaveLength(1);
  });

  it('without skipIfUnchanged, an identical re-upload still creates v2', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await snap.captureSnapshot(uxUploadId, baseDesign());
    const v2 = await snap.captureSnapshot(uxUploadId, baseDesign());
    expect(v2.versionNumber).toBe(2);
    expect(pool.tables.design_versions).toHaveLength(2);
  });

  it('surfaces concurrent_version_conflict on UNIQUE violation', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });

    await snap.captureSnapshot(uxUploadId, baseDesign());
    // Simulate a race: another writer slipped v2 in just before us.
    pool.hookBeforeInsertVersion = (vn, uid) => {
      if (vn === 2 && uid === uxUploadId) {
        pool.tables.design_versions.push({
          id: randomUUID(),
          tenant_id: tenantId,
          ux_upload_id: uxUploadId,
          version_number: 2,
          parent_version_id: null,
          rendered_design: {},
          rendered_design_hash: 'sha256:zz',
          diff_from_parent: null,
          diff_summary: null,
          notes: 'racer',
          created_at: new Date(),
        });
        pool.hookBeforeInsertVersion = null;
      }
    };
    await expect(snap.captureSnapshot(uxUploadId, copyChangedDesign())).rejects.toMatchObject({
      code: 'concurrent_version_conflict',
    });
  });

  it('uses resolveTenantSchema callback for search_path', async () => {
    const pool = new FakePool();
    const byoc = new InMemoryBYOCAdapter();
    const calls: string[] = [];
    const snap = new DesignSnapshotter({
      pool,
      byoc,
      resolveTenantSchema: (tid) => {
        calls.push(tid);
        return 'caia_abc123';
      },
    });
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await snap.captureSnapshot(uxUploadId, baseDesign());
    expect(calls).toContain(tenantId);
  });
});

describe('listVersions', () => {
  it('returns versions in ascending order', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });

    await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    await snap.captureSnapshot(uxUploadId, nodeAddedDesign());

    const list = await snap.listVersions(uxUploadId);
    expect(list.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
  });

  it('omits heavy renderedDesign payload from summaries', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await snap.captureSnapshot(uxUploadId, baseDesign());

    const list = await snap.listVersions(uxUploadId);
    expect(list[0]!).not.toHaveProperty('renderedDesign');
    expect(list[0]).toHaveProperty('renderedDesignHash');
  });

  it('returns an empty array when no versions exist', async () => {
    const { snap } = setup();
    const list = await snap.listVersions(randomUUID());
    expect(list).toEqual([]);
  });
});

describe('getSnapshot', () => {
  it('returns the persisted version by id', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    const got = await snap.getSnapshot(v1.id);
    expect(got.id).toBe(v1.id);
    expect(got.renderedDesign).toMatchObject({ source: 'cd-zip' });
  });

  it('throws design_version_not_found for an unknown id', async () => {
    const { snap } = setup();
    await expect(snap.getSnapshot(randomUUID())).rejects.toMatchObject({
      code: 'design_version_not_found',
    });
  });
});

describe('getDiff', () => {
  it('returns the cached diff when toVersion is the direct child of fromVersion', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    const v2 = await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    const diff = await snap.getDiff(v1.id, v2.id);
    expect(diff.copy.textChanged).toHaveLength(1);
  });

  it('recomputes the diff when the two versions are not parent/child', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    const v3 = await snap.captureSnapshot(uxUploadId, nodeAddedDesign());
    // v3's cached diff is vs v2, not v1 — getDiff(v1, v3) must recompute.
    const diff = await snap.getDiff(v1.id, v3.id);
    expect(diff.nodes.added).toContain('page-home>section-stats');
  });

  it('throws design_version_not_found when either version is missing', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    await expect(snap.getDiff(v1.id, randomUUID())).rejects.toMatchObject({
      code: 'design_version_not_found',
    });
  });
});

describe('revertToVersion', () => {
  it('forward-creates v(N+1) equal to v(target)', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });

    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    await snap.captureSnapshot(uxUploadId, nodeAddedDesign());

    const v4 = await snap.revertToVersion(uxUploadId, 1);
    expect(v4.versionNumber).toBe(4);
    expect(v4.renderedDesignHash).toBe(v1.renderedDesignHash);
    expect(v4.notes).toMatch(/revert to v1/);
  });

  it('does NOT mutate the target row (immutability)', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });

    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    const beforeV1 = JSON.stringify(
      pool.tables.design_versions.find((r) => r.id === v1.id),
    );
    await snap.revertToVersion(uxUploadId, 1);
    const afterV1 = JSON.stringify(
      pool.tables.design_versions.find((r) => r.id === v1.id),
    );
    expect(afterV1).toBe(beforeV1);
  });

  it('respects custom notes on revert', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    const reverted = await snap.revertToVersion(uxUploadId, 1, {
      notes: 'roll back the bad header',
    });
    expect(reverted.notes).toBe('roll back the bad header');
  });

  it('throws design_version_not_found when target version does not exist', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await snap.captureSnapshot(uxUploadId, baseDesign());
    await expect(snap.revertToVersion(uxUploadId, 99)).rejects.toMatchObject({
      code: 'design_version_not_found',
    });
  });

  it('throws invalid_version_number for a non-positive integer', async () => {
    const { snap } = setup();
    await expect(snap.revertToVersion('anything', 0)).rejects.toMatchObject({
      code: 'invalid_version_number',
    });
    await expect(snap.revertToVersion('anything', -3)).rejects.toMatchObject({
      code: 'invalid_version_number',
    });
    await expect(snap.revertToVersion('anything', 1.5)).rejects.toMatchObject({
      code: 'invalid_version_number',
    });
  });

  it('throws design_version_not_found when ux_upload has zero versions', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await expect(snap.revertToVersion(uxUploadId, 1)).rejects.toMatchObject({
      code: 'design_version_not_found',
    });
  });

  it('preserves the chain: after revert, the new latest parent is the just-prior version', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await snap.captureSnapshot(uxUploadId, baseDesign());
    const v2 = await snap.captureSnapshot(uxUploadId, copyChangedDesign());
    const v3 = await snap.revertToVersion(uxUploadId, 1);
    expect(v3.parentVersionId).toBe(v2.id);
  });
});

describe('deleteAllForTenant', () => {
  it('removes every snapshotter row for the tenant and returns the counts', async () => {
    const { pool, snap } = setup();
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const uA = pool.insertUpload({ tenantId: tenantA });
    const uB = pool.insertUpload({ tenantId: tenantB });

    await snap.captureSnapshot(uA, baseDesign());
    await snap.captureSnapshot(uA, copyChangedDesign());
    await snap.captureSnapshot(uB, baseDesign());

    const result = await snap.deleteAllForTenant(tenantA);
    expect(result.deletedVersionCount).toBe(2);
    expect(result.deletedAssetCount).toBe(1);
    expect(result.tenantTombstoneRef).toMatch(/^tombstone:/);

    // Tenant B still intact.
    expect(pool.tables.design_versions.filter((r) => r.tenant_id === tenantB)).toHaveLength(1);
    expect(pool.tables.design_assets.filter((r) => r.tenant_id === tenantB)).toHaveLength(1);
  });

  it('dry-run returns counts without mutating', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });
    await snap.captureSnapshot(uxUploadId, baseDesign());
    await snap.captureSnapshot(uxUploadId, copyChangedDesign());

    const result = await snap.deleteAllForTenant(tenantId, { dryRun: true });
    expect(result.deletedVersionCount).toBe(2);
    expect(pool.tables.design_versions).toHaveLength(2);
    expect(pool.tables.design_assets).toHaveLength(1);
  });

  it('is idempotent — re-running on an empty tenant returns zeros', async () => {
    const { snap } = setup();
    const result = await snap.deleteAllForTenant(randomUUID());
    expect(result.deletedVersionCount).toBe(0);
    expect(result.deletedAssetCount).toBe(0);
    expect(result.tenantTombstoneRef).toMatch(/^tombstone:/);
  });

  it('rejects empty tenantId', async () => {
    const { snap } = setup();
    await expect(snap.deleteAllForTenant('')).rejects.toBeInstanceOf(SnapshotterError);
  });
});

describe('integration of features', () => {
  it('full cycle: 3 captures + 1 revert + 1 diff query + delete', async () => {
    const { pool, snap } = setup();
    const tenantId = randomUUID();
    const uxUploadId = pool.insertUpload({ tenantId });

    const v1 = await snap.captureSnapshot(uxUploadId, baseDesign(), { notes: 'first' });
    const v2 = await snap.captureSnapshot(uxUploadId, tokenChangedDesign(), { notes: 'rebrand' });
    const v3 = await snap.captureSnapshot(uxUploadId, nodeMovedDesign(), {
      notes: 'restructure',
    });

    const list = await snap.listVersions(uxUploadId);
    expect(list.map((v) => v.versionNumber)).toEqual([1, 2, 3]);

    const diff13 = await snap.getDiff(v1.id, v3.id);
    expect(diff13.tokens.valueChanged.length + diff13.nodes.added.length).toBeGreaterThan(0);

    const v4 = await snap.revertToVersion(uxUploadId, 1);
    expect(v4.renderedDesignHash).toBe(v1.renderedDesignHash);
    expect((await snap.listVersions(uxUploadId))).toHaveLength(4);

    const del = await snap.deleteAllForTenant(tenantId);
    expect(del.deletedVersionCount).toBe(4);
    expect(pool.tables.design_versions).toHaveLength(0);
    void v2;
  });
});
