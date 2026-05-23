import { describe, expect, it } from 'vitest';

import { createDesignSnapshotter, SnapshotterError } from '../src/index.js';
import {
  FakeBlobStorage,
  FakePg,
  counterIdGen,
  fakeDiff,
  frozenClock,
  makeDesign,
} from './fakes.js';

const SCHEMA = 'caia_test';
const TENANT = 'tenant-a';

function setup() {
  const pg = new FakePg();
  const blob = new FakeBlobStorage();
  const snap = createDesignSnapshotter({
    pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: TENANT,
    idGen: counterIdGen(), clock: frozenClock(),
  });
  pg.seedUxUpload({ id: 'upload-1', tenant_id: TENANT });
  return { pg, blob, snap };
}

describe('read APIs', () => {
  describe('getSnapshot', () => {
    it('returns the persisted RenderableDesign', async () => {
      const { snap } = setup();
      const v1 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      const got = await snap.getSnapshot(v1.id);
      expect(got.routes[0]!.path).toBe('/');
    });

    it('roundtrips the stamped designVersionId', async () => {
      const { snap } = setup();
      const v = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      const got = await snap.getSnapshot(v.id);
      expect(got.designVersionId).toBe(v.id);
    });

    it('throws design_version_not_found for an unknown id', async () => {
      const { snap } = setup();
      await expect(snap.getSnapshot('does-not-exist')).rejects.toBeInstanceOf(SnapshotterError);
    });
  });

  describe('listVersions', () => {
    it('returns versions newest-first', async () => {
      const { snap } = setup();
      await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      const list = await snap.listVersions('upload-1');
      expect(list.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    });

    it('returns empty for a brand-new upload', async () => {
      const { snap } = setup();
      const list = await snap.listVersions('upload-1');
      expect(list).toEqual([]);
    });

    it('exposes the diff_summary jsonb', async () => {
      const { snap } = setup();
      await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      const list = await snap.listVersions('upload-1');
      expect(list[0]!.diffSummary).toBeTruthy();
      expect(list[0]!.diffSummary!.modifiedCount).toBe(0);
    });

    it('exposes parentVersionId per row', async () => {
      const { snap } = setup();
      const v1 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      const list = await snap.listVersions('upload-1');
      expect(list.find((v) => v.versionNumber === 2)!.parentVersionId).toBe(v1.id);
      expect(list.find((v) => v.versionNumber === 1)!.parentVersionId).toBeNull();
    });
  });

  describe('getDiff', () => {
    it('throws design_version_not_found when an id is missing', async () => {
      const { snap } = setup();
      await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
      await expect(snap.getDiff('missing-1', 'missing-2')).rejects.toBeInstanceOf(SnapshotterError);
    });
  });
});
