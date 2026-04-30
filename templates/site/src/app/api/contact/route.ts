import { NextRequest, NextResponse } from 'next/server';

interface ContactPayload {
  name: string;
  email: string;
  message: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, email, message } = (body ?? {}) as Partial<ContactPayload>;

  if (!name?.trim() || name.length > 100) {
    return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  }
  if (!email?.trim() || !isValidEmail(email) || email.length > 200) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }
  if (!message?.trim() || message.trim().length < 10 || message.length > 2000) {
    return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
  }

  // TODO: persist to contacts table
  console.log('[contact]', { name: name.trim(), email: email.trim(), createdAt: new Date().toISOString() });

  return NextResponse.json({ success: true }, { status: 201 });
}
