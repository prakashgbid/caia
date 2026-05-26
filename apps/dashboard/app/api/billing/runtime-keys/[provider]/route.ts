/**
 * /api/billing/runtime-keys/[provider] — PUT/GET/DELETE for a tenant's
 * BYOK runtime key for a given provider.
 *
 * GET returns ONLY `{ configured: boolean }` — the key value is never
 * exposed to the browser. A separate operator-only read endpoint
 * (used by the deploy worker) is wired elsewhere.
 */

import {
  runtimeKeysRouteFactory,
  type BillingRequest,
} from '@caia/billing/api';
import { getBillingApi } from '../../../../../lib/billing/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toBillingReq(req: Request): BillingRequest {
  return {
    method: req.method,
    url: req.url,
    headers: req.headers,
    json: () => req.json(),
    text: () => req.text(),
  };
}

const factory = () => runtimeKeysRouteFactory(getBillingApi());

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const result = await factory().PUT(toBillingReq(req), ctx);
  return new Response(result.body, { status: result.status, headers: result.headers });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const result = await factory().GET(toBillingReq(req), ctx);
  return new Response(result.body, { status: result.status, headers: result.headers });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const result = await factory().DELETE(toBillingReq(req), ctx);
  return new Response(result.body, { status: result.status, headers: result.headers });
}
