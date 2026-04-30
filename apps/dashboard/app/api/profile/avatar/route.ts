import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const AVATARS_DIR = join(process.cwd(), 'public', 'avatars');
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('avatar');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF.' }, { status: 400 });
  }

  const ext = extname(file.name) || '.jpg';
  const filename = `avatar${ext}`;
  mkdirSync(AVATARS_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(join(AVATARS_DIR, filename), buffer);

  return NextResponse.json({ url: `/avatars/${filename}` });
}
