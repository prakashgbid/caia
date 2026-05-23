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
    pg,
    blobStorage: blob,
    diffDesigns: fakeDiff,
    schema: SCHEMA,
    tenantId: TENANT,
    idGen: counterIdGen(),
    clock: frozenClock(),
  });
  pg.seedUxUpload({ id: 'upload-1', tenant_id: TENANT });
  return { pg, blob, snap };
}

describe('snapshot — first version (v1)', () => {
  it('creates a row with version_number=1 and no parent', async () => {
    const { pg, snap } = setup();
    const row = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    expect(row.versionNumber).toBe(1);
    expect(row.parentVersionId).toBeNull();
    expect(pg.designVersions).toHaveLength(1);
    expect(pg.designVersions[0]!.version_number).toBe(1);
  });

  it('persists rendered_design as a JSON-serialisable column', async () => {
    const { pg, snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const stored = pg.designVersions[0]!.rendered_design;
    expect(typeof stored).toBe('string');
    const parsed = JSON.parse(stored as string);
    expect(parsed.routes[0].path).toBe('/');
  });

  it('stamps the new designVersionId into the persisted design payload', async () => {
    const { pg, snap } = setup();
    const row = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const stored = JSON.parse(pg.designVersions[0]!.rendered_design as string);
    expect(stored.designVersionId).toBe(row.id);
  });

  it('writes diff_from_parent=NULL for v1 (no parent)', async () => {
    const { pg, snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    expect(pg.designVersions[0]!.diff_from_parent).toBeNull();
  });

  it('still writes a non-null diff_summary for v1 (zero counts)', async () => {
    const { pg, snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const summary = JSON.parse(pg.designVersions[0]!.diff_summary as string);
    expect(summary.addedCount).toBe(0);
    expect(summary.removedCount).toBe(0);
    expect(summary.modifiedCount).toBe(0);
  });

  it('flips ux_uploads.status to "parsed" and stores the latest design', async () => {
    const { pg, snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const upload = pg.uxUploads.get('upload-1');
    expect(upload?.status).toBe('parsed');
    expect(upload?.rendered_design).toBeTruthy();
  });

  it('honours an explicit notes message', async () => {
    const { pg, snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign(), notes: 'initial' });
    expect(pg.designVersions[0]!.notes).toBe('initial');
  });

  it('throws invalid_renderable_design when componentTrees is missing', async () => {
    const { snap } = setup();
    await expect(
      snap.snapshot({ uxUploadId: 'upload-1', design: { routes: [] } as any }),
    ).rejects.toBeInstanceOf(SnapshotterError);
  });

  it('throws invalid_renderable_design when routes is missing', async () => {
    const { snap } = setup();
    await expect(
      snap.snapshot({ uxUploadId: 'upload-1', design: { componentTrees: {} } as any }),
    ).rejects.toBeInstanceOf(SnapshotterError);
  });

  it('rejects an empty uxUploadId', async () => {
    const { snap } = setup();
    await expect(
      snap.snapshot({ uxUploadId: '', design: makeDesign() }),
    ).rejects.toBeInstanceOf(SnapshotterError);
  });
});

describe('snapshot — parent linkage (v2, v3, ...)', () => {
  it('v2 links parent_version_id to v1', async () => {
    const { pg, snap } = setup();
    const v1 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const v2 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    expect(v2.versionNumber).toBe(2);
    expect(v2.parentVersionId).toBe(v1.id);
    expect(pg.designVersions).toHaveLength(2);
  });

  it('v3 links parent_version_id to v2', async () => {
    const { snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const v2 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const v3 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    expect(v3.versionNumber).toBe(3);
    expect(v3.parentVersionId).toBe(v2.id);
  });

  it('different ux_uploads have independent version numbering', async () => {
    const { pg, snap } = setup();
    pg.seedUxUpload({ id: 'upload-2', tenant_id: TENANT });
    const aV1 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const bV1 = await snap.snapshot({ uxUploadId: 'upload-2', design: makeDesign() });
    expect(aV1.versionNumber).toBe(1);
    expect(bV1.versionNumber).toBe(1);
    expect(aV1.parentVersionId).toBeNull();
    expect(bV1.parentVersionId).toBeNull();
  });

  it('persists diff_from_parent on v2 onwards', async () => {
    const { pg, snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    await snap.snapshot({
      uxUploadId: 'upload-1',
      design: makeDesign({
        componentTrees: {
          home: {
            rootDomId: 'page-home',
            node: { domId: 'page-home', tag: 'main', role: 'page', children: [] },
          },
        },
      }),
    });
    const v2 = pg.designVersions[1]!;
    const diff = JSON.parse(v2.diff_from_parent as string);
    // The hero section + headline were removed in the v2 design.
    expect(diff.removed.length).toBeGreaterThan(0);
  });
});
