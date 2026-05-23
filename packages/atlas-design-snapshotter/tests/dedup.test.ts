import { describe, expect, it } from 'vitest';

import { createDesignSnapshotter, sha256 } from '../src/index.js';
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
const TENANT = 'tenant-a';

function setup(opts: { bytes?: Uint8Array } = {}) {
  const pg = new FakePg();
  const blob = new FakeBlobStorage();
  const bytes = opts.bytes ?? makeAssetBytes('photo');
  pg.seedUxUpload({ id: 'u-1', tenant_id: TENANT });
  pg.seedUxUpload({ id: 'u-2', tenant_id: TENANT });
  const snap = createDesignSnapshotter({
    pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: TENANT,
    idGen: counterIdGen(), clock: frozenClock(),
    assetByteReader: async () => bytes,
  });
  return { pg, blob, snap, bytes };
}

describe('content-hash dedup', () => {
  it('uploads the blob on the first reference', async () => {
    const { blob, snap } = setup();
    await snap.snapshot({
      uxUploadId: 'u-1',
      design: makeDesign({ assets: [{ path: '/headshot.jpg', kind: 'image' }] }),
    });
    expect(blob.size()).toBe(1);
  });

  it('does NOT re-upload identical bytes across versions of the same upload', async () => {
    const { blob, snap } = setup();
    await snap.snapshot({
      uxUploadId: 'u-1',
      design: makeDesign({ assets: [{ path: '/headshot.jpg', kind: 'image' }] }),
    });
    const putsAfterV1 = blob.putCalls;
    await snap.snapshot({
      uxUploadId: 'u-1',
      design: makeDesign({ assets: [{ path: '/headshot.jpg', kind: 'image' }] }),
    });
    expect(blob.size()).toBe(1);
    expect(blob.dedupHits).toBeGreaterThanOrEqual(1);
    // put still happens (the adapter short-circuits internally), but only one blob is materialised.
    expect(blob.putCalls).toBeGreaterThan(putsAfterV1);
  });

  it('does NOT re-upload identical bytes across different ux_uploads (cross-version dedup spine)', async () => {
    const { blob, snap } = setup();
    await snap.snapshot({
      uxUploadId: 'u-1',
      design: makeDesign({ assets: [{ path: '/h.jpg', kind: 'image' }] }),
    });
    await snap.snapshot({
      uxUploadId: 'u-2',
      design: makeDesign({ assets: [{ path: '/h.jpg', kind: 'image' }] }),
    });
    expect(blob.size()).toBe(1);
    expect(blob.dedupHits).toBeGreaterThanOrEqual(1);
  });

  it('inserts one design_assets row per (designVersionId, path) reference', async () => {
    const { pg, snap } = setup();
    await snap.snapshot({
      uxUploadId: 'u-1',
      design: makeDesign({ assets: [{ path: '/h.jpg', kind: 'image' }] }),
    });
    await snap.snapshot({
      uxUploadId: 'u-1',
      design: makeDesign({ assets: [{ path: '/h.jpg', kind: 'image' }] }),
    });
    expect(pg.designAssets.length).toBe(2);
    expect(pg.designAssets.map((r) => r.content_hash).every((h) => h === pg.designAssets[0]!.content_hash)).toBe(true);
  });

  it('different bytes produce different SHAs and different blobs', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    pg.seedUxUpload({ id: 'u', tenant_id: TENANT });
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: TENANT,
      idGen: counterIdGen(), clock: frozenClock(),
      assetByteReader: async (a) => makeAssetBytes(a.path),
    });
    await snap.snapshot({
      uxUploadId: 'u',
      design: makeDesign({ assets: [
        { path: '/a.jpg', kind: 'image' },
        { path: '/b.jpg', kind: 'image' },
      ] }),
    });
    expect(blob.size()).toBe(2);
  });

  it('content_hash matches sha256() applied to the input bytes', async () => {
    const bytes = makeAssetBytes('photo');
    const expected = sha256(bytes);
    const { pg, snap } = setup({ bytes });
    await snap.snapshot({
      uxUploadId: 'u-1',
      design: makeDesign({ assets: [{ path: '/h.jpg', kind: 'image' }] }),
    });
    expect(pg.designAssets[0]!.content_hash).toBe(expected);
  });

  it('throws asset_bytes_missing when no assetByteReader is provided', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    pg.seedUxUpload({ id: 'u', tenant_id: TENANT });
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: TENANT,
      idGen: counterIdGen(), clock: frozenClock(),
      // no assetByteReader
    });
    await expect(
      snap.snapshot({
        uxUploadId: 'u',
        design: makeDesign({ assets: [{ path: '/h.jpg', kind: 'image' }] }),
      }),
    ).rejects.toMatchObject({ code: 'asset_bytes_missing' });
  });

  it('skips asset upload when the design already carries storageUrl + contentHash', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    pg.seedUxUpload({ id: 'u', tenant_id: TENANT });
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: TENANT,
      idGen: counterIdGen(), clock: frozenClock(),
    });
    await snap.snapshot({
      uxUploadId: 'u',
      design: makeDesign({ assets: [
        { path: '/h.jpg', kind: 'image', contentHash: 'sha256:abc', storageUrl: 's3://b/x', byteSize: 5 },
      ] }),
    });
    expect(blob.putCalls).toBe(0);
    expect(pg.designAssets[0]!.storage_url).toBe('s3://b/x');
  });
});
