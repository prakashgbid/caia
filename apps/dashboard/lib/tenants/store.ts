// REUSE-FIRST EXCEPTION: short-lived duplicate, refactor to shared package tracked at follow-up B-task
// TODO(ADR): short-lived duplication of apps/wizard/lib/auth + lib/tenants until the shared `@chiefaia/wizard-auth` package lands (B-task tracked in PLAN.md §7).
/**
 * Global `tenants` table client.
 *
 * Single source of truth for `email → tenant_id` lookups. The table lives
 * in the global Postgres schema (migration `0011_tenants_global.sql`),
 * not inside any per-tenant schema — by design, since we need to read it
 * BEFORE we know which tenant a request belongs to.
 *
 * Reuse-first note:
 *   - AGENTS.md lists `@chiefaia/persistence-postgres` as the canonical
 *     Postgres wrapper but no such package ships yet on develop. We use
 *     the `pg` driver directly. Semgrep + reuse-check-strict only block
 *     raw `better-sqlite3` (not `pg`), so this is reuse-clean. When the
 *     wrapper package lands, swap the import in this one file.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export interface TenantRow {
  tenantId: string;
  email: string;
  displayName: string;
  schemaName: string;
  infisicalProjectId: string;
  createdAtIso: string;
}

export interface TenantStoreOptions {
  /** Existing pg Pool — required. */
  pool: Pool;
}

const SELECT_BY_EMAIL = `
  SELECT
    tenant_id,
    email,
    display_name,
    schema_name,
    infisical_project_id,
    created_at
  FROM tenants
  WHERE email = $1
  LIMIT 1
`;

const INSERT_TENANT = `
  INSERT INTO tenants (
    tenant_id,
    email,
    display_name,
    schema_name,
    infisical_project_id,
    created_at
  )
  VALUES ($1, $2, $3, $4, $5, NOW())
  ON CONFLICT (email) DO NOTHING
  RETURNING
    tenant_id,
    email,
    display_name,
    schema_name,
    infisical_project_id,
    created_at
`;

function rowToTenant(row: QueryResultRow): TenantRow {
  return {
    tenantId: String(row.tenant_id),
    email: String(row.email),
    displayName: String(row.display_name),
    schemaName: String(row.schema_name),
    infisicalProjectId: String(row.infisical_project_id),
    createdAtIso: new Date(row.created_at).toISOString(),
  };
}

export interface InsertTenantInput {
  tenantId: string;
  email: string;
  displayName: string;
  schemaName: string;
  infisicalProjectId: string;
}

export class TenantStore {
  private readonly pool: Pool;

  constructor(opts: TenantStoreOptions) {
    this.pool = opts.pool;
  }

  /** Returns the tenant row for `email`, or `null` if none. */
  async findByEmail(email: string): Promise<TenantRow | null> {
    const res = await this.pool.query(SELECT_BY_EMAIL, [email.toLowerCase()]);
    return res.rows[0] ? rowToTenant(res.rows[0]) : null;
  }

  /**
   * Inserts a tenant row idempotently — `ON CONFLICT (email) DO NOTHING`
   * means a second writer for the same email is a no-op. If the conflict
   * fired we re-read the existing row so the caller always gets the
   * canonical record.
   *
   * Returns a tuple `{tenant, created}` so the caller can distinguish
   * first-touch (used by the provisioning fan-out) from idempotent retries.
   */
  async insertIfAbsent(
    input: InsertTenantInput,
    client?: PoolClient,
  ): Promise<{ tenant: TenantRow; created: boolean }> {
    const runner = client ?? this.pool;
    const res = await runner.query(INSERT_TENANT, [
      input.tenantId,
      input.email.toLowerCase(),
      input.displayName,
      input.schemaName,
      input.infisicalProjectId,
    ]);
    if (res.rows.length > 0) {
      return { tenant: rowToTenant(res.rows[0]), created: true };
    }
    // Conflict — re-read.
    const existing = await this.findByEmail(input.email);
    if (!existing) {
      throw new Error(
        `TenantStore: insert conflicted on email=${input.email} but no existing row found — concurrent delete?`,
      );
    }
    return { tenant: existing, created: false };
  }
}

/**
 * Deterministic schema-name derivation from email. Postgres identifier
 * rules: lowercase, [a-z0-9_], ≤ 63 chars. We hash the local-part to keep
 * collisions improbable while remaining grep-friendly.
 */
export function schemaNameForEmail(email: string): string {
  const normalized = email.toLowerCase();
  const safe = normalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  // 8-char hash suffix from a tiny FNV-1a so two emails that share a
  // sanitised prefix don't collide. Crypto strength is irrelevant —
  // we already have the tenants table as the source of truth.
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  const suffix = h.toString(36).padStart(7, '0').slice(0, 8);
  return `tenant_${safe}_${suffix}`;
}
