/**
 * GET /api/wizard/auth/me — returns current session or null.
 */

import { NextResponse } from 'next/server';
import { readAuthedUser } from '../../../../../lib/backend/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const me = await readAuthedUser();
  return NextResponse.json({ ok: true, user: me });
}
