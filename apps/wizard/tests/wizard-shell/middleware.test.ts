/**
 * Middleware-level tests covering the WIZARD_AUTH_MODE matrix:
 *
 *   mode × (JWT present / absent) × (edge-bypass headers correct / wrong)
 *
 * The wire / cf-access modules are mocked so this runs with no real
 * pg.Pool, NATS, or JWKS network. The middleware itself is the thing
 * under test.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// `vi.mock` factories are hoisted above all imports, so any variable
// they reference must ALSO be hoisted via `vi.hoisted`. We declare the
// mock fns once at the top here and pull them back into the test scope
// after import.
const mocks = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  findByEmailMock: vi.fn(),
  provisionTenantMock: vi.fn(),
}));

vi.mock('../../lib/auth/cf-access', () => ({
  CF_AUTHORIZATION_COOKIE: 'CF_Authorization',
  getDefaultVerifier: () => ({ verify: mocks.verifyMock }),
  __resetDefaultVerifier: () => undefined,
}));

vi.mock('../../lib/tenants/wire', () => ({
  getProvisionDeps: async () => ({
    tenantStore: { findByEmail: mocks.findByEmailMock },
    pool: {} as unknown,
    infisical: {} as unknown,
    publisher: {} as unknown,
  }),
}));

vi.mock('../../lib/tenants/provision', () => ({
  provisionTenant: mocks.provisionTenantMock,
}));

// Now safe to import.
import { middleware } from '../../middleware';

const { verifyMock, findByEmailMock, provisionTenantMock } = mocks;

const OPERATOR_EMAIL = 'prakash.stolution@gmail.com';
const OPERATOR_IP = '69.118.44.175';
const EDGE_SECRET = 'super-secret-32-char-hex-value';

function makeRequest(opts: {
  url?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
} = {}): NextRequest {
  const url = opts.url ?? 'https://dashboard.chiefaia.com/wizard/onboarding';
  const headers = new Headers(opts.headers ?? {});
  if (opts.cookies && Object.keys(opts.cookies).length > 0) {
    const cookieStr = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers.set('cookie', cookieStr);
  }
  return new NextRequest(new URL(url), { headers });
}

function setEnv(over: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.WIZARD_AUTH_MODE;
  delete process.env.BYPASS_ALLOWED_IPS;
  delete process.env.EDGE_SHARED_SECRET;
  delete process.env.BYPASS_TENANT_EMAIL;
  // Default happy-path verifier + tenant lookup.
  verifyMock.mockResolvedValue({ payload: { email: 'jwt-user@example.com' } });
  findByEmailMock.mockResolvedValue({ tenantId: 'tenant-jwt-1' });
});

describe('middleware — mode=cloudflare (default, strict JWT)', () => {
  it('redirects to /sign-in (307) when no CF_Authorization cookie is present', async () => {
    const res = await middleware(makeRequest());
    expect(res.status).toBe(307);
    const loc = res.headers.get('location');
    expect(loc).toContain('/sign-in');
    expect(loc).toContain('r=no-cookie');
  });

  it('redirects to /sign-in (307) when CF_Authorization cookie is invalid', async () => {
    verifyMock.mockRejectedValueOnce(new Error('bad signature'));
    const res = await middleware(makeRequest({ cookies: { CF_Authorization: 'bad-jwt' } }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('r=invalid-jwt');
  });

  it('returns next() with tenant headers when JWT is valid and tenant exists', async () => {
    const res = await middleware(makeRequest({ cookies: { CF_Authorization: 'good-jwt' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tenant-id')).toBe('tenant-jwt-1');
    expect(res.headers.get('x-tenant-email')).toBe('jwt-user@example.com');
    expect(res.headers.get('x-auth-mode')).toBe('cloudflare');
  });
});

describe('middleware — mode=disabled (local dev no-op)', () => {
  it('returns next() with x-auth-mode=disabled regardless of JWT presence', async () => {
    setEnv({ WIZARD_AUTH_MODE: 'disabled' });
    const res = await middleware(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-auth-mode')).toBe('disabled');
    expect(res.headers.get('x-tenant-id')).toBeNull();
    expect(verifyMock).not.toHaveBeenCalled();
    expect(findByEmailMock).not.toHaveBeenCalled();
  });
});

describe('middleware — mode=cf-edge-only (defence-in-depth bypass)', () => {
  beforeEach(() => {
    setEnv({
      WIZARD_AUTH_MODE: 'cf-edge-only',
      BYPASS_ALLOWED_IPS: OPERATOR_IP,
      EDGE_SHARED_SECRET: EDGE_SECRET,
      BYPASS_TENANT_EMAIL: OPERATOR_EMAIL,
    });
    findByEmailMock.mockResolvedValue({ tenantId: 'tenant-operator-1' });
  });

  const validBypassHeaders = {
    'cf-ray': '8d4a1e2b3c4d5e6f-IAD',
    'cf-connecting-ip': OPERATOR_IP,
    'x-caia-edge-token': EDGE_SECRET,
  };

  it('bypasses JWT when all three edge checks pass and resolves operator tenant', async () => {
    const res = await middleware(makeRequest({ headers: validBypassHeaders }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tenant-id')).toBe('tenant-operator-1');
    expect(res.headers.get('x-tenant-email')).toBe(OPERATOR_EMAIL);
    expect(res.headers.get('x-auth-mode')).toBe('cf-edge-only');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('falls through to strict JWT when X-Caia-Edge-Token is wrong → 307 /sign-in', async () => {
    const res = await middleware(makeRequest({
      headers: { ...validBypassHeaders, 'x-caia-edge-token': 'wrong-secret' },
    }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('r=no-cookie');
  });

  it('falls through to strict JWT when Cf-Connecting-Ip is not in allow-list', async () => {
    const res = await middleware(makeRequest({
      headers: { ...validBypassHeaders, 'cf-connecting-ip': '9.9.9.9' },
    }));
    expect(res.status).toBe(307);
  });

  it('falls through to strict JWT when Cf-Ray is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { 'cf-ray': _ray, ...withoutCfRay } = validBypassHeaders;
    const res = await middleware(makeRequest({ headers: withoutCfRay }));
    expect(res.status).toBe(307);
  });

  it('PREFERS the edge bypass over a present JWT (mode wins until checks fail)', async () => {
    const res = await middleware(makeRequest({
      headers: validBypassHeaders,
      cookies: { CF_Authorization: 'good-jwt' },
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-auth-mode')).toBe('cf-edge-only');
    expect(res.headers.get('x-tenant-email')).toBe(OPERATOR_EMAIL);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('returns 503 when tenant provisioning throws (operational failure, not auth)', async () => {
    findByEmailMock.mockResolvedValueOnce(null);
    provisionTenantMock.mockRejectedValueOnce(new Error('pg unreachable'));
    const res = await middleware(makeRequest({ headers: validBypassHeaders }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('tenant-provisioning-failed');
  });

  it('provisions a new tenant on miss using BYPASS_TENANT_EMAIL', async () => {
    findByEmailMock.mockResolvedValueOnce(null);
    provisionTenantMock.mockResolvedValueOnce({
      tenant: { tenantId: 'tenant-fresh-1' },
      created: true,
    });
    const res = await middleware(makeRequest({ headers: validBypassHeaders }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tenant-id')).toBe('tenant-fresh-1');
    expect(provisionTenantMock).toHaveBeenCalledWith(
      OPERATOR_EMAIL,
      'prakash.stolution',
      expect.any(Object),
    );
  });
});
