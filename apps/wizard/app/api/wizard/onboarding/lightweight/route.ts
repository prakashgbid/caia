/**
 * POST /api/wizard/onboarding/lightweight
 *
 * Lightweight pre-payment onboarding submit. Validates the 3 fields
 * (name, email, optional BYOK OpenRouter key) and returns 200 with
 * a canned success envelope.
 *
 * In demo mode (WIZARD_AUTH_MODE=disabled) nothing is persisted — the
 * client just redirects to /wizard/grand-idea on 200.
 *
 * In production mode this route will:
 *   - upsert the tenant record (email lookup, generate slug, provision
 *     a per-tenant Postgres row + Keycloak user)
 *   - if byokKey present: validate it against OpenRouter (GET /models),
 *     encrypt with the CAIA-side KMS/Vault-backed transit key, and store
 *     it against the tenant record
 *   - emit tenant.provisioned event
 *
 * Kept as a stub for now because we're focused on the demo flow. The
 * heavy real-tenant path lives in lib/tenants/provision.ts already.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPENROUTER_KEY_RE = /^sk-or-v1-[a-zA-Z0-9]{20,}$/;

interface Payload {
  displayName?: unknown;
  email?: unknown;
  byokKey?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const name = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const byokRaw = typeof body.byokKey === 'string' ? body.byokKey.trim() : '';

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ ok: false, error: 'invalid_name', message: 'Name must be 2-80 chars.' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid_email', message: 'Please provide a valid email.' }, { status: 400 });
  }
  if (byokRaw !== '' && !OPENROUTER_KEY_RE.test(byokRaw)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_byok_key', message: 'OpenRouter keys start with sk-or-v1-.' },
      { status: 400 },
    );
  }

  // Demo mode: no persistence, no side effects. Real path lands in a
  // later story once the tenant CMS/DB is wired for pre-payment tenants.
  return NextResponse.json(
    {
      ok: true,
      demo: true,
      // Deterministic pseudo-slug so URLs look real in the demo.
      tenantSlug: email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30) || 'demo',
      byokConfigured: byokRaw !== '',
      message: 'Welcome — nothing persisted in demo mode. Continue to /wizard/grand-idea.',
    },
    { status: 200 },
  );
}
