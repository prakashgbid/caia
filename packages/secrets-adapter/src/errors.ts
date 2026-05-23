/**
 * Typed error hierarchy. Adapters throw these so callers can branch
 * cleanly without grepping error messages.
 */

import type { ErrorClass } from './types.js';

export abstract class SecretsAdapterError extends Error {
  abstract readonly errorClass: ErrorClass;
  readonly tenantId?: string;
  readonly category?: string;
  readonly key?: string;
  override readonly cause?: unknown;

  constructor(
    message: string,
    opts: {
      tenantId?: string;
      category?: string;
      key?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    if (opts.tenantId !== undefined) this.tenantId = opts.tenantId;
    if (opts.category !== undefined) this.category = opts.category;
    if (opts.key !== undefined) this.key = opts.key;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export class SecretNotFoundError extends SecretsAdapterError {
  override readonly errorClass = 'not_found' as const;
}

export class SecretPolicyDeniedError extends SecretsAdapterError {
  override readonly errorClass = 'policy_denied' as const;
}

export class SecretRateLimitedError extends SecretsAdapterError {
  override readonly errorClass = 'rate_limited' as const;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    opts: {
      tenantId?: string;
      category?: string;
      key?: string;
      cause?: unknown;
      retryAfterMs?: number;
    } = {},
  ) {
    super(message, opts);
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
  }
}

export class SecretProviderError extends SecretsAdapterError {
  override readonly errorClass = 'provider_error' as const;
}

export class SecretsAdapterConfigError extends Error {
  override readonly name = 'SecretsAdapterConfigError';
}

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof SecretsAdapterError) return err.errorClass;
  return 'provider_error';
}
