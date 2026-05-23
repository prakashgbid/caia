/**
 * Snapshot capture — the write-path for the snapshotter.
 *
 * Lifecycle of one snapshot:
 *
 *   1. Load the prior version (if any) for the same ux_upload_id.
 *   2. Upload every asset whose `storageUrl` is empty. Content-hash dedup:
 *      `head()` the target path; on hit, skip upload but still record the
 *      design_assets row. On miss, `put()` and record.
 *   3. Insert a `design_versions` row with `version_number = prior + 1`,
 *      `parent_version_id` = prior.id (or NULL for v1), and a snapshot of the
 *      `RenderableDesign` (assets list now carries `storageUrl`).
 *   4. Compute diff-from-parent via the injected `diffDesigns`. Persist into
 *      `diff_from_parent` and `diff_summary`.
 *
 * Everything happens in a single Postgres transaction so a mid-flight failure
 * leaves no half-committed `design_versions` row.
 */

import { sha256 } from './content-hash.js';
import { emptyDiff, summarise } from './diff.js';
import { assertSafeSchemaName, q } from './sql.js';
import {
  type AssetByteReader,
  type BlobStorage,
  type DesignVersionRow,
  type Diff,
  type DiffDesignsFn,
  type DiffSummary,
  type PgQueryable,
  type RenderableAsset,
  type RenderableDesign,
  SnapshotterError,
  type SnapshotInput,
} from './types.js';

export interface CaptureDeps {
  pg: PgQueryable;
  blobStorage: BlobStorage;
  diffDesigns: DiffDesignsFn;
  schema: string;
  blobPathPrefix: string;
  assetByteReader?: AssetByteReader;
  idGen: () => string;
  clock: () => Date;
}

