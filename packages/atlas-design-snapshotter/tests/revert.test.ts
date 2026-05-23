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

describe('revertToVersion — Time Machine primitive', () => {
  it('creates v(N+1) whose content equals v(target)', async () => {
    const { snap } = setup();
    const v1Design = makeDesign();
    await snap.snapshot({ uxUploadId: 'upload-1', design: v1Design });
    await snap.snapshot({
      uxUploadId: 'upload-1',
      design: makeDesign({ designTokens: { colors: { '--brand': '#999' } } }),
    });
    const reverted = await snap.revertToVersion({ uxUploadId: 'upload-1', versionNumber: 1 });
    expect(reverted.versionNumber).toBe(3);
    const restored = await snap.getSnapshot(reverted.id);
    expect(restored.designTokens?.colors?.['--brand']).toBe('#222');
  });

  it('does NOT mutate the targeted prior row', async () => {
    const { pg, snap } = setup();
    const v1 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const v1RowBefore = JSON.stringify(pg.designVersions[0]);
    await snap.revertToVersion({ uxUploadId: 'upload-1', versionNumber: 1 });
    const v1RowAfter = JSON.stringify(pg.designVersions.find((r) => r.id === v1.id));
    expect(v1RowAfter).toBe(v1RowBefore);
  });

  it('records the parent as the CURRENT latest, not the target', async () => {
    const { snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const v2 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const reverted = await snap.revertToVersion({ uxUploadId: 'upload-1', versionNumber: 1 });
    expect(reverted.parentVersionId).toBe(v2.id);
  });

  it('default notes mention the target version', async () => {
    const { snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const reverted = await snap.revertToVersion({ uxUploadId: 'upload-1', versionNumber: 1 });
    expect(reverted.notes).toMatch(/Revert to v1/);
  });

  it('honours explicit notes on revert', async () => {
    const { snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const reverted = await snap.revertToVersion({
      uxUploadId: 'upload-1',
      versionNumber: 1,
      notes: 'rollback per ticket SUP-91',
    });
    expect(reverted.notes).toBe('rollback per ticket SUP-91');
  });

  it('throws invalid_revert_target for a non-existent version_number', async () => {
    const { snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    await expect(
      snap.revertToVersion({ uxUploadId: 'upload-1', versionNumber: 99 }),
    ).rejects.toBeInstanceOf(SnapshotterError);
  });

  it('rejects a non-integer versionNumber', async () => {
    const { snap } = setup();
    await expect(
      snap.revertToVersion({ uxUploadId: 'upload-1', versionNumber: 1.5 }),
    ).rejects.toBeInstanceOf(SnapshotterError);
  });

  it('rejects a versionNumber < 1', async () => {
    const { snap } = setup();
    await expect(
      snap.revertToVersion({ uxUploadId: 'upload-1', versionNumber: 0 }),
    ).rejects.toBeInstanceOf(SnapshotterError);
  });

  it('after revert, ux_uploads.rendered_design carries the reverted payload', async () => {
    const { pg, snap } = setup();
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    await snap.snapshot({
      uxUploadId: 'upload-1',
      design: makeDesign({ designTokens: { colors: { '--brand': '#999' } } }),
    });
    await snap.revertToVersion({ uxUploadId: 'upload-1', versionNumber: 1 });
    const stored = JSON.parse(pg.uxUploads.get('upload-1')!.rendered_design as string);
    expect(stored.designTokens.colors['--brand']).toBe('#222');
  });
});
