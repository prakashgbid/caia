/**
 * Audit-log interface for the Infisical adapter.
 *
 * Mirrors the shape used by `@caia/secrets-postgres` so that an operator
 * who wants a unified audit table can pass the Postgres logger in here.
 * The Infisical adapter does NOT depend on `@caia/secrets-postgres`;
 * callers wire it up.
 */

import type { AccessContext, ErrorClass } from '@caia/secrets-adapter';

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

/** Default — drops all events. Used in tests + when the broker handles audit upstream. */
export class NoopAuditLogger implements AuditLogger {
  async write(_params: AuditWriteParams): Promise<void> {
    // intentionally empty
  }
}

/** In-memory logger — handy for unit tests + ad-hoc inspection. */
export class InMemoryAuditLogger implements AuditLogger {
  readonly events: AuditWriteParams[] = [];
  async write(params: AuditWriteParams): Promise<void> {
    this.events.push(params);
  }
}