export async function captureSnapshot(
  input: SnapshotInput,
  deps: CaptureDeps,
): Promise<DesignVersionRow> {
  validateInput(input);
  assertSafeSchemaName(deps.schema);

  const prior = await loadPriorVersion(input.uxUploadId, deps);
  const versionNumber = prior ? prior.versionNumber + 1 : 1;
  const parentVersionId = prior?.id ?? null;
  const newVersionId = deps.idGen();
  const createdAt = deps.clock();

  // 1. Materialise the design with storageUrls populated for every asset.
  const materialised = await materialiseAssets({
    design: input.design,
    blobStorage: deps.blobStorage,
    blobPathPrefix: deps.blobPathPrefix,
    ...(deps.assetByteReader ? { assetByteReader: deps.assetByteReader } : {}),
  });

  // 2. Compute diff before insert so we can write it in one round-trip.
  let diff: Diff;
  let diffSummary: DiffSummary;
  if (prior) {
    try {
      diff = deps.diffDesigns(prior.renderableDesign!, materialised);
    } catch (err) {
      throw new SnapshotterError('diff_failed', 'diffDesigns threw', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    diffSummary = summarise(diff);
  } else {
    diff = emptyDiff();
    diffSummary = summarise(diff);
  }

  // 3. Stamp designVersionId into the snapshot itself so the persisted
  //    payload is self-describing. Atlas's iframe renderers rely on this.
  const stampedDesign: RenderableDesign = {
    ...materialised,
    designVersionId: newVersionId,
  };

  // 4. Persist everything in a transaction. Manual BEGIN/COMMIT because the
  //    `PgQueryable` shape is intentionally narrow.
  await deps.pg.query('BEGIN');
  try {
    await deps.pg.query(
      `INSERT INTO ${q(deps.schema, 'design_versions')}
         (id, ux_upload_id, version_number, parent_version_id, created_at,
          diff_from_parent, diff_summary, notes, rendered_design)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        newVersionId,
        input.uxUploadId,
        versionNumber,
        parentVersionId,
        createdAt,
        prior ? JSON.stringify(diff) : null,
        JSON.stringify(diffSummary),
        input.notes ?? null,
        JSON.stringify(stampedDesign),
      ],
    );

    // Asset rows — one per logical path in the design, pointing at the
    // (possibly deduped) storage_url.
    for (const a of stampedDesign.assets ?? []) {
      if (!a.contentHash || !a.storageUrl) {
        // Defensive: materialiseAssets guarantees these but in case of a
        // mis-supplied placeholder asset we skip it rather than crash.
        if (a.isPlaceholder) continue;
        throw new SnapshotterError('asset_bytes_missing', 'Asset lacks contentHash/storageUrl after materialise', {
          path: a.path,
        });
      }
      await deps.pg.query(
        `INSERT INTO ${q(deps.schema, 'design_assets')}
           (id, ux_upload_id, design_version_id, path, kind, content_hash,
            storage_url, size_bytes, alt_text, intrinsic_w, intrinsic_h, is_placeholder)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (design_version_id, path) DO NOTHING`,
        [
          deps.idGen(),
          input.uxUploadId,
          newVersionId,
          a.path,
          a.kind ?? 'image',
          a.contentHash,
          a.storageUrl,
          a.byteSize ?? 0,
          a.alt ?? null,
          a.intrinsicSize?.w ?? null,
          a.intrinsicSize?.h ?? null,
          a.isPlaceholder ?? false,
        ],
      );
    }

    // Mirror onto ux_uploads.rendered_design so the latest design is one
    // join away from the upload row (step5 §4 keeps this convenience copy).
    await deps.pg.query(
      `UPDATE ${q(deps.schema, 'ux_uploads')}
         SET rendered_design = $1, status = 'parsed'
       WHERE id = $2`,
      [JSON.stringify(stampedDesign), input.uxUploadId],
    );

    await deps.pg.query('COMMIT');
  } catch (err) {
    await deps.pg.query('ROLLBACK').catch(() => undefined);
    throw err;
  }

  return {
    id: newVersionId,
    uxUploadId: input.uxUploadId,
    versionNumber,
    parentVersionId,
    createdAt,
    diffFromParent: prior ? diff : null,
    diffSummary,
    notes: input.notes ?? null,
    renderableDesign: stampedDesign,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function validateInput(input: SnapshotInput): void {
  if (!input.uxUploadId || typeof input.uxUploadId !== 'string') {
    throw new SnapshotterError('invalid_renderable_design', 'snapshot requires uxUploadId');
  }
  if (!input.design || typeof input.design !== 'object') {
    throw new SnapshotterError('invalid_renderable_design', 'snapshot requires design payload');
  }
  if (!input.design.componentTrees || typeof input.design.componentTrees !== 'object') {
    throw new SnapshotterError('invalid_renderable_design', 'design.componentTrees is required');
  }
  if (!Array.isArray(input.design.routes)) {
    throw new SnapshotterError('invalid_renderable_design', 'design.routes is required');
  }
}

interface PriorVersion {
  id: string;
  versionNumber: number;
  renderableDesign: RenderableDesign;
}

async function loadPriorVersion(
  uxUploadId: string,
  deps: CaptureDeps,
): Promise<PriorVersion | null> {
  const res = await deps.pg.query<{ id: string; version_number: number; rendered_design: unknown }>(
    `SELECT id, version_number, rendered_design
       FROM ${q(deps.schema, 'design_versions')}
      WHERE ux_upload_id = $1
   ORDER BY version_number DESC
      LIMIT 1`,
    [uxUploadId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const design = parseJsonbColumn(row.rendered_design);
  if (!design) {
    throw new SnapshotterError('invalid_renderable_design', 'prior version is missing rendered_design', {
      designVersionId: row.id,
    });
  }
  return {
    id: row.id,
    versionNumber: row.version_number,
    renderableDesign: design as RenderableDesign,
  };
}

/**
 * Walk the design's `assets[]` and ensure every entry has a `contentHash` +
 * `storageUrl`. Uploads bytes via the BYOC adapter, with `head()`-based dedup
 * keyed on the SHA path.
 */
async function materialiseAssets(args: {
  design: RenderableDesign;
  blobStorage: BlobStorage;
  blobPathPrefix: string;
  assetByteReader?: AssetByteReader;
}): Promise<RenderableDesign> {
  const out: RenderableAsset[] = [];
  for (const asset of args.design.assets ?? []) {
    out.push(await materialiseAsset(asset, args));
  }
  return { ...args.design, assets: out };
}

async function materialiseAsset(
  asset: RenderableAsset,
  args: {
    blobStorage: BlobStorage;
    blobPathPrefix: string;
    assetByteReader?: AssetByteReader;
  },
): Promise<RenderableAsset> {
  // Already-stored asset: trust its storageUrl/contentHash and pass through.
  if (asset.storageUrl && asset.contentHash) {
    return asset;
  }
  if (asset.isPlaceholder) {
    // Placeholder assets carry no bytes; record only.
    return {
      ...asset,
      contentHash: asset.contentHash ?? 'sha256:placeholder',
      storageUrl: asset.storageUrl ?? '',
    };
  }
  if (!args.assetByteReader) {
    throw new SnapshotterError(
      'asset_bytes_missing',
      `Asset ${asset.path} has no storageUrl and no assetByteReader was provided`,
      { path: asset.path },
    );
  }
  const bytes = await args.assetByteReader(asset);
  const contentHash = asset.contentHash ?? sha256(bytes);
  const blobPath = `${args.blobPathPrefix}/${stripShaPrefix(contentHash)}`;

  const head = await args.blobStorage.head(blobPath);
  let storageUrl: string;
  if (head.exists) {
    // Dedup hit. We still trust the existing blob — `head` returns the
    // adapter's recorded URL via the `put` short-circuit below.
    const put = await args.blobStorage.put({
      path: blobPath,
      bytes,
      contentHash,
      ...(asset.kind ? { contentType: kindToMime(asset.kind) } : {}),
    });
    storageUrl = put.storageUrl;
  } else {
    const put = await args.blobStorage.put({
      path: blobPath,
      bytes,
      contentHash,
      ...(asset.kind ? { contentType: kindToMime(asset.kind) } : {}),
    });
    storageUrl = put.storageUrl;
  }
  return {
    ...asset,
    contentHash,
    byteSize: asset.byteSize ?? bytes.byteLength,
    storageUrl,
  };
}

function stripShaPrefix(h: string): string {
  return h.startsWith('sha256:') ? h.slice('sha256:'.length) : h;
}

function kindToMime(kind: string): string {
  switch (kind) {
    case 'image':
      return 'image/octet-stream';
    case 'svg':
      return 'image/svg+xml';
    case 'font':
      return 'font/otf';
    case 'video':
      return 'video/mp4';
    case 'icon':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

/**
 * node-postgres returns `JSONB` columns as already-parsed objects. Some
 * fake clients (and migrations) return strings instead. Accept both.
 */
function parseJsonbColumn(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}
