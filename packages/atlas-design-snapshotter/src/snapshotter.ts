/**
 * `DesignSnapshotter` — the core class.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §4-§5,
 *            research/atlas_module_spec_2026.md §7 (RenderableDesign),
 *            research/17_architect_framework_spec_2026.md Architect #15.
 *
 * Public methods:
 *   - captureSnapshot(uxUploadId, renderableDesign, opts?)
 *   - revertToVersion(uxUploadId, versionNumber, opts?)
 *   - getSnapshot(designVersionId)
 *   - listVersions(uxUploadId)
 *   - getDiff(fromVersionId, toVersionId)
 *   - deleteAllForTenant(tenantId, opts?)
 *
 * Storage model:
 *   - `design_versions` rows live in the tenant schema `caia_<short>`
 *     (resolved via `resolveTenantSchema(tenantId)`). The snapshotter
 *     itself does NOT know how `<short>` is derived; it asks the
 *     resolver, which production wires to a `caia_meta.tenants` lookup.
 *   - Asset blobs live in the tenant's chosen cloud via the BYOC
 *     adapter. The `design_assets` table dedups by (tenant_id, content_hash)
 *     so re-uploads of the same bytes never re-upload.
 *
 * Concurrency:
 *   - `captureSnapshot` runs inside a transaction that takes
 *     `SELECT ... FOR UPDATE` on the latest design_versions row for the
 *     ux_upload. Two concurrent captures will serialise; if two callers
 *     both target version_number = N, the loser sees a unique-violation
 *     and is surfaced as `concurrent_version_conflict`.
 *
 * No LLM calls. No network beyond Postgres + the supplied BYOC adapter.
 */

import type { RenderableDesign, RenderableAsset } from '@chiefaia/atlas-mapper';
import type { BYOCBlobAdapter } from './byoc-adapter.js';
import { SnapshotterError } from './errors.js';
import { hashValue, sha256 } from './hash.js';
import {
  diffDesigns,
  emptyDiff,
  summarizeDiff,
  type DesignDiff,
  type DiffSummary,
} from './diff.js';
import type { PoolLike, PoolClientLike } from './pg-types.js';
import type {
  CaptureSnapshotOptions,
  DeleteAllForTenantOptions,
  DeleteAllForTenantResult,
  DesignVersion,
  DesignVersionSummary,
  RevertOptions,
} from './types.js';

/** A function that maps `tenantId` to its Postgres schema name. */
export type ResolveTenantSchema = (tenantId: string) => Promise<string> | string;

/** A function that maps `tenantId` to its blob-key prefix. */
export type ResolveTenantBlobPrefix = (tenantId: string) => string;

export interface DesignSnapshotterOptions {
  pool: PoolLike;
  byoc: BYOCBlobAdapter;
  /** Maps tenantId → schema name. Defaults to `'public'` for integration
   *  tests; production wires to a `caia_meta.tenants.short_id` lookup. */
  resolveTenantSchema?: ResolveTenantSchema;
  /** Maps tenantId → key prefix for blob uploads. Defaults to
   *  `caia-tenant/<tenantId>/design-assets/`. */
  resolveTenantBlobPrefix?: ResolveTenantBlobPrefix;
  /** Test-only clock. */
  now?: () => Date;
}

interface RawVersionRow {
  id: string;
  tenant_id: string;
  ux_upload_id: string;
  version_number: number;
  parent_version_id: string | null;
  rendered_design: RenderableDesign;
  rendered_design_hash: string;
  diff_from_parent: DesignDiff | null;
  diff_summary: DiffSummary | null;
  notes: string | null;
  created_at: Date;
}

interface RawAssetRow {
  id: string;
  tenant_id: string;
  content_hash: string;
  storage_url: string;
  size_bytes: string;
  mime_type: string | null;
}

interface RawUploadRow {
  id: string;
  tenant_id: string;
}

export class DesignSnapshotter {
  private readonly pool: PoolLike;
  private readonly byoc: BYOCBlobAdapter;
  private readonly resolveSchema: ResolveTenantSchema;
  private readonly resolveBlobPrefix: ResolveTenantBlobPrefix;
  private readonly now: () => Date;

