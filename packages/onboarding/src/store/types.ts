/**
 * Onboarding store contracts — the engine talks to these interfaces;
 * production wires a Postgres implementation, tests wire the
 * in-memory implementation in this directory.
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

export interface OnboardingStore {
  // Tenants
  createTenant(
    input: Omit<TenantRow, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'onboardingComplete'> & {
      id?: string;
    },
  ): Promise<TenantRow>;
  getTenant(id: string): Promise<TenantRow | undefined>;
  markTenantOnboarded(id: string): Promise<void>;

  // Steps (one row per (tenant, category))
  upsertStep(input: OnboardingStepRow): Promise<OnboardingStepRow>;
  setStepStatus(
    tenantId: string,
    category: CategoryId,
    status: StepStatus,
    fields?: Partial<OnboardingStepRow>,
  ): Promise<OnboardingStepRow>;
  listSteps(tenantId: string): Promise<OnboardingStepRow[]>;
  getStep(
    tenantId: string,
    category: CategoryId,
  ): Promise<OnboardingStepRow | undefined>;

  // Choices
  putChoice(row: CustomerChoiceRow): Promise<void>;
  listChoices(tenantId: string): Promise<CustomerChoiceRow[]>;

  // Credentials (secret_ref pointers, never raw values)
  putCredential(row: CredentialRow): Promise<CredentialRow>;
  listCredentials(tenantId: string): Promise<CredentialRow[]>;
  getCredential(
    tenantId: string,
    category: CategoryId,
    keyId: string,
  ): Promise<CredentialRow | undefined>;

  // Audit
  appendAudit(entry: AuditLogEntry): Promise<void>;
  listAudit(tenantId: string, limit?: number): Promise<AuditLogEntry[]>;
}
