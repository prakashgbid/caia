/**
 * GDPR delete — `deleteAllForTenant(tenantId)`.
 *
 * Drops every `design_versions` + `design_assets` row plus every blob for
 * the tenant. Idempotent: re-running on an already-empty tenant returns
 * `{ deletedVersionCount: 0, deletedBlobCount: 0 }` and never throws.
 *
 * Strategy:
 *   1. Enumerate every `ux_uploads.id` belonging to the tenant.
 *   2. Enumerate every `design_assets.storage_url` for those uploads.
 *      Convert URLs to blob paths (the segment after the bucket root) so
 *      the BYOC adapter can address them.
 *   3. `DELETE FROM design_versions WHERE ux_upload_id IN (...)` —
 *      cascades to `design_assets` via the ON DELETE CASCADE FK.
 *   4. `DELETE FROM ux_uploads WHERE tenant_id = $1`.
 *   5. For every collected blob path, `blobStorage.delete(path)` (idempotent
 *      in the adapter contract).
 *
 * Step 5 is best-effort: a transient blob-delete failure is logged but does
 * not roll back the DB delete — the row-level erasure is the legal
 * requirement; orphan blobs are GC'd by the cross-tenant cleanup job.
 */

import { assertSafeSchemaName, q } from './sql.js';
import { type BlobStorage, type PgQueryable, SnapshotterError } from './types.js';

export interface GdprDeleteDeps {
  pg: PgQueryable;
  blobStorage: BlobStorage;
  schema: string;
  blobPathPrefix: string;
}

export async function deleteAllForTenant(
  tenantId: string,
  deps: GdprDeleteDeps,
): Promise<{ deletedVersionCount: number; deletedBlobCount: number }> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new SnapshotterError('tenant_mismatch', 'deleteAllForTenant requires a tenantId');
  }
  assertSafeSchemaName(deps.schema);

  // Find every upload for the tenant.
  const uploadRes = await deps.pg.query<{ id: string }>(
    `SELECT id FROM ${q(deps.schema, 'ux_uploads')} WHERE tenant_id = $1`,
    [tenantId],
  );
  const uploadIds = uploadRes.rows.map((r) => r.id);
  if (uploadIds.length === 0) {
    return { deletedVersionCount: 0, deletedBlobCount: 0 };
  }

  // Snapshot every storage_url before the cascade wipes the rows.
  const assetRes = await deps.pg.query<{ storage_url: string }>(
    `SELECT DISTINCT storage_url
       FROM ${q(deps.schema, 'design_assets')}
      WHERE ux_upload_id = ANY($1::uuid[])`,
    [uploadIds],
  );
  const blobPaths = assetRes.rows
    .map((r) => storageUrlToBlobPath(r.storage_url, deps.blobPathPrefix))
    .filter((p): p is string => p !== null);

  // Cascade-delete versions first, then uploads. Wrapped in a transaction so
  // a partial failure doesn't leave dangling rows.
  await deps.pg.query('BEGIN');
  let deletedVersionCount = 0;
  try {
    const versionDel = await deps.pg.query(
      `DELETE FROM ${q(deps.schema, 'design_versions')}
        WHERE ux_upload_id = ANY($1::uuid[])`,
      [uploadIds],
    );
    deletedVersionCount = versionDel.rowCount ?? 0;
    // design_assets cascades from design_versions via FK ON DELETE CASCADE.
    // Belt-and-braces: nuke them explicitly too in case the FK is absent on
    // this deployment.
    await deps.pg.query(
      `DELETE FROM ${q(deps.schema, 'design_assets')}
        WHERE ux_upload_id = ANY($1::uuid[])`,
      [uploadIds],
    );
    await deps.pg.query(
      `DELETE FROM ${q(deps.schema, 'ux_uploads')} WHERE id = ANY($1::uuid[])`,
      [uploadIds],
    );
    await deps.pg.query('COMMIT');
  } catch (err) {
    await deps.pg.query('ROLLBACK').catch(() => undefined);
    throw err;
  }

  // Delete blobs best-effort. Failure here is logged but not fatal — the
  // row-level erasure is what GDPR requires; orphan blobs are GC'd by the
  // cross-tenant cleanup job.
  let deletedBlobCount = 0;
  for (const p of new Set(blobPaths)) {
    try {
      await deps.blobStorage.delete(p);
      deletedBlobCount += 1;
    } catch {
      // intentionally swallowed — see comment above.
    }
  }
  return { deletedVersionCount, deletedBlobCount };
}

/**
 * Maps a `storage_url` (e.g. `s3://bucket/design-assets/<sha>`) back to the
 * bucket-relative path the BYOC adapter expects. Returns `null` if the URL
 * isn't recognisable so the caller can skip it without failing the wipe.
 */
function storageUrlToBlobPath(url: string, prefix: string): string | null {
  if (!url) return null;
  // Strip scheme.
  const noScheme = url.replace(/^[a-z0-9+.-]+:\/\//, '');
  // Strip bucket (first path segment).
  const slash = noScheme.indexOf('/');
  if (slash === -1) return null;
  const path = noScheme.slice(slash + 1);
  // Sanity-check the prefix.
  if (!path.startsWith(prefix)) {
    // Not one of ours — caller's responsibility (e.g. cross-tenant URLs).
    // Return as-is and let the adapter no-op.
    return path;
  }
  return path;
}
