/**
 * Dashboard API proxy: POST /api/profile/avatar
 * Accepts multipart/form-data with an "avatar" file field,
 * forwards to the Conductor orchestrator's avatar upload endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const file = formData.get('avatar');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No avatar file provided' }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5 MB' },
        { status: 400 },
      );
    }

    const upstream = await fetch(`${ORCHESTRATOR_URL}/profile/avatar`, {
      method: 'POST',
      body: formData,
    });

    const data = await upstream.json() as unknown;
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
