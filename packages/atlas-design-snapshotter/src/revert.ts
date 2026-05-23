/**
 * Revert — the Time-Machine primitive.
 *
 * `revertToVersion(uxUploadId, versionNumber)` creates a new snapshot
 * v(N+1) whose content equals v(versionNumber). Restoration is always a
 * **forward** operation: we never mutate prior `design_versions` rows.
 *
 * This mirrors the SQL pattern from step5 spec §5.3 — INSERT a new row that
 * copies the target version's `rendered_design`, with the new row's
 * `parent_version_id` set to the current latest. The diff is computed from
 * the current-latest to the target (i.e. how the design will visibly change).
 */

import { captureSnapshot, type CaptureDeps } from './capture.js';
import { assertSafeSchemaName, q } from './sql.js';
import {
  type DesignVersionRow,
  type PgQueryable,
  type RenderableDesign,
  type RevertInput,
  SnapshotterError,
} from './types.js';

export async function revertToVersion(
  input: RevertInput,
  deps: CaptureDeps,
): Promise<DesignVersionRow> {
  assertSafeSchemaName(deps.schema);
  if (!input.uxUploadId || typeof input.uxUploadId !== 'string') {
    throw new SnapshotterError('invalid_revert_target', 'revertToVersion requires uxUploadId');
  }
  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new SnapshotterError('invalid_revert_target', 'versionNumber must be a positive integer', {
      versionNumber: input.versionNumber,
    });
  }

  const target = await loadVersion(input.uxUploadId, input.versionNumber, deps);
  if (!target) {
    throw new SnapshotterError(
      'invalid_revert_target',
      `No design_versions row for ux_upload_id=${input.uxUploadId} version_number=${input.versionNumber}`,
      { uxUploadId: input.uxUploadId, versionNumber: input.versionNumber },
    );
  }

  // Run captureSnapshot with the target design payload — this gives us
  //   - automatic version_number bump
  //   - automatic parent_version_id linkage
  //   - diff vs. *current* latest (not the target)
  //   - asset rows mirrored onto the new version
  //   - a refreshed ux_uploads.rendered_design
  // …all in one transaction, so we get the same audit trail as a fresh upload.
  //
  // The assets carry storageUrl already (they came from the prior persisted
  // version), so no blob uploads happen on revert — it's pure metadata.
  return captureSnapshot(
    {
      uxUploadId: input.uxUploadId,
      design: stripStaleVersionId(target.renderableDesign),
      notes: input.notes ?? `Revert to v${input.versionNumber}`,
    },
    deps,
  );
}

async function loadVersion(
  uxUploadId: string,
  versionNumber: number,
  deps: { pg: PgQueryable; schema: string },
): Promise<{ id: string; renderableDesign: RenderableDesign } | null> {
  const res = await deps.pg.query<{ id: string; rendered_design: unknown }>(
    `SELECT id, rendered_design
       FROM ${q(deps.schema, 'design_versions')}
      WHERE ux_upload_id = $1 AND version_number = $2
      LIMIT 1`,
    [uxUploadId, versionNumber],
  );
  const row = res.rows[0];
  if (!row) return null;
  const design = parseJsonbColumn(row.rendered_design);
  if (!design) {
    throw new SnapshotterError('invalid_revert_target', 'target version has no rendered_design', {
      designVersionId: row.id,
    });
  }
  return { id: row.id, renderableDesign: design as RenderableDesign };
}

function stripStaleVersionId(d: RenderableDesign): RenderableDesign {
  // captureSnapshot will stamp the new versionId; clear the old one so the
  // payload is self-consistent on disk.
  const { designVersionId: _ignored, ...rest } = d;
  return rest;
}

function parseJsonbColumn(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}
