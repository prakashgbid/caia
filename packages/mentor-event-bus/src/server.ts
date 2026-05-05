/**
 * HTTP server for cross-machine event ingestion.
 *
 * Endpoints:
 *   - POST /v1/events       — emit one or more events (batch supported)
 *   - GET  /v1/healthz      — liveness probe (returns 200 "ok")
 *   - GET  /v1/recent       — read events (optionally filtered)
 *
 * Auth: every POST/GET (except /v1/healthz) carries the headers checked
 * by `verifyRequest` (HMAC-SHA256 over "<timestamp>:<body>"). Replay window
 * defaults to 5 min.
 *
 * Bind address: 127.0.0.1 by default (Mac-local only). Set
 * `CAIA_EVENT_BUS_BIND` to e.g. the Tailscale IP for cross-machine reach.
 *
 * NOTE on body parsing: the server reads the request body as a buffer + UTF-8
 * decodes it BEFORE auth verification, since the HMAC is computed over the
 * raw body text. Body is capped at 256 KiB per request — well above the
 * largest realistic payload + room for a small batch.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  DEFAULT_REPLAY_WINDOW_MS,
  loadSecret,
  verifyRequest
} from './auth.js';
import {
  insertEvent,
  queryEvents,
  type InsertEventArgs,
  type QueryEventsOptions
} from './sqlite.js';
import type { Database as DatabaseInstance } from 'better-sqlite3';

/** Maximum request body size (256 KiB). */
export const MAX_BODY_BYTES = 256 * 1024;

export interface ServerOptions {
  /** Open SQLite handle. Caller manages lifecycle. */
  db: DatabaseInstance;
  /** Bind host. Default 127.0.0.1. Set CAIA_EVENT_BUS_BIND for cross-machine. */
  host?: string;
  /** Bind port. Default 5180. */
  port?: number;
  /** Override secret loader (test injection). */
  secret?: string;
  /** Replay window in ms (default 5min). */
  replayWindowMs?: number;
  /** Logger. Default: console. */
  logger?: { info: (m: string) => void; warn: (m: string, ctx?: unknown) => void };
  /** Override the `now()` clock (for tests). */
  now?: () => number;
}

export interface RunningServer {
  server: Server;
  host: string;
  port: number;
  close: () => Promise<void>;
}

const DEFAULT_PORT = 5180;
const DEFAULT_HOST = '127.0.0.1';

const consoleLogger = {
  info: (m: string): void => console.log(m),
  warn: (m: string, ctx?: unknown): void => {
    if (ctx !== undefined) console.warn(m, ctx);
    else console.warn(m);
  }
};

/**
 * Start the HTTP server. Returns a RunningServer with `host`, `port`, and a
 * `close()` Promise. If `port` is 0, the OS assigns a port (used in tests).
 */
