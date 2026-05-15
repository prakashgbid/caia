/**
 * HMAC-SHA256 request signing for the mentor event-bus HTTP API.
 *
 * The implementation lives in `@chiefaia/hmac-auth` so that other
 * services (e.g. `@chiefaia/capability-broker`) can share the same
 * hardened primitives. This module re-exports the same surface that
 * existed before the D2 extraction so callers (server, client, cli,
 * tests) keep working unchanged.
 *
 * Pattern (AppRole-style): producer + server share a secret. Each HTTP
 * request carries:
 *
 *   X-Caia-Timestamp: <ms-since-epoch>
 *   X-Caia-Signature: <hex(hmac-sha256(secret, "<ts>:<body>"))>
 *
 * Secret is loaded once at process start from:
 *   - file at `CAIA_EVENT_BUS_SECRET_PATH` (preferred — Mac Keychain or
 *     stolution `~/.stolution-vault/event-bus-secret`)
 *   - `CAIA_EVENT_BUS_SECRET` env var (fallback for tests/local dev)
 *
 * If neither is set, both client and server refuse to start — never silently
 * skip auth. Production deploy MUST set the secret at install time.
 */

export {
  DEFAULT_REPLAY_WINDOW_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  loadSecret,
  signRequest,
  verifyRequest,
  type VerifyResult,
} from '@chiefaia/hmac-auth';
