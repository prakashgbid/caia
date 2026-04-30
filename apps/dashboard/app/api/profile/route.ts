import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), '.data');
const PROFILE_FILE = join(DATA_DIR, 'profile.json');

interface Profile {
  username: string;
  displayName: string;
  bio: string;
  city: string;
  state: string;
  avatarUrl: string | null;
  updatedAt: string;
}

function readProfile(): Profile {
  if (!existsSync(PROFILE_FILE)) {
    return {
      username: 'operator',
      displayName: 'Conductor Operator',
      bio: '',
      city: '',
      state: '',
      avatarUrl: null,
      updatedAt: new Date().toISOString(),
    };
  }
  return JSON.parse(readFileSync(PROFILE_FILE, 'utf-8')) as Profile;
}

function writeProfile(profile: Profile): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8');
}

export async function GET() {
  return NextResponse.json(readProfile());
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Partial<Profile>;
  const current = readProfile();
  const updated: Profile = {
    ...current,
    ...(typeof body.displayName === 'string' && { displayName: body.displayName }),
    ...(typeof body.bio === 'string' && { bio: body.bio }),
    ...(typeof body.city === 'string' && { city: body.city }),
    ...(typeof body.state === 'string' && { state: body.state }),
    ...(typeof body.avatarUrl === 'string' && { avatarUrl: body.avatarUrl }),
    updatedAt: new Date().toISOString(),
  };
  writeProfile(updated);
  return NextResponse.json(updated);
}
