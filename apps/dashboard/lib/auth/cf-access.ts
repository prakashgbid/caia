/**
 * Cloudflare Access configuration loader + shared singleton verifier.
 *
 * The middleware constructs the verifier once at module-init via
 * `getDefaultVerifier()` and reuses it for every request — Node will hold
 * the JWKS cache across invocations within a single warm runtime.
 *
 * Env shape (required at runtime, optional at typecheck):
 *   CF_ACCESS_TEAM_DOMAIN  — eg `chiefaia.cloudflareaccess.com`
 *   CF_ACCESS_AUD          — the Application AUD tag
 *
 * If either is missing the verifier still constructs (so build-time
 * typechecks pass) but `verify()` will reject. The middleware treats this
 * as an auth failure → /sign-in redirect, which is the correct fail-closed
 * behaviour for any misconfiguration.
 */

import { CloudflareAccessJwksCache } from './jwks-cache.js';

export interface CfAccessEnv {
  teamDomain?: string;
  audience?: string;
}

export function readCfAccessEnv(env: NodeJS.ProcessEnv = process.env): CfAccessEnv {
  return {
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    audience: env.CF_ACCESS_AUD,
  };
}

export function buildVerifier(env: CfAccessEnv): CloudflareAccessJwksCache {
  // We construct the verifier even if env is missing — a downstream
  // `verify()` call will reject. This keeps the module purely declarative
  // and lets the middleware decide what to do with the failure.
  const teamDomain = env.teamDomain ?? 'invalid.cloudflareaccess.invalid';
  const audience = env.audience ?? 'invalid-audience';
  return new CloudflareAccessJwksCache({
    jwksUrl: `https://${teamDomain}/cdn-cgi/access/certs`,
    issuer: `https://${teamDomain}`,
    audience,
  });
}

let defaultVerifier: CloudflareAccessJwksCache | null = null;

export function getDefaultVerifier(): CloudflareAccessJwksCache {
  if (!defaultVerifier) {
    defaultVerifier = buildVerifier(readCfAccessEnv());
  }
  return defaultVerifier;
}

/** Test-only — reset the singleton. */
export function __resetDefaultVerifier(): void {
  defaultVerifier = null;
}

export const CF_AUTHORIZATION_COOKIE = 'CF_Authorization';
