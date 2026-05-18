// Mentor event-bus emit helper for @chiefaia/prompt-optimizer.
//
// Mirrors packages/local-llm-router/src/mentor-emit.ts. Kept separate (rather
// than introducing a workspace dep on local-llm-router) so that prompt-optimizer
// stays a leaf package — the dep edge runs router → optimizer, not vice-versa.
//
// Fire-and-forget HTTP POST to the mentor-event-bus `/v1/events` endpoint.
// Used by `optimize()` to emit one `PromptOptimizerStage` per stage. Never
// throws, never blocks.
//
// HMAC request signing delegated to @chiefaia/hmac-auth (PR #478 completion
// gate). Header names and canonical "<ts>:<body>" scheme are the canonical
// constants exported by that package; this module no longer hand-rolls them.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hostname as osHostname } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { signRequest } from '@chiefaia/hmac-auth';

const DEFAULT_BASE_URL = 'http://127.0.0.1:5180';

export type OptimizerEventType = 'PromptOptimizerStage' | 'Compression';

export interface EmitterOptions {
  baseUrl?: string;
  secret?: string;
  hostname?: string;
  processName?: string;
  timeoutMs?: number;
  requestFn?: typeof httpRequest;
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
        /* swallow */
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
      processName: opts.processName ?? 'prompt-optimizer',
      timeoutMs: opts.timeoutMs ?? 2_000,
      requestFn:
        opts.requestFn ?? (url.protocol === 'https:' ? httpsRequest : httpRequest),
      now: opts.now ?? Date.now,
    };
  }

  if (Object.keys(opts).length === 0) cachedConfig = resolved;
  return resolved;
}

export function __resetEmitterConfig(): void {
  cachedConfig = undefined;
}

export function __setEmitterConfigForTests(opts: EmitterOptions): void {
  const resolved = getConfig(opts);
  cachedConfig = resolved;
}

function makeEventId(now: number): string {
  return `ev_${now.toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
}

export function emitOptimizerEvent(
  type: OptimizerEventType,
  payload: Record<string, unknown>,
  meta: { correlationId?: string | null; parentEventId?: string | null } = {},
): void {
  setImmediate(() => {
    try {
      dispatch(type, payload, meta);
    } catch {
      /* swallow */
    }
  });
}

function dispatch(
  type: OptimizerEventType,
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

  const sigHeaders = signRequest(cfg.secret, body, now);

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
        ...sigHeaders,
      },
      timeout: cfg.timeoutMs,
    },
    (resp) => {
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

export function newOptimizerRunId(): string {
  return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
