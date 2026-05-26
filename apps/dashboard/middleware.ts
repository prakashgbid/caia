/**
 * Next.js middleware — Cloudflare Access JWT gate + tenant header.
 *
 * Flow per request:
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

export async function middleware(req: NextRequest): Promise<NextResponse> {
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

  let tenantId: string;
  try {
    const deps = await getProvisionDeps();
    const existing = await deps.tenantStore.findByEmail(email);
    if (existing) {
      tenantId = existing.tenantId;
    } else {
      // Display name fallback: local-part of the email. Operators can
      // PATCH /api/tenant/me later to override.
      const displayName = email.split('@')[0] ?? email;
      const { tenant } = await provisionTenant(email, displayName, deps);
      tenantId = tenant.tenantId;
    }
  } catch (err) {
    // Provisioning failure is operational, not auth-related. Surface as
    // 503 so the client can retry rather than getting bounced to sign-in.
    return new NextResponse(
      JSON.stringify({
        error: 'tenant-provisioning-failed',
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const res = NextResponse.next();
  res.headers.set('x-tenant-id', tenantId);
  res.headers.set('x-tenant-email', email);
  return res;
}

// Re-export the pure pieces for the unit tests — Next.js's `middleware`
// export shape is the only one the runtime actually consumes, but having
// the helpers reachable makes test isolation cleaner.
export {
  CF_AUTHORIZATION_COOKIE,
  redirectToSignIn as __test_redirectToSignIn,
};
