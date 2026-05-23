/**
 * Read APIs — `getSnapshot`, `listVersions`, `getDiff`.
 *
 * These are pure-read; no mutation. All three accept opaque IDs (UUIDs) and
 * return the persisted shape verbatim — including the JSONB columns, which
 * we re-parse if the driver returns them as strings.
 */

import { emptyDiff } from './diff.js';
import { assertSafeSchemaName, q } from './sql.js';
import {
  type Diff,
  type DiffSummary,
  type PgQueryable,
  type RenderableDesign,
  SnapshotterError,
} from './types.js';

export interface ReadDeps {
  pg: PgQueryable;
  schema: string;
}

export async function getSnapshot(designVersionId: string, deps: ReadDeps): Promise<RenderableDesign> {
  assertSafeSchemaName(deps.schema);
  const res = await deps.pg.query<{ rendered_design: unknown }>(
    `SELECT rendered_design
       FROM ${q(deps.schema, 'design_versions')}
      WHERE id = $1
      LIMIT 1`,
    [designVersionId],
  );
  const row = res.rows[0];
  if (!row) {
    throw new SnapshotterError('design_version_not_found', `design_versions.id=${designVersionId}`);
  }
  const design = parseJsonbColumn(row.rendered_design);
  if (!design) {
    throw new SnapshotterError('design_version_not_found', `design_versions.id=${designVersionId} has no rendered_design`);
  }
  return design as RenderableDesign;
}

export async function listVersions(
  uxUploadId: string,
  deps: ReadDeps,
): Promise<Array<{
  designVersionId: string;
  versionNumber: number;
  parentVersionId: string | null;
  createdAt: Date;
  diffSummary: DiffSummary | null;
  notes: string | null;
}>> {
  assertSafeSchemaName(deps.schema);
  const res = await deps.pg.query<{
    id: string;
    version_number: number;
    parent_version_id: string | null;
    created_at: Date | string;
    diff_summary: unknown;
    notes: string | null;
  }>(
    `SELECT id, version_number, parent_version_id, created_at, diff_summary, notes
       FROM ${q(deps.schema, 'design_versions')}
      WHERE ux_upload_id = $1
   ORDER BY version_number DESC`,
    [uxUploadId],
  );
  return res.rows.map((r) => ({
    designVersionId: r.id,
    versionNumber: r.version_number,
    parentVersionId: r.parent_version_id,
    createdAt: typeof r.created_at === 'string' ? new Date(r.created_at) : r.created_at,
    diffSummary: parseJsonbColumn(r.diff_summary) as DiffSummary | null,
    notes: r.notes,
  }));
}

/**
 * Returns the diff between two arbitrary design versions. If `from` is the
 * direct parent of `to`, returns the persisted `diff_from_parent` (cheap).
 * Otherwise re-runs `diffDesigns` on the two payloads (expensive — only
 * happens when the dashboard asks for a non-adjacent comparison).
 */
export async function getDiff(
  fromVersionId: string,
  toVersionId: string,
  deps: ReadDeps & { diffDesigns: (a: RenderableDesign, b: RenderableDesign) => Diff },
): Promise<Diff> {
  assertSafeSchemaName(deps.schema);
  if (fromVersionId === toVersionId) return emptyDiff();

  // Fast path: `to`'s parent IS `from`. Pull the persisted diff.
  const toRow = await loadVersionRow(toVersionId, deps);
  if (!toRow) {
    throw new SnapshotterError('design_version_not_found', `to=${toVersionId}`);
  }
  if (toRow.parent_version_id === fromVersionId && toRow.diff_from_parent) {
    const persisted = parseJsonbColumn(toRow.diff_from_parent) as Diff | null;
    if (persisted) return persisted;
  }

  // Slow path: pull both payloads, recompute.
  const fromRow = await loadVersionRow(fromVersionId, deps);
  if (!fromRow) {
    throw new SnapshotterError('design_version_not_found', `from=${fromVersionId}`);
  }
  const fromDesign = parseJsonbColumn(fromRow.rendered_design) as RenderableDesign | null;
  const toDesign = parseJsonbColumn(toRow.rendered_design) as RenderableDesign | null;
  if (!fromDesign || !toDesign) {
    throw new SnapshotterError('design_version_not_found', 'rendered_design missing on one of the two versions');
  }
  return deps.diffDesigns(fromDesign, toDesign);
}

interface VersionRow {
  id: string;
  parent_version_id: string | null;
  diff_from_parent: unknown;
  rendered_design: unknown;
}

async function loadVersionRow(id: string, deps: ReadDeps): Promise<VersionRow | null> {
  const res = await deps.pg.query<VersionRow>(
    `SELECT id, parent_version_id, diff_from_parent, rendered_design
       FROM ${q(deps.schema, 'design_versions')}
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  return res.rows[0] ?? null;
}

function parseJsonbColumn(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}
