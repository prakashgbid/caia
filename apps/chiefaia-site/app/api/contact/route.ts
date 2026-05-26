/**
 * POST /api/contact — stub form endpoint.
 *
 * Validates payload shape and 200s. Production will swap to a real
 * forms-provider call (operator pick TBD — Resend / SendGrid / internal).
 * Today the request is structurally validated and dropped; no PII is
 * persisted by this stub.
 */

import { NextResponse } from 'next/server';

interface ContactPayload {
  name: unknown;
  email: unknown;
  message: unknown;
}

function isValid(payload: ContactPayload): payload is {
  name: string;
  email: string;
  message: string;
} {
  return (
    typeof payload.name === 'string' &&
    payload.name.trim().length >= 2 &&
    typeof payload.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) &&
    typeof payload.message === 'string' &&
    payload.message.trim().length >= 10
  );
}

export async function POST(request: Request) {
  let json: ContactPayload;
  try {
    json = (await request.json()) as ContactPayload;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'invalid_json' },
      { status: 400 }
    );
  }

  if (!isValid(json)) {
    return NextResponse.json(
      { ok: false, code: 'invalid_payload' },
      { status: 400 }
    );
  }

  // Stub: real handler will dispatch to the operator-picked forms provider.
  // We intentionally do NOT log the message body to avoid persisting PII in
  // serverless logs by accident.
  return NextResponse.json({ ok: true }, { status: 200 });
}

export const dynamic = 'force-dynamic';
