/**
 * The portable `SecretsAdapter` interface.
 *
 * Reference: research/multi_tenant_secrets_architecture_2026.md §6.
 *
 * Design choices:
 *   1. `get` takes `AccessContext` so the adapter writes the audit row.
 *   2. `deleteAllForTenant` returns a tombstone ref for GDPR receipts.
 *   3. No encryption details in the interface — adapter-internal.
 */

import type {
  AccessContext,
  AccessLogEntry,
  DeleteAllForTenantOptions,
  DeleteAllResult,
  DeleteOptions,
  PingResult,
  PutOptions,
  PutResult,
  RotateResult,
  SecretMetadata,
} from './types.js';

export interface SecretsAdapter {
  put(
    tenantId: string,
    category: string,
    key: string,
    value: string,
    opts?: PutOptions,
  ): Promise<PutResult>;

  get(
    tenantId: string,
    category: string,
    key: string,
    callerContext: AccessContext,
  ): Promise<string>;

  list(tenantId: string, category?: string): Promise<SecretMetadata[]>;

  rotate(
    tenantId: string,
    category: string,
    key: string,
  ): Promise<RotateResult>;

  delete(
    tenantId: string,
    category: string,
    key: string,
    opts?: DeleteOptions,
  ): Promise<void>;

  deleteAllForTenant(
    tenantId: string,
    opts?: DeleteAllForTenantOptions,
  ): Promise<DeleteAllResult>;

  auditLog(
    tenantId: string,
    since?: Date,
    until?: Date,
  ): Promise<AccessLogEntry[]>;

  ping(): Promise<PingResult>;
}
