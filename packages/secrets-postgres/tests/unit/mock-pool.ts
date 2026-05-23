/**
 * Hand-rolled in-memory Postgres mock implementing `PoolLike`.
 *
 * Why not pg-mem? Because we want zero non-trivial deps in the test
 * fixture and we want fine-grained control over query routing for
 * audit-log testing. The shapes mirror the real schema's columns.
 */

import type { PoolLike, QueryResultLike } from '../../src/pg-types.js';

interface SecretRow {
  id: number;
  tenant_id: string;
  category: string;
  key: string;
  ciphertext_b64: string;
  version: number;
  created_at: Date;
  last_accessed_at: Date | null;
  last_rotated_at: Date | null;
  expires_at: Date | null;
}

interface AuditRow {
  id: number;
  tenant_id: string;
  category: string;
  key: string;
  backend: string;
  action: string;
  caller_type: string;
  caller_id: string;
  ticket_id: string | null;
  reason: string;
  capability_token_id: string | null;
  requester_ip: string | null;
  granted_at: Date;
  ok: boolean;
  error_class: string | null;
  provider_trace: string | null;
}

interface ShredRow {
  tenant_id: string;
  shredded_at: Date;
  tombstone_ref: string;
}

export class MockPool implements PoolLike {
  public secrets: SecretRow[] = [];
  public audit: AuditRow[] = [];
  public shred: ShredRow[] = [];
  private nextSecretId = 1;
  private nextAuditId = 1;
  public failNext: { match: RegExp; err: Error } | null = null;
  public capturedQueries: { text: string; values: readonly unknown[] }[] = [];

