/**
 * In-memory `OnboardingStore` — used by tests and dev. Mirrors the
 * `caia_meta.*` schema's UNIQUE constraints (tenant+category for steps,
 * tenant+category+key+status for credentials).
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

function nowIso(): Date {
  return new Date();
}

function uuid(): string {
  // Tests don't need RFC-4122 compliance, just uniqueness.
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  );
}

export class InMemoryOnboardingStore implements OnboardingStore {
  private readonly tenants = new Map<string, TenantRow>();
  private readonly steps = new Map<string, OnboardingStepRow>();
  private readonly choices = new Map<string, CustomerChoiceRow>();
  private readonly creds = new Map<string, CredentialRow>();
  private readonly audit: AuditLogEntry[] = [];

  private stepKey(tenantId: string, category: CategoryId): string {
    return `${tenantId}:${category}`;
  }
  private choiceKey(
    tenantId: string,
    category: CategoryId,
    choiceKey: string,
  ): string {
    return `${tenantId}:${category}:${choiceKey}`;
  }
  private credKey(
    tenantId: string,
    category: CategoryId,
    keyId: string,
  ): string {
    return `${tenantId}:${category}:${keyId}`;
  }

  async createTenant(
    input: Omit<TenantRow, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'onboardingComplete'> & {
      id?: string;
    },
  ): Promise<TenantRow> {
    const id = input.id ?? uuid();
    const row: TenantRow = {
      id,
      slug: input.slug,
      name: input.name,
      ownerEmail: input.ownerEmail,
      billingEmail: input.billingEmail,
      timezone: input.timezone,
      locale: input.locale,
      status: 'onboarding',
      onboardingComplete: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.tenants.set(id, row);
    return row;
  }

  async getTenant(id: string): Promise<TenantRow | undefined> {
    return this.tenants.get(id);
  }

  async markTenantOnboarded(id: string): Promise<void> {
    const t = this.tenants.get(id);
    if (!t) throw new Error(`tenant not found: ${id}`);
    this.tenants.set(id, {
      ...t,
      onboardingComplete: true,
      status: 'onboarded',
      updatedAt: nowIso(),
    });
  }

  async upsertStep(input: OnboardingStepRow): Promise<OnboardingStepRow> {
    const k = this.stepKey(input.tenantId, input.category);
    const existing = this.steps.get(k);
    const merged: OnboardingStepRow = existing
      ? { ...existing, ...input }
      : { ...input };
    this.steps.set(k, merged);
    return merged;
  }

  async setStepStatus(
    tenantId: string,
    category: CategoryId,
    status: StepStatus,
    fields: Partial<OnboardingStepRow> = {},
  ): Promise<OnboardingStepRow> {
    const k = this.stepKey(tenantId, category);
    const existing = this.steps.get(k);
    const base: OnboardingStepRow = existing ?? {
      tenantId,
      category,
      status: 'pending',
      required: true,
      attemptCount: 0,
    };
    const next: OnboardingStepRow = {
      ...base,
      ...fields,
      status,
      attemptCount: (base.attemptCount ?? 0) + (status === 'probing' ? 1 : 0),
    };
    this.steps.set(k, next);
    return next;
  }

  async listSteps(tenantId: string): Promise<OnboardingStepRow[]> {
    return [...this.steps.values()].filter((r) => r.tenantId === tenantId);
  }

  async getStep(
    tenantId: string,
    category: CategoryId,
  ): Promise<OnboardingStepRow | undefined> {
    return this.steps.get(this.stepKey(tenantId, category));
  }

  async putChoice(row: CustomerChoiceRow): Promise<void> {
    this.choices.set(
      this.choiceKey(row.tenantId, row.category, row.choiceKey),
      row,
    );
  }

  async listChoices(tenantId: string): Promise<CustomerChoiceRow[]> {
    return [...this.choices.values()].filter((r) => r.tenantId === tenantId);
  }

  async putCredential(row: CredentialRow): Promise<CredentialRow> {
    this.creds.set(this.credKey(row.tenantId, row.category, row.keyId), row);
    return row;
  }

  async listCredentials(tenantId: string): Promise<CredentialRow[]> {
    return [...this.creds.values()].filter((r) => r.tenantId === tenantId);
  }

  async getCredential(
    tenantId: string,
    category: CategoryId,
    keyId: string,
  ): Promise<CredentialRow | undefined> {
    return this.creds.get(this.credKey(tenantId, category, keyId));
  }

  async appendAudit(entry: AuditLogEntry): Promise<void> {
    this.audit.push({ ...entry, occurredAt: entry.occurredAt ?? nowIso() });
  }

  async listAudit(tenantId: string, limit = 1000): Promise<AuditLogEntry[]> {
    return this.audit
      .filter((e) => e.tenantId === tenantId)
      .slice(-limit)
      .reverse();
  }
}
