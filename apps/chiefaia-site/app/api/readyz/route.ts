/**
 * `/api/readyz` — readiness gate.
 *
 * chiefaia-site is the marketing surface: static-ish MDX content +
 * one stub form endpoint (`POST /api/contact`). It has NO runtime
 * dependencies on Postgres, Infisical, or NATS — unlike the dashboard.
 *
 * Readiness therefore confirms only that the Node process is up and
 * the route handler is reachable. We avoid checking external services
 * to keep the probe cheap and deterministic; chiefaia-site staying
 * up does not depend on cluster-internal hosts being reachable.
 *
 * If a future B-task wires `/api/contact` to a real forms provider
 * (Resend / SendGrid / SMTP), add a 2-second reachability check here
 * and return 503 on failure — mirror apps/dashboard/app/api/readyz/route.ts.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      service: 'chiefaia-site',
      checks: {
        process: { ok: true },
      },
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
