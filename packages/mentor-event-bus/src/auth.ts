/**
 * HMAC-SHA256 request signing for the mentor event-bus HTTP API.
 *
 * Pattern (AppRole-style): producer + server share a secret. Each HTTP
 * request carries:
 *
 *   X-Caia-Timestamp: <ms-since-epoch>
 *   X-Caia-Signature: <hex(hmac-sha256(secret, "<ts>:<body>"))>
 *
 * Server verifies:
 *   1. timestamp within ±replayWindowMs of "now" (replay protection)
 *   2. signature matches HMAC of the secret over "<ts>:<body>"
 *
 * Secret is loaded once at process start from:
 *   - file at `CAIA_EVENT_BUS_SECRET_PATH` (preferred — Mac Keychain or
 *     stolution `~/.stolution-vault/event-bus-secret`)
 *   - `CAIA_EVENT_BUS_SECRET` env var (fallback for tests/local dev)
 *
 * If neither is set, both client and server refuse to start — never silently
 * skip auth. Production deploy MUST set the secret at install time.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export const TIMESTAMP_HEADER = 'x-caia-timestamp';
export const SIGNATURE_HEADER = 'x-caia-signature';

/** Default replay window: 5 minutes (in ms). */
export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60_000;

/**
 * Sign a request body with the shared secret.
 * Returns the headers to attach to the outgoing request.
 */
export function signRequest(
  secret: string,
  body: string,
  now: number = Date.now()
): { [TIMESTAMP_HEADER]: string; [SIGNATURE_HEADER]: string } {
  if (!secret) {
    throw new Error('signRequest: empty secret');
  }
  const ts = String(now);
  const mac = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
  return {
    [TIMESTAMP_HEADER]: ts,
    [SIGNATURE_HEADER]: mac
  };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing-timestamp' | 'missing-signature' | 'bad-timestamp' | 'expired' | 'future' | 'bad-signature' };

/**
 * Verify a request's signature.
 *
 * @param secret  Shared secret (must match what signRequest used).
 * @param body    Request body as a string.
 * @param headers Lower-cased header map (Node http upper/lower-cases headers; treat them as case-insensitive on the way in).
 * @param now     Current time. Test-injectable.
 * @param replayWindowMs Window of acceptable timestamp drift (default 5min).
 */
export function verifyRequest(
  secret: string,
  body: string,
  headers: Record<string, string | string[] | undefined>,
  now: number = Date.now(),
  replayWindowMs: number = DEFAULT_REPLAY_WINDOW_MS
): VerifyResult {
  const tsHeader = pickHeader(headers, TIMESTAMP_HEADER);
  const sigHeader = pickHeader(headers, SIGNATURE_HEADER);

  if (tsHeader === undefined) return { ok: false, reason: 'missing-timestamp' };
  if (sigHeader === undefined) return { ok: false, reason: 'missing-signature' };

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad-timestamp' };

  if (ts < now - replayWindowMs) return { ok: false, reason: 'expired' };
  if (ts > now + replayWindowMs) return { ok: false, reason: 'future' };

  const expected = createHmac('sha256', secret).update(`${tsHeader}:${body}`).digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(sigHeader, 'hex');
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
  if (provided.length !== expected.length) {
    return { ok: false, reason: 'bad-signature' };
  }
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad-signature' };
  }
  return { ok: true };
}

/**
 * Resolve the shared secret from env / file. Refuses to fall back to a
 * default — auth is mandatory.
 */
export function loadSecret(env: NodeJS.ProcessEnv = process.env): string {
  const path = env['CAIA_EVENT_BUS_SECRET_PATH'];
  if (path && path.length > 0) {
    if (!existsSync(path)) {
      throw new Error(
        `loadSecret: CAIA_EVENT_BUS_SECRET_PATH=${path} does not exist`
      );
    }
    const raw = readFileSync(path, 'utf-8').trim();
    if (raw.length === 0) {
      throw new Error(`loadSecret: secret file ${path} is empty`);
    }
    if (raw.length < 32) {
      throw new Error(
        `loadSecret: secret too short (${raw.length} chars; require ≥32 for adequate entropy)`
      );
    }
    return raw;
  }
  const env_secret = env['CAIA_EVENT_BUS_SECRET'];
  if (env_secret && env_secret.length >= 32) {
    return env_secret;
  }
  if (env_secret && env_secret.length > 0) {
    throw new Error(
      `loadSecret: CAIA_EVENT_BUS_SECRET too short (${env_secret.length} chars; require ≥32)`
    );
  }
  throw new Error(
    'loadSecret: neither CAIA_EVENT_BUS_SECRET_PATH nor CAIA_EVENT_BUS_SECRET is set; refusing to run without auth'
  );
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  // Node http exposes headers as lowercase already. Be defensive in case
  // a caller passes a partial uppercase headers map.
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}
