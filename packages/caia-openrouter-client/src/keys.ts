/**
 * Key resolution for the OpenRouter client.
 *
 * BYOK-first per [[byok-first-ai]]. Resolution order:
 *   1. If tenantId provided AND tenant has a BYOK OpenRouter key on file,
 *      use that. (Callers wire a real Vault-backed lookup here in prod;
 *      the default implementation only knows about env.)
 *   2. CAIA-provided key from OPENROUTER_API_KEY env var.
 *   3. Throw. Never fall back to no auth.
 */

import type { KeyResolver } from './types.js';

export class MissingKeyError extends Error {
  public readonly code = 'MISSING_OPENROUTER_KEY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MissingKeyError';
  }
}

/**
 * Default key resolver — env only. In prod, wrap this with a real BYOK
 * lookup that reads the tenant record and returns its key when present.
 *
 * NEVER logs the key. NEVER falls back to no-auth.
 */
export const envKeyResolver: KeyResolver = (_tenantId) => {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k || k.trim() === '') {
    throw new MissingKeyError(
      'OPENROUTER_API_KEY is unset. Either set the env var (CAIA-provided default) ' +
      'or configure a tenant-aware resolver that returns a BYOK key from Vault.',
    );
  }
  return k.trim();
};

/**
 * Build a tenant-aware resolver.
 *
 * @param lookup   Async function that returns `null` when the tenant has
 *                 no BYOK key on file OR the BYOK key string when it does.
 *                 Typically wraps a Vault read at `secret/caia/tenants/<id>/openrouter`.
 * @param fallbackEnvKey Optional override for the CAIA-provided key
 *                       (defaults to OPENROUTER_API_KEY env).
 */
export function makeTenantAwareResolver(
  lookup: (tenantId: string) => Promise<string | null>,
  fallbackEnvKey?: string,
): KeyResolver {
  return async (tenantId) => {
    if (tenantId) {
      const byok = await lookup(tenantId);
      if (byok && byok.trim() !== '') return byok.trim();
    }
    const env = fallbackEnvKey ?? process.env.OPENROUTER_API_KEY;
    if (!env || env.trim() === '') {
      throw new MissingKeyError(
        `No BYOK key for tenant=${tenantId ?? '(none)'} and no OPENROUTER_API_KEY fallback.`,
      );
    }
    return env.trim();
  };
}
