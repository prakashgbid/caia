// REUSE-FIRST EXCEPTION: short-lived duplicate, refactor to shared package tracked at follow-up B-task
// TODO(ADR): short-lived duplication of apps/wizard/lib/auth + lib/tenants until the shared `@chiefaia/wizard-auth` package lands (B-task tracked in PLAN.md §7).
/**
 * `cf-edge-only` bypass guard.
 *
 * Implements the `WIZARD_AUTH_MODE=cf-edge-only` defense-in-depth check:
 *
 *   1. `Cf-Ray` header must be present. Cloudflare always injects this
 *      header on edge-handled requests. If the request reached the
 *      origin directly without going through CF, the header is absent
 *      — the WAF Transform Rule that injects the shared secret also
 *      relies on CF being in front, so the absence is a deterministic
 *      "this is a direct-to-origin request, do not trust" signal.
 *
 *   2. `Cf-Connecting-Ip` must match one of `BYPASS_ALLOWED_IPS` (CSV).
 *      This is a softer signal — the header itself is user-settable —
 *      so we treat it as a coarse allow-list, not an authentication
 *      check.
 *
 *   3. `X-Caia-Edge-Token` must match `EDGE_SHARED_SECRET` byte-for-byte
 *      via a constant-time compare. The Cloudflare WAF Transform Rule
 *      injects this header at the edge AND overwrites any client-supplied
 *      value, so a direct-to-origin attacker cannot forge it without
 *      first compromising the shared secret. This is the actual
 *      authentication primitive of the bypass mode.
 *
 * All three checks must pass. Any failure → `null`, signalling the
 * middleware to fall through to the strict JWT path.
 *
 * Defense-in-depth rationale: even if (1) and (2) are weak in isolation
 * — a sophisticated attacker can spoof headers on a direct connection —
 * (3) gates on a secret that only Cloudflare and our K8s Secret know.
 * The compounded probability of bypass without the secret is
 * vanishingly small as long as the secret is not leaked.
 *
 * See `infra/wizard/README.md` § Cloudflare WAF Transform Rule for the
 * edge setup that injects the secret.
 */

import { timingSafeEqual } from 'node:crypto';

export interface EdgeBypassEnv {
  BYPASS_ALLOWED_IPS?: string;
  EDGE_SHARED_SECRET?: string;
  BYPASS_TENANT_EMAIL?: string;
}

export interface EdgeBypassResult {
  /** Resolved tenant email (lowercased + trimmed). */
  email: string;
}

/** Request-headers view; matches both NextRequest and a plain Headers. */
export interface ReadOnlyHeaders {
  get(name: string): string | null;
}

/**
 * Returns the bypass result if all three checks pass, or `null` if any
 * fails. NEVER throws — callers fall through to the strict JWT path on
 * `null`, so a misconfigured env should not break the middleware.
 */
export function tryEdgeBypass(
  headers: ReadOnlyHeaders,
  env: EdgeBypassEnv = process.env as EdgeBypassEnv,
): EdgeBypassResult | null {
  // 1. Cf-Ray present.
  if (!headers.get('cf-ray')) return null;

  // 2. Cf-Connecting-Ip in allow-list.
  const cfIp = headers.get('cf-connecting-ip');
  if (!cfIp) return null;
  const allowed = (env.BYPASS_ALLOWED_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(cfIp)) return null;

  // 3. Shared-secret header matches EDGE_SHARED_SECRET via timing-safe
  //    compare. Length-mismatched buffers fail without exposing the
  //    correct length (timingSafeEqual throws on length mismatch — we
  //    catch and return null).
  const token = headers.get('x-caia-edge-token');
  const shared = env.EDGE_SHARED_SECRET;
  if (!token || !shared) return null;
  try {
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(shared, 'utf8');
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  // Tenant identity comes from BYPASS_TENANT_EMAIL — single-operator
  // fallback. Default mirrors the operator's email so a missing env on
  // the operator's own deploy still resolves to their tenant.
  const fallback = (env.BYPASS_TENANT_EMAIL ?? 'prakash.stolution@gmail.com')
    .toLowerCase()
    .trim();
  if (!fallback || !fallback.includes('@')) return null;
  return { email: fallback };
}

/**
 * Read the auth mode from env. Recognised values:
 *   - `cloudflare`     (default) — strict JWT
 *   - `cf-edge-only`             — try edge bypass; fall through to JWT
 *   - `disabled`                 — middleware no-op (local dev only)
 */
export type AuthMode = 'cloudflare' | 'cf-edge-only' | 'disabled';

export function readAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const raw = (env.WIZARD_AUTH_MODE ?? 'cloudflare').toLowerCase().trim();
  if (raw === 'disabled' || raw === 'cf-edge-only' || raw === 'cloudflare') {
    return raw;
  }
  // Unknown values fail closed → strict mode.
  return 'cloudflare';
}
