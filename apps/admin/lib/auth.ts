/**
 * Cloudflare-Access cookie gate borrowed from packages/cms.
 *
 * In production the upstream Cloudflare Access edge sets a
 * `CF_Authorization` cookie that proxies a signed JWT. We don't verify
 * the signature here (the edge already did); we just extract the
 * subject + email for audit purposes. Bypass mode (env var
 * `CAIA_AUTH_BYPASS=1`) is used by local-dev + Playwright E2E.
 */

import type { NextRequest } from 'next/server';

export interface AuthContext {
  email: string;
  subject: string;
  /** True when the bypass env var is set. */
  bypass: boolean;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1];
    if (!payload) return null;
    const buf = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    );
    return JSON.parse(buf.toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function authContext(req: NextRequest): AuthContext | null {
  if (process.env['CAIA_AUTH_BYPASS'] === '1') {
    return {
      email: process.env['CAIA_AUTH_BYPASS_EMAIL'] ?? 'dev@caia.local',
      subject: 'dev-bypass',
      bypass: true,
    };
  }
  const cookie = req.cookies.get('CF_Authorization')?.value;
  if (!cookie) return null;
  const claims = decodeJwtPayload(cookie);
  if (!claims) return null;
  const email = (claims['email'] as string) || (claims['custom']?.toString() ?? '');
  const subject = (claims['sub'] as string) || '';
  if (!email || !subject) return null;
  return { email, subject, bypass: false };
}
