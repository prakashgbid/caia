/**
 * POST /api/billing/webhook — Stripe webhook receiver.
 *
 * Signature verification happens inside `@caia/billing`. The raw body
 * MUST be passed as text (not JSON-parsed) for the HMAC to match —
 * Next 15's `req.text()` is the correct accessor.
 */

import { webhookRouteFactory, type BillingRequest } from '@caia/billing/api';
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
  const handler = webhookRouteFactory(getBillingApi());
  const result = await handler(toBillingReq(req));
  return new Response(result.body, { status: result.status, headers: result.headers });
}
