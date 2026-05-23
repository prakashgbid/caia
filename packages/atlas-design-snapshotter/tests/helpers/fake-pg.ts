/**
 * Fake `pg.Pool`-like backend for unit tests — implements just enough
 * of the Postgres surface that `DesignSnapshotter` exercises:
 *   - BEGIN / COMMIT / ROLLBACK
 *   - SET LOCAL search_path = "x", public
 *   - INSERT / SELECT / UPDATE / DELETE on the snapshotter's tables
 *   - SELECT ... FOR UPDATE (no-op locking — single-threaded tests)
 *   - ON CONFLICT (tenant_id, content_hash) DO UPDATE
 *   - COUNT(*)::text
 *   - $N positional parameters
 *
 * NOT a generic Postgres emulator. Adding a real Postgres+MinIO via
 * docker-compose covers everything this stubs out, and is what the
 * integration suite uses.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClientLike, PoolLike, QueryResultLike } from '../../src/pg-types.js';

interface UxUpload {
  id: string;
  tenant_id: string;
  business_proposal_id: string | null;
  source: string;
  source_metadata: Record<string, unknown>;
  uploaded_at: Date;
  rendered_design: unknown;
  status: string;
  parse_diagnostics: unknown;
  parse_duration_ms: number | null;
  failure_reason: string | null;
}

interface DesignAsset {
  id: string;
  tenant_id: string;
  content_hash: string;
  storage_url: string;
  size_bytes: number;
  mime_type: string | null;
  first_seen_at: Date;
  ref_count: number;
}

interface DesignVersionAsset {
  design_version_id: string;
  asset_id: string;
  path: string;
  kind: string | null;
  alt_text: string | null;
  intrinsic_w: number | null;
  intrinsic_h: number | null;
  is_placeholder: boolean;
}

interface DesignVersion {
  id: string;
  tenant_id: string;
  ux_upload_id: string;
  version_number: number;
  parent_version_id: string | null;
  rendered_design: unknown;
  rendered_design_hash: string;
  diff_from_parent: unknown;
  diff_summary: unknown;
  notes: string | null;
  created_at: Date;
}

interface Tables {
  ux_uploads: UxUpload[];
  design_assets: DesignAsset[];
  design_version_assets: DesignVersionAsset[];
  design_versions: DesignVersion[];
}

class UniqueViolation extends Error {
  public readonly code = '23505';
  constructor(constraint: string) {
    super(`duplicate key value violates unique constraint "${constraint}"`);
    this.name = 'UniqueViolation';
  }
}

export class FakePool implements PoolLike {
  public tables: Tables = {
    ux_uploads: [],
    design_assets: [],
    design_version_assets: [],
    design_versions: [],
  };

  // For testing concurrent-conflict simulation.
  public hookBeforeInsertVersion: ((versionNumber: number, uxUploadId: string) => void) | null =
    null;

  insertUpload(opts: { tenantId: string; uxUploadId?: string }): string {
    const id = opts.uxUploadId ?? randomUUID();
    this.tables.ux_uploads.push({
      id,
      tenant_id: opts.tenantId,
      business_proposal_id: null,
      source: 'cd-zip',
      source_metadata: {},
      uploaded_at: new Date(),
      rendered_design: null,
      status: 'uploading',
      parse_diagnostics: null,
      parse_duration_ms: null,
      failure_reason: null,
    });
    return id;
  }

  async query<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<R>> {
    const client = await this.connect();
    try {
      return await client.query<R>(sql, params);
    } finally {
      client.release();
    }
  }

  async connect(): Promise<PoolClientLike> {
    const self = this;
    return {
      async query<R = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<QueryResultLike<R>> {
        return self.exec<R>(sql, params);
      },
      release() {
        /* no-op */
      },
    };
  }

  private exec<R>(rawSql: string, params: unknown[]): QueryResultLike<R> {
    const sql = rawSql.trim();
    const lower = sql.toLowerCase();

    if (lower.startsWith('begin') || lower.startsWith('commit') || lower.startsWith('rollback')) {
      return { rows: [], rowCount: 0 };
    }
    if (lower.startsWith('set local')) {
      return { rows: [], rowCount: 0 };
    }

    // --- ux_uploads SELECT ---
    if (lower.startsWith('select id, tenant_id from ux_uploads')) {
      const id = params[0] as string;
      const row = this.tables.ux_uploads.find((r) => r.id === id);
      return {
        rows: row ? [{ id: row.id, tenant_id: row.tenant_id } as unknown as R] : [],
        rowCount: row ? 1 : 0,
      };
    }

    // --- design_versions SELECT latest FOR UPDATE ---
    if (lower.includes('from design_versions') && lower.includes('order by version_number desc')) {
      const uxUploadId = params[0] as string;
      const matches = this.tables.design_versions
        .filter((r) => r.ux_upload_id === uxUploadId)
        .sort((a, b) => b.version_number - a.version_number);
      const top = matches[0];
      return {
        rows: top ? [structuredClone(top) as unknown as R] : [],
        rowCount: top ? 1 : 0,
      };
    }

    // --- design_versions SELECT by id (single) ---
    if (
      lower.startsWith('select * from design_versions where id = $1') &&
      !lower.includes('any')
    ) {
      const id = params[0] as string;
      const row = this.tables.design_versions.find((r) => r.id === id);
      return {
        rows: row ? [structuredClone(row) as unknown as R] : [],
        rowCount: row ? 1 : 0,
      };
    }

    // --- design_versions SELECT by id = ANY (for getDiff) ---
    if (lower.includes('id = any')) {
      const ids = params[0] as string[];
      const rows = this.tables.design_versions
        .filter((r) => ids.includes(r.id))
        .map((r) => structuredClone(r) as unknown as R);
      return { rows, rowCount: rows.length };
    }

    // --- design_versions SELECT by (ux_upload_id, version_number) ---
    if (lower.includes('from design_versions') && lower.includes('version_number = $2')) {
      const uxUploadId = params[0] as string;
      const versionNumber = params[1] as number;
      const row = this.tables.design_versions.find(
        (r) => r.ux_upload_id === uxUploadId && r.version_number === versionNumber,
      );
      return {
        rows: row ? [structuredClone(row) as unknown as R] : [],
        rowCount: row ? 1 : 0,
      };
    }

    // --- design_versions LIST (summary) ---
    if (
      lower.startsWith('select id, tenant_id, ux_upload_id, version_number, parent_version_id')
    ) {
      const uxUploadId = params[0] as string;
      const rows = this.tables.design_versions
        .filter((r) => r.ux_upload_id === uxUploadId)
        .sort((a, b) => a.version_number - b.version_number)
        .map((r) => ({
          id: r.id,
          tenant_id: r.tenant_id,
          ux_upload_id: r.ux_upload_id,
          version_number: r.version_number,
          parent_version_id: r.parent_version_id,
          rendered_design_hash: r.rendered_design_hash,
          diff_summary: r.diff_summary,
          notes: r.notes,
          created_at: r.created_at,
        }));
      return { rows: rows as unknown as R[], rowCount: rows.length };
    }

    // --- design_assets SELECT by (tenant_id, content_hash) ---
    if (
      lower.startsWith('select id, tenant_id, content_hash, storage_url, size_bytes::text') ||
      (lower.includes('from design_assets') && lower.includes('content_hash = $2'))
    ) {
      const tenantId = params[0] as string;
      const contentHash = params[1] as string;
      const row = this.tables.design_assets.find(
        (r) => r.tenant_id === tenantId && r.content_hash === contentHash,
      );
      return {
        rows: row
          ? ([
              {
                id: row.id,
                tenant_id: row.tenant_id,
                content_hash: row.content_hash,
                storage_url: row.storage_url,
                size_bytes: String(row.size_bytes),
                mime_type: row.mime_type,
              },
            ] as unknown as R[])
          : [],
        rowCount: row ? 1 : 0,
      };
    }

    // --- design_assets INSERT ... ON CONFLICT DO UPDATE ---
    if (lower.startsWith('insert into design_assets')) {
      const [tenantId, contentHash, storageUrl, sizeBytes, mimeType] = params as [
        string,
        string,
        string,
        number,
        string | null,
      ];
      const existing = this.tables.design_assets.find(
        (r) => r.tenant_id === tenantId && r.content_hash === contentHash,
      );
      const row: DesignAsset = existing ?? {
        id: randomUUID(),
        tenant_id: tenantId,
        content_hash: contentHash,
        storage_url: storageUrl,
        size_bytes: sizeBytes,
        mime_type: mimeType,
        first_seen_at: new Date(),
        ref_count: 0,
      };
      if (existing) {
        existing.storage_url = storageUrl;
      } else {
        this.tables.design_assets.push(row);
      }
      return {
        rows: [
          {
            id: row.id,
            tenant_id: row.tenant_id,
            content_hash: row.content_hash,
            storage_url: row.storage_url,
            size_bytes: String(row.size_bytes),
            mime_type: row.mime_type,
          } as unknown as R,
        ],
        rowCount: 1,
      };
    }

    // --- design_versions INSERT ---
    if (lower.startsWith('insert into design_versions')) {
      const [
        tenantId,
        uxUploadId,
        versionNumber,
        parentVersionId,
        renderedDesign,
        renderedDesignHash,
        diffFromParent,
        diffSummary,
        notes,
        createdAt,
      ] = params as [
        string,
        string,
        number,
        string | null,
        string,
        string,
        string,
        string,
        string | null,
        Date,
      ];
      if (this.hookBeforeInsertVersion) this.hookBeforeInsertVersion(versionNumber, uxUploadId);
      const dup = this.tables.design_versions.find(
        (r) => r.ux_upload_id === uxUploadId && r.version_number === versionNumber,
      );
      if (dup) throw new UniqueViolation('design_versions_ux_upload_id_version_number_key');
      const row: DesignVersion = {
        id: randomUUID(),
        tenant_id: tenantId,
        ux_upload_id: uxUploadId,
        version_number: versionNumber,
        parent_version_id: parentVersionId,
        rendered_design: JSON.parse(renderedDesign),
        rendered_design_hash: renderedDesignHash,
        diff_from_parent: JSON.parse(diffFromParent),
        diff_summary: JSON.parse(diffSummary),
        notes: notes,
        created_at: createdAt,
      };
      this.tables.design_versions.push(row);
      return { rows: [structuredClone(row) as unknown as R], rowCount: 1 };
    }

    // --- design_version_assets INSERT ---
    if (lower.startsWith('insert into design_version_assets')) {
      const [
        designVersionId,
        assetId,
        path,
        kind,
        altText,
        intrinsicW,
        intrinsicH,
        isPlaceholder,
      ] = params as [
        string,
        string,
        string,
        string | null,
        string | null,
        number | null,
        number | null,
        boolean,
      ];
      this.tables.design_version_assets.push({
        design_version_id: designVersionId,
        asset_id: assetId,
        path,
        kind,
        alt_text: altText,
        intrinsic_w: intrinsicW,
        intrinsic_h: intrinsicH,
        is_placeholder: isPlaceholder,
      });
      return { rows: [], rowCount: 1 };
    }

    // --- design_version_assets SELECT for revert copy ---
    if (lower.startsWith('select asset_id, path, kind, alt_text')) {
      const designVersionId = params[0] as string;
      const rows = this.tables.design_version_assets
        .filter((r) => r.design_version_id === designVersionId)
        .map((r) => ({
          asset_id: r.asset_id,
          path: r.path,
          kind: r.kind,
          alt_text: r.alt_text,
          intrinsic_w: r.intrinsic_w,
          intrinsic_h: r.intrinsic_h,
          is_placeholder: r.is_placeholder,
        }));
      return { rows: rows as unknown as R[], rowCount: rows.length };
    }

    // --- design_assets UPDATE ref_count ---
    if (lower.startsWith('update design_assets set ref_count')) {
      const id = params[0] as string;
      const row = this.tables.design_assets.find((r) => r.id === id);
      if (row) row.ref_count += 1;
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    // --- COUNT(*) versions/assets for tenant ---
    if (lower.startsWith('select count(*)::text as c from design_versions')) {
      const tenantId = params[0] as string;
      const c = this.tables.design_versions.filter((r) => r.tenant_id === tenantId).length;
      return { rows: [{ c: String(c) } as unknown as R], rowCount: 1 };
    }
    if (lower.startsWith('select count(*)::text as c from design_assets')) {
      const tenantId = params[0] as string;
      const c = this.tables.design_assets.filter((r) => r.tenant_id === tenantId).length;
      return { rows: [{ c: String(c) } as unknown as R], rowCount: 1 };
    }

    // --- DELETE for tenant ---
    if (lower.startsWith('delete from design_version_assets')) {
      const tenantId = params[0] as string;
      const versionIds = new Set(
        this.tables.design_versions
          .filter((r) => r.tenant_id === tenantId)
          .map((r) => r.id),
      );
      const before = this.tables.design_version_assets.length;
      this.tables.design_version_assets = this.tables.design_version_assets.filter(
        (r) => !versionIds.has(r.design_version_id),
      );
      return { rows: [], rowCount: before - this.tables.design_version_assets.length };
    }
    if (lower.startsWith('delete from design_versions')) {
      const tenantId = params[0] as string;
      const before = this.tables.design_versions.length;
      this.tables.design_versions = this.tables.design_versions.filter(
        (r) => r.tenant_id !== tenantId,
      );
      return { rows: [], rowCount: before - this.tables.design_versions.length };
    }
    if (lower.startsWith('delete from design_assets')) {
      const tenantId = params[0] as string;
      const before = this.tables.design_assets.length;
      this.tables.design_assets = this.tables.design_assets.filter(
        (r) => r.tenant_id !== tenantId,
      );
      return { rows: [], rowCount: before - this.tables.design_assets.length };
    }

    throw new Error(`fake-pg: unhandled SQL:\n${sql}`);
  }
}
