/**
 * HMAC-SHA256 signing primitives + timestamped request signing.
 *
 * The low-level helpers (`hmacSign` / `hmacSignHex`) are the building
 * blocks consumers compose into their own canonical-payload schemes
 * (e.g. capability-broker token signatures).
 *
 * The high-level helper (`signRequest`) is the timestamped HTTP-request
 * signing pattern used by the mentor event-bus — producer and server
 * share a secret, and each request carries:
 *
 *   X-Caia-Timestamp: <ms-since-epoch>
 *   X-Caia-Signature: <hex(hmac-sha256(secret, "<ts>:<body>"))>
 *
 * The server validates the timestamp is inside a replay window before
 * checking the signature (see `verifyRequest`).
 */

import { createHmac } from 'node:crypto';

export const TIMESTAMP_HEADER = 'x-caia-timestamp';
export const SIGNATURE_HEADER = 'x-caia-signature';

/** Default replay window: 5 minutes (in ms). */
export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60_000;

/**
 * Compute HMAC-SHA256 of `data` under `secret`, returning the raw digest.
 * Use this when you need the bytes for further composition (constant-time
 * compare against an incoming buffer, base64 encoding, etc.).
 */
export function hmacSign(
  secret: string | Buffer,
  data: string | Buffer,
): Buffer {
  if (!secret || (typeof secret === 'string' && secret.length === 0)) {
    throw new Error('hmacSign: empty secret');
  }
  return createHmac('sha256', secret).update(data).digest();
}

/**
 * Compute HMAC-SHA256 of `data` under `secret`, returning the lower-case
 * hex digest. Convenience for the common "send as a header" path.
 */
export function hmacSignHex(
  secret: string | Buffer,
  data: string | Buffer,
): string {
  return hmacSign(secret, data).toString('hex');
}

/**
 * Sign a request body with the shared secret.
 * Returns the headers to attach to the outgoing request.
 */
export function signRequest(
  secret: string,
  body: string,
  now: number = Date.now(),
): { [TIMESTAMP_HEADER]: string; [SIGNATURE_HEADER]: string } {
  if (!secret) {
    throw new Error('signRequest: empty secret');
  }
  const ts = String(now);
  const mac = hmacSignHex(secret, `${ts}:${body}`);
  return {
    [TIMESTAMP_HEADER]: ts,
    [SIGNATURE_HEADER]: mac,
  };
}