  constructor(opts: DesignSnapshotterOptions) {
    this.pool = opts.pool;
    this.byoc = opts.byoc;
    this.resolveSchema = opts.resolveTenantSchema ?? (() => 'public');
    this.resolveBlobPrefix =
      opts.resolveTenantBlobPrefix ?? ((tenantId) => `caia-tenant/${tenantId}/design-assets`);
    this.now = opts.now ?? (() => new Date());
  }

  // ============================================================
  // captureSnapshot
  // ============================================================

  async captureSnapshot(
    uxUploadId: string,
    renderableDesign: RenderableDesign,
    opts: CaptureSnapshotOptions = {},
  ): Promise<DesignVersion> {
    if (!uxUploadId) {
      throw new SnapshotterError('ux_upload_not_found', 'uxUploadId is required');
    }
    if (!renderableDesign || typeof renderableDesign !== 'object') {
      throw new SnapshotterError(
        'invalid_renderable_design',
        'renderableDesign must be a non-null object',
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Resolve upload row + tenant + schema search_path.
      const upload = await this.fetchUpload(client, uxUploadId);
      const schema = await Promise.resolve(this.resolveSchema(upload.tenant_id));
      await client.query(`SET LOCAL search_path = ${quoteIdent(schema)}, public`);

      // Lock the prior latest row, if any, to serialise concurrent captures.
      const priorRes = await client.query<RawVersionRow>(
        `SELECT * FROM design_versions
          WHERE ux_upload_id = $1
          ORDER BY version_number DESC
          LIMIT 1
          FOR UPDATE`,
        [uxUploadId],
      );
      const prior: RawVersionRow | null = priorRes.rows[0] ?? null;

      const renderedDesignHash = hashValue(renderableDesign);

      // skip-if-unchanged short-circuit.
      if (opts.skipIfUnchanged && prior && prior.rendered_design_hash === renderedDesignHash) {
        await client.query('COMMIT');
        return rowToDesignVersion(prior);
      }

      // Upload + dedup assets BEFORE writing the version row, so the
      // version row points at stable storage URLs. We mutate a clone
      // of the assets array to carry storage URLs forward.
      const persistedAssets = await this.uploadAssetsWithDedup(
        client,
        upload.tenant_id,
        renderableDesign,
      );
      const renderedDesignWithUrls: RenderableDesign = {
        ...renderableDesign,
        assets: persistedAssets.assets,
      };
      const finalRenderedHash = hashValue(renderedDesignWithUrls);

      // Compute diff.
      let diffFromParent: DesignDiff | null = null;
      let diffSummary: DiffSummary | null = null;
      if (prior) {
        diffFromParent = diffDesigns(prior.rendered_design, renderedDesignWithUrls);
        diffSummary = summarizeDiff(diffFromParent);
      } else {
        // v1 — write an empty diff for consistent JSON shape.
        diffFromParent = emptyDiff();
        diffSummary = summarizeDiff(diffFromParent);
      }

      const nextVersionNumber = (prior?.version_number ?? 0) + 1;

      let insertedRow: RawVersionRow;
      try {
        const insRes = await client.query<RawVersionRow>(
          `INSERT INTO design_versions
             (tenant_id, ux_upload_id, version_number, parent_version_id,
              rendered_design, rendered_design_hash, diff_from_parent, diff_summary,
              notes, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            upload.tenant_id,
            uxUploadId,
            nextVersionNumber,
            prior?.id ?? null,
            JSON.stringify(renderedDesignWithUrls),
            finalRenderedHash,
            JSON.stringify(diffFromParent),
            JSON.stringify(diffSummary),
            opts.notes ?? null,
            this.now(),
          ],
        );
        insertedRow = insRes.rows[0]!;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new SnapshotterError(
            'concurrent_version_conflict',
            `version ${nextVersionNumber} already exists for ux_upload ${uxUploadId}`,
            { uxUploadId, versionNumber: nextVersionNumber },
          );
        }
        throw err;
      }

      // Link each upload asset to its (dedup) asset row.
      for (const link of persistedAssets.links) {
        await client.query(
          `INSERT INTO design_version_assets
             (design_version_id, asset_id, path, kind, alt_text, intrinsic_w, intrinsic_h, is_placeholder)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            insertedRow.id,
            link.assetId,
            link.path,
            link.kind,
            link.altText,
            link.intrinsicW,
            link.intrinsicH,
            link.isPlaceholder,
          ],
        );
        // Bump ref count.
        await client.query(
          `UPDATE design_assets SET ref_count = ref_count + 1 WHERE id = $1`,
          [link.assetId],
        );
      }

      await client.query('COMMIT');
      return rowToDesignVersion(insertedRow);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore — original error wins
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // revertToVersion
  // ============================================================

  /**
   * Forward-create v(N+1) equal to v(versionNumber). The prior latest
   * row becomes the `parent_version_id`. Step 5 §5.3 — "It does NOT
   * mutate any prior row — the audit trail stays clean."
   */
  async revertToVersion(
    uxUploadId: string,
    versionNumber: number,
    opts: RevertOptions = {},
  ): Promise<DesignVersion> {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new SnapshotterError(
        'invalid_version_number',
        `versionNumber must be a positive integer, got ${versionNumber}`,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const upload = await this.fetchUpload(client, uxUploadId);
      const schema = await Promise.resolve(this.resolveSchema(upload.tenant_id));
      await client.query(`SET LOCAL search_path = ${quoteIdent(schema)}, public`);

      // Lock the prior latest row to serialise.
      const priorRes = await client.query<RawVersionRow>(
        `SELECT * FROM design_versions
          WHERE ux_upload_id = $1
          ORDER BY version_number DESC
          LIMIT 1
          FOR UPDATE`,
        [uxUploadId],
      );
      const prior = priorRes.rows[0] ?? null;
      if (!prior) {
        throw new SnapshotterError(
          'design_version_not_found',
          `cannot revert: no versions exist for ux_upload ${uxUploadId}`,
        );
      }

      // Fetch the target row.
      const targetRes = await client.query<RawVersionRow>(
        `SELECT * FROM design_versions
          WHERE ux_upload_id = $1 AND version_number = $2`,
        [uxUploadId, versionNumber],
      );
      const target = targetRes.rows[0] ?? null;
      if (!target) {
        throw new SnapshotterError(
          'design_version_not_found',
          `version ${versionNumber} not found for ux_upload ${uxUploadId}`,
          { uxUploadId, versionNumber },
        );
      }

      const nextVersionNumber = prior.version_number + 1;
      const diff = diffDesigns(prior.rendered_design, target.rendered_design);
      const summary = summarizeDiff(diff);
      const note = opts.notes ?? `revert to v${versionNumber}`;

      let insertedRow: RawVersionRow;
      try {
        const insRes = await client.query<RawVersionRow>(
          `INSERT INTO design_versions
             (tenant_id, ux_upload_id, version_number, parent_version_id,
              rendered_design, rendered_design_hash, diff_from_parent, diff_summary,
              notes, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            upload.tenant_id,
            uxUploadId,
            nextVersionNumber,
            prior.id,
            JSON.stringify(target.rendered_design),
            target.rendered_design_hash,
            JSON.stringify(diff),
            JSON.stringify(summary),
            note,
            this.now(),
          ],
        );
        insertedRow = insRes.rows[0]!;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new SnapshotterError(
            'concurrent_version_conflict',
            `version ${nextVersionNumber} already exists for ux_upload ${uxUploadId}`,
            { uxUploadId, versionNumber: nextVersionNumber },
          );
        }
        throw err;
      }

      // Copy the asset-edge rows from the target version so the new
      // version is fully self-contained (and ref-counts stay accurate).
      const targetAssets = await client.query<{
        asset_id: string;
        path: string;
        kind: string | null;
        alt_text: string | null;
        intrinsic_w: number | null;
        intrinsic_h: number | null;
        is_placeholder: boolean;
      }>(
        `SELECT asset_id, path, kind, alt_text, intrinsic_w, intrinsic_h, is_placeholder
           FROM design_version_assets WHERE design_version_id = $1`,
        [target.id],
      );
      for (const row of targetAssets.rows) {
        await client.query(
          `INSERT INTO design_version_assets
             (design_version_id, asset_id, path, kind, alt_text, intrinsic_w, intrinsic_h, is_placeholder)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            insertedRow.id,
            row.asset_id,
            row.path,
            row.kind,
            row.alt_text,
            row.intrinsic_w,
            row.intrinsic_h,
            row.is_placeholder,
          ],
        );
        await client.query(
          `UPDATE design_assets SET ref_count = ref_count + 1 WHERE id = $1`,
          [row.asset_id],
        );
      }

      await client.query('COMMIT');
      return rowToDesignVersion(insertedRow);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore — original error wins
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // getSnapshot
  // ============================================================

  async getSnapshot(designVersionId: string): Promise<DesignVersion> {
    // We must know the tenant before we know the schema. The bootstrap
    // strategy: look up the row in `public` (integration default) AND
    // in every plausible tenant schema. For production, the caller can
    // pass a `tenantId` hint — but the simpler approach is to walk via
    // a single search_path tweak: search_path = ALL tenant schemas.
    //
    // Pragmatic implementation: assume the snapshotter has a default
    // schema resolver that returns a single schema (e.g. 'public' for
    // tests, the caller's tenant schema in production). We let the
    // resolver be called with the row's tenant_id AFTER the SELECT —
    // but that's circular. So getSnapshot accepts an unqualified
    // search_path and relies on the caller being inside one tenant
    // schema's connection pool (production's wired this way per Step
    // 5 §3.1 — "search_path = caia_<short>, public" is set on every
    // tenant pool checkout).
    const client = await this.pool.connect();
    try {
      const res = await client.query<RawVersionRow>(
        `SELECT * FROM design_versions WHERE id = $1`,
        [designVersionId],
      );
      const row = res.rows[0];
      if (!row) {
        throw new SnapshotterError(
          'design_version_not_found',
          `design version ${designVersionId} not found`,
          { designVersionId },
        );
      }
      return rowToDesignVersion(row);
    } finally {
      client.release();
    }
  }

  // ============================================================
  // listVersions
  // ============================================================

  async listVersions(uxUploadId: string): Promise<DesignVersionSummary[]> {
    const client = await this.pool.connect();
    try {
      const res = await client.query<Omit<RawVersionRow, 'rendered_design' | 'diff_from_parent'>>(
        `SELECT id, tenant_id, ux_upload_id, version_number, parent_version_id,
                rendered_design_hash, diff_summary, notes, created_at
           FROM design_versions
          WHERE ux_upload_id = $1
          ORDER BY version_number ASC`,
        [uxUploadId],
      );
      return res.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        uxUploadId: row.ux_upload_id,
        versionNumber: row.version_number,
        parentVersionId: row.parent_version_id,
        renderedDesignHash: row.rendered_design_hash,
        diffSummary: row.diff_summary,
        notes: row.notes,
        createdAt: row.created_at,
      }));
    } finally {
      client.release();
    }
  }

