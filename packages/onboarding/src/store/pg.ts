/**
 * Postgres-backed `OnboardingStore` — written against the `pg`
 * driver's `Pool` interface; we accept a generic `PgClient` so the
 * package doesn't have a hard dependency on `pg`.
 *
 * Production callers should pass a `pg.Pool` instance.
 */

import type {
  AuditLogEntry,
  CategoryId,
  CredentialRow,
  CustomerChoiceRow,
  OnboardingStepRow,
  StepStatus,
  TenantRow,
} from '../types.js';
import type { OnboardingStore } from './types.js';

export interface PgClient {
  query<T = unknown>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

interface TenantSqlRow {
  id: string;
  slug: string;
  name: string;
  owner_email: string;
  billing_email: string;
  timezone: string;
  locale: string;
  status: TenantRow['status'];
  onboarding_complete: boolean;
  created_at: Date;
  updated_at: Date;
}

interface StepSqlRow {
  tenant_id: string;
  category: CategoryId;
  status: StepStatus;
  required: boolean;
  attempt_count: number;
  last_probe_at: Date | null;
  last_validated_at: Date | null;
  validation_payload: Record<string, unknown> | null;
  failure_reason: string | null;
  deferred_reason: string | null;
  override_reason: string | null;
}

interface ChoiceSqlRow {
  tenant_id: string;
  category: CategoryId;
  choice_key: string;
  choice_value: unknown;
  source: CustomerChoiceRow['source'];
}

interface CredSqlRow {
  tenant_id: string;
  category: CategoryId;
  key_id: string;
  secret_ref: string;
  archetype: CredentialRow['archetype'];
  provider: string;
  scopes_granted: string[];
  scopes_required: string[];
  expires_at: Date | null;
  status: CredentialRow['status'];
  validated_at: Date;
  metadata: Record<string, unknown>;
}

interface AuditSqlRow {
  tenant_id: string;
  actor_type: AuditLogEntry['actorType'];
  actor_id: string | null;
  action: string;
  category: CategoryId | null;
  key_id: string | null;
  request_ip: string | null;
  user_agent: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export class PgOnboardingStore implements OnboardingStore {
  constructor(private readonly db: PgClient) {}

  private mapTenant(r: TenantSqlRow): TenantRow {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      ownerEmail: r.owner_email,
      billingEmail: r.billing_email,
      timezone: r.timezone,
      locale: r.locale,
      status: r.status,
      onboardingComplete: r.onboarding_complete,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapStep(r: StepSqlRow): OnboardingStepRow {
    const row: OnboardingStepRow = {
      tenantId: r.tenant_id,
      category: r.category,
      status: r.status,
      required: r.required,
      attemptCount: r.attempt_count,
    };
    if (r.last_probe_at) row.lastProbeAt = r.last_probe_at;
    if (r.last_validated_at) row.lastValidatedAt = r.last_validated_at;
    if (r.validation_payload) row.validationPayload = r.validation_payload;
    if (r.failure_reason) row.failureReason = r.failure_reason;
    if (r.deferred_reason) row.deferredReason = r.deferred_reason;
    if (r.override_reason) row.overrideReason = r.override_reason;
    return row;
  }

  async createTenant(
    input: Omit<TenantRow, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'onboardingComplete'> & {
      id?: string;
    },
  ): Promise<TenantRow> {
    const { rows } = await this.db.query<TenantSqlRow>(
      `INSERT INTO caia_meta.tenants
       (slug, name, owner_email, billing_email, timezone, locale, status)
       VALUES ($1,$2,$3,$4,$5,$6,'onboarding')
       RETURNING *`,
      [
        input.slug,
        input.name,
        input.ownerEmail,
        input.billingEmail,
        input.timezone,
        input.locale,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error('createTenant returned no row');
    return this.mapTenant(row);
  }

  async getTenant(id: string): Promise<TenantRow | undefined> {
    const { rows } = await this.db.query<TenantSqlRow>(
      `SELECT * FROM caia_meta.tenants WHERE id = $1`,
      [id],
    );
    return rows[0] ? this.mapTenant(rows[0]) : undefined;
  }

  async markTenantOnboarded(id: string): Promise<void> {
    await this.db.query(
      `UPDATE caia_meta.tenants
       SET onboarding_complete = true, status = 'onboarded',
           onboarding_completed_at = now()
       WHERE id = $1`,
      [id],
    );
  }

  async upsertStep(input: OnboardingStepRow): Promise<OnboardingStepRow> {
    const { rows } = await this.db.query<StepSqlRow>(
      `INSERT INTO caia_meta.onboarding_steps
       (tenant_id, category, status, required, attempt_count)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, category) DO UPDATE SET
         status = EXCLUDED.status,
         required = EXCLUDED.required,
         attempt_count = EXCLUDED.attempt_count
       RETURNING *`,
      [
        input.tenantId,
        input.category,
        input.status,
        input.required,
        input.attemptCount,
      ],
    );
    return this.mapStep(rows[0] as StepSqlRow);
  }

  async setStepStatus(
    tenantId: string,
    category: CategoryId,
    status: StepStatus,
    fields: Partial<OnboardingStepRow> = {},
  ): Promise<OnboardingStepRow> {
    const required = fields.required ?? true;
    const { rows } = await this.db.query<StepSqlRow>(
      `INSERT INTO caia_meta.onboarding_steps
       (tenant_id, category, status, required, attempt_count,
        last_probe_at, last_validated_at, validation_payload,
        failure_reason, deferred_reason, override_reason)
       VALUES ($1,$2,$3,$4,1,
               $5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, category) DO UPDATE SET
         status = EXCLUDED.status,
         required = caia_meta.onboarding_steps.required OR EXCLUDED.required,
         attempt_count = caia_meta.onboarding_steps.attempt_count
                       + CASE WHEN EXCLUDED.status = 'probing' THEN 1 ELSE 0 END,
         last_probe_at = COALESCE(EXCLUDED.last_probe_at, caia_meta.onboarding_steps.last_probe_at),
         last_validated_at = COALESCE(EXCLUDED.last_validated_at, caia_meta.onboarding_steps.last_validated_at),
         validation_payload = COALESCE(EXCLUDED.validation_payload, caia_meta.onboarding_steps.validation_payload),
         failure_reason = EXCLUDED.failure_reason,
         deferred_reason = EXCLUDED.deferred_reason,
         override_reason = EXCLUDED.override_reason
       RETURNING *`,
      [
        tenantId,
        category,
        status,
        required,
        fields.lastProbeAt ?? null,
        fields.lastValidatedAt ?? null,
        fields.validationPayload ? JSON.stringify(fields.validationPayload) : null,
        fields.failureReason ?? null,
        fields.deferredReason ?? null,
        fields.overrideReason ?? null,
      ],
    );
    return this.mapStep(rows[0] as StepSqlRow);
  }

  async listSteps(tenantId: string): Promise<OnboardingStepRow[]> {
    const { rows } = await this.db.query<StepSqlRow>(
      `SELECT * FROM caia_meta.onboarding_steps WHERE tenant_id = $1`,
      [tenantId],
    );
    return rows.map((r) => this.mapStep(r));
  }

  async getStep(
    tenantId: string,
    category: CategoryId,
  ): Promise<OnboardingStepRow | undefined> {
    const { rows } = await this.db.query<StepSqlRow>(
      `SELECT * FROM caia_meta.onboarding_steps
        WHERE tenant_id = $1 AND category = $2`,
      [tenantId, category],
    );
    return rows[0] ? this.mapStep(rows[0]) : undefined;
  }

  async putChoice(row: CustomerChoiceRow): Promise<void> {
    await this.db.query(
      `INSERT INTO caia_meta.customer_choices
       (tenant_id, category, choice_key, choice_value, source)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (tenant_id, category, choice_key) DO UPDATE SET
         choice_value = EXCLUDED.choice_value,
         source = EXCLUDED.source`,
      [row.tenantId, row.category, row.choiceKey, JSON.stringify(row.choiceValue), row.source],
    );
  }

  async listChoices(tenantId: string): Promise<CustomerChoiceRow[]> {
    const { rows } = await this.db.query<ChoiceSqlRow>(
      `SELECT * FROM caia_meta.customer_choices WHERE tenant_id = $1`,
      [tenantId],
    );
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      category: r.category,
      choiceKey: r.choice_key,
      choiceValue: r.choice_value,
      source: r.source,
    }));
  }

  async putCredential(row: CredentialRow): Promise<CredentialRow> {
    const { rows } = await this.db.query<CredSqlRow>(
      `INSERT INTO caia_meta.credentials
       (tenant_id, category, key_id, secret_ref, archetype, provider,
        scopes_granted, scopes_required, expires_at, status, validated_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT (tenant_id, category, key_id, status) DO UPDATE SET
         secret_ref = EXCLUDED.secret_ref,
         scopes_granted = EXCLUDED.scopes_granted,
         scopes_required = EXCLUDED.scopes_required,
         expires_at = EXCLUDED.expires_at,
         validated_at = EXCLUDED.validated_at,
         metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        row.tenantId,
        row.category,
        row.keyId,
        row.secretRef,
        row.archetype,
        row.provider,
        row.scopesGranted,
        row.scopesRequired,
        row.expiresAt ?? null,
        row.status,
        row.validatedAt,
        JSON.stringify(row.metadata),
      ],
    );
    const r = rows[0] as CredSqlRow;
    const out: CredentialRow = {
      tenantId: r.tenant_id,
      category: r.category,
      keyId: r.key_id,
      secretRef: r.secret_ref,
      archetype: r.archetype,
      provider: r.provider,
      scopesGranted: r.scopes_granted,
      scopesRequired: r.scopes_required,
      status: r.status,
      validatedAt: r.validated_at,
      metadata: r.metadata,
    };
    if (r.expires_at) out.expiresAt = r.expires_at;
    return out;
  }

  async listCredentials(tenantId: string): Promise<CredentialRow[]> {
    const { rows } = await this.db.query<CredSqlRow>(
      `SELECT * FROM caia_meta.credentials WHERE tenant_id = $1`,
      [tenantId],
    );
    return rows.map((r) => {
      const out: CredentialRow = {
        tenantId: r.tenant_id,
        category: r.category,
        keyId: r.key_id,
        secretRef: r.secret_ref,
        archetype: r.archetype,
        provider: r.provider,
        scopesGranted: r.scopes_granted ?? [],
        scopesRequired: r.scopes_required ?? [],
        status: r.status,
        validatedAt: r.validated_at,
        metadata: r.metadata ?? {},
      };
      if (r.expires_at) out.expiresAt = r.expires_at;
      return out;
    });
  }

  async getCredential(
    tenantId: string,
    category: CategoryId,
    keyId: string,
  ): Promise<CredentialRow | undefined> {
    const { rows } = await this.db.query<CredSqlRow>(
      `SELECT * FROM caia_meta.credentials
        WHERE tenant_id = $1 AND category = $2 AND key_id = $3 AND status = 'active'`,
      [tenantId, category, keyId],
    );
    if (!rows[0]) return undefined;
    const r = rows[0];
    const out: CredentialRow = {
      tenantId: r.tenant_id,
      category: r.category,
      keyId: r.key_id,
      secretRef: r.secret_ref,
      archetype: r.archetype,
      provider: r.provider,
      scopesGranted: r.scopes_granted ?? [],
      scopesRequired: r.scopes_required ?? [],
      status: r.status,
      validatedAt: r.validated_at,
      metadata: r.metadata ?? {},
    };
    if (r.expires_at) out.expiresAt = r.expires_at;
    return out;
  }

  async appendAudit(entry: AuditLogEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO caia_meta.audit_log
       (tenant_id, actor_type, actor_id, action, category, key_id,
        request_ip, user_agent, payload, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        entry.tenantId,
        entry.actorType,
        entry.actorId ?? null,
        entry.action,
        entry.category ?? null,
        entry.keyId ?? null,
        entry.requestIp ?? null,
        entry.userAgent ?? null,
        JSON.stringify(entry.payload),
        entry.occurredAt ?? new Date(),
      ],
    );
  }

  async listAudit(tenantId: string, limit = 1000): Promise<AuditLogEntry[]> {
    const { rows } = await this.db.query<AuditSqlRow>(
      `SELECT * FROM caia_meta.audit_log
        WHERE tenant_id = $1
        ORDER BY occurred_at DESC
        LIMIT $2`,
      [tenantId, limit],
    );
    return rows.map((r) => {
      const entry: AuditLogEntry = {
        tenantId: r.tenant_id,
        actorType: r.actor_type,
        action: r.action,
        payload: r.payload ?? {},
        occurredAt: r.occurred_at,
      };
      if (r.actor_id) entry.actorId = r.actor_id;
      if (r.category) entry.category = r.category;
      if (r.key_id) entry.keyId = r.key_id;
      if (r.request_ip) entry.requestIp = r.request_ip;
      if (r.user_agent) entry.userAgent = r.user_agent;
      return entry;
    });
  }
}