  async query<R = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResultLike<R>> {
    this.capturedQueries.push({ text, values });
    if (this.failNext && this.failNext.match.test(text)) {
      const err = this.failNext.err;
      this.failNext = null;
      throw err;
    }
    const s = text.replace(/\s+/g, ' ').trim();

    // SELECT 1 — ping
    if (s === 'SELECT 1') {
      return { rows: [{ '?column?': 1 }] as unknown as R[], rowCount: 1 };
    }

    // SELECT from tenant_crypto_shred
    if (s.startsWith('SELECT tenant_id FROM caia_meta.tenant_crypto_shred')) {
      const tenantId = values[0] as string;
      const found = this.shred.filter((r) => r.tenant_id === tenantId);
      return { rows: found as unknown as R[], rowCount: found.length };
    }

    // INSERT into tenant_crypto_shred (upsert)
    if (s.startsWith('INSERT INTO caia_meta.tenant_crypto_shred')) {
      const tenantId = values[0] as string;
      const tombstoneRef = values[1] as string;
      const existing = this.shred.find((r) => r.tenant_id === tenantId);
      if (existing) {
        existing.tombstone_ref = tombstoneRef;
      } else {
        this.shred.push({
          tenant_id: tenantId,
          tombstone_ref: tombstoneRef,
          shredded_at: new Date(),
        });
      }
      return { rows: [], rowCount: 1 };
    }

    // COUNT(*) from tenant_secrets_cold
    if (s.startsWith('SELECT COUNT(*)::text AS n FROM caia_meta.tenant_secrets_cold')) {
      const tenantId = values[0] as string;
      const count = this.secrets.filter((r) => r.tenant_id === tenantId).length;
      return {
        rows: [{ n: String(count) }] as unknown as R[],
        rowCount: 1,
      };
    }

    // INSERT into tenant_secrets_cold with ON CONFLICT (upsert)
    if (
      s.startsWith('INSERT INTO caia_meta.tenant_secrets_cold') &&
      s.includes('ON CONFLICT')
    ) {
      const [tenantId, category, key, ciphertext, expiresAt] = values as [
        string,
        string,
        string,
        string,
        Date | null,
      ];
      const existing = this.secrets.find(
        (r) =>
          r.tenant_id === tenantId &&
          r.category === category &&
          r.key === key,
      );
      if (existing) {
        existing.ciphertext_b64 = ciphertext;
        existing.version += 1;
        existing.expires_at = expiresAt;
        existing.last_rotated_at = new Date();
        return {
          rows: [{ id: existing.id, version: existing.version }] as unknown as R[],
          rowCount: 1,
        };
      }
      const id = this.nextSecretId++;
      this.secrets.push({
        id,
        tenant_id: tenantId,
        category,
        key,
        ciphertext_b64: ciphertext,
        version: 1,
        created_at: new Date(),
        last_accessed_at: null,
        last_rotated_at: null,
        expires_at: expiresAt,
      });
      return { rows: [{ id, version: 1 }] as unknown as R[], rowCount: 1 };
    }

    // INSERT into tenant_secrets_cold (plain — fails on conflict)
    if (s.startsWith('INSERT INTO caia_meta.tenant_secrets_cold')) {
      const [tenantId, category, key, ciphertext, expiresAt] = values as [
        string,
        string,
        string,
        string,
        Date | null,
      ];
      const conflict = this.secrets.find(
        (r) =>
          r.tenant_id === tenantId &&
          r.category === category &&
          r.key === key,
      );
      if (conflict) {
        const err = new Error('duplicate key value violates unique constraint') as Error & {
          code?: string;
        };
        err.code = '23505';
        throw err;
      }
      const id = this.nextSecretId++;
      this.secrets.push({
        id,
        tenant_id: tenantId,
        category,
        key,
        ciphertext_b64: ciphertext,
        version: 1,
        created_at: new Date(),
        last_accessed_at: null,
        last_rotated_at: null,
        expires_at: expiresAt,
      });
      return { rows: [{ id, version: 1 }] as unknown as R[], rowCount: 1 };
    }

    // SELECT a single secret row
    if (
      s.startsWith(
        'SELECT id, ciphertext_b64, version, created_at, last_accessed_at, last_rotated_at, expires_at FROM caia_meta.tenant_secrets_cold',
      )
    ) {
      const [tenantId, category, key] = values as [string, string, string];
      const row = this.secrets.find(
        (r) =>
          r.tenant_id === tenantId &&
          r.category === category &&
          r.key === key,
      );
      return { rows: row ? ([row] as unknown as R[]) : [], rowCount: row ? 1 : 0 };
    }

    // SELECT list metadata
    if (
      s.startsWith(
        'SELECT id, tenant_id, category, key, version, created_at, last_accessed_at, last_rotated_at, expires_at FROM caia_meta.tenant_secrets_cold',
      )
    ) {
      const tenantId = values[0] as string;
      const category = values[1] as string | undefined;
      const now = Date.now();
      const rows = this.secrets
        .filter((r) => r.tenant_id === tenantId)
        .filter((r) => (category ? r.category === category : true))
        .filter((r) => r.expires_at === null || r.expires_at.getTime() > now)
        .sort((a, b) =>
          a.category === b.category
            ? a.key.localeCompare(b.key)
            : a.category.localeCompare(b.category),
        );
      return { rows: rows as unknown as R[], rowCount: rows.length };
    }

    // UPDATE last_accessed_at (best-effort, no return required)
    if (
      s.startsWith(
        'UPDATE caia_meta.tenant_secrets_cold SET last_accessed_at',
      )
    ) {
      const id = values[0] as number;
      const row = this.secrets.find((r) => r.id === id);
      if (row) row.last_accessed_at = new Date();
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    // UPDATE rotate version
    if (
      s.startsWith(
        'UPDATE caia_meta.tenant_secrets_cold SET version = version + 1',
      )
    ) {
      const [tenantId, category, key] = values as [string, string, string];
      const row = this.secrets.find(
        (r) =>
          r.tenant_id === tenantId &&
          r.category === category &&
          r.key === key,
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.version += 1;
      row.last_rotated_at = new Date();
      return {
        rows: [{ version: row.version, last_rotated_at: row.last_rotated_at }] as unknown as R[],
        rowCount: 1,
      };
    }

    // DELETE one secret
    if (
      s.startsWith(
        'DELETE FROM caia_meta.tenant_secrets_cold WHERE tenant_id = $1 AND category = $2 AND key = $3',
      )
    ) {
      const [tenantId, category, key] = values as [string, string, string];
      const before = this.secrets.length;
      this.secrets = this.secrets.filter(
        (r) =>
          !(
            r.tenant_id === tenantId &&
            r.category === category &&
            r.key === key
          ),
      );
      return { rows: [], rowCount: before - this.secrets.length };
    }

    // DELETE all for tenant
    if (
      s.startsWith(
        'DELETE FROM caia_meta.tenant_secrets_cold WHERE tenant_id = $1',
      )
    ) {
      const tenantId = values[0] as string;
      const before = this.secrets.length;
      this.secrets = this.secrets.filter((r) => r.tenant_id !== tenantId);
      return { rows: [], rowCount: before - this.secrets.length };
    }

    // INSERT into audit_log
    if (s.startsWith('INSERT INTO caia_meta.audit_log')) {
      const [
        tenantId,
        category,
        key,
        backend,
        action,
        callerType,
        callerId,
        ticketId,
        reason,
        capabilityTokenId,
        requesterIp,
        ok,
        errorClass,
        providerTrace,
      ] = values as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string | null,
        string,
        string | null,
        string | null,
        boolean,
        string | null,
        string | null,
      ];
      this.audit.push({
        id: this.nextAuditId++,
        tenant_id: tenantId,
        category,
        key,
        backend,
        action,
        caller_type: callerType,
        caller_id: callerId,
        ticket_id: ticketId,
        reason,
        capability_token_id: capabilityTokenId,
        requester_ip: requesterIp,
        granted_at: new Date(),
        ok,
        error_class: errorClass,
        provider_trace: providerTrace,
      });
      return { rows: [], rowCount: 1 };
    }

    // SELECT audit_log
    if (s.startsWith('SELECT tenant_id, category, key, caller_type')) {
      const [tenantId, backend] = values as [string, string];
      const rows = this.audit
        .filter((r) => r.tenant_id === tenantId && r.backend === backend)
        .sort((a, b) => b.granted_at.getTime() - a.granted_at.getTime());
      return { rows: rows as unknown as R[], rowCount: rows.length };
    }

    throw new Error(`MockPool: unrecognized query: ${s.slice(0, 100)}…`);
  }
}
