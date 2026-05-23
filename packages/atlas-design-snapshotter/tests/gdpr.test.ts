import { describe, expect, it } from 'vitest';

import { createDesignSnapshotter } from '../src/index.js';
import {
  FakeBlobStorage,
  FakePg,
  counterIdGen,
  fakeDiff,
  frozenClock,
  makeAssetBytes,
  makeDesign,
} from './fakes.js';

const SCHEMA = 'caia_test';

describe('deleteAllForTenant — GDPR right-to-erasure', () => {
  it('is idempotent on an empty tenant', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: 'empty',
      idGen: counterIdGen(), clock: frozenClock(),
    });
    const r = await snap.deleteAllForTenant('empty');
    expect(r.deletedVersionCount).toBe(0);
    expect(r.deletedBlobCount).toBe(0);
  });

  it('drops all design_versions rows for the tenant', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    pg.seedUxUpload({ id: 'u-a', tenant_id: 'tenant-a' });
    pg.seedUxUpload({ id: 'u-a2', tenant_id: 'tenant-a' });
    pg.seedUxUpload({ id: 'u-b', tenant_id: 'tenant-b' });
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: 'tenant-a',
      idGen: counterIdGen(), clock: frozenClock(),
    });
    await snap.snapshot({ uxUploadId: 'u-a', design: makeDesign() });
    await snap.snapshot({ uxUploadId: 'u-a2', design: makeDesign() });
    await snap.snapshot({ uxUploadId: 'u-b', design: makeDesign() });

    const r = await snap.deleteAllForTenant('tenant-a');
    expect(r.deletedVersionCount).toBe(2);
    expect(pg.designVersions.map((v) => v.ux_upload_id)).toEqual(['u-b']);
    expect(pg.uxUploads.has('u-a')).toBe(false);
    expect(pg.uxUploads.has('u-a2')).toBe(false);
    expect(pg.uxUploads.has('u-b')).toBe(true);
  });

  it('deletes blobs via the BYOC adapter', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    pg.seedUxUpload({ id: 'u-a', tenant_id: 'tenant-a' });
    const bytes = makeAssetBytes('photo');
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: 'tenant-a',
      idGen: counterIdGen(), clock: frozenClock(),
      assetByteReader: async () => bytes,
    });
    await snap.snapshot({
      uxUploadId: 'u-a',
      design: makeDesign({ assets: [{ path: '/p.png', kind: 'image' }] }),
    });
    expect(blob.size()).toBe(1);

    const r = await snap.deleteAllForTenant('tenant-a');
    expect(r.deletedBlobCount).toBeGreaterThanOrEqual(1);
    expect(blob.size()).toBe(0);
  });

  it('is safe to re-run (still idempotent after one successful wipe)', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    pg.seedUxUpload({ id: 'u-a', tenant_id: 'tenant-a' });
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: 'tenant-a',
      idGen: counterIdGen(), clock: frozenClock(),
    });
    await snap.snapshot({ uxUploadId: 'u-a', design: makeDesign() });
    await snap.deleteAllForTenant('tenant-a');
    const again = await snap.deleteAllForTenant('tenant-a');
    expect(again.deletedVersionCount).toBe(0);
    expect(again.deletedBlobCount).toBe(0);
  });

  it('rejects an empty tenantId', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: 'tenant-a',
      idGen: counterIdGen(), clock: frozenClock(),
    });
    await expect(snap.deleteAllForTenant('')).rejects.toMatchObject({ code: 'tenant_mismatch' });
  });

  it('swallows blob-delete errors so DB delete is final', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    blob.delete = async () => { throw new Error('s3 unreachable'); };
    pg.seedUxUpload({ id: 'u-a', tenant_id: 'tenant-a' });
    const bytes = makeAssetBytes('photo');
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: 'tenant-a',
      idGen: counterIdGen(), clock: frozenClock(),
      assetByteReader: async () => bytes,
    });
    await snap.snapshot({
      uxUploadId: 'u-a',
      design: makeDesign({ assets: [{ path: '/p.png', kind: 'image' }] }),
    });
    const r = await snap.deleteAllForTenant('tenant-a');
    // Versions deleted; blob delete count is 0 because every call errored.
    expect(r.deletedVersionCount).toBe(1);
    expect(r.deletedBlobCount).toBe(0);
    expect(pg.uxUploads.has('u-a')).toBe(false);
  });
});
