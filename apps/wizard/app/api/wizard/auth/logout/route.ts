/**
 * POST /api/wizard/auth/logout — destroys session.
 */

import { NextResponse } from 'next/server';
import { destroySession } from '../../../../../lib/backend/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  await destroySession();
  return NextResponse.json({ ok: true });
}