export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const host = opts.host ?? process.env['CAIA_EVENT_BUS_BIND'] ?? DEFAULT_HOST;
  const port = opts.port ?? Number(process.env['CAIA_EVENT_BUS_PORT'] ?? DEFAULT_PORT);
  const replayWindowMs = opts.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS;
  const logger = opts.logger ?? consoleLogger;
  const now = opts.now ?? Date.now;
  const secret = opts.secret ?? loadSecret();

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        db: opts.db,
        secret,
        replayWindowMs,
        logger,
        now
      });
    } catch (err) {
      logger.warn(`[mentor-event-bus] request handler threw: ${err}`);
      sendJson(res, 500, { error: 'internal' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;

  logger.info(`[mentor-event-bus] server listening on http://${host}:${boundPort}`);

  return {
    server,
    host,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  };
}

interface HandlerContext {
  db: DatabaseInstance;
  secret: string;
  replayWindowMs: number;
  logger: { info: (m: string) => void; warn: (m: string, ctx?: unknown) => void };
  now: () => number;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // Healthz is unauthenticated.
  if (path === '/v1/healthz' && method === 'GET') {
    sendText(res, 200, 'ok\n');
    return;
  }

  // Read the body (cap at MAX_BODY_BYTES).
  let body: string;
  try {
    body = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    sendJson(res, 413, { error: String(err) });
    return;
  }

  // Auth.
  const verify = verifyRequest(ctx.secret, body, req.headers, ctx.now(), ctx.replayWindowMs);
  if (!verify.ok) {
    ctx.logger.warn(`[mentor-event-bus] auth failed: ${verify.reason}`);
    sendJson(res, 401, { error: verify.reason });
    return;
  }

  // Routes.
  if (path === '/v1/events' && method === 'POST') {
    await handlePostEvents(req, res, body, ctx);
    return;
  }
  if (path === '/v1/recent' && method === 'GET') {
    handleGetRecent(req, res, ctx);
    return;
  }
  sendJson(res, 404, { error: 'not-found', path, method });
}

interface PostEventBody {
  events: Array<Omit<InsertEventArgs, 'id'> & { id?: string }>;
}

function handlePostEvents(
  _req: IncomingMessage,
  res: ServerResponse,
  body: string,
  ctx: HandlerContext
): void {
  let parsed: PostEventBody;
  try {
    parsed = JSON.parse(body) as PostEventBody;
  } catch {
    sendJson(res, 400, { error: 'invalid-json' });
    return;
  }
  if (!parsed || !Array.isArray(parsed.events)) {
    sendJson(res, 400, { error: 'expected-events-array' });
    return;
  }

  const inserted: number[] = [];
  for (const e of parsed.events) {
    if (!e || typeof e !== 'object') {
      sendJson(res, 400, { error: 'invalid-event' });
      return;
    }
    if (
      typeof e.event_type !== 'string' ||
      typeof e.payload_json !== 'string' ||
      typeof e.emitted_at !== 'string' ||
      typeof e.hostname !== 'string'
    ) {
      sendJson(res, 400, { error: 'missing-required-fields' });
      return;
    }
    try {
      const offset = insertEvent(ctx.db, {
        id: e.id ?? `srv_${ctx.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        event_type: e.event_type,
        schema_version: e.schema_version ?? 1,
        correlation_id: e.correlation_id ?? null,
        parent_event_id: e.parent_event_id ?? null,
        emitted_at: e.emitted_at,
        hostname: e.hostname,
        process_name: e.process_name ?? null,
        payload_json: e.payload_json,
        validation_failed: (e.validation_failed === 1 ? 1 : 0)
      });
      inserted.push(offset);
    } catch (err) {
      ctx.logger.warn(`[mentor-event-bus] insertEvent failed: ${err}`);
      sendJson(res, 500, { error: 'insert-failed', count: inserted.length });
      return;
    }
  }
  sendJson(res, 200, { ingested: inserted.length, offsets: inserted });
}

function handleGetRecent(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext
): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const params = url.searchParams;
  const opts: QueryEventsOptions = {};
  const eventType = params.get('eventType');
  if (eventType) opts.eventType = eventType;
  const correlationId = params.get('correlationId');
  if (correlationId) opts.correlationId = correlationId;
  const sinceIso = params.get('sinceIso');
  if (sinceIso) opts.sinceIso = sinceIso;
  const sinceOffset = params.get('sinceOffset');
  if (sinceOffset) {
    const n = Number(sinceOffset);
    if (Number.isFinite(n)) opts.sinceOffset = n;
  }
  const limitParam = params.get('limit');
  if (limitParam) {
    const n = Number(limitParam);
    if (Number.isFinite(n)) opts.limit = Math.min(n, 1000);
  } else {
    opts.limit = 100;
  }
  const order = params.get('order');
  if (order === 'asc' || order === 'desc') opts.order = order;

  try {
    const rows = queryEvents(ctx.db, opts);
    sendJson(res, 200, { events: rows });
  } catch (err) {
    ctx.logger.warn(`[mentor-event-bus] queryEvents failed: ${err}`);
    sendJson(res, 500, { error: 'query-failed' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error(`request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload).toString()
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body).toString()
  });
  res.end(body);
}
