// REUSE-FIRST EXCEPTION: short-lived duplicate of apps/wizard/middleware.ts, refactor to shared package tracked at follow-up B-task
// TODO(ADR): once @chiefaia/wizard-auth lands, this file becomes a 3-line re-export with the env-var branch coming from the shared module.
/**
 * Next.js middleware — Cloudflare Access JWT gate + tenant header,
 * with optional `cf-edge-only` bypass for the operator's allowlisted
 * Mac IP (driven by `WIZARD_AUTH_MODE`).
 *
 * Modes (env `WIZARD_AUTH_MODE`):
 *
 *   `cloudflare`   (default) — strict JWT path. Missing/invalid cookie
 *                              → 302 /sign-in.
 *
 *   `cf-edge-only`           — try the cf-edge-only bypass first
 *                              (Cf-Ray + Cf-Connecting-Ip ∈ allow-list
 *                              + X-Caia-Edge-Token === EDGE_SHARED_SECRET).
 *                              If ANY check fails, fall through to the
 *                              strict JWT path. See `lib/auth/edge-bypass.ts`
 *                              for the defense-in-depth rationale.
 *
 *   `disabled`               — middleware no-op (local dev only). Never
 *                              set in production ConfigMaps; the README
 *                              calls this out explicitly.
 *
 * The strict JWT path (unchanged from PR #601):
 *
 *   1. Read the `CF_Authorization` cookie. Missing → 302 /sign-in.
 *   2. Verify via the cached JWKS (5-min TTL). Invalid → 302 /sign-in.
 *   3. Look up `email → tenant_id` in the global tenants table.
 *   4. If absent, call `provisionTenant(email, displayName)`. Idempotent.
 *   5. Attach `x-tenant-id` (+ `x-tenant-email`) to the upstream request
 *      so downstream route handlers can read it from headers().
 *
 * Public paths (never gated): `/sign-in`, `/_next/*`, `/favicon.ico`,
 * `/api/health`, `/api/healthz`, `/api/readyz`. The K8s kubelet probes
 * never carry a `CF_Authorization` cookie, so the probe endpoints MUST
 * be excluded from the matcher — otherwise readiness checks 302 to
 * /sign-in, the pod never goes Ready, and the rollout fails.
 *
 * Edge-runtime caveat: Next.js middleware runs on the edge, where
 * `pg`, `nats`, and `node:crypto` are unavailable. We mitigate by
 * running the *expensive* parts (provisioning + publishing) inside a
 * Node-runtime route handler at `/api/tenant/provision-on-signin` that
 * the middleware kicks off via a server fetch from the **Node runtime**.
 *
 * To keep this PR small and reviewable, the middleware here uses the
 * Node runtime (`export const config.runtime = 'nodejs'`). Next.js 15
 * supports `nodejs` middleware as a stable opt-in. When we need the
 * edge runtime for latency, we'll split provisioning into the route
 * handler described above. Tracked in PLAN.md §6.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  CF_AUTHORIZATION_COOKIE,
  getDefaultVerifier,
} from './lib/auth/cf-access';
import { getProvisionDeps } from './lib/tenants/wire';
import { provisionTenant } from './lib/tenants/provision';
import { readAuthMode, tryEdgeBypass } from './lib/auth/edge-bypass';

export const config = {
  // Nodejs runtime is required for `pg` + `nats` access from the
  // provisioning path. See file-header comment.
  runtime: 'nodejs',
  // We DON'T match _next/static, _next/image, favicon, public files,
  // the sign-in page itself, or the K8s probe endpoints (/api/healthz,
  // /api/readyz). Public API endpoints opt-in by being outside the
  // listed prefixes below.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|sign-in|api/health|api/healthz|api/readyz).*)',
  ],
};

function redirectToSignIn(req: NextRequest, reason: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?from=${encodeURIComponent(req.nextUrl.pathname)}&r=${reason}`;
  const res = NextResponse.redirect(url);
  // Clear a possibly-bad cookie so the next request actually re-auths.
  res.cookies.delete(CF_AUTHORIZATION_COOKIE);
  return res;
}

/**
 * Resolve `email → tenant_id`, provisioning a new tenant on miss. Shared
 * between the strict-JWT path and the cf-edge-only bypass path so both
 * code paths produce identical `x-tenant-*` headers.
 *
 * Returns either a tenantId string OR a NextResponse (when provisioning
 * itself failed — that's a 503, not an auth failure).
 */
async function resolveTenantOrError(email: string): Promise<string | NextResponse> {
  try {
    const deps = await getProvisionDeps();
    const existing = await deps.tenantStore.findByEmail(email);
    if (existing) return existing.tenantId;
    const displayName = email.split('@')[0] ?? email;
    const { tenant } = await provisionTenant(email, displayName, deps);
    return tenant.tenantId;
  } catch (err) {
    return new NextResponse(
      JSON.stringify({
        error: 'tenant-provisioning-failed',
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const mode = readAuthMode();

  // ─── `disabled` — middleware no-op (local dev) ──────────────────
  if (mode === 'disabled') {
    const res = NextResponse.next();
    res.headers.set('x-auth-mode', 'disabled');
    return res;
  }

  // ─── `cf-edge-only` — try edge bypass before JWT ───────────────
  if (mode === 'cf-edge-only') {
    const bypass = tryEdgeBypass(req.headers);
    if (bypass) {
      const resolved = await resolveTenantOrError(bypass.email);
      if (typeof resolved !== 'string') return resolved; // 503
      const res = NextResponse.next();
      res.headers.set('x-tenant-id', resolved);
      res.headers.set('x-tenant-email', bypass.email);
      res.headers.set('x-auth-mode', 'cf-edge-only');
      return res;
    }
    // Fall through to strict JWT — defence in depth: a request that
    // misses any of the three edge checks must still be authenticated.
  }

  // ─── `cloudflare` (default) — strict JWT ───────────────────────
  const token = req.cookies.get(CF_AUTHORIZATION_COOKIE)?.value;
  if (!token) {
    return redirectToSignIn(req, 'no-cookie');
  }

  let email: string | undefined;
  try {
    const verifier = getDefaultVerifier();
    const { payload } = await verifier.verify(token);
    email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!email) {
      return redirectToSignIn(req, 'no-email-claim');
    }
  } catch {
    return redirectToSignIn(req, 'invalid-jwt');
  }

  const resolved = await resolveTenantOrError(email);
  if (typeof resolved !== 'string') return resolved; // 503

  const res = NextResponse.next();
  res.headers.set('x-tenant-id', resolved);
  res.headers.set('x-tenant-email', email);
  res.headers.set('x-auth-mode', 'cloudflare');
  return res;
}

// Re-export the pure pieces for the unit tests — Next.js's `middleware`
// export shape is the only one the runtime actually consumes, but having
// the helpers reachable makes test isolation cleaner.
export {
  CF_AUTHORIZATION_COOKIE,
  redirectToSignIn as __test_redirectToSignIn,
  resolveTenantOrError as __test_resolveTenantOrError,
};
