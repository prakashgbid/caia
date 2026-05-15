/**
 * HMAC-SHA256 verification primitives + timestamped request verification.
 *
 * Pair to `./sign.js`. Verification is always constant-time
 * (`timingSafeEqual`) — never use `===` or `Buffer.equals` on HMAC
 * output.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  DEFAULT_REPLAY_WINDOW_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from './sign.js';

export type VerifyRequestResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'missing-timestamp'
        | 'missing-signature'
        | 'bad-timestamp'
        | 'expired'
        | 'future'
        | 'bad-signature';
    };

/**
 * Constant-time HMAC verification.
 *
 * `provided` may be a Buffer of raw bytes, or a hex string (the wire
 * format used by `signRequest`). Returns false on length mismatch,
 * malformed hex, or timing-safe mismatch — never throws on bad input.
 */
export function hmacVerify(
  secret: string | Buffer,
  data: string | Buffer,
  provided: Buffer | string,
): boolean {
  if (!secret || (typeof secret === 'string' && secret.length === 0)) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(data).digest();

  let providedBuf: Buffer;
  if (Buffer.isBuffer(provided)) {
    providedBuf = provided;
  } else {
    if (typeof provided !== 'string' || provided.length === 0) return false;
    // Hex must be even-length and contain only hex digits.
    if (provided.length % 2 !== 0) return false;
    if (!/^[0-9a-fA-F]+$/.test(provided)) return false;
    try {
      providedBuf = Buffer.from(provided, 'hex');
    } catch {
      return false;
    }
  }

  if (providedBuf.length !== expected.length) return false;
  return timingSafeEqual(providedBuf, expected);
}

/**
 * Verify a request's signature.
 *
 * @param secret  Shared secret (must match what signRequest used).
 * @param body    Request body as a string.
 * @param headers Header map. Node http already lower-cases header names;
 *                this function also matches case-insensitively as a
 *                defensive measure for callers that hand-roll the map.
 * @param now     Current time. Test-injectable.
 * @param replayWindowMs Window of acceptable timestamp drift (default 5min).
 */
export function verifyRequest(
  secret: string,
  body: string,
  headers: Record<string, string | string[] | undefined>,
  now: number = Date.now(),
  replayWindowMs: number = DEFAULT_REPLAY_WINDOW_MS,
): VerifyRequestResult {
  const tsHeader = pickHeader(headers, TIMESTAMP_HEADER);
  const sigHeader = pickHeader(headers, SIGNATURE_HEADER);

  if (tsHeader === undefined) return { ok: false, reason: 'missing-timestamp' };
  if (sigHeader === undefined) return { ok: false, reason: 'missing-signature' };

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad-timestamp' };

  if (ts < now - replayWindowMs) return { ok: false, reason: 'expired' };
  if (ts > now + replayWindowMs) return { ok: false, reason: 'future' };

  // Match the original wire format `"<ts>:<body>"` byte-for-byte.
  if (!hmacVerify(secret, `${tsHeader}:${body}`, sigHeader)) {
    return { ok: false, reason: 'bad-signature' };
  }
  return { ok: true };
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}
