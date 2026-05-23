import { describe, expect, it } from 'vitest';

import { createDesignSnapshotter, emptyDiff, summarise } from '../src/index.js';
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

describe('diff-from-parent', () => {
  it('summarises an empty diff with all-zero counts', () => {
    const s = summarise(emptyDiff());
    expect(s.addedCount).toBe(0);
    expect(s.modifiedCount).toBe(0);
    expect(s.reasonCounts.attrs_changed).toBe(0);
  });

  it('counts every reason on every modified entry', () => {
    const s = summarise({
      added: [],
      removed: [],
      modified: [
        { domId: 'a', reasons: ['attrs_changed', 'copy_changed'] },
        { domId: 'b', reasons: ['copy_changed'] },
      ],
    });
    expect(s.reasonCounts.attrs_changed).toBe(1);
    expect(s.reasonCounts.copy_changed).toBe(2);
  });

  it('ignores unknown reasons (forward-compatible)', () => {
    const s = summarise({
      added: [],
      removed: [],
      modified: [{ domId: 'a', reasons: ['something_new' as any] }],
    });
    expect(s.modifiedCount).toBe(1);
    expect(Object.values(s.reasonCounts).every((n) => n === 0)).toBe(true);
  });

  it('persists the full diff on v2 and exposes it via getDiff(v1, v2)', async () => {
    const { snap } = setup();
    const v1 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const v2 = await snap.snapshot({
      uxUploadId: 'upload-1',
      design: makeDesign({
        componentTrees: {
          home: {
            rootDomId: 'page-home',
            node: {
              domId: 'page-home',
              tag: 'main',
              role: 'page',
              children: [
                { domId: 'page-home>section-newhero', tag: 'section', role: 'section' },
              ],
            },
          },
        },
      }),
    });
    const diff = await snap.getDiff(v1.id, v2.id);
    expect(diff.added.some((e) => e.domId === 'page-home>section-newhero')).toBe(true);
    expect(diff.removed.some((e) => e.domId === 'page-home>section-hero')).toBe(true);
  });

  it('getDiff between non-adjacent versions falls back to recompute', async () => {
    const { snap } = setup();
    const v1 = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const v3 = await snap.snapshot({
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
    const diff = await snap.getDiff(v1.id, v3.id);
    expect(diff.removed.length).toBeGreaterThan(0);
  });

  it('getDiff between identical versions returns empty', async () => {
    const { snap } = setup();
    const v = await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    const diff = await snap.getDiff(v.id, v.id);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
  });

  it('wraps a thrown diffDesigns in SnapshotterError diff_failed', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    pg.seedUxUpload({ id: 'upload-1', tenant_id: TENANT });
    const snap = createDesignSnapshotter({
      pg,
      blobStorage: blob,
      diffDesigns: () => { throw new Error('boom'); },
      schema: SCHEMA,
      tenantId: TENANT,
      idGen: counterIdGen(),
      clock: frozenClock(),
    });
    await snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() });
    await expect(
      snap.snapshot({ uxUploadId: 'upload-1', design: makeDesign() }),
    ).rejects.toMatchObject({ code: 'diff_failed' });
  });
});
