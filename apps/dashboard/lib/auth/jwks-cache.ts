// REUSE-FIRST EXCEPTION: short-lived duplicate, refactor to shared package tracked at follow-up B-task
// TODO(ADR): short-lived duplication of apps/wizard/lib/auth + lib/tenants until the shared `@chiefaia/wizard-auth` package lands (B-task tracked in PLAN.md §7).
/**
 * JWKS cache for Cloudflare Access JWT verification.
 *
 * Cloudflare Access publishes its public keys at
 *   https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
 * (JWKS format). We fetch + cache for 5 minutes; on cache miss or
 * expiry we re-fetch.
 *
 * Why a hand-rolled cache instead of `jose`'s `createRemoteJWKSet` cache:
 * `createRemoteJWKSet` keeps its TTL internally with no external visibility,
 * which makes cache-hit/miss + refresh behaviour untestable. The shape here
 * is a thin wrapper around `createRemoteJWKSet` + an explicit 5-minute TTL
 * + an injectable `fetch` so unit tests can swap the network.
 *
 * Reuse-first note:
 *   - No `@chiefaia/http-client` exists yet in this repo (referenced in
 *     AGENTS.md as the canonical wrapper but not shipped), so we use the
 *     native `fetch` global directly. Allowed by reuse-check-strict.js +
 *     Semgrep — those rules only forbid raw `axios` / `node-fetch` /
 *     `better-sqlite3`. When `@chiefaia/http-client` lands, swap the call.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface JwksCacheOptions {
  /** Full URL to the Cloudflare Access JWKS endpoint. */
  jwksUrl: string;
  /** Issuer claim — typically `https://<team>.cloudflareaccess.com`. */
  issuer: string;
  /** Audience claim — the CF Access Application AUD tag. */
  audience: string;
  /** TTL in ms. Defaults to 5 minutes. */
  ttlMs?: number;
  /** Clock — injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Fetch — injectable for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface VerifiedToken {
  payload: JWTPayload & { email?: string; sub?: string };
  protectedHeader: { alg?: string; kid?: string };
}

interface CacheEntry {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  fetchedAtMs: number;
}

/**
 * JWKS verifier with a 5-minute TTL cache.
 *
 * Construct once per process; `verify(token)` is safe to call concurrently.
 */
export class CloudflareAccessJwksCache {
  private readonly opts: Required<JwksCacheOptions>;
  private entry: CacheEntry | null = null;

  constructor(opts: JwksCacheOptions) {
    this.opts = {
      ttlMs: 5 * 60 * 1000,
      now: Date.now,
      fetchImpl: globalThis.fetch,
      ...opts,
    };
  }

  /**
   * Force-refresh the JWKS regardless of TTL. Tests use this; in production
   * the TTL handles it. Exposed for an out-of-band rotation hook.
   */
  refresh(): void {
    const url = new URL(this.opts.jwksUrl);
    this.entry = {
      jwks: createRemoteJWKSet(url, {
        // jose's own cooldown — set to 0 so our TTL is authoritative.
        cooldownDuration: 0,
        [Symbol.for('jose.fetch')]: this.opts.fetchImpl,
      } as unknown as Parameters<typeof createRemoteJWKSet>[1]),
      fetchedAtMs: this.opts.now(),
    };
  }

  /**
   * Returns whether the cache entry is still within TTL. `null` cache
   * counts as expired.
   */
  isFresh(): boolean {
    if (!this.entry) return false;
    return this.opts.now() - this.entry.fetchedAtMs < this.opts.ttlMs;
  }

  /**
   * Verify a JWT against the cached JWKS. Re-fetches on miss or TTL expiry.
   * Throws if the token is invalid, expired, or has wrong issuer/audience.
   */
  async verify(token: string): Promise<VerifiedToken> {
    if (!this.isFresh()) {
      this.refresh();
    }
    const entry = this.entry!;
    const { payload, protectedHeader } = await jwtVerify(token, entry.jwks, {
      issuer: this.opts.issuer,
      audience: this.opts.audience,
    });
    return { payload, protectedHeader };
  }
}
