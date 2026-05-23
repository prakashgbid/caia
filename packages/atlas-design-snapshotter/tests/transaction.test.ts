/**
 * Transaction semantics — snapshot must roll back cleanly if any of the
 * mid-flight DML fails. Asserted via FakePg's BEGIN/COMMIT/ROLLBACK counters.
 */

import { describe, expect, it } from 'vitest';

import { createDesignSnapshotter } from '../src/index.js';
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

describe('transactional semantics', () => {
  it('happy path COMMITs exactly once', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    pg.seedUxUpload({ id: 'u', tenant_id: TENANT });
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: TENANT,
      idGen: counterIdGen(), clock: frozenClock(),
    });
    await snap.snapshot({ uxUploadId: 'u', design: makeDesign() });
    expect(pg.committedAt).toBe(1);
    expect(pg.rolledBack).toBe(0);
    expect(pg.txDepth).toBe(0);
  });

  it('rolls back when an INSERT mid-flight throws', async () => {
    const pg = new FakePg();
    const blob = new FakeBlobStorage();
    pg.seedUxUpload({ id: 'u', tenant_id: TENANT });
    const snap = createDesignSnapshotter({
      pg, blobStorage: blob, diffDesigns: fakeDiff, schema: SCHEMA, tenantId: TENANT,
      idGen: counterIdGen(), clock: frozenClock(),
    });
    // Land a successful v1 first so loadPriorVersion has a row to return.
    await snap.snapshot({ uxUploadId: 'u', design: makeDesign() });
    // Now arm a failure that fires on the next non-control query (the v2 INSERT).
    pg.failNextInsert = new Error('FK violation simulated');
    await expect(
      snap.snapshot({ uxUploadId: 'u', design: makeDesign() }),
    ).rejects.toThrow();
    // v1 committed once before; v2 rolled back; v2's COMMIT never ran.
    expect(pg.rolledBack).toBe(1);
    expect(pg.committedAt).toBe(1);
    // No new design_versions row appeared from the failed snapshot.
    expect(pg.designVersions).toHaveLength(1);
  });
});
