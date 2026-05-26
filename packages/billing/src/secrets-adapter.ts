/**
 * `secrets-adapter.ts` — local re-export shim.
 *
 * Per operator policy (2026-05-25): the `@caia/secrets-adapter` package
 * currently ships only `dist/*` artifacts (no `package.json`) so we
 * cannot yet declare it as a workspace dependency. To keep this PR
 * shippable today, we mirror the minimum type surface here.
 *
 * TODO: replace this whole file with `export type * from '@caia/secrets-adapter'`
 * once the secrets-adapter source is restored (tracked separately).
 *
 * The runtime adapter implementation is provided by the CONSUMER of
 * `@caia/billing` — the dashboard wires Infisical at boot; tests wire
 * an in-memory mock. This package never imports a concrete adapter.
 */

export type CallerType =
  | 'agent'
  | 'user'
  | 'deploy-worker'
  | 'cron'
  | 'system';

export interface AccessContext {
  callerType: CallerType;
  callerId: string;
  ticketId?: string;
  reason: string;
  capabilityTokenId?: string;
  requesterIp?: string;
}

export interface PutOptions {
  ttlSeconds?: number;
  replace?: boolean;
}

export interface PutResult {
  secretRef: string;
  version?: number;
}

export interface DeleteOptions {
  purge?: boolean;
}

export interface SecretMetadata {
  key: string;
  category: string;
  secretRef: string;
  createdAt: Date;
  lastAccessedAt?: Date;
  lastRotatedAt?: Date;
  version?: number;
  expiresAt?: Date;
}

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
  delete(
    tenantId: string,
    category: string,
    key: string,
    opts?: DeleteOptions,
  ): Promise<void>;
}

export class SecretNotFoundLike extends Error {
  readonly errorClass = 'not_found' as const;
}

export function isSecretNotFound(err: unknown): boolean {
  if (err instanceof SecretNotFoundLike) return true;
  return (
    typeof err === 'object' &&
    err !== null &&
    'errorClass' in err &&
    (err as { errorClass?: unknown }).errorClass === 'not_found'
  );
}
