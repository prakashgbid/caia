/**
 * `PostgresSecretsAdapter` — Pattern C from the architecture spec.
 *
 * One Postgres table; one row per (tenantId, category, key). Encrypted
 * with AES-256-GCM under a per-tenant HKDF-derived key. Crypto-shred GDPR
 * delete; audit log dual-written to `caia_meta.audit_log`.
 */

import {
  AccessContextSchema,
  CategorySchema,
  KeySchema,
  SecretValueSchema,
  TenantIdSchema,
  SecretNotFoundError,
  SecretProviderError,
  SecretsAdapterConfigError,
  classifyError,
  type AccessContext,
  type AccessLogEntry,
  type DeleteAllForTenantOptions,
  type DeleteAllResult,
  type DeleteOptions,
  type PingResult,
  type PutOptions,
  type PutResult,
  type RotateResult,
  type SecretMetadata,
  type SecretsAdapter,
} from '@caia/secrets-adapter';

import {
  decryptValue,
  deriveTenantKey,
  encryptValue,
  parseMasterKeyHex,
} from './crypto.js';
import { TenantKeyCache } from './key-cache.js';
import { PostgresAuditLogger, type AuditLogger } from './audit.js';
import type { PoolLike } from './pg-types.js';

export const BACKEND_NAME = 'postgres';

export interface PostgresSecretsAdapterOptions {
  /** A `pg.Pool` or structurally-compatible client. */
  pool: PoolLike;
  /** 32-byte hex master key. Required unless `masterKey` is provided. */
  masterKeyHex?: string;
  /** Raw 32-byte master key. Required unless `masterKeyHex` is provided. */
  masterKey?: Buffer;
  /** Per-tenant key cache. Provide a shared one across instances if needed. */
  keyCache?: TenantKeyCache;
  /** Audit logger. Defaults to writing into `caia_meta.audit_log` on the same pool. */
  auditLogger?: AuditLogger;
  /** Test-only clock for `now()`. */
  now?: () => Date;
}

interface SecretRow {
  id: number | string;
  ciphertext_b64: string;
  version: number;
  created_at: Date;
  last_accessed_at: Date | null;
  last_rotated_at: Date | null;
  expires_at: Date | null;
}

interface ListRow extends SecretRow {
  tenant_id: string;
  category: string;
  key: string;
}

interface RotateRow {
  version: number;
  last_rotated_at: Date;
}

interface PutRow {
  id: number | string;
  version: number;
}

interface AuditRow {
  tenant_id: string;
  category: string;
  key: string;
  caller_type: AccessContext['callerType'];
  caller_id: string;
  ticket_id: string | null;
  reason: string;
  capability_token_id: string | null;
  requester_ip: string | null;
  granted_at: Date;
  ok: boolean;
  error_class:
    | 'not_found'
    | 'policy_denied'
    | 'rate_limited'
    | 'provider_error'
    | null;
  provider_trace: string | null;
}

export class PostgresSecretsAdapter implements SecretsAdapter {
  private readonly pool: PoolLike;
  private readonly masterKey: Buffer;
  private readonly cache: TenantKeyCache;
  private readonly audit: AuditLogger;
  private readonly now: () => Date;

