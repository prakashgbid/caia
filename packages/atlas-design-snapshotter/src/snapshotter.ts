/**
 * `createDesignSnapshotter` — the public entry point.
 *
 * Returns a `DesignSnapshotter` that wires the capture / revert / GDPR /
 * read modules around a common set of injected dependencies. Construction
 * never touches the network and never throws on missing data — it just
 * builds a closure. The first `await` from any method is when DB or blob
 * I/O happens.
 */

import { randomUUID } from 'node:crypto';

import { captureSnapshot } from './capture.js';
import { deleteAllForTenant } from './gdpr.js';
import { getDiff, getSnapshot, listVersions } from './read.js';
import { revertToVersion } from './revert.js';
import { assertSafeSchemaName } from './sql.js';
import {
  type DesignSnapshotter,
  type SnapshotterOptions,
} from './types.js';

export function createDesignSnapshotter(opts: SnapshotterOptions): DesignSnapshotter {
  assertSafeSchemaName(opts.schema);

  const idGen = opts.idGen ?? (() => randomUUID());
  const clock = opts.clock ?? (() => new Date());
  const blobPathPrefix = opts.blobPathPrefix ?? 'design-assets';

  const captureDeps = {
    pg: opts.pg,
    blobStorage: opts.blobStorage,
    diffDesigns: opts.diffDesigns,
    schema: opts.schema,
    blobPathPrefix,
    ...(opts.assetByteReader ? { assetByteReader: opts.assetByteReader } : {}),
    idGen,
    clock,
  } as const;

  const readDeps = {
    pg: opts.pg,
    schema: opts.schema,
  };

  return {
    snapshot: (input) => captureSnapshot(input, captureDeps),
    revertToVersion: (input) => revertToVersion(input, captureDeps),
    deleteAllForTenant: (tenantId) =>
      deleteAllForTenant(tenantId, {
        pg: opts.pg,
        blobStorage: opts.blobStorage,
        schema: opts.schema,
        blobPathPrefix,
      }),
    getSnapshot: (designVersionId) => getSnapshot(designVersionId, readDeps),
    listVersions: (uxUploadId) => listVersions(uxUploadId, readDeps),
    getDiff: (fromVersionId, toVersionId) =>
      getDiff(fromVersionId, toVersionId, {
        ...readDeps,
        diffDesigns: opts.diffDesigns,
      }),
  };
}
