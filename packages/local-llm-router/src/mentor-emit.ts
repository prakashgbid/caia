// Mentor event-bus emit helper for @chiefaia/local-llm-router.
//
// Fire-and-forget HTTP POST to the mentor-event-bus `/v1/events` endpoint.
// Used by router.ts (RouterDecision, Compression) and claude-adapter.ts
// (ClaudeRequest, ClaudeResponse, ClaudeDuration) to feed the observability
// substrate without taking a workspace dependency on the full mentor-event-bus
// package (which transitively pulls in better-sqlite3 + chokidar).
//
// Invariants:
//   1. NEVER throw. Every error path is swallowed; emit must not break the
//      router request.
//   2. NEVER block. Emits are dispatched via setImmediate so the caller's
//      `void emit(...)` returns synchronously.
//   3. Auto-no-op when the mentor base URL or shared secret is unset. The
//      router is the primary serving path and must run even on machines that
//      haven't been provisioned with mentor-event-bus credentials.
//
// HMAC scheme matches packages/mentor-event-bus/src/auth.ts exactly:
//   X-Caia-Timestamp: <ms>
//   X-Caia-Signature: hex(hmac-sha256(secret, "<ts>:<body>"))

import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hostname as osHostname } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';

const TIMESTAMP_HEADER = 'x-caia-timestamp';
const SIGNATURE_HEADER = 'x-caia-signature';

const DEFAULT_BASE_URL = 'http://127.0.0.1:5180';

/** Event types this module knows how to emit. Kept in sync with the
 *  mentor-event-bus literal-tuple but intentionally a string here so the
 *  router doesn't take a hard type dependency. */
export type RouterEventType =
  | 'RouterDecision'
  | 'Compression'
  | 'ClaudeRequest'
  | 'ClaudeResponse'
  | 'ClaudeDuration';

export interface EmitterOptions {
  /** Base URL of the mentor-event-bus HTTP server. Default reads
   *  CAIA_MENTOR_EVENT_BUS_URL, then falls back to 127.0.0.1:5180. */
  baseUrl?: string;
  /** Override the shared secret. Default reads CAIA_EVENT_BUS_SECRET_PATH
   *  (file path) then CAIA_EVENT_BUS_SECRET (raw). Refuses too-short. */
  secret?: string;
  /** Hostname recorded on the emitted event. Default os.hostname(). */
  hostname?: string;
  /** Process name recorded on the emitted event. */
  processName?: string;
  /** Per-request timeout in ms. Default 2000 (kept short — emit is
   *  fire-and-forget; we don't want the router request to wait). */
  timeoutMs?: number;
  /** Inject a request function (test seam). */
  requestFn?: typeof httpRequest;
  /** Inject `now()` (test seam). */
  now?: () => number;
}

interface ResolvedConfig {
  baseUrl: URL;
  secret: string;
  hostname: string;
  processName: string | null;
  timeoutMs: number;
  requestFn: typeof httpRequest;
  now: () => number;
}

let cachedConfig: ResolvedConfig | null | undefined;

/** Resolve config lazily. Returns null when not configured — emits become no-ops. */
function getConfig(opts: EmitterOptions = {}): ResolvedConfig | null {
  if (Object.keys(opts).length === 0 && cachedConfig !== undefined) {
    return cachedConfig;
  }

  const baseUrlStr =
    opts.baseUrl ?? process.env['CAIA_MENTOR_EVENT_BUS_URL'] ?? DEFAULT_BASE_URL;

  let secret: string | null = null;
  if (opts.secret !== undefined) {
    secret = opts.secret;
  } else {
    const path = process.env['CAIA_EVENT_BUS_SECRET_PATH'];
    if (path && existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf-8').trim();
        if (raw.length >= 32) secret = raw;
      } catch {
        /* swallow — emit is best-effort */
      }
    }
    if (secret === null) {
      const envSecret = process.env['CAIA_EVENT_BUS_SECRET'];
      if (envSecret && envSecret.length >= 32) secret = envSecret;
    }
  }

  let resolved: ResolvedConfig | null;
  if (secret === null) {
    resolved = null;
  } else {
    let url: URL;
    try {
      url = new URL(baseUrlStr);
    } catch {
      resolved = null;
      if (Object.keys(opts).length === 0) cachedConfig = resolved;
      return resolved;
    }
    resolved = {
      baseUrl: url,
      secret,
      hostname: opts.hostname ?? osHostname(),
      processName: opts.processName ?? 'local-llm-router',
      timeoutMs: opts.timeoutMs ?? 2_000,
      requestFn:
        opts.requestFn ?? (url.protocol === 'https:' ? httpsRequest : httpRequest),
      now: opts.now ?? Date.now,
    };
  }

  if (Object.keys(opts).length === 0) cachedConfig = resolved;
  return resolved;
}

