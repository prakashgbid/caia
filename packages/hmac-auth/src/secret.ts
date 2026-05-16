/**
 * Secret loading for HMAC-authenticated services.
 *
 * Resolves the shared secret from one of two sources:
 *   - file at `CAIA_EVENT_BUS_SECRET_PATH` (preferred — Mac Keychain export
 *     or stolution `~/.stolution-vault/event-bus-secret`)
 *   - `CAIA_EVENT_BUS_SECRET` env var (fallback for tests / local dev)
 *
 * Refuses to fall back to a default — auth is mandatory. Production
 * deploy MUST set the secret at install time.
 */

import { existsSync, readFileSync } from 'node:fs';

/** Minimum secret length (bytes / chars) we accept. */
export const MIN_SECRET_LENGTH = 32;

export function loadSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const path = env['CAIA_EVENT_BUS_SECRET_PATH'];
  if (path && path.length > 0) {
    if (!existsSync(path)) {
      throw new Error(
        `loadSecret: CAIA_EVENT_BUS_SECRET_PATH=${path} does not exist`,
      );
    }
    const raw = readFileSync(path, 'utf-8').trim();
    if (raw.length === 0) {
      throw new Error(`loadSecret: secret file ${path} is empty`);
    }
    if (raw.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `loadSecret: secret too short (${raw.length} chars; require ≥${MIN_SECRET_LENGTH} for adequate entropy)`,
      );
    }
    return raw;
  }
  const envSecret = env['CAIA_EVENT_BUS_SECRET'];
  if (envSecret && envSecret.length >= MIN_SECRET_LENGTH) {
    return envSecret;
  }
  if (envSecret && envSecret.length > 0) {
    throw new Error(
      `loadSecret: CAIA_EVENT_BUS_SECRET too short (${envSecret.length} chars; require ≥${MIN_SECRET_LENGTH})`,
    );
  }
  throw new Error(
    'loadSecret: neither CAIA_EVENT_BUS_SECRET_PATH nor CAIA_EVENT_BUS_SECRET is set; refusing to run without auth',
  );
}