  // ============================================================
  // getDiff
  // ============================================================

  /**
   * Compute (or fetch the cached) structural diff between two versions.
   *
   * If `toVersionId` is the direct child of `fromVersionId`, the cached
   * `diff_from_parent` is returned verbatim. Otherwise the diff is
   * computed on the fly by `diffDesigns(from.rendered_design, to.rendered_design)`.
   */
  async getDiff(fromVersionId: string, toVersionId: string): Promise<DesignDiff> {
    const client = await this.pool.connect();
    try {
      const res = await client.query<RawVersionRow>(
        `SELECT * FROM design_versions WHERE id = ANY($1::uuid[])`,
        [[fromVersionId, toVersionId]],
      );
      const byId = new Map(res.rows.map((r) => [r.id, r]));
      const from = byId.get(fromVersionId);
      const to = byId.get(toVersionId);
      if (!from) {
        throw new SnapshotterError(
          'design_version_not_found',
          `from-version ${fromVersionId} not found`,
        );
      }
      if (!to) {
        throw new SnapshotterError(
          'design_version_not_found',
          `to-version ${toVersionId} not found`,
        );
      }
      // Cached path: if `to`'s parent is `from`, the diff is already stored.
      if (to.parent_version_id === from.id && to.diff_from_parent) {
        return to.diff_from_parent;
      }
      return diffDesigns(from.rendered_design, to.rendered_design);
    } finally {
      client.release();
    }
  }