/** Test-only: clear the resolved-config cache. */
export function __resetEmitterConfig(): void {
  cachedConfig = undefined;
}

/** Test-only: install a config (bypasses env lookup). */
export function __setEmitterConfigForTests(opts: EmitterOptions): void {
  const resolved = getConfig(opts);
  cachedConfig = resolved;
}

function makeEventId(now: number): string {
  return `ev_${now.toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
}

/**
 * Emit a single mentor event. Returns immediately; the actual HTTP POST
 * happens asynchronously. ANY error (config missing, network down, server
 * 500) is swallowed. This is the public surface used by router.ts +
 * claude-adapter.ts.
 *
 * The `correlationId` is the prompt-level correlation id (usually inherited
 * via AsyncLocalStorage upstream); the router-level sibling correlator is
 * the `decisionId` baked into the payload.
 */
export function emitMentorEvent(
  type: RouterEventType,
  payload: Record<string, unknown>,
  meta: { correlationId?: string | null; parentEventId?: string | null } = {},
): void {
  // The setImmediate guarantees we never run inside the caller's
  // synchronous frame — any throw from `dispatch` lands on the next tick
  // where our top-level catch absorbs it.
  setImmediate(() => {
    try {
      dispatch(type, payload, meta);
    } catch {
      /* swallow */
    }
  });
}

function dispatch(
  type: RouterEventType,
  payload: Record<string, unknown>,
  meta: { correlationId?: string | null; parentEventId?: string | null },
): void {
  const cfg = getConfig();
  if (!cfg) return;

  const now = cfg.now();
  const emittedAt = new Date(now).toISOString();
  const event = {
    id: makeEventId(now),
    event_type: type,
    schema_version: 1,
    correlation_id: meta.correlationId ?? null,
    parent_event_id: meta.parentEventId ?? null,
    emitted_at: emittedAt,
    hostname: cfg.hostname,
    process_name: cfg.processName,
    payload_json: JSON.stringify(payload),
    validation_failed: 0,
  };

  let body: string;
  try {
    body = JSON.stringify({ events: [event] });
  } catch {
    return;
  }

  const ts = String(now);
  const signature = createHmac('sha256', cfg.secret)
    .update(`${ts}:${body}`)
    .digest('hex');

  const req = cfg.requestFn(
    {
      method: 'POST',
      protocol: cfg.baseUrl.protocol,
      hostname: cfg.baseUrl.hostname,
      port:
        cfg.baseUrl.port || (cfg.baseUrl.protocol === 'https:' ? 443 : 80),
      path: '/v1/events',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body).toString(),
        [TIMESTAMP_HEADER]: ts,
        [SIGNATURE_HEADER]: signature,
      },
      timeout: cfg.timeoutMs,
    },
    (resp) => {
      // Drain the response body so the socket can be re-used; ignore content.
      resp.resume();
    },
  );
  req.on('error', () => {
    /* swallow */
  });
  req.on('timeout', () => {
    try {
      req.destroy();
    } catch {
      /* swallow */
    }
  });
  try {
    req.write(body);
    req.end();
  } catch {
    /* swallow */
  }
}

/**
 * Mint a fresh router-decision id. Used by router.ts to correlate the
 * RouterDecision event with its sibling Compression / ClaudeRequest /
 * ClaudeResponse / ClaudeDuration events.
 */
export function newDecisionId(): string {
  return `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Mint a fresh claude-call request id. */
export function newClaudeRequestId(): string {
  return `creq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
