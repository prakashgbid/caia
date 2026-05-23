/**
 * Audit-log writer for the Postgres adapter.
 *
 * Every `get` and `put` writes one row here. Failure to write the audit
 * row is logged but does NOT fail the operation — losing an audit row is
 * better than losing a secret-fetch on a fully-functional cache miss.
 *
 * However, on `get`, if the read itself fails AND the audit write fails,
 * we re-throw the original read error (not the audit error) because the
 * caller's concern is the read.
 */

import type { AccessContext, ErrorClass } from '@caia/secrets-adapter';
import type { PoolLike } from './pg-types.js';

export interface AuditWriteParams {
  tenantId: string;
  category: string;
  key: string;
  backend: string;
  action: 'get' | 'put' | 'rotate' | 'delete' | 'delete_all';
  callerContext: AccessContext;
  ok: boolean;
  errorClass?: ErrorClass;
  providerTrace?: string;
}

export interface AuditLogger {
  write(params: AuditWriteParams): Promise<void>;
}

export class PostgresAuditLogger implements AuditLogger {
  private readonly pool: PoolLike;
  private readonly onError: (err: unknown) => void;

  constructor(
    pool: PoolLike,
    onError: (err: unknown) => void = () => undefined,
  ) {
    this.pool = pool;
    this.onError = onError;
  }

  async write(params: AuditWriteParams): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO caia_meta.audit_log
           (tenant_id, category, key, backend, action,
            caller_type, caller_id, ticket_id, reason,
            capability_token_id, requester_ip,
            ok, error_class, provider_trace)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          params.tenantId,
          params.category,
          params.key,
          params.backend,
          params.action,
          params.callerContext.callerType,
          params.callerContext.callerId,
          params.callerContext.ticketId ?? null,
          params.callerContext.reason,
          params.callerContext.capabilityTokenId ?? null,
          params.callerContext.requesterIp ?? null,
          params.ok,
          params.errorClass ?? null,
          params.providerTrace ?? null,
        ],
      );
    } catch (err) {
      this.onError(err);
    }
  }
}

/** No-op auditor — useful when an outer broker is responsible for audit. */
export class NoopAuditLogger implements AuditLogger {
  async write(_params: AuditWriteParams): Promise<void> {
    // intentionally empty
  }
}
