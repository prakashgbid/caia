/**
 * Infisical machine-identity authentication.
 *
 * The adapter logs in with Universal Auth (client-id + client-secret),
 * receives a short-lived `accessToken`, caches it, and refreshes it
 * roughly 5 minutes before the documented expiry.
 *
 * Why we don't just use a long-lived service token: Infisical deprecated
 * `serviceTokens` in favor of machine identities; universal-auth is the
 * supported successor and supports per-identity rate limits + scoping.
 *
 * Self-hosted Infisical sits behind Cloudflare Access in CAIA's stand-up,
 * so authenticated requests need both:
 *   - `Authorization: Bearer <infisical-accessToken>`
 *   - `CF-Access-Client-Id: ...` and `CF-Access-Client-Secret: ...`
 */

import { SecretsAdapterConfigError, SecretProviderError } from '@caia/secrets-adapter';

export interface UniversalAuthConfig {
  type: 'universal-auth';
  clientId: string;
  clientSecret: string;
}

export interface StaticTokenAuthConfig {
  type: 'static-token';
  /**
   * Pre-minted access token. Useful for tests + short-lived CI jobs.
   * Will NEVER auto-refresh.
   */
  accessToken: string;
}

export type AuthConfig = UniversalAuthConfig | StaticTokenAuthConfig;

export interface CloudflareAccessConfig {
  clientId: string;
  clientSecret: string;
}

export interface InfisicalAuthOptions {
  baseUrl: string;
  auth: AuthConfig;
  cloudflareAccess?: CloudflareAccessConfig;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** Override for tests. Default: 5 minutes before documented expiry. */
  refreshSkewMs?: number;
  /** Injectable clock. */
  now?: () => number;
}

interface UniversalAuthLoginResponse {
  accessToken: string;
  expiresIn: number; // seconds
  accessTokenMaxTTL: number; // seconds
  tokenType: 'Bearer';
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export class InfisicalAuth {
  private readonly baseUrl: string;
  private readonly auth: AuthConfig;
  private readonly cfAccess?: CloudflareAccessConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly refreshSkewMs: number;
  private readonly now: () => number;
  private cached: CachedToken | null = null;
  private inflight: Promise<CachedToken> | null = null;

  constructor(opts: InfisicalAuthOptions) {
    if (!opts.baseUrl) {
      throw new SecretsAdapterConfigError('InfisicalAuth: baseUrl is required');
    }
    if (!opts.auth) {
      throw new SecretsAdapterConfigError('InfisicalAuth: auth config is required');
    }
    if (opts.auth.type === 'universal-auth') {
      if (!opts.auth.clientId || !opts.auth.clientSecret) {
        throw new SecretsAdapterConfigError(
          'InfisicalAuth: universal-auth requires clientId + clientSecret',
        );
      }
    } else if (opts.auth.type === 'static-token') {
      if (!opts.auth.accessToken) {
        throw new SecretsAdapterConfigError(
          'InfisicalAuth: static-token requires accessToken',
        );
      }
    } else {
      throw new SecretsAdapterConfigError(
        `InfisicalAuth: unknown auth type ${(opts.auth as { type: string }).type}`,
      );
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.auth = opts.auth;
    if (opts.cloudflareAccess) this.cfAccess = opts.cloudflareAccess;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.refreshSkewMs = opts.refreshSkewMs ?? 5 * 60 * 1000;
    this.now = opts.now ?? ((): number => Date.now());
  }

  /** Headers that should accompany every authenticated API call. */
  async authorizedHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.cfAccess) {
      headers['CF-Access-Client-Id'] = this.cfAccess.clientId;
      headers['CF-Access-Client-Secret'] = this.cfAccess.clientSecret;
    }
    return headers;
  }

  /** Just the CF-Access headers, when needed pre-auth (e.g. for the login call itself). */
  cloudflareAccessHeaders(): Record<string, string> {
    if (!this.cfAccess) return {};
    return {
      'CF-Access-Client-Id': this.cfAccess.clientId,
      'CF-Access-Client-Secret': this.cfAccess.clientSecret,
    };
  }

  /** Force-clear the cached token. Used by callers that observe a 401. */
  invalidate(): void {
    this.cached = null;
  }

  private async getAccessToken(): Promise<string> {
    if (this.auth.type === 'static-token') return this.auth.accessToken;
    if (this.cached && this.cached.expiresAtMs > this.now() + this.refreshSkewMs) {
      return this.cached.accessToken;
    }
    if (this.inflight) {
      const result = await this.inflight;
      return result.accessToken;
    }
    this.inflight = this.login();
    try {
      this.cached = await this.inflight;
      return this.cached.accessToken;
    } finally {
      this.inflight = null;
    }
  }

  private async login(): Promise<CachedToken> {
    if (this.auth.type !== 'universal-auth') {
      throw new SecretsAdapterConfigError(
        `InfisicalAuth: login is only valid for universal-auth (got ${this.auth.type})`,
      );
    }
    const url = `${this.baseUrl}/api/v1/auth/universal-auth/login`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.cloudflareAccessHeaders(),
      },
      body: JSON.stringify({
        clientId: this.auth.clientId,
        clientSecret: this.auth.clientSecret,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new SecretProviderError(
        `Infisical login failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as UniversalAuthLoginResponse;
    if (!json.accessToken || typeof json.expiresIn !== 'number') {
      throw new SecretProviderError(
        `Infisical login returned malformed body: ${JSON.stringify(json).slice(0, 200)}`,
      );
    }
    return {
      accessToken: json.accessToken,
      expiresAtMs: this.now() + json.expiresIn * 1000,
    };
  }
}
