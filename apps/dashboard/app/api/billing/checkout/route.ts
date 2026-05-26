/**
 * POST /api/billing/checkout — kick off a Stripe Checkout flow.
 *
 * Thin route: all logic lives in `@caia/billing`. We translate between
 * Next 15's `Request` / `Response` and the package's
 * `BillingRequest` / `BillingResponseInit`.
 */

import { checkoutRouteFactory, type BillingRequest } from '@caia/billing/api';
import { getBillingApi } from '../../../../lib/billing/runtime';

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

export async function POST(req: Request): Promise<Response> {
  const handler = checkoutRouteFactory(getBillingApi());
  const result = await handler(toBillingReq(req));
  return new Response(result.body, { status: result.status, headers: result.headers });
}
