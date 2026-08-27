/**
 * Password hashing using Node's built-in scrypt (no native deps).
 *
 * Format stored in DB: `scrypt$N=<n>,r=<r>,p=<p>$<salt-b64>$<hash-b64>`
 * OWASP-recommended parameters: N=2^17, r=8, p=1, 32-byte hash, 16-byte salt.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 1 << 17;
const R = 8;
const P = 1;
const HASH_LEN = 32;
const SALT_LEN = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password.normalize('NFKC'), salt, HASH_LEN, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 });
  return `scrypt$N=${N},r=${R},p=${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
    const params = Object.fromEntries(parts[1].split(',').map((kv) => kv.split('=')));
    const n = parseInt(params.N, 10);
    const r = parseInt(params.r, 10);
    const p = parseInt(params.p, 10);
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    const actual = scryptSync(password.normalize('NFKC'), salt, expected.length, { N: n, r, p, maxmem: 256 * 1024 * 1024 });
    return timingSafeEqual(expected, actual);
  } catch { return false; }
}

/** Enforce reasonable password strength. */
export function validatePasswordStrength(password: string): { ok: boolean; reason?: string } {
  if (!password || password.length < 8) return { ok: false, reason: 'Password must be at least 8 characters.' };
  if (password.length > 200) return { ok: false, reason: 'Password is too long (max 200 characters).' };
  const classes =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/\d/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
  if (classes < 2) return { ok: false, reason: 'Use letters plus numbers or a symbol.' };
  return { ok: true };
}
