/**
 * `GET /api/tenant/me` — returns the current request's tenant.
 *
 * The middleware sets `x-tenant-id` + `x-tenant-email` on every authed
 * request. This route reads those headers, then reads the canonical
 * tenant row from Postgres so callers always get the full record (not
 * just the id).
 *
 * 401 if no headers (middleware bypass, eg direct curl with no cookie).
 */

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getProvisionDeps } from '../../../../lib/tenants/wire.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  const email = h.get('x-tenant-email');
  if (!tenantId || !email) {
    return NextResponse.json(
      { error: 'unauthenticated', detail: 'middleware did not set tenant headers' },
      { status: 401 },
    );
  }
  try {
    const deps = await getProvisionDeps();
    const tenant = await deps.tenantStore.findByEmail(email);
    if (!tenant) {
      return NextResponse.json(
        { error: 'tenant-not-found', tenantId, email },
        { status: 404 },
      );
    }
    return NextResponse.json(tenant);
  } catch (err) {
    return NextResponse.json(
      { error: 'lookup-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