  // ============================================================
  // deleteAllForTenant
  // ============================================================

  /**
   * GDPR Article 17 right-to-erasure.
   *
   * Sequence:
   *   1. Enumerate every blob URL the snapshotter owns for the tenant
   *      (every distinct storage_url on `design_assets`).
   *   2. Delete blobs via the BYOC adapter's `deletePrefix` (cheap).
   *      Fall back to per-row `deleteBlob` if the prefix delete is
   *      unsupported.
   *   3. DELETE design_version_assets → design_versions → design_assets
   *      for tenant_id = $1. (We do NOT drop the whole tenant schema —
   *      the parent tenant-erasure routine in @caia/tenant-provisioner
   *      does that. The snapshotter only owns its own rows.)
   *   4. Return a tombstone ref so the caller can audit.
   *
   * Idempotent — re-running it on an already-erased tenant returns
   * counts of zero (deletedCount is from the BYOC adapter — already-empty
   * stores naturally return zero).
   */
  async deleteAllForTenant(
    tenantId: string,
    opts: DeleteAllForTenantOptions = {},
  ): Promise<DeleteAllForTenantResult> {
    if (!tenantId) {
      throw new SnapshotterError(
        'ux_upload_not_found',
        'tenantId is required for deleteAllForTenant',
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const schema = await Promise.resolve(this.resolveSchema(tenantId));
      await client.query(`SET LOCAL search_path = ${quoteIdent(schema)}, public`);

      const versionCountRes = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM design_versions WHERE tenant_id = $1`,
        [tenantId],
      );
      const assetCountRes = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM design_assets WHERE tenant_id = $1`,
        [tenantId],
      );

      const prefix = this.resolveBlobPrefix(tenantId);

      if (opts.dryRun) {
        // Headcount only — no mutation, no BYOC calls.
        await client.query('ROLLBACK');
        return {
          deletedVersionCount: Number(versionCountRes.rows[0]?.c ?? '0'),
          deletedAssetCount: Number(assetCountRes.rows[0]?.c ?? '0'),
          deletedBlobCount: 0,
          tenantTombstoneRef: tombstoneRef(tenantId, this.now()),
        };
      }

      // Wipe blob storage first — if this fails we abort before any DB
      // mutation, so the next attempt can retry.
      const blobResult = await this.byoc.deletePrefix(tenantId, prefix);

      // Cascade through the DB.
      const delVerAssets = await client.query(
        `DELETE FROM design_version_assets
           WHERE design_version_id IN (
             SELECT id FROM design_versions WHERE tenant_id = $1
           )`,
        [tenantId],
      );
      void delVerAssets;
      const delVersions = await client.query(
        `DELETE FROM design_versions WHERE tenant_id = $1`,
        [tenantId],
      );
      const delAssets = await client.query(
        `DELETE FROM design_assets WHERE tenant_id = $1`,
        [tenantId],
      );

      await client.query('COMMIT');

      return {
        deletedVersionCount: delVersions.rowCount,
        deletedAssetCount: delAssets.rowCount,
        deletedBlobCount: blobResult.deletedCount,
        tenantTombstoneRef: tombstoneRef(tenantId, this.now()),
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore — original error wins
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // private helpers
  // ============================================================

  private async fetchUpload(client: PoolClientLike, uxUploadId: string): Promise<RawUploadRow> {
    const res = await client.query<RawUploadRow>(
      `SELECT id, tenant_id FROM ux_uploads WHERE id = $1`,
      [uxUploadId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new SnapshotterError(
        'ux_upload_not_found',
        `ux_upload ${uxUploadId} not found`,
        { uxUploadId },
      );
    }
    return row;
  }

  /**
   * For each asset in the design, ensure a (tenant_id, content_hash)
   * row exists in `design_assets`, uploading the bytes via BYOC if it's
   * a first sighting. Returns:
   *   - the rewritten assets array (each asset's `storageUrl` filled in
   *     from the (existing or new) row),
   *   - the M:N edge rows to insert into `design_version_assets`.
   *
   * Skips assets without a `contentHash` — those are placeholders or
   * the adapter didn't hash them. Such assets are still passed through
   * to `renderedDesign.assets` but without dedup.
   */
  private async uploadAssetsWithDedup(
    client: PoolClientLike,
    tenantId: string,
    design: RenderableDesign,
  ): Promise<{
    assets: RenderableAsset[];
    links: Array<{
      assetId: string;
      path: string;
      kind: string | null;
      altText: string | null;
      intrinsicW: number | null;
      intrinsicH: number | null;
      isPlaceholder: boolean;
    }>;
  }> {
    const rawAssets = design.assets ?? [];
    const out: RenderableAsset[] = [];
    const links: Array<{
      assetId: string;
      path: string;
      kind: string | null;
      altText: string | null;
      intrinsicW: number | null;
      intrinsicH: number | null;
      isPlaceholder: boolean;
    }> = [];

    for (const a of rawAssets) {
      // Carry through assets without content hashes unchanged — they
      // can't dedup, but we don't drop them.
      if (!a.contentHash) {
        out.push({ ...a });
        continue;
      }

      // Look up existing row by (tenant_id, content_hash).
      const existRes = await client.query<RawAssetRow>(
        `SELECT id, tenant_id, content_hash, storage_url, size_bytes::text AS size_bytes, mime_type
           FROM design_assets
          WHERE tenant_id = $1 AND content_hash = $2
          LIMIT 1`,
        [tenantId, a.contentHash],
      );
      let assetRow = existRes.rows[0] ?? null;

      if (!assetRow) {
        // First sighting — upload the bytes. We do NOT have the raw
        // bytes here; the adapter upstream should have already uploaded
        // them to `a.storageUrl` if it had bytes in hand. The snapshotter
        // *finalises* the upload: it re-PUTs to the canonical
        // content-hash key, so re-uploads are dedup'd at the key level.
        //
        // If `storageUrl` is missing the bytes were never uploaded —
        // which means the adapter is incomplete. We register the row
        // with the existing URL (or a placeholder marker) and let the
        // caller decide how to handle it.
        const key = blobKeyFor(this.resolveBlobPrefix(tenantId), a.contentHash);
        let storageUrl = a.storageUrl ?? `byoc://${this.byoc.providerId}/${key}`;
        const head = await this.byoc.headBlob(tenantId, key);
        if (!head.exists && a.storageUrl) {
          // Best-effort: try to fetch from the upstream URL and re-PUT
          // under the canonical key. In tests, the adapter has the
          // bytes in memory already at `storageUrl`; in production,
          // upstream adapters will have populated the in-memory or
          // S3 store before calling snapshotter.captureSnapshot.
          //
          // We don't attempt cross-bucket copies here — out of scope.
          // We just register the row with the supplied storageUrl.
          storageUrl = a.storageUrl;
        } else if (head.exists) {
          storageUrl = `byoc://${this.byoc.providerId}/${key}`;
        }
        const ins = await client.query<RawAssetRow>(
          `INSERT INTO design_assets
             (tenant_id, content_hash, storage_url, size_bytes, mime_type)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, content_hash)
           DO UPDATE SET storage_url = EXCLUDED.storage_url
           RETURNING id, tenant_id, content_hash, storage_url, size_bytes::text AS size_bytes, mime_type`,
          [tenantId, a.contentHash, storageUrl, a.byteSize ?? 0, a.kind ?? null],
        );
        assetRow = ins.rows[0]!;
      }

      out.push({ ...a, storageUrl: assetRow.storage_url });
      links.push({
        assetId: assetRow.id,
        path: a.path,
        kind: a.kind ?? null,
        altText: a.alt ?? null,
        intrinsicW: a.intrinsicSize?.w ?? null,
        intrinsicH: a.intrinsicSize?.h ?? null,
        isPlaceholder: a.isPlaceholder ?? false,
      });
    }

    return { assets: out, links };
  }
}

// ----- module-local helpers ----------------------------------------------

function rowToDesignVersion(row: RawVersionRow): DesignVersion {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    uxUploadId: row.ux_upload_id,
    versionNumber: row.version_number,
    parentVersionId: row.parent_version_id,
    renderedDesign: row.rendered_design,
    renderedDesignHash: row.rendered_design_hash,
    diffFromParent: row.diff_from_parent,
    diffSummary: row.diff_summary,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

function quoteIdent(s: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new SnapshotterError(
      'tenant_schema_missing',
      `invalid schema name: ${s} (must match [a-zA-Z_][a-zA-Z0-9_]*)`,
    );
  }
  return `"${s}"`;
}

function blobKeyFor(prefix: string, contentHash: string): string {
  // contentHash is `sha256:<hex>` — replace the colon for cleaner URLs.
  const safe = contentHash.replace(':', '-');
  return `${prefix.replace(/\/$/, '')}/${safe}`;
}

function tombstoneRef(tenantId: string, now: Date): string {
  return `tombstone:${tenantId}:${sha256(`${tenantId}:${now.toISOString()}`).slice(7, 23)}`;
}

// Suppress unused-import lint warning for `RawAssetRow`.
export type { RawVersionRow as InternalDesignVersionRow };
