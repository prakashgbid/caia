/**
 * `UxUploadsRepo` — owns the `ux_uploads` row lifecycle.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §4.
 *
 * Lifecycle:
 *   `uploading` (created by upload endpoint)
 *     → `parsing`  (Ingestor begins)
 *     → `parsed`   (snapshot captured)
 *     | `failed`   (parse threw / validate rejected)
 *
 * The repo writes/reads INSIDE the per-tenant schema. The framework's
 * caller wires `resolveTenantSchema` and sets `search_path` before
 * invoking any method (same pattern as `@caia/atlas-design-snapshotter`).
 * The repo itself does NOT issue `SET LOCAL search_path` — the caller
 * owns transactional boundaries.
 *
 * No locking or version columns — the row is single-writer once the
 * Ingestor picks it up. Concurrent re-uploads create distinct rows.
 */

import type { PoolLike, QueryResultLike } from './pg-types.js';
import type {
  InsertUxUploadInput,
  UxUploadRow,
  UxUploadStatus,
} from './types.js';
import type { RenderableDesign, SourceName } from './schema.js';
import { DesignIngestError } from './errors.js';

interface RawRow {
  id: string;
  tenant_id: string;
  business_proposal_id: string | null;
  source: string;
  source_metadata: Record<string, unknown>;
  uploaded_at: Date;
  rendered_design: RenderableDesign | null;
  status: UxUploadStatus;
  parse_diagnostics: Record<string, unknown> | null;
  parse_duration_ms: number | null;
  failure_reason: string | null;
}

export interface DeleteAllUxUploadsResult {
  deletedCount: number;
}

export class UxUploadsRepo {
  constructor(private readonly pg: PoolLike) {}

  async insert(input: InsertUxUploadInput): Promise<UxUploadRow> {
    const res = await this.pg.query<RawRow>(
      `INSERT INTO ux_uploads
         (tenant_id, business_proposal_id, source, source_metadata, status)
       VALUES ($1, $2, $3, $4, 'uploading')
       RETURNING id, tenant_id, business_proposal_id, source, source_metadata,
                 uploaded_at, rendered_design, status, parse_diagnostics,
                 parse_duration_ms, failure_reason`,
      [
        input.tenantId,
        input.businessProposalId ?? null,
        input.source,
        JSON.stringify(input.sourceMetadata),
      ],
    );
    const row = res.rows[0];
    if (!row) {
      throw new DesignIngestError(
        'ingestion_failed',
        'ux_uploads insert returned no row',
      );
    }
    return rawToRow(row);
  }

  async getById(id: string): Promise<UxUploadRow | null> {
    const res = await this.pg.query<RawRow>(
      `SELECT id, tenant_id, business_proposal_id, source, source_metadata,
              uploaded_at, rendered_design, status, parse_diagnostics,
              parse_duration_ms, failure_reason
         FROM ux_uploads
        WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? rawToRow(row) : null;
  }

  async markParsing(id: string): Promise<void> {
    await this.requireStatusTransition(id, 'parsing');
  }

  async markParsed(
    id: string,
    renderedDesign: RenderableDesign,
    parseDurationMs: number,
    parseDiagnostics: Record<string, unknown> | null,
  ): Promise<void> {
    const res = await this.pg.query(
      `UPDATE ux_uploads
          SET status = 'parsed',
              rendered_design = $2,
              parse_duration_ms = $3,
              parse_diagnostics = $4
        WHERE id = $1`,
      [
        id,
        JSON.stringify(renderedDesign),
        parseDurationMs,
        parseDiagnostics ? JSON.stringify(parseDiagnostics) : null,
      ],
    );
    assertOneRow(res, id, 'markParsed');
  }

  async markFailed(
    id: string,
    failureReason: string,
    parseDurationMs: number | null,
    parseDiagnostics: Record<string, unknown> | null,
  ): Promise<void> {
    const res = await this.pg.query(
      `UPDATE ux_uploads
          SET status = 'failed',
              failure_reason = $2,
              parse_duration_ms = $3,
              parse_diagnostics = $4
        WHERE id = $1`,
      [
        id,
        failureReason,
        parseDurationMs,
        parseDiagnostics ? JSON.stringify(parseDiagnostics) : null,
      ],
    );
    assertOneRow(res, id, 'markFailed');
  }

  /**
   * GDPR Article 17 — remove every `ux_uploads` row for the tenant.
   * Idempotent; returns counts so the caller can audit.
   *
   * Re-running on an already-erased tenant returns
   * `{ deletedCount: 0 }`. The snapshotter handles `design_versions`
   * and `design_assets` independently (see `GdprCoordinator`).
   */
  async deleteAllForTenant(
    tenantId: string,
    opts: { dryRun?: boolean } = {},
  ): Promise<DeleteAllUxUploadsResult> {
    if (opts.dryRun) {
      const res = await this.pg.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM ux_uploads WHERE tenant_id = $1`,
        [tenantId],
      );
      return { deletedCount: Number(res.rows[0]?.c ?? '0') };
    }
    const res = await this.pg.query(
      `DELETE FROM ux_uploads WHERE tenant_id = $1`,
      [tenantId],
    );
    return { deletedCount: res.rowCount };
  }

  // -- private ----------------------------------------------------------

  private async requireStatusTransition(
    id: string,
    next: UxUploadStatus,
  ): Promise<void> {
    const res = await this.pg.query<{ status: UxUploadStatus }>(
      `UPDATE ux_uploads SET status = $2 WHERE id = $1 RETURNING status`,
      [id, next],
    );
    if (res.rows.length === 0) {
      throw new DesignIngestError(
        'ux_upload_not_found',
        `ux_upload ${id} not found`,
        { uxUploadId: id },
      );
    }
  }
}

function rawToRow(r: RawRow): UxUploadRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    businessProposalId: r.business_proposal_id,
    source: r.source as SourceName,
    sourceMetadata: r.source_metadata ?? {},
    uploadedAt: r.uploaded_at,
    renderedDesign: r.rendered_design,
    status: r.status,
    parseDiagnostics: r.parse_diagnostics,
    parseDurationMs: r.parse_duration_ms,
    failureReason: r.failure_reason,
  };
}

function assertOneRow(
  res: QueryResultLike<unknown>,
  uxUploadId: string,
  op: string,
): void {
  if (res.rowCount === 0) {
    throw new DesignIngestError(
      'ux_upload_not_found',
      `${op}: ux_upload ${uxUploadId} not found`,
      { uxUploadId, op },
    );
  }
}
