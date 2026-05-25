/**
 * Fake `pg.Pool`-like backend for unit tests. Implements just enough
 * SQL surface that `UxUploadsRepo` + the registry dispatcher exercise.
 *
 * For tests that touch the snapshotter's tables, see
 * `@caia/atlas-design-snapshotter`'s own FakePool — they're keyed off
 * different tables and we don't share state.
 */

import { randomUUID } from 'node:crypto';
import type {
  PoolClientLike,
  PoolLike,
  QueryResultLike,
} from '../../src/pg-types.js';

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

interface TenantRow {
  id: string;
  preferred_design_source: string;
}

export class FakePool implements PoolLike {
  public ux_uploads: UxUpload[] = [];
  public tenants: TenantRow[] = [];

  insertTenant(t: TenantRow): void {
    this.tenants.push(t);
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
      release(): void {
        /* no-op */
      },
    };
  }

  async query<R = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResultLike<R>> {
    return this.exec<R>(sql, params);
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

    // INSERT INTO ux_uploads ...
    if (lower.startsWith('insert into ux_uploads')) {
      const [tenantId, businessProposalId, source, sourceMetadata] = params as [
        string,
        string | null,
        string,
        string,
      ];
      const row: UxUpload = {
        id: randomUUID(),
        tenant_id: tenantId,
        business_proposal_id: businessProposalId,
        source,
        source_metadata: JSON.parse(sourceMetadata),
        uploaded_at: new Date(),
        rendered_design: null,
        status: 'uploading',
        parse_diagnostics: null,
        parse_duration_ms: null,
        failure_reason: null,
      };
      this.ux_uploads.push(row);
      return { rows: [cloneAsR<R>(row)], rowCount: 1 };
    }

    // SELECT ... FROM ux_uploads WHERE id = $1
    if (lower.startsWith('select id, tenant_id, business_proposal_id') && lower.includes('from ux_uploads')) {
      const id = params[0] as string;
      const row = this.ux_uploads.find((r) => r.id === id);
      return {
        rows: row ? [cloneAsR<R>(row)] : [],
        rowCount: row ? 1 : 0,
      };
    }

    // UPDATE ux_uploads SET status = $2 WHERE id = $1 RETURNING status
    if (
      lower.startsWith('update ux_uploads set status = $2 where id = $1 returning status')
    ) {
      const [id, status] = params as [string, string];
      const row = this.ux_uploads.find((r) => r.id === id);
      if (!row) return { rows: [], rowCount: 0 };
      row.status = status;
      return { rows: [{ status } as unknown as R], rowCount: 1 };
    }

    // UPDATE ux_uploads SET status = 'parsed', rendered_design = $2, parse_duration_ms = $3, parse_diagnostics = $4 WHERE id = $1
    if (lower.includes("update ux_uploads") && lower.includes("status = 'parsed'")) {
      const [id, renderedDesignJson, parseDurationMs, parseDiagnosticsJson] = params as [
        string,
        string,
        number,
        string | null,
      ];
      const row = this.ux_uploads.find((r) => r.id === id);
      if (!row) return { rows: [], rowCount: 0 };
      row.status = 'parsed';
      row.rendered_design = JSON.parse(renderedDesignJson);
      row.parse_duration_ms = parseDurationMs;
      row.parse_diagnostics = parseDiagnosticsJson ? JSON.parse(parseDiagnosticsJson) : null;
      return { rows: [], rowCount: 1 };
    }

    // UPDATE ux_uploads SET status = 'failed', failure_reason = $2, parse_duration_ms = $3, parse_diagnostics = $4 WHERE id = $1
    if (lower.includes("update ux_uploads") && lower.includes("status = 'failed'")) {
      const [id, failureReason, parseDurationMs, parseDiagnosticsJson] = params as [
        string,
        string,
        number | null,
        string | null,
      ];
      const row = this.ux_uploads.find((r) => r.id === id);
      if (!row) return { rows: [], rowCount: 0 };
      row.status = 'failed';
      row.failure_reason = failureReason;
      row.parse_duration_ms = parseDurationMs;
      row.parse_diagnostics = parseDiagnosticsJson ? JSON.parse(parseDiagnosticsJson) : null;
      return { rows: [], rowCount: 1 };
    }

    // SELECT COUNT(*)::text AS c FROM ux_uploads WHERE tenant_id = $1
    if (lower.startsWith('select count(*)::text as c from ux_uploads')) {
      const tenantId = params[0] as string;
      const c = this.ux_uploads.filter((r) => r.tenant_id === tenantId).length;
      return { rows: [{ c: String(c) } as unknown as R], rowCount: 1 };
    }

    // DELETE FROM ux_uploads WHERE tenant_id = $1
    if (lower.startsWith('delete from ux_uploads')) {
      const tenantId = params[0] as string;
      const before = this.ux_uploads.length;
      this.ux_uploads = this.ux_uploads.filter((r) => r.tenant_id !== tenantId);
      return { rows: [], rowCount: before - this.ux_uploads.length };
    }

    // SELECT preferred_design_source FROM caia_meta.tenants WHERE id = $1
    if (lower.startsWith('select preferred_design_source')) {
      const id = params[0] as string;
      const row = this.tenants.find((t) => t.id === id);
      return {
        rows: row ? [{ preferred_design_source: row.preferred_design_source } as unknown as R] : [],
        rowCount: row ? 1 : 0,
      };
    }

    throw new Error(`fake-pg: unhandled SQL:\n${sql}`);
  }
}

function cloneAsR<R>(row: unknown): R {
  return JSON.parse(JSON.stringify(row)) as R;
}