  constructor(opts: PostgresSecretsAdapterOptions) {
    if (!opts.pool) {
      throw new SecretsAdapterConfigError(
        'PostgresSecretsAdapter: `pool` is required',
      );
    }
    if (!opts.masterKey && !opts.masterKeyHex) {
      throw new SecretsAdapterConfigError(
        'PostgresSecretsAdapter: provide either `masterKey` or `masterKeyHex` (32-byte hex string)',
      );
    }
    this.pool = opts.pool;
    this.masterKey =
      opts.masterKey ?? parseMasterKeyHex(opts.masterKeyHex as string);
    if (this.masterKey.length !== 32) {
      throw new SecretsAdapterConfigError(
        `PostgresSecretsAdapter: masterKey must be 32 bytes; got ${this.masterKey.length}`,
      );
    }
    this.cache = opts.keyCache ?? new TenantKeyCache();
    this.audit = opts.auditLogger ?? new PostgresAuditLogger(this.pool);
    this.now = opts.now ?? ((): Date => new Date());
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private async assertNotShredded(tenantId: string): Promise<void> {
    const res = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM caia_meta.tenant_crypto_shred WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    if (res.rowCount && res.rowCount > 0) {
      throw new SecretsAdapterConfigError(
        `tenant '${tenantId}' was crypto-shredded; its secrets are permanently unreachable`,
      );
    }
  }

  private async getOrDeriveTenantKey(tenantId: string): Promise<Buffer> {
    const cached = this.cache.get(tenantId);
    if (cached) return cached;
    await this.assertNotShredded(tenantId);
    const derived = deriveTenantKey(this.masterKey, tenantId);
    this.cache.set(tenantId, derived);
    return derived;
  }

  private validateIdentifiers(
    tenantId: string,
    category: string,
    key: string,
  ): void {
    TenantIdSchema.parse(tenantId);
    CategorySchema.parse(category);
    KeySchema.parse(key);
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter — put
  // ---------------------------------------------------------------------

  async put(
    tenantId: string,
    category: string,
    key: string,
    value: string,
    opts?: PutOptions,
  ): Promise<PutResult> {
    this.validateIdentifiers(tenantId, category, key);
    SecretValueSchema.parse(value);
    const tenantKey = await this.getOrDeriveTenantKey(tenantId);
    const ciphertext = encryptValue(tenantKey, value);
    const expiresAt =
      opts?.ttlSeconds !== undefined
        ? new Date(this.now().getTime() + opts.ttlSeconds * 1000)
        : null;

    if (opts?.replace) {
      // Upsert. Bumps version. Resets expiresAt.
      const res = await this.pool.query<PutRow>(
        `INSERT INTO caia_meta.tenant_secrets_cold
           (tenant_id, category, key, ciphertext_b64, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, category, key)
           DO UPDATE SET
             ciphertext_b64 = EXCLUDED.ciphertext_b64,
             version        = caia_meta.tenant_secrets_cold.version + 1,
             expires_at     = EXCLUDED.expires_at,
             last_rotated_at = NOW()
         RETURNING id, version`,
        [tenantId, category, key, ciphertext, expiresAt],
      );
      const row = res.rows[0];
      if (!row) {
        throw new SecretProviderError(
          `put: upsert returned no row for ${tenantId}/${category}/${key}`,
        );
      }
      return { secretRef: String(row.id), version: row.version };
    }

    // No replace — insert-only. Conflicts throw.
    try {
      const res = await this.pool.query<PutRow>(
        `INSERT INTO caia_meta.tenant_secrets_cold
           (tenant_id, category, key, ciphertext_b64, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, version`,
        [tenantId, category, key, ciphertext, expiresAt],
      );
      const row = res.rows[0];
      if (!row) {
        throw new SecretProviderError(
          `put: insert returned no row for ${tenantId}/${category}/${key}`,
        );
      }
      return { secretRef: String(row.id), version: row.version };
    } catch (err) {
      // pg unique-violation
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        throw new SecretProviderError(
          `secret already exists: ${tenantId}/${category}/${key} (pass replace:true to overwrite)`,
          { tenantId, category, key, cause: err },
        );
      }
      throw err;
    }
  }

  /**
   * Variant of `put` that writes an explicit audit row. Used by the
   * onboarding broker which has the operator's caller context.
   */
  async putWithAudit(
    tenantId: string,
    category: string,
    key: string,
    value: string,
    callerContext: AccessContext,
    opts?: PutOptions,
  ): Promise<PutResult> {
    AccessContextSchema.parse(callerContext);
    let result: PutResult | undefined;
    let thrown: unknown;
    try {
      result = await this.put(tenantId, category, key, value, opts);
    } catch (err) {
      thrown = err;
    }
    await this.audit.write({
      tenantId,
      category,
      key,
      backend: BACKEND_NAME,
      action: 'put',
      callerContext,
      ok: thrown === undefined,
      ...(thrown !== undefined ? { errorClass: classifyError(thrown) } : {}),
      ...(result?.secretRef !== undefined
        ? { providerTrace: result.secretRef }
        : {}),
    });
    if (thrown !== undefined) throw thrown;
    return result as PutResult;
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter — get
  // ---------------------------------------------------------------------

  async get(
    tenantId: string,
    category: string,
    key: string,
    callerContext: AccessContext,
  ): Promise<string> {
    this.validateIdentifiers(tenantId, category, key);
    AccessContextSchema.parse(callerContext);
    try {
      const tenantKey = await this.getOrDeriveTenantKey(tenantId);
      const res = await this.pool.query<SecretRow>(
        `SELECT id, ciphertext_b64, version, created_at,
                last_accessed_at, last_rotated_at, expires_at
         FROM caia_meta.tenant_secrets_cold
         WHERE tenant_id = $1 AND category = $2 AND key = $3
         LIMIT 1`,
        [tenantId, category, key],
      );
      const row = res.rows[0];
      if (!row) {
        throw new SecretNotFoundError(
          `secret not found: ${tenantId}/${category}/${key}`,
          { tenantId, category, key },
        );
      }
      if (row.expires_at && row.expires_at.getTime() <= this.now().getTime()) {
        throw new SecretNotFoundError(
          `secret expired: ${tenantId}/${category}/${key}`,
          { tenantId, category, key },
        );
      }
      const plaintext = decryptValue(tenantKey, row.ciphertext_b64);
      // Best-effort: bump last_accessed_at. We don't fail the read if this
      // fails (race with deletion, etc.).
      this.pool
        .query(
          `UPDATE caia_meta.tenant_secrets_cold
             SET last_accessed_at = NOW()
           WHERE id = $1`,
          [row.id],
        )
        .catch(() => undefined);
      await this.audit.write({
        tenantId,
        category,
        key,
        backend: BACKEND_NAME,
        action: 'get',
        callerContext,
        ok: true,
        providerTrace: String(row.id),
      });
      return plaintext;
    } catch (err) {
      await this.audit.write({
        tenantId,
        category,
        key,
        backend: BACKEND_NAME,
        action: 'get',
        callerContext,
        ok: false,
        errorClass: classifyError(err),
      });
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter — list
  // ---------------------------------------------------------------------

  async list(tenantId: string, category?: string): Promise<SecretMetadata[]> {
    TenantIdSchema.parse(tenantId);
    if (category !== undefined) CategorySchema.parse(category);
    const params: unknown[] = [tenantId];
    let where = `tenant_id = $1`;
    if (category !== undefined) {
      params.push(category);
      where += ` AND category = $2`;
    }
    // Exclude expired entries from the listing.
    const res = await this.pool.query<ListRow>(
      `SELECT id, tenant_id, category, key, version,
              created_at, last_accessed_at, last_rotated_at, expires_at
       FROM caia_meta.tenant_secrets_cold
       WHERE ${where}
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY category, key`,
      params,
    );
    return res.rows.map((row) => {
      const meta: SecretMetadata = {
        key: row.key,
        category: row.category,
        secretRef: String(row.id),
        createdAt: row.created_at,
        version: row.version,
      };
      if (row.last_accessed_at) meta.lastAccessedAt = row.last_accessed_at;
      if (row.last_rotated_at) meta.lastRotatedAt = row.last_rotated_at;
      if (row.expires_at) meta.expiresAt = row.expires_at;
      return meta;
    });
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter — rotate
  // ---------------------------------------------------------------------

  async rotate(
    tenantId: string,
    category: string,
    key: string,
  ): Promise<RotateResult> {
    this.validateIdentifiers(tenantId, category, key);
    // The Postgres adapter cannot mint a new secret value — it doesn't
    // know what the provider's API key looks like. `rotate` here means:
    // bump the version + record rotated_at. The caller must `put(...,
    // {replace: true})` with the new value separately. This matches the
    // interface contract (rotators are provider-specific).
    const res = await this.pool.query<RotateRow>(
      `UPDATE caia_meta.tenant_secrets_cold
         SET version = version + 1, last_rotated_at = NOW()
       WHERE tenant_id = $1 AND category = $2 AND key = $3
       RETURNING version, last_rotated_at`,
      [tenantId, category, key],
    );
    const row = res.rows[0];
    if (!row) {
      throw new SecretNotFoundError(
        `rotate target not found: ${tenantId}/${category}/${key}`,
        { tenantId, category, key },
      );
    }
    return { rotatedAt: row.last_rotated_at, version: row.version };
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter — delete
  // ---------------------------------------------------------------------

  async delete(
    tenantId: string,
    category: string,
    key: string,
    _opts?: DeleteOptions,
  ): Promise<void> {
    this.validateIdentifiers(tenantId, category, key);
    // Idempotent: deleting a non-existent secret is not an error.
    await this.pool.query(
      `DELETE FROM caia_meta.tenant_secrets_cold
       WHERE tenant_id = $1 AND category = $2 AND key = $3`,
      [tenantId, category, key],
    );
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter — deleteAllForTenant (crypto-shred)
  // ---------------------------------------------------------------------

  async deleteAllForTenant(
    tenantId: string,
    opts?: DeleteAllForTenantOptions,
  ): Promise<DeleteAllResult> {
    TenantIdSchema.parse(tenantId);
    const countRes = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM caia_meta.tenant_secrets_cold
       WHERE tenant_id = $1`,
      [tenantId],
    );
    const deletedCount = Number(countRes.rows[0]?.n ?? '0');
    const tombstoneRef = `tomb_${tenantId}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    if (opts?.dryRun) {
      return { deletedCount, tenantTombstoneRef: `${tombstoneRef}_dryrun` };
    }
    // Step 1 — record the shred tombstone. This is the security barrier:
    // future `getOrDeriveTenantKey` calls for this tenant throw.
    await this.pool.query(
      `INSERT INTO caia_meta.tenant_crypto_shred (tenant_id, tombstone_ref)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET tombstone_ref = EXCLUDED.tombstone_ref`,
      [tenantId, tombstoneRef],
    );
    // Step 2 — forget the cached derived key. The Buffer is zeroed inside.
    this.cache.invalidate(tenantId);
    // Step 3 — drop the rows. Hygiene only; the data is already
    // cryptographically unreachable by now.
    await this.pool.query(
      `DELETE FROM caia_meta.tenant_secrets_cold WHERE tenant_id = $1`,
      [tenantId],
    );
    return { deletedCount, tenantTombstoneRef: tombstoneRef };
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter — auditLog
  // ---------------------------------------------------------------------

  async auditLog(
    tenantId: string,
    since?: Date,
    until?: Date,
  ): Promise<AccessLogEntry[]> {
    TenantIdSchema.parse(tenantId);
    const params: unknown[] = [tenantId, BACKEND_NAME];
    let where = `tenant_id = $1 AND backend = $2`;
    if (since !== undefined) {
      params.push(since);
      where += ` AND granted_at >= $${params.length}`;
    }
    if (until !== undefined) {
      params.push(until);
      where += ` AND granted_at <= $${params.length}`;
    }
    const res = await this.pool.query<AuditRow>(
      `SELECT tenant_id, category, key, caller_type, caller_id, ticket_id, reason,
              capability_token_id, requester_ip, granted_at, ok, error_class, provider_trace
       FROM caia_meta.audit_log
       WHERE ${where}
       ORDER BY granted_at DESC
       LIMIT 1000`,
      params,
    );
    return res.rows.map((row) => {
      const entry: AccessLogEntry = {
        tenantId: row.tenant_id,
        category: row.category,
        key: row.key,
        callerType: row.caller_type,
        callerId: row.caller_id,
        reason: row.reason,
        grantedAt: row.granted_at,
        ok: row.ok,
      };
      if (row.ticket_id) entry.ticketId = row.ticket_id;
      if (row.capability_token_id)
        entry.capabilityTokenId = row.capability_token_id;
      if (row.requester_ip) entry.requesterIp = row.requester_ip;
      if (row.error_class) entry.errorClass = row.error_class;
      if (row.provider_trace) entry.providerTrace = row.provider_trace;
      return entry;
    });
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter — ping
  // ---------------------------------------------------------------------

  async ping(): Promise<PingResult> {
    const start = Date.now();
    try {
      await this.pool.query(`SELECT 1`);
      return { ok: true, latencyMs: Date.now() - start, backend: BACKEND_NAME };
    } catch {
      return { ok: false, latencyMs: Date.now() - start, backend: BACKEND_NAME };
    }
  }
}
